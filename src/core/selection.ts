import type { Rect } from './bitmap'

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect'

/**
 * Masque de selection binaire aligne sur la toile.
 * 0 = hors selection, 255 = dans la selection.
 */
export class Selection {
  readonly width: number
  readonly height: number
  readonly mask: Uint8Array
  private cachedBounds: Rect | null = null
  private count = 0

  constructor(width: number, height: number, mask?: Uint8Array) {
    this.width = width
    this.height = height
    this.mask = mask ?? new Uint8Array(width * height)
    if (mask) this.recount()
  }

  private recount(): void {
    let n = 0
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i]) n++
    this.count = n
    this.cachedBounds = null
  }

  /** true si une selection est active (au moins un pixel). */
  get active(): boolean { return this.count > 0 }
  get selectedCount(): number { return this.count }

  contains(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false
    return this.mask[y * this.width + x] !== 0
  }

  /** Vrai si le pixel est dessinable : pas de selection = tout est dessinable. */
  allows(x: number, y: number): boolean {
    return !this.active || this.contains(x, y)
  }

  clear(): void {
    this.mask.fill(0)
    this.count = 0
    this.cachedBounds = null
  }

  selectAll(): void {
    this.mask.fill(255)
    this.count = this.mask.length
    this.cachedBounds = { x: 0, y: 0, w: this.width, h: this.height }
  }

  clone(): Selection {
    return new Selection(this.width, this.height, new Uint8Array(this.mask))
  }

  copyFrom(other: Selection): void {
    this.mask.set(other.mask)
    this.count = other.count
    this.cachedBounds = null
  }

  /** Applique un masque temporaire selon le mode de combinaison. */
  combine(other: Uint8Array, mode: SelectionMode): void {
    const m = this.mask
    switch (mode) {
      case 'replace': m.set(other); break
      case 'add': for (let i = 0; i < m.length; i++) if (other[i]) m[i] = 255; break
      case 'subtract': for (let i = 0; i < m.length; i++) if (other[i]) m[i] = 0; break
      case 'intersect': for (let i = 0; i < m.length; i++) if (!other[i]) m[i] = 0; break
    }
    this.recount()
  }

  invert(): void {
    for (let i = 0; i < this.mask.length; i++) this.mask[i] = this.mask[i] ? 0 : 255
    this.recount()
  }

  translate(dx: number, dy: number): void {
    const out = new Uint8Array(this.mask.length)
    for (let y = 0; y < this.height; y++) {
      const sy = y - dy
      if (sy < 0 || sy >= this.height) continue
      for (let x = 0; x < this.width; x++) {
        const sx = x - dx
        if (sx < 0 || sx >= this.width) continue
        out[y * this.width + x] = this.mask[sy * this.width + sx]
      }
    }
    this.mask.set(out)
    this.recount()
  }

  /** Dilatation (n > 0) ou erosion (n < 0) par voisinage carre. */
  grow(n: number): void {
    const steps = Math.abs(n)
    const dilate = n > 0
    for (let s = 0; s < steps; s++) {
      const out = new Uint8Array(this.mask)
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const i = y * this.width + x
          const on = this.mask[i] !== 0
          if (dilate === on) continue
          let neighbour = false
          for (let dy = -1; dy <= 1 && !neighbour; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy
              const v = nx < 0 || ny < 0 || nx >= this.width || ny >= this.height
                ? false
                : this.mask[ny * this.width + nx] !== 0
              if (v === dilate) { neighbour = true; break }
            }
          }
          if (neighbour) out[i] = dilate ? 255 : 0
        }
      }
      this.mask.set(out)
    }
    this.recount()
  }

  bounds(): Rect {
    if (this.cachedBounds) return this.cachedBounds
    let minX = this.width, minY = this.height, maxX = -1, maxY = -1
    for (let y = 0; y < this.height; y++) {
      const row = y * this.width
      for (let x = 0; x < this.width; x++) {
        if (this.mask[row + x]) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    this.cachedBounds = maxX < 0
      ? { x: 0, y: 0, w: 0, h: 0 }
      : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    return this.cachedBounds
  }

  /**
   * Segments de contour en coordonnees pixel, pour tracer les fourmis
   * marcheuses. Format plat : [x1,y1,x2,y2, ...].
   */
  outline(): Float32Array {
    const seg: number[] = []
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= this.width || y >= this.height ? 0 : this.mask[y * this.width + x]
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.mask[y * this.width + x]) continue
        if (!at(x, y - 1)) seg.push(x, y, x + 1, y)
        if (!at(x, y + 1)) seg.push(x, y + 1, x + 1, y + 1)
        if (!at(x - 1, y)) seg.push(x, y, x, y + 1)
        if (!at(x + 1, y)) seg.push(x + 1, y, x + 1, y + 1)
      }
    }
    return new Float32Array(seg)
  }
}

/* ------------------------------------------------------------------ */
/* Generateurs de masques                                              */
/* ------------------------------------------------------------------ */

export function maskFromRect(w: number, h: number, r: Rect): Uint8Array {
  const m = new Uint8Array(w * h)
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.floor(r.x + r.w)), y1 = Math.min(h, Math.floor(r.y + r.h))
  for (let y = y0; y < y1; y++) m.fill(255, y * w + x0, y * w + x1)
  return m
}

export function maskFromEllipse(w: number, h: number, r: Rect): Uint8Array {
  const m = new Uint8Array(w * h)
  const rx = r.w / 2, ry = r.h / 2
  const cx = r.x + rx, cy = r.y + ry
  if (rx <= 0 || ry <= 0) return m
  for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(h, Math.ceil(r.y + r.h)); y++) {
    for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(w, Math.ceil(r.x + r.w)); x++) {
      const nx = (x + 0.5 - cx) / rx
      const ny = (y + 0.5 - cy) / ry
      if (nx * nx + ny * ny <= 1) m[y * w + x] = 255
    }
  }
  return m
}

/** Masque d'un polygone ferme (lasso), regle pair-impair. */
export function maskFromPolygon(w: number, h: number, pts: { x: number; y: number }[]): Uint8Array {
  const m = new Uint8Array(w * h)
  if (pts.length < 3) return m
  let minY = Infinity, maxY = -Infinity
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY))
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5
    const xs: number[] = []
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i]
      if (a.y === b.y) continue
      if ((cy >= a.y && cy < b.y) || (cy >= b.y && cy < a.y)) {
        xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x))
      }
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const sx = Math.max(0, Math.round(xs[i]))
      const ex = Math.min(w, Math.round(xs[i + 1]))
      for (let x = sx; x < ex; x++) m[y * w + x] = 255
    }
  }
  return m
}
