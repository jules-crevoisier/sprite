import type { Editor } from '../core/editor'
import { ICONS } from '../ui/icons'
import { line, rectOutline, rectFill, ellipseOutline, ellipseFill, bezier, type Pt } from './algorithms'
import { painterFor, constrain45, rectFromDrag, type PointerInfo, type Tool } from './types'

/** Applique un trace de forme sur la case active, apres restauration de l'etat initial. */
function drawShape(ed: Editor, p: PointerInfo, draw: (plot: (x: number, y: number) => void) => void): void {
  if (!ed.strokeBefore) return
  ed.resetStroke()
  const cel = ed.peekCel()
  if (!cel) return
  const painter = painterFor(ed, cel.bitmap, p)
  painter.beginStroke()
  draw(painter.plot)
  painter.endStroke()
  ed.events.emit('doc', undefined)
}

export const lineTool: Tool = {
  id: 'line',
  name: 'Ligne',
  shortcut: 'L',
  icon: ICONS.line,
  group: 'shape',
  hint: 'Maj : contraint a 45 degres.',
  options: ['brush', 'opacity', 'paintMode', 'dither'],
  down(ed) { ed.beginStroke('Ligne') },
  move(ed, p) {
    const end = p.shift ? constrain45(p.startPx, p.startPy, p.px, p.py) : { x: p.px, y: p.py }
    drawShape(ed, p, (plot) => line(p.startPx, p.startPy, end.x, end.y, plot))
  },
  up: (ed) => ed.commitStroke(),
  cancel: (ed) => ed.cancelStroke(),
}

export const rectangleTool: Tool = {
  id: 'rectangle',
  name: 'Rectangle',
  shortcut: 'U',
  icon: ICONS.rectangle,
  group: 'shape',
  hint: 'Maj : carre. Alt : depuis le centre.',
  options: ['brush', 'opacity', 'fillShapes', 'paintMode', 'dither'],
  down(ed) { ed.beginStroke('Rectangle') },
  move(ed, p) {
    const r = rectFromDrag(p.startPx, p.startPy, p.px, p.py, p.shift, p.alt)
    drawShape(ed, p, (plot) => {
      if (ed.settings.fillShapes) rectFill(r, plot)
      rectOutline(r, plot)
    })
  },
  up: (ed) => ed.commitStroke(),
  cancel: (ed) => ed.cancelStroke(),
}

export const ellipseTool: Tool = {
  id: 'ellipse',
  name: 'Ellipse',
  shortcut: 'Shift+U',
  icon: ICONS.ellipse,
  group: 'shape',
  hint: 'Maj : cercle. Alt : depuis le centre.',
  options: ['brush', 'opacity', 'fillShapes', 'paintMode', 'dither'],
  down(ed) { ed.beginStroke('Ellipse') },
  move(ed, p) {
    const r = rectFromDrag(p.startPx, p.startPy, p.px, p.py, p.shift, p.alt)
    drawShape(ed, p, (plot) => {
      if (ed.settings.fillShapes) ellipseFill(r, plot)
      ellipseOutline(r, plot)
    })
  },
  up: (ed) => ed.commitStroke(),
  cancel: (ed) => ed.cancelStroke(),
}

/* ------------------------------------------------------------------ */
/* Contour libre                                                       */
/* ------------------------------------------------------------------ */

let contourPts: Pt[] = []

export const contourTool: Tool = {
  id: 'contour',
  name: 'Contour',
  shortcut: 'Q',
  icon: ICONS.contour,
  group: 'shape',
  hint: 'Trace libre referme automatiquement au relachement.',
  options: ['brush', 'opacity', 'fillShapes', 'paintMode', 'dither'],
  down(ed, p) {
    if (!ed.beginStroke('Contour')) return
    contourPts = [{ x: p.px, y: p.py }]
  },
  move(ed, p) {
    const last = contourPts[contourPts.length - 1]
    if (!last || (last.x === p.px && last.y === p.py)) return
    contourPts.push({ x: p.px, y: p.py })
    drawShape(ed, p, (plot) => {
      for (let i = 1; i < contourPts.length; i++) {
        line(contourPts[i - 1].x, contourPts[i - 1].y, contourPts[i].x, contourPts[i].y, plot)
      }
    })
  },
  up(ed, p) {
    if (contourPts.length > 2) {
      drawShape(ed, p, (plot) => {
        if (ed.settings.fillShapes) {
          fillPolygon(contourPts, plot)
        }
        for (let i = 1; i < contourPts.length; i++) {
          line(contourPts[i - 1].x, contourPts[i - 1].y, contourPts[i].x, contourPts[i].y, plot)
        }
        const a = contourPts[contourPts.length - 1], b = contourPts[0]
        line(a.x, a.y, b.x, b.y, plot)
      })
    }
    contourPts = []
    ed.commitStroke()
  },
  cancel(ed) { contourPts = []; ed.cancelStroke() },
}

/** Remplissage pair-impair d'un polygone ferme. */
function fillPolygon(pts: Pt[], plot: (x: number, y: number) => void): void {
  if (pts.length < 3) return
  let minY = Infinity, maxY = -Infinity
  for (const q of pts) { minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y) }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const cy = y + 0.5
    const xs: number[] = []
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i]
      if (a.y === b.y) continue
      if ((cy >= a.y && cy < b.y) || (cy >= b.y && cy < a.y)) {
        xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x))
      }
    }
    xs.sort((u, v) => u - v)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) plot(x, y)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Courbe de Bezier                                                    */
/* ------------------------------------------------------------------ */

type CurvePhase = 'idle' | 'chord' | 'bend'
const curve = { phase: 'idle' as CurvePhase, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }

function drawCurve(ed: Editor, p: PointerInfo, bend: Pt | null): void {
  drawShape(ed, p, (plot) => {
    if (!bend) { line(curve.a.x, curve.a.y, curve.b.x, curve.b.y, plot); return }
    // Deux points de controle confondus sur le curseur : la courbe suit la
    // souris de maniere previsible, comme l'outil courbe d'Aseprite.
    const c1 = { x: curve.a.x + (bend.x - curve.a.x) * 1.15, y: curve.a.y + (bend.y - curve.a.y) * 1.15 }
    const c2 = { x: curve.b.x + (bend.x - curve.b.x) * 1.15, y: curve.b.y + (bend.y - curve.b.y) * 1.15 }
    bezier(curve.a, c1, c2, curve.b, plot)
  })
}

export const curveTool: Tool = {
  id: 'curve',
  name: 'Courbe',
  shortcut: 'Shift+C',
  icon: ICONS.curve,
  group: 'shape',
  hint: 'Glisser pour la corde, bouger pour cintrer, cliquer pour valider.',
  options: ['brush', 'opacity', 'paintMode', 'dither'],
  down(ed, p) {
    if (curve.phase === 'bend') {
      curve.phase = 'idle'
      ed.commitStroke()
      return
    }
    if (!ed.beginStroke('Courbe')) return
    curve.phase = 'chord'
    curve.a = { x: p.px, y: p.py }
    curve.b = { x: p.px, y: p.py }
  },
  move(ed, p) {
    if (curve.phase !== 'chord') return
    curve.b = p.shift ? constrain45(curve.a.x, curve.a.y, p.px, p.py) : { x: p.px, y: p.py }
    drawCurve(ed, p, null)
  },
  up(ed, _p) {
    if (curve.phase !== 'chord') return
    if (curve.a.x === curve.b.x && curve.a.y === curve.b.y) {
      curve.phase = 'idle'
      ed.commitStroke()
      return
    }
    curve.phase = 'bend'
  },
  hover(ed, p) {
    if (curve.phase !== 'bend') return
    drawCurve(ed, p, { x: p.px, y: p.py })
  },
  cancel(ed) { curve.phase = 'idle'; ed.cancelStroke() },
}
