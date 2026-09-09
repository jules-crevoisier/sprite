import { Bitmap } from '../core/bitmap'
import { getA } from '../core/color'
import type { Editor } from '../core/editor'
import { maskFromEllipse, maskFromPolygon, maskFromRect, type SelectionMode } from '../core/selection'
import { compositeFrame } from '../render/composite'
import { ICONS } from '../ui/icons'
import { floodFillMask, type Pt } from './algorithms'
import { rectFromDrag, type PointerInfo, type Tool } from './types'

/** Modificateurs clavier -> mode de combinaison, comme dans Aseprite. */
function modeFrom(p: PointerInfo): SelectionMode {
  if (p.ctrl) return 'intersect'
  if (p.shift && p.alt) return 'intersect'
  if (p.shift) return 'add'
  if (p.alt) return 'subtract'
  return 'replace'
}

function makeMarquee(
  name: string,
  id: 'select-rect' | 'select-ellipse',
  iconName: string,
  ellipse: boolean,
  shortcut: string,
): Tool {
  return {
    id,
    name,
    shortcut,
    icon: ICONS[iconName],
    group: 'select',
    hint: 'Maj : ajouter. Alt : soustraire. Ctrl : intersection.',
    options: ['selectionMode'],
    cursor: 'crosshair',
    down(ed) { resetPreviewBase(ed); gestureActive = true; ed.beginSelectionChange() },
    move(ed, p) {
      const r = rectFromDrag(p.startPx, p.startPy, p.px, p.py, false, false)
      const mask = ellipse
        ? maskFromEllipse(ed.sprite.width, ed.sprite.height, r)
        : maskFromRect(ed.sprite.width, ed.sprite.height, r)
      applyPreview(ed, mask, modeFrom(p))
    },
    up(ed, p) {
      gestureActive = false
      if (p.startPx === p.px && p.startPy === p.py) {
        // Un simple clic desélectionne.
        ed.selection.clear()
        ed.events.emit('selection', undefined)
      }
      ed.commitSelectionChange('Sélection')
    },
    // Annule uniquement le geste en cours : une selection deja validee
    // survit au changement d'outil.
    cancel: abortGesture,
  }
}

/** Masque de depart du geste courant, pour recombiner a chaque deplacement. */
let previewBase: Uint8Array | null = null
/** Vrai entre le clic et le relachement d'un outil de selection. */
let gestureActive = false

/** Restaure le masque d'avant le geste, uniquement si un geste est en cours. */
function abortGesture(ed: Editor): void {
  if (!gestureActive) return
  gestureActive = false
  if (previewBase && previewBase.length === ed.selection.mask.length) {
    ed.selection.combine(previewBase, 'replace')
    ed.events.emit('selection', undefined)
  }
}

function applyPreview(ed: Editor, mask: Uint8Array, mode: SelectionMode): void {
  if (!previewBase || previewBase.length !== ed.selection.mask.length) {
    previewBase = new Uint8Array(ed.selection.mask)
  }
  ed.selection.combine(previewBase, 'replace')
  ed.selection.combine(mask, mode)
  ed.events.emit('selection', undefined)
}

function resetPreviewBase(ed: Editor): void {
  previewBase = new Uint8Array(ed.selection.mask)
}

export const selectRectTool = makeMarquee('Sélection rectangulaire', 'select-rect', 'select-rect', false, 'M')
export const selectEllipseTool = makeMarquee('Sélection elliptique', 'select-ellipse', 'select-ellipse', true, 'Shift+M')

/* ------------------------------------------------------------------ */
/* Lasso                                                               */
/* ------------------------------------------------------------------ */

let lassoPts: Pt[] = []

export const lassoTool: Tool = {
  id: 'lasso',
  name: 'Lasso',
  shortcut: 'Shift+L',
  icon: ICONS.lasso,
  group: 'select',
  hint: 'Tracé libre referme automatiquement.',
  options: ['selectionMode'],
  cursor: 'crosshair',
  down(ed, p) {
    resetPreviewBase(ed)
    gestureActive = true
    ed.beginSelectionChange()
    lassoPts = [{ x: p.x, y: p.y }]
  },
  move(ed, p) {
    lassoPts.push({ x: p.x, y: p.y })
    if (lassoPts.length < 3) return
    applyPreview(ed, maskFromPolygon(ed.sprite.width, ed.sprite.height, lassoPts), modeFrom(p))
  },
  up(ed, p) {
    gestureActive = false
    if (lassoPts.length < 3) {
      ed.selection.clear()
      ed.events.emit('selection', undefined)
    } else {
      applyPreview(ed, maskFromPolygon(ed.sprite.width, ed.sprite.height, lassoPts), modeFrom(p))
    }
    lassoPts = []
    ed.commitSelectionChange('Lasso')
  },
  cancel(ed) { lassoPts = []; abortGesture(ed) },
  overlay(_ed, o) {
    if (lassoPts.length < 2) return
    const { ctx } = o
    ctx.save()
    ctx.strokeStyle = '#ffffffdd'
    ctx.lineWidth = 1 / o.zoom
    ctx.beginPath()
    ctx.moveTo(lassoPts[0].x, lassoPts[0].y)
    for (const q of lassoPts) ctx.lineTo(q.x, q.y)
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
  },
}

/* ------------------------------------------------------------------ */
/* Baguette magique                                                    */
/* ------------------------------------------------------------------ */

export const magicWandTool: Tool = {
  id: 'magic-wand',
  name: 'Baguette magique',
  shortcut: 'W',
  icon: ICONS['magic-wand'],
  group: 'select',
  hint: 'Alt : baser la sélection sur le calque actif uniquement.',
  options: ['tolerance', 'contiguous', 'selectionMode'],
  cursor: 'crosshair',
  down(ed, p) {
    resetPreviewBase(ed)
    ed.beginSelectionChange()
    const src = p.alt ? ed.peekCel()?.bitmap : compositeFrame(ed.sprite, ed.activeFrame)
    if (!src) return
    const mask = floodFillMask(src, p.px, p.py, {
      tolerance: ed.settings.tolerance,
      contiguous: ed.settings.contiguous,
    })
    applyPreview(ed, mask, modeFrom(p))
    ed.commitSelectionChange('Baguette magique')
  },
  move() {},
  up() {},
}

/* ------------------------------------------------------------------ */
/* Deplacement                                                         */
/* ------------------------------------------------------------------ */

interface MoveState {
  hole: Bitmap
  lifted: Bitmap
  origMask: Uint8Array | null
  active: boolean
}
let moveState: MoveState | null = null

/** Detache les pixels selectionnes (ou toute la case) pour les deplacer. */
export function beginMove(ed: Editor): boolean {
  const cel = ed.beginStroke('Déplacer')
  if (!cel) return false
  const before = ed.strokeBefore!
  const sel = ed.selection
  const hole = before.clone()
  const lifted = new Bitmap(before.width, before.height)

  if (sel.active) {
    for (let i = 0; i < before.u32.length; i++) {
      if (sel.mask[i]) {
        lifted.u32[i] = before.u32[i]
        hole.u32[i] = 0
      }
    }
  } else {
    lifted.copyFrom(before)
    hole.clear()
  }
  moveState = {
    hole,
    lifted,
    origMask: sel.active ? new Uint8Array(sel.mask) : null,
    active: true,
  }
  return true
}

/** Applique un decalage au contenu detache. */
export function applyMove(ed: Editor, dx: number, dy: number): void {
  const st = moveState
  if (!st) return
  const cel = ed.peekCel()
  if (!cel) return
  cel.bitmap.copyFrom(st.hole)
  cel.bitmap.paste(st.lifted.shift(dx, dy, ed.tiledDrawing), 0, 0, true)
  if (st.origMask) {
    ed.selection.combine(st.origMask, 'replace')
    ed.selection.translate(dx, dy)
    ed.events.emit('selection', undefined)
  }
  ed.events.emit('doc', undefined)
}

export function endMove(ed: Editor): void {
  moveState = null
  ed.commitStroke()
}

export const moveTool: Tool = {
  id: 'move',
  name: 'Déplacer',
  shortcut: 'V',
  icon: ICONS.move,
  group: 'select',
  hint: 'Déplace la sélection, ou tout le contenu du calque si rien n\'est sélectionné.',
  options: [],
  cursor: 'move',
  down(ed) { beginMove(ed) },
  move(ed, p) {
    if (!moveState) return
    applyMove(ed, p.px - p.startPx, p.py - p.startPy)
  },
  up(ed) { if (moveState) endMove(ed) },
  cancel(ed) { moveState = null; ed.cancelStroke() },
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

/** La main et la loupe sont pilotees par le controleur de canvas. */
export const handTool: Tool = {
  id: 'hand',
  name: 'Main',
  shortcut: 'H',
  icon: ICONS.hand,
  group: 'nav',
  hint: 'Barre espace : main temporaire depuis n\'importe quel outil.',
  options: [],
  cursor: 'grab',
  down() {}, move() {}, up() {},
}

export const zoomTool: Tool = {
  id: 'zoom',
  name: 'Loupe',
  shortcut: 'Z',
  icon: ICONS.zoom,
  group: 'nav',
  hint: 'Clic : zoom avant. Alt ou clic droit : zoom arrière.',
  options: [],
  cursor: 'zoom-in',
  down() {}, move() {}, up() {},
}

/** Vrai si la case contient au moins un pixel opaque dans la selection. */
export function selectionHasPixels(bm: Bitmap, mask: Uint8Array): boolean {
  for (let i = 0; i < bm.u32.length; i++) {
    if (mask[i] && getA(bm.u32[i]) > 0) return true
  }
  return false
}
