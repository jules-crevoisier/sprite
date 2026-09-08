import { Bitmap, type Rect } from './bitmap'
import { getA, getR, getG, getB, rgba, type RGBA, luminance } from './color'
import type { Editor } from './editor'
import type { Cel } from './document'
import { outlineMask } from '../tools/algorithms'

/* ------------------------------------------------------------------ */
/* Portee des operations                                               */
/* ------------------------------------------------------------------ */

export type Scope = 'cel' | 'layer' | 'frame' | 'sprite'

/** Cases concernees par une operation selon la portee demandee. */
export function celsInScope(ed: Editor, scope: Scope): Cel[] {
  const sprite = ed.sprite
  switch (scope) {
    case 'cel': {
      const c = sprite.cel(ed.activeLayer, ed.activeFrame)
      return c ? [c] : []
    }
    case 'layer':
      return sprite.layers[ed.activeLayer].cels.filter((c): c is Cel => c !== null)
    case 'frame':
      return sprite.layers.map((l) => l.cels[ed.activeFrame]).filter((c): c is Cel => c !== null)
    case 'sprite':
      return sprite.layers.flatMap((l) => l.cels).filter((c): c is Cel => c !== null)
  }
}

/* ------------------------------------------------------------------ */
/* Transformations geometriques                                        */
/* ------------------------------------------------------------------ */

/**
 * Retourne le contenu. Avec une selection active, seul le contenu selectionne
 * est retourne, a l'interieur de sa boite englobante.
 */
export function flip(ed: Editor, axis: 'h' | 'v', scope: Scope): void {
  const cels = celsInScope(ed, scope)
  if (!cels.length) return
  const sel = ed.selection
  const box = sel.active ? sel.bounds() : null

  ed.runPixels(axis === 'h' ? 'Miroir horizontal' : 'Miroir vertical', cels, () => {
    for (const cel of cels) {
      if (!box) {
        const flipped = axis === 'h' ? cel.bitmap.flipH() : cel.bitmap.flipV()
        cel.bitmap.copyFrom(flipped)
      } else {
        const region = cel.bitmap.crop(box)
        const flipped = axis === 'h' ? region.flipH() : region.flipV()
        for (let y = 0; y < box.h; y++) {
          for (let x = 0; x < box.w; x++) {
            const tx = box.x + x, ty = box.y + y
            if (!sel.contains(tx, ty)) continue
            cel.bitmap.set(tx, ty, flipped.get(x, y))
          }
        }
      }
    }
  })
}

/** Rotation de la toile entiere par quarts de tour. */
export function rotateSprite(ed: Editor, quarters: number): void {
  const turns = ((quarters % 4) + 4) % 4
  if (turns === 0) return
  ed.run('Rotation', () => {
    const sprite = ed.sprite
    for (const layer of sprite.layers) {
      layer.cels = layer.cels.map((cel) => {
        if (!cel) return null
        let bm = cel.bitmap
        for (let i = 0; i < turns; i++) bm = bm.rotate90()
        return { ...cel, bitmap: bm }
      })
    }
    if (turns % 2 === 1) {
      const w = sprite.width
      sprite.width = sprite.height
      sprite.height = w
    }
  })
  ed.syncSelectionSize()
}

export type Anchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right'

function anchorOffset(anchor: Anchor, dw: number, dh: number): { x: number; y: number } {
  const col = anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5
  const row = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 : 0.5
  return { x: Math.round(dw * col), y: Math.round(dh * row) }
}

/** Change la taille de la toile sans toucher au contenu. */
export function resizeCanvas(ed: Editor, w: number, h: number, anchor: Anchor): void {
  const { x, y } = anchorOffset(anchor, w - ed.sprite.width, h - ed.sprite.height)
  ed.run('Taille de la toile', () => { ed.sprite.resizeCanvas(w, h, x, y) })
  ed.syncSelectionSize()
}

/** Redimensionne le sprite et son contenu. */
export function scaleSprite(ed: Editor, w: number, h: number, smooth: boolean): void {
  ed.run('Redimensionner le sprite', () => { ed.sprite.scale(w, h, smooth) })
  ed.syncSelectionSize()
}

/** Rogne la toile sur la selection active. */
export function cropToSelection(ed: Editor): boolean {
  if (!ed.selection.active) return false
  const box = ed.selection.bounds()
  ed.run('Rogner sur la selection', () => {
    ed.sprite.resizeCanvas(box.w, box.h, -box.x, -box.y)
  })
  ed.syncSelectionSize()
  return true
}

/** Rogne la toile sur les pixels visibles. */
export function trimSprite(ed: Editor): void {
  const box = ed.sprite.trimBounds()
  if (box.w === ed.sprite.width && box.h === ed.sprite.height) {
    ed.toast('Rien a rogner')
    return
  }
  ed.run('Rogner les bords vides', () => {
    ed.sprite.resizeCanvas(box.w, box.h, -box.x, -box.y)
  })
  ed.syncSelectionSize()
}

/* ------------------------------------------------------------------ */
/* Presse-papiers                                                      */
/* ------------------------------------------------------------------ */

/** Copie la zone selectionnee (ou toute la case) dans le presse-papiers interne. */
export function copySelection(ed: Editor): boolean {
  const cel = ed.peekCel()
  if (!cel) return false
  const sel = ed.selection
  const box: Rect = sel.active ? sel.bounds() : ed.sprite.bounds
  if (box.w === 0 || box.h === 0) return false
  const bitmap = cel.bitmap.crop(box)
  let mask: Uint8Array | null = null
  if (sel.active) {
    mask = new Uint8Array(box.w * box.h)
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) {
        const inside = sel.contains(box.x + x, box.y + y)
        mask[y * box.w + x] = inside ? 255 : 0
        if (!inside) bitmap.set(x, y, 0)
      }
    }
  }
  ed.clipboard = { bitmap, mask, w: box.w, h: box.h }
  return true
}

export function cutSelection(ed: Editor): boolean {
  if (!copySelection(ed)) return false
  deleteSelection(ed, 'Couper')
  return true
}

/** Efface les pixels selectionnes de la case active. */
export function deleteSelection(ed: Editor, label = 'Effacer'): void {
  const cel = ed.currentCel()
  if (!cel) return
  const sel = ed.selection
  ed.runPixels(label, [cel], () => {
    if (!sel.active) { cel.bitmap.clear(); return }
    for (let i = 0; i < cel.bitmap.u32.length; i++) if (sel.mask[i]) cel.bitmap.u32[i] = 0
  })
}

/** Colle le presse-papiers dans la case active et selectionne la zone collee. */
export function pasteClipboard(ed: Editor, at?: { x: number; y: number }): void {
  const clip = ed.clipboard
  if (!clip) { ed.toast('Presse-papiers vide', 'error'); return }
  const cel = ed.currentCel()
  if (!cel) return
  const box = ed.selection.active ? ed.selection.bounds() : null
  const x = at?.x ?? box?.x ?? 0
  const y = at?.y ?? box?.y ?? 0

  ed.runPixels('Coller', [cel], () => {
    cel.bitmap.paste(clip.bitmap, x, y, true)
  })

  const mask = new Uint8Array(ed.sprite.width * ed.sprite.height)
  for (let cy = 0; cy < clip.h; cy++) {
    for (let cx = 0; cx < clip.w; cx++) {
      const tx = x + cx, ty = y + cy
      if (tx < 0 || ty < 0 || tx >= ed.sprite.width || ty >= ed.sprite.height) continue
      if (clip.mask && !clip.mask[cy * clip.w + cx]) continue
      mask[ty * ed.sprite.width + tx] = 255
    }
  }
  ed.setSelectionMask(mask)
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

export function selectAll(ed: Editor): void {
  ed.beginSelectionChange()
  ed.selection.selectAll()
  ed.events.emit('selection', undefined)
  ed.commitSelectionChange('Tout selectionner')
}

export function deselect(ed: Editor): void {
  if (!ed.selection.active) return
  ed.beginSelectionChange()
  ed.selection.clear()
  ed.events.emit('selection', undefined)
  ed.commitSelectionChange('Deselectionner')
}

export function invertSelection(ed: Editor): void {
  ed.beginSelectionChange()
  if (!ed.selection.active) ed.selection.selectAll()
  else ed.selection.invert()
  ed.events.emit('selection', undefined)
  ed.commitSelectionChange('Inverser la selection')
}

export function growSelection(ed: Editor, amount: number): void {
  if (!ed.selection.active) return
  ed.beginSelectionChange()
  ed.selection.grow(amount)
  ed.events.emit('selection', undefined)
  ed.commitSelectionChange(amount > 0 ? 'Dilater la selection' : 'Contracter la selection')
}

/** Selectionne tous les pixels opaques de la case active. */
export function selectOpaque(ed: Editor): void {
  const cel = ed.peekCel()
  if (!cel) return
  const mask = new Uint8Array(ed.sprite.width * ed.sprite.height)
  for (let i = 0; i < cel.bitmap.u32.length; i++) mask[i] = getA(cel.bitmap.u32[i]) > 0 ? 255 : 0
  ed.beginSelectionChange()
  ed.setSelectionMask(mask)
  ed.commitSelectionChange('Selectionner le contenu')
}

/* ------------------------------------------------------------------ */
/* Effets                                                              */
/* ------------------------------------------------------------------ */

/** Remplit la selection (ou toute la case) avec une couleur. */
export function fillSelection(ed: Editor, color: RGBA): void {
  const cel = ed.currentCel()
  if (!cel) return
  const sel = ed.selection
  ed.runPixels('Remplir', [cel], () => {
    for (let y = 0; y < cel.bitmap.height; y++) {
      for (let x = 0; x < cel.bitmap.width; x++) {
        if (sel.active && !sel.contains(x, y)) continue
        cel.bitmap.blend(x, y, color)
      }
    }
  })
}

/** Ajoute un contour exterieur autour des pixels opaques. */
export function addOutline(ed: Editor, color: RGBA, thickness: number, diagonal: boolean, scope: Scope): void {
  const cels = celsInScope(ed, scope)
  if (!cels.length) return
  ed.runPixels('Contour', cels, () => {
    for (const cel of cels) {
      const mask = outlineMask(cel.bitmap, thickness, diagonal)
      for (let i = 0; i < mask.length; i++) if (mask[i]) cel.bitmap.u32[i] = color
    }
  })
}

/** Applique une transformation couleur par pixel sur la portee demandee. */
export function applyColorEffect(
  ed: Editor,
  label: string,
  scope: Scope,
  fn: (c: RGBA) => RGBA,
): void {
  const cels = celsInScope(ed, scope)
  if (!cels.length) return
  const sel = ed.selection
  ed.runPixels(label, cels, () => {
    for (const cel of cels) {
      const u = cel.bitmap.u32
      for (let i = 0; i < u.length; i++) {
        if (getA(u[i]) === 0) continue
        if (sel.active && !sel.mask[i]) continue
        u[i] = fn(u[i])
      }
    }
  })
}

export const invertColors = (c: RGBA): RGBA =>
  rgba(255 - getR(c), 255 - getG(c), 255 - getB(c), getA(c))

export const desaturate = (c: RGBA): RGBA => {
  const l = Math.round(luminance(c))
  return rgba(l, l, l, getA(c))
}

/** Aligne toutes les couleurs sur l'entree la plus proche de la palette. */
export function snapToPalette(ed: Editor, scope: Scope): void {
  const palette = ed.sprite.palette
  if (!palette.size) { ed.toast('Palette vide', 'error'); return }
  applyColorEffect(ed, 'Aligner sur la palette', scope, (c) => {
    const near = palette.nearest(c)
    return rgba(getR(near), getG(near), getB(near), getA(c))
  })
}

/** Remplace une couleur par une autre dans la portee demandee. */
export function replaceColor(ed: Editor, from: RGBA, to: RGBA, scope: Scope, tolerance = 0): void {
  applyColorEffect(ed, 'Remplacer la couleur', scope, (c) => {
    if (tolerance === 0) return c === from ? to : c
    const close =
      Math.abs(getR(c) - getR(from)) <= tolerance &&
      Math.abs(getG(c) - getG(from)) <= tolerance &&
      Math.abs(getB(c) - getB(from)) <= tolerance
    return close ? to : c
  })
}

/** Duplique la case active vers toutes les frames selectionnees. */
export function propagateCel(ed: Editor): void {
  const source = ed.peekCel()
  if (!source) { ed.toast('Case vide', 'error'); return }
  const layer = ed.layer
  const targets = [...ed.frameSelection].filter((f) => f !== ed.activeFrame)
  if (!targets.length) { ed.toast('Selectionnez plusieurs frames dans la timeline', 'error'); return }
  ed.run('Propager la case', () => {
    for (const f of targets) {
      layer.cels[f] = { bitmap: source.bitmap.clone(), opacity: source.opacity }
    }
  })
}

/** Cree un bitmap contenant le rendu de la selection (export rapide). */
export function selectionToBitmap(ed: Editor, source: Bitmap): Bitmap {
  const sel = ed.selection
  if (!sel.active) return source.clone()
  const box = sel.bounds()
  const out = source.crop(box)
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      if (!sel.contains(box.x + x, box.y + y)) out.set(x, y, 0)
    }
  }
  return out
}
