import { getA, getR, getG, getB, rgba, lerpColor, rgbaToHsv, hsvToRgba } from '../core/color'
import type { Editor } from '../core/editor'
import { compositeFrame } from '../render/composite'
import { line, floodFillMask, PixelPerfectStroke, dither, type Pt } from './algorithms'
import { Painter } from './painter'
import { ICONS } from '../ui/icons'
import { activeColor, otherColor, painterFor, type PointerInfo, type Tool } from './types'

/** Points confirmes du trait courant, partages entre crayon et gomme. */
interface FreehandState {
  pp: PixelPerfectStroke | null
  points: Pt[]
  last: Pt | null
}
const freehand: FreehandState = { pp: null, points: [], last: null }

/** Dernier point valide du trait precedent, pour le trace en ligne avec Maj. */
let lastCommitted: Pt | null = null

function freehandBegin(ed: Editor, p: PointerInfo, label: string, erase: boolean): void {
  if (!ed.beginStroke(label)) return
  freehand.pp = ed.settings.pixelPerfect && ed.settings.brushSize === 1 ? new PixelPerfectStroke() : null
  freehand.points = []
  freehand.last = null

  if (p.shift && lastCommitted) {
    line(lastCommitted.x, lastCommitted.y, p.px, p.py, (x, y) => feed(x, y))
  } else {
    feed(p.px, p.py)
  }
  redraw(ed, p, erase)
}

function feed(x: number, y: number): void {
  if (freehand.pp) {
    freehand.pp.push(x, y)
    freehand.points = freehand.pp.points
  } else {
    const l = freehand.last
    if (l && l.x === x && l.y === y) return
    freehand.points.push({ x, y })
  }
  freehand.last = { x, y }
}

/**
 * Rejoue l'integralite du trait depuis l'etat initial. Necessaire car le
 * filtre pixel-perfect peut retirer un point deja pose.
 */
function redraw(ed: Editor, p: PointerInfo, erase: boolean): void {
  ed.resetStroke()
  const cel = ed.peekCel()
  if (!cel) return
  const painter = painterFor(ed, cel.bitmap, p, erase ? { mode: 'erase' } : {})
  painter.beginStroke()
  for (const pt of freehand.points) painter.plot(pt.x, pt.y)
  painter.endStroke()
  ed.events.emit('doc', undefined)
}

function freehandMove(ed: Editor, p: PointerInfo, erase: boolean): void {
  if (!ed.strokeBefore) return
  line(p.prevPx, p.prevPy, p.px, p.py, (x, y) => feed(x, y))
  redraw(ed, p, erase)
}

function freehandUp(ed: Editor): void {
  const pts = freehand.points
  if (pts.length) lastCommitted = pts[pts.length - 1]
  freehand.points = []
  freehand.pp = null
  ed.commitStroke()
}

export const pencilTool: Tool = {
  id: 'pencil',
  name: 'Crayon',
  shortcut: 'B',
  icon: ICONS.pencil,
  group: 'draw',
  hint: 'Maj : ligne depuis le dernier point. Clic droit : couleur secondaire.',
  options: ['brush', 'opacity', 'paintMode', 'pixelPerfect', 'dither'],
  down: (ed, p) => freehandBegin(ed, p, 'Crayon', false),
  move: (ed, p) => freehandMove(ed, p, false),
  up: (ed) => freehandUp(ed),
  cancel: (ed) => { freehand.points = []; ed.cancelStroke() },
}

export const eraserTool: Tool = {
  id: 'eraser',
  name: 'Gomme',
  shortcut: 'E',
  icon: ICONS.eraser,
  group: 'draw',
  options: ['brush', 'opacity', 'pixelPerfect'],
  down: (ed, p) => freehandBegin(ed, p, 'Gomme', true),
  move: (ed, p) => freehandMove(ed, p, true),
  up: (ed) => freehandUp(ed),
  cancel: (ed) => { freehand.points = []; ed.cancelStroke() },
}

/* ------------------------------------------------------------------ */
/* Pot de peinture                                                     */
/* ------------------------------------------------------------------ */

export const bucketTool: Tool = {
  id: 'bucket',
  name: 'Pot de peinture',
  shortcut: 'G',
  icon: ICONS.bucket,
  group: 'draw',
  hint: 'Maj : remplit selon le rendu de tous les calques visibles.',
  options: ['tolerance', 'contiguous', 'opacity', 'dither', 'paintMode'],
  down(ed, p) {
    const cel = ed.beginStroke('Pot de peinture')
    if (!cel) return
    // Maj : la zone est determinee sur l'aplat de tous les calques visibles.
    const source = p.shift ? compositeFrame(ed.sprite, ed.activeFrame) : cel.bitmap
    const mask = floodFillMask(source, p.px, p.py, {
      tolerance: ed.settings.tolerance,
      contiguous: ed.settings.contiguous,
      within: ed.selection.active ? ed.selection.mask : null,
    })
    const painter = painterFor(ed, cel.bitmap, p)
    painter.fillMask(mask)
    ed.commitStroke()
  },
  move() {},
  up() {},
}

/* ------------------------------------------------------------------ */
/* Pipette                                                             */
/* ------------------------------------------------------------------ */

function pick(ed: Editor, p: PointerInfo): void {
  const src = p.alt
    ? ed.peekCel()?.bitmap
    : compositeFrame(ed.sprite, ed.activeFrame)
  if (!src) return
  const c = src.get(p.px, p.py)
  if (p.button === 2) ed.setSecondary(c)
  else ed.setPrimary(c)
}

export const eyedropperTool: Tool = {
  id: 'eyedropper',
  name: 'Pipette',
  shortcut: 'I',
  icon: ICONS.eyedropper,
  group: 'draw',
  hint: 'Alt : preleve uniquement sur le calque actif.',
  options: [],
  cursor: 'crosshair',
  down: pick,
  move: pick,
  up() {},
}

/* ------------------------------------------------------------------ */
/* Aerographe                                                          */
/* ------------------------------------------------------------------ */

function sprayStep(ed: Editor, p: PointerInfo): void {
  const cel = ed.peekCel()
  if (!cel) return
  const painter = painterFor(ed, cel.bitmap, p, { brushSize: 1, brushShape: 'square' })
  const radius = Math.max(1, ed.settings.brushSize)
  const n = Math.max(1, Math.round(ed.settings.sprayDensity))
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * radius
    painter.plot(Math.round(p.x + Math.cos(a) * r), Math.round(p.y + Math.sin(a) * r))
  }
  ed.events.emit('doc', undefined)
}

export const sprayTool: Tool = {
  id: 'spray',
  name: 'Aerographe',
  shortcut: 'A',
  icon: ICONS.spray,
  group: 'draw',
  options: ['brush', 'opacity', 'sprayDensity', 'dither'],
  down(ed, p) { if (ed.beginStroke('Aerographe')) sprayStep(ed, p) },
  move(ed, p) { if (ed.strokeBefore) sprayStep(ed, p) },
  up: (ed) => ed.commitStroke(),
  cancel: (ed) => ed.cancelStroke(),
}

/* ------------------------------------------------------------------ */
/* Flou                                                                */
/* ------------------------------------------------------------------ */

function blurStep(ed: Editor, p: PointerInfo): void {
  const cel = ed.peekCel()
  if (!cel) return
  const src = cel.bitmap.clone()
  const strength = ed.settings.strength
  const painter = painterFor(ed, cel.bitmap, p, {
    transform: (dst, x, y) => {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = src.get(x + dx, y + dy)
          if (!src.inside(x + dx, y + dy)) continue
          const w = dx === 0 && dy === 0 ? 4 : 1
          r += getR(c) * w; g += getG(c) * w; b += getB(c) * w; a += getA(c) * w
          n += w
        }
      }
      if (!n) return dst
      const avg = rgba(r / n, g / n, b / n, a / n)
      return lerpColor(dst, avg, strength * 3)
    },
  })
  painter.plot(p.px, p.py)
  line(p.prevPx, p.prevPy, p.px, p.py, painter.plot)
  ed.events.emit('doc', undefined)
}

export const blurTool: Tool = {
  id: 'blur',
  name: 'Flou',
  shortcut: 'Y',
  icon: ICONS.blur,
  group: 'draw',
  options: ['brush', 'strength'],
  down(ed, p) { if (ed.beginStroke('Flou')) blurStep(ed, p) },
  move(ed, p) { if (ed.strokeBefore) blurStep(ed, p) },
  up: (ed) => ed.commitStroke(),
  cancel: (ed) => ed.cancelStroke(),
}

/* ------------------------------------------------------------------ */
/* Shading                                                             */
/* ------------------------------------------------------------------ */

function shadeStep(ed: Editor, p: PointerInfo): void {
  const cel = ed.peekCel()
  if (!cel) return
  // Clic gauche eclaircit, clic droit assombrit.
  const dir = p.button === 2 ? -1 : 1
  const amount = ed.settings.strength * dir
  const palette = ed.sprite.palette
  const painter = painterFor(ed, cel.bitmap, p, {
    transform: (dst) => {
      if (getA(dst) === 0) return dst
      const hsv = rgbaToHsv(dst)
      hsv.v = Math.min(1, Math.max(0, hsv.v + amount))
      // Legere derive de teinte : les ombres tirent vers le froid,
      // les lumieres vers le chaud, comme le fait un artiste.
      hsv.h = (hsv.h + dir * 4 + 360) % 360
      hsv.s = Math.min(1, Math.max(0, hsv.s - amount * 0.25))
      const shifted = hsvToRgba(hsv)
      return palette.size > 0 ? palette.nearest(shifted) : shifted
    },
  })
  painter.beginStroke()
  line(p.prevPx, p.prevPy, p.px, p.py, painter.plot)
  painter.plot(p.px, p.py)
  painter.endStroke()
  ed.events.emit('doc', undefined)
}

export const shadingTool: Tool = {
  id: 'shading',
  name: 'Ombrage',
  shortcut: 'D',
  icon: ICONS.shading,
  group: 'draw',
  hint: 'Clic gauche eclaircit, clic droit assombrit. Aligne sur la palette.',
  options: ['brush', 'strength'],
  down(ed, p) { if (ed.beginStroke('Ombrage')) shadeStep(ed, p) },
  move(ed, p) { if (ed.strokeBefore) shadeStep(ed, p) },
  up: (ed) => ed.commitStroke(),
  cancel: (ed) => ed.cancelStroke(),
}

/* ------------------------------------------------------------------ */
/* Degrade                                                             */
/* ------------------------------------------------------------------ */

export const gradientTool: Tool = {
  id: 'gradient',
  name: 'Degrade',
  shortcut: 'R',
  icon: ICONS.gradient,
  group: 'draw',
  hint: 'Glisser pour definir l\'axe. Maj : degrade radial.',
  options: ['gradientDither', 'opacity', 'paintMode'],
  down(ed, _p) { ed.beginStroke('Degrade') },
  move(ed, p) {
    if (!ed.strokeBefore) return
    ed.resetStroke()
    const cel = ed.peekCel()
    if (!cel) return
    const from = activeColor(ed, p)
    const to = otherColor(ed, p)
    const ax = p.startPx + 0.5, ay = p.startPy + 0.5
    const bx = p.px + 0.5, by = p.py + 0.5
    const dx = bx - ax, dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return
    const radial = p.shift
    const radius = Math.sqrt(lenSq)
    const useDither = ed.settings.gradientDither

    const painter = new Painter(cel.bitmap, {
      selection: ed.selection,
      brushSize: 1,
      mode: ed.settings.paintMode,
      opacity: ed.settings.opacity,
      transform: (dst, x, y) => {
        const px = x + 0.5, py = y + 0.5
        let t = radial
          ? Math.hypot(px - ax, py - ay) / radius
          : ((px - ax) * dx + (py - ay) * dy) / lenSq
        t = Math.min(1, Math.max(0, t))
        const color = useDither
          ? (dither('bayer8', x, y, 1 - t) ? from : to)
          : lerpColor(from, to, t)
        if (getA(color) === 0) return dst
        if (ed.settings.paintMode === 'lock-alpha' && getA(dst) === 0) return dst
        if (ed.settings.paintMode === 'behind' && getA(dst) !== 0) return dst
        return color
      },
    })
    const region = ed.selection.active ? ed.selection.mask : null
    for (let y = 0; y < cel.bitmap.height; y++) {
      for (let x = 0; x < cel.bitmap.width; x++) {
        if (region && !region[y * cel.bitmap.width + x]) continue
        painter.plot(x, y)
      }
    }
    ed.events.emit('doc', undefined)
  },
  up: (ed) => ed.commitStroke(),
  cancel: (ed) => ed.cancelStroke(),
  overlay(_ed, o, p) {
    if (!p) return
    o.ctx.save()
    o.ctx.strokeStyle = '#ffffffcc'
    o.ctx.lineWidth = 1 / o.zoom
    o.ctx.setLineDash([3 / o.zoom, 3 / o.zoom])
    o.ctx.beginPath()
    o.ctx.moveTo(p.startPx + 0.5, p.startPy + 0.5)
    o.ctx.lineTo(p.px + 0.5, p.py + 0.5)
    o.ctx.stroke()
    o.ctx.restore()
  },
}
