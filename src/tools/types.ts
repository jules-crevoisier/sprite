import type { Editor, ToolId } from '../core/editor'
import { Painter, type PainterOptions } from './painter'
import type { RGBA } from '../core/color'
import type { Bitmap } from '../core/bitmap'

export interface PointerInfo {
  /** Coordonnees en pixels sprite (fractionnaires). */
  x: number
  y: number
  /** Coordonnees entieres du pixel survole. */
  px: number
  py: number
  /** Pixel ou le geste a commence. */
  startPx: number
  startPy: number
  /** Pixel du precedent evenement de deplacement. */
  prevPx: number
  prevPy: number
  shift: boolean
  alt: boolean
  ctrl: boolean
  /** 0 = principal, 2 = secondaire. */
  button: number
  /** Pression du stylet (1 par defaut). */
  pressure: number
}

/** Contexte de dessin de l'aperçu, déjà mis a l'echelle en pixels sprite. */
export interface OverlayContext {
  ctx: CanvasRenderingContext2D
  zoom: number
}

export interface Tool {
  id: ToolId
  name: string
  shortcut: string
  icon: string
  group: 'draw' | 'shape' | 'select' | 'nav' | 'rig'
  /** Reglages pertinents affichés dans la barre d'options. */
  options: ToolOption[]
  cursor?: string
  hint?: string
  down(ed: Editor, p: PointerInfo): void
  move(ed: Editor, p: PointerInfo): void
  up(ed: Editor, p: PointerInfo): void
  /** Deplacement du curseur sans bouton enfonce (outils multi-etapes). */
  hover?(ed: Editor, p: PointerInfo): void
  /** Annulation au clavier (Echap). */
  cancel?(ed: Editor): void
  overlay?(ed: Editor, o: OverlayContext, p: PointerInfo | null): void
}

export type ToolOption =
  | 'brush' | 'opacity' | 'paintMode' | 'pixelPerfect' | 'dither'
  | 'tolerance' | 'contiguous' | 'fillShapes' | 'strength' | 'sprayDensity'
  | 'selectionMode' | 'gradientDither' | 'weightBrush' | 'seam'

/** Couleur active selon le bouton de la souris (droit = couleur secondaire). */
export function activeColor(ed: Editor, p: PointerInfo): RGBA {
  return p.button === 2 ? ed.secondary : ed.primary
}

export function otherColor(ed: Editor, p: PointerInfo): RGBA {
  return p.button === 2 ? ed.primary : ed.secondary
}

/** Construit un Painter configure avec les reglages courants de l'editeur. */
export function painterFor(ed: Editor, target: Bitmap, p: PointerInfo, over: PainterOptions = {}): Painter {
  const s = ed.settings
  return new Painter(target, {
    selection: ed.selection,
    brushSize: s.brushSize,
    brushShape: s.brushShape,
    color: activeColor(ed, p),
    secondary: otherColor(ed, p),
    ditherPattern: s.ditherPattern,
    ditherRatio: s.ditherRatio,
    mode: s.paintMode,
    opacity: s.opacity,
    symmetryX: ed.symmetry.x ? ed.symmetry.axisX : null,
    symmetryY: ed.symmetry.y ? ed.symmetry.axisY : null,
    tiled: ed.tiledDrawing,
    ...over,
  })
}

/** Contraint un point sur un axe ou une diagonale a 45 degres. */
export function constrain45(x0: number, y0: number, x1: number, y1: number): { x: number; y: number } {
  const dx = x1 - x0
  const dy = y1 - y0
  const adx = Math.abs(dx), ady = Math.abs(dy)
  if (adx > ady * 2) return { x: x1, y: y0 }
  if (ady > adx * 2) return { x: x0, y: y1 }
  const d = Math.max(adx, ady)
  return { x: x0 + Math.sign(dx) * d, y: y0 + Math.sign(dy) * d }
}

/** Rectangle normalise a partir de deux coins, options carre et depuis-le-centre. */
export function rectFromDrag(
  x0: number, y0: number, x1: number, y1: number,
  square: boolean, fromCenter: boolean,
) {
  let ax = x0, ay = y0, bx = x1, by = y1
  if (square) {
    const d = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
    bx = ax + Math.sign(bx - ax || 1) * d
    by = ay + Math.sign(by - ay || 1) * d
  }
  if (fromCenter) {
    const dx = bx - ax, dy = by - ay
    ax -= dx; ay -= dy
  }
  const x = Math.min(ax, bx), y = Math.min(ay, by)
  return { x, y, w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 }
}
