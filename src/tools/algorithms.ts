import { Bitmap, type Rect } from '../core/bitmap'
import { type RGBA, getA, getR, getG, getB } from '../core/color'

export type Plot = (x: number, y: number) => void
export interface Pt { x: number; y: number }

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** Bresenham entier : la ligne diagonale reste nette, sans anti-aliasing. */
export function line(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    plot(x0, y0)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}

export function rectOutline(r: Rect, plot: Plot): void {
  const x1 = r.x + r.w - 1
  const y1 = r.y + r.h - 1
  for (let x = r.x; x <= x1; x++) { plot(x, r.y); plot(x, y1) }
  for (let y = r.y; y <= y1; y++) { plot(r.x, y); plot(x1, y) }
}

export function rectFill(r: Rect, plot: Plot): void {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) plot(x, y)
}

/**
 * Ellipse par point milieu, inscrite dans `r`.
 * Les rayons demi-entiers sont geres en dupliquant la ligne/colonne centrale,
 * ce qui donne des cercles symetriques en taille paire comme impaire.
 */
export function ellipseOutline(r: Rect, plot: Plot): void {
  if (r.w <= 0 || r.h <= 0) return
  if (r.w <= 2 || r.h <= 2) { rectOutline(r, plot); return }
  const a = (r.w - 1) / 2
  const b = (r.h - 1) / 2
  const cx = r.x + a
  const cy = r.y + b
  const seen = new Set<number>()
  const p = (x: number, y: number) => {
    const k = (x + 4096) * 100000 + (y + 4096)
    if (seen.has(k)) return
    seen.add(k)
    plot(x, y)
  }
  const steps = Math.max(16, Math.ceil((r.w + r.h) * 2))
  let px = NaN, py = NaN
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const x = Math.round(cx + a * Math.cos(t))
    const y = Math.round(cy + b * Math.sin(t))
    if (!Number.isNaN(px) && (Math.abs(x - px) > 1 || Math.abs(y - py) > 1)) {
      line(px, py, x, y, p)
    } else p(x, y)
    px = x; py = y
  }
}

export function ellipseFill(r: Rect, plot: Plot): void {
  if (r.w <= 0 || r.h <= 0) return
  const rx = r.w / 2, ry = r.h / 2
  const cx = r.x + rx, cy = r.y + ry
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const nx = (x + 0.5 - cx) / rx
      const ny = (y + 0.5 - cy) / ry
      if (nx * nx + ny * ny <= 1) plot(x, y)
    }
  }
}

/** Courbe de Bezier cubique echantillonnee puis reliee en Bresenham. */
export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, plot: Plot): void {
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y) + Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y)
  const steps = Math.max(8, Math.ceil(dist * 2))
  let px = NaN, py = NaN
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const x = Math.round(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x)
    const y = Math.round(u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y)
    if (Number.isNaN(px)) plot(x, y)
    else if (x !== px || y !== py) line(px, py, x, y, plot)
    px = x; py = y
  }
}

/* ------------------------------------------------------------------ */
/* Brosses                                                             */
/* ------------------------------------------------------------------ */

export type BrushShape = 'circle' | 'square' | 'diamond' | 'h-line' | 'v-line'

const brushCache = new Map<string, Int16Array>()

/**
 * Decalages (dx,dy) couverts par la brosse, centres sur 0.
 * Les tailles paires sont decalees de -0.5 pour rester centrees sur le curseur.
 */
export function brushOffsets(size: number, shape: BrushShape): Int16Array {
  const key = `${size}:${shape}`
  const hit = brushCache.get(key)
  if (hit) return hit
  const s = Math.max(1, Math.round(size))
  const c = (s - 1) / 2          // centre geometrique, demi-entier si s est pair
  const rad = s / 2
  const intOff = Math.floor(c)   // biais haut-gauche pour les tailles paires
  const thr = (rad - 0.25) * (rad - 0.25)
  const out: number[] = []
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - c
      const dy = y - c
      let inside: boolean
      switch (shape) {
        case 'square': inside = true; break
        case 'diamond': inside = Math.abs(dx) + Math.abs(dy) <= rad; break
        // Une taille paire n'a pas de rangee centrale : on prend celle dont
        // le decalage est nul, sinon les deux passaient et la ligne devenait
        // un carre — les cinq formes se ressemblaient toutes a la taille 2.
        case 'h-line': inside = y - intOff === 0; break
        case 'v-line': inside = x - intOff === 0; break
        default: inside = dx * dx + dy * dy <= thr
      }
      if (inside) out.push(x - intOff, y - intOff)
    }
  }
  const arr = new Int16Array(out)
  brushCache.set(key, arr)
  return arr
}

/* ------------------------------------------------------------------ */
/* Pixel perfect                                                       */
/* ------------------------------------------------------------------ */

/**
 * Supprime les pixels "en coin" d'un trace libre : quand trois points
 * consecutifs forment un L, celui du milieu est redondant. C'est le
 * comportement "pixel perfect" d'Aseprite.
 */
export class PixelPerfectStroke {
  private pts: Pt[] = []
  private emitted = 0

  /** Ajoute un point et retourne les points valides nouvellement confirmes. */
  push(x: number, y: number): Pt[] {
    const last = this.pts[this.pts.length - 1]
    if (last && last.x === x && last.y === y) return []
    this.pts.push({ x, y })
    const n = this.pts.length
    if (n >= 3) {
      const a = this.pts[n - 3], b = this.pts[n - 2], c = this.pts[n - 1]
      const isCorner =
        Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1 &&
        (b.x === a.x || b.y === a.y) && (b.x === c.x || b.y === c.y)
      if (isCorner) {
        this.pts.splice(n - 2, 1)
        if (this.emitted > this.pts.length) this.emitted = this.pts.length
      }
    }
    const fresh = this.pts.slice(this.emitted)
    this.emitted = this.pts.length
    return fresh
  }

  /** Points conserves depuis le debut du trace. */
  get points(): Pt[] { return this.pts }

  reset(): void { this.pts = []; this.emitted = 0 }
}

/* ------------------------------------------------------------------ */
/* Remplissage                                                         */
/* ------------------------------------------------------------------ */

function matches(a: RGBA, b: RGBA, tolerance: number): boolean {
  if (a === b) return true
  if (tolerance <= 0) return false
  const aa = getA(a), ba = getA(b)
  if (aa === 0 && ba === 0) return true
  return (
    Math.abs(getR(a) - getR(b)) <= tolerance &&
    Math.abs(getG(a) - getG(b)) <= tolerance &&
    Math.abs(getB(a) - getB(b)) <= tolerance &&
    Math.abs(aa - ba) <= tolerance
  )
}

export interface FillOptions {
  tolerance?: number
  /** false = selectionne tous les pixels similaires de l'image (global). */
  contiguous?: boolean
  /** Inclut les diagonales dans le voisinage. */
  diagonal?: boolean
  /** Restreint la propagation (masque de selection). */
  within?: Uint8Array | null
}

/**
 * Retourne le masque des pixels a remplir depuis (sx,sy).
 * Implementation par balayage de lignes : lineaire et sans recursion.
 */
export function floodFillMask(bm: Bitmap, sx: number, sy: number, opts: FillOptions = {}): Uint8Array {
  const { tolerance = 0, contiguous = true, diagonal = false, within = null } = opts
  const w = bm.width, h = bm.height
  const out = new Uint8Array(w * h)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out
  const target = bm.u32[sy * w + sx]
  const ok = (i: number): boolean =>
    (!within || within[i] !== 0) && matches(bm.u32[i], target, tolerance)

  if (!contiguous) {
    for (let i = 0; i < out.length; i++) if (ok(i)) out[i] = 255
    return out
  }

  const stack: number[] = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    const row = y * w
    if (out[row + x] || !ok(row + x)) continue
    let left = x
    while (left > 0 && !out[row + left - 1] && ok(row + left - 1)) left--
    let right = x
    while (right < w - 1 && !out[row + right + 1] && ok(row + right + 1)) right++
    out.fill(255, row + left, row + right + 1)

    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue
      const nrow = ny * w
      const from = diagonal ? Math.max(0, left - 1) : left
      const to = diagonal ? Math.min(w - 1, right + 1) : right
      let run = false
      for (let nx = from; nx <= to; nx++) {
        const inRun = out[nrow + nx] === 0 && ok(nrow + nx)
        if (inRun && !run) stack.push(nx, ny)
        run = inRun
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Dithering                                                           */
/* ------------------------------------------------------------------ */

export type DitherPattern = 'none' | 'bayer2' | 'bayer4' | 'bayer8' | 'checker' | 'noise' | 'lines-h' | 'lines-v'

const BAYER2 = [0, 2, 3, 1]
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const BAYER8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]

/**
 * Retourne true si le pixel (x,y) doit recevoir la couleur principale
 * pour un ratio donne (0 = jamais, 1 = toujours).
 */
export function dither(pattern: DitherPattern, x: number, y: number, ratio: number): boolean {
  if (pattern === 'none' || ratio >= 1) return ratio > 0
  if (ratio <= 0) return false
  switch (pattern) {
    case 'checker': return ((x + y) & 1) === 0 ? ratio > 0.25 : ratio > 0.75
    case 'lines-h': return (y & 1) === 0 ? ratio > 0.25 : ratio > 0.75
    case 'lines-v': return (x & 1) === 0 ? ratio > 0.25 : ratio > 0.75
    case 'noise': {
      // Hash deterministe : le motif ne scintille pas d'un rendu a l'autre.
      let n = (x * 374761393 + y * 668265263) | 0
      n = (n ^ (n >> 13)) * 1274126177
      return (((n ^ (n >> 16)) >>> 0) % 1000) / 1000 < ratio
    }
    case 'bayer2': return BAYER2[(y & 1) * 2 + (x & 1)] / 4 < ratio
    case 'bayer8': return BAYER8[(y & 7) * 8 + (x & 7)] / 64 < ratio
    default: return BAYER4[(y & 3) * 4 + (x & 3)] / 16 < ratio
  }
}

export const DITHER_PATTERNS: { id: DitherPattern; label: string }[] = [
  { id: 'none', label: 'Aucun' },
  { id: 'bayer2', label: 'Bayer 2x2' },
  { id: 'bayer4', label: 'Bayer 4x4' },
  { id: 'bayer8', label: 'Bayer 8x8' },
  { id: 'checker', label: 'Damier' },
  { id: 'lines-h', label: 'Lignes H' },
  { id: 'lines-v', label: 'Lignes V' },
  { id: 'noise', label: 'Bruit' },
]

/* ------------------------------------------------------------------ */
/* Filtres                                                             */
/* ------------------------------------------------------------------ */

/** Masque des pixels de bordure d'une zone opaque (contour interieur). */
export function outlineMask(bm: Bitmap, thickness = 1, diagonal = true): Uint8Array {
  const w = bm.width, h = bm.height
  const solid = new Uint8Array(w * h)
  for (let i = 0; i < solid.length; i++) solid[i] = getA(bm.u32[i]) > 0 ? 1 : 0
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid[y * w + x]) continue
      let near = false
      for (let dy = -thickness; dy <= thickness && !near; dy++) {
        for (let dx = -thickness; dx <= thickness; dx++) {
          if (!diagonal && dx !== 0 && dy !== 0) continue
          if (dx === 0 && dy === 0) continue
          if (Math.hypot(dx, dy) > thickness + 0.3) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          if (solid[ny * w + nx]) { near = true; break }
        }
      }
      if (near) out[y * w + x] = 255
    }
  }
  return out
}
