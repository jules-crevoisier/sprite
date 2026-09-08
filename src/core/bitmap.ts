import { type RGBA, TRANSPARENT, getA, getR, getG, getB, rgba } from './color'

export interface Rect { x: number; y: number; w: number; h: number }

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h }
}

export function rectIntersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.w, b.x + b.w)
  const bo = Math.min(a.y + a.h, b.y + b.h)
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, bo - y) }
}

export function rectUnion(a: Rect, b: Rect): Rect {
  if (a.w <= 0 || a.h <= 0) return { ...b }
  if (b.w <= 0 || b.h <= 0) return { ...a }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
}

/**
 * Surface de pixels RGBA non premultipliee.
 * `data` et `u32` pointent sur le meme buffer : `u32` sert aux operations
 * en masse (remplissage, comparaison), `data` a l'acces canal par canal.
 */
export class Bitmap {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  readonly u32: Uint32Array

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.width = Math.max(1, Math.floor(width))
    this.height = Math.max(1, Math.floor(height))
    const bytes = this.width * this.height * 4
    if (data && data.length === bytes) {
      this.data = data
    } else {
      this.data = new Uint8ClampedArray(bytes)
      if (data) this.data.set(data.subarray(0, Math.min(data.length, bytes)))
    }
    this.u32 = new Uint32Array(this.data.buffer, this.data.byteOffset, this.width * this.height)
  }

  get length(): number { return this.width * this.height }
  get bounds(): Rect { return { x: 0, y: 0, w: this.width, h: this.height } }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  index(x: number, y: number): number { return y * this.width + x }

  get(x: number, y: number): RGBA {
    if (!this.inside(x, y)) return TRANSPARENT
    return this.u32[y * this.width + x]
  }

  /** Ecriture brute : remplace le pixel sans tenir compte de l'alpha. */
  set(x: number, y: number, color: RGBA): void {
    if (!this.inside(x, y)) return
    this.u32[y * this.width + x] = color
  }

  /** Composite `color` par-dessus le pixel existant (source-over, non premultiplie). */
  blend(x: number, y: number, color: RGBA): void {
    if (!this.inside(x, y)) return
    const a = getA(color)
    if (a === 0) return
    const i = y * this.width + x
    if (a === 255) { this.u32[i] = color; return }
    const o = i * 4
    const d = this.data
    const da = d[o + 3]
    if (da === 0) { this.u32[i] = color; return }
    const sa = a / 255
    const dab = (da / 255) * (1 - sa)
    const outA = sa + dab
    d[o] = (getR(color) * sa + d[o] * dab) / outA
    d[o + 1] = (getG(color) * sa + d[o + 1] * dab) / outA
    d[o + 2] = (getB(color) * sa + d[o + 2] * dab) / outA
    d[o + 3] = outA * 255
  }

  clear(): void { this.u32.fill(0) }

  fill(color: RGBA): void { this.u32.fill(color) }

  fillRect(r: Rect, color: RGBA): void {
    const c = rectIntersect(r, this.bounds)
    for (let y = c.y; y < c.y + c.h; y++) {
      this.u32.fill(color, y * this.width + c.x, y * this.width + c.x + c.w)
    }
  }

  clone(): Bitmap {
    return new Bitmap(this.width, this.height, new Uint8ClampedArray(this.data))
  }

  copyFrom(other: Bitmap): void {
    if (other.width === this.width && other.height === this.height) {
      this.data.set(other.data)
    }
  }

  /** true si aucun pixel n'a d'alpha non nul. */
  isEmpty(): boolean {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 0) return false
    return true
  }

  /** Boite englobante des pixels non transparents ; w/h a 0 si le bitmap est vide. */
  trimBounds(): Rect {
    let minX = this.width, minY = this.height, maxX = -1, maxY = -1
    for (let y = 0; y < this.height; y++) {
      const row = y * this.width
      for (let x = 0; x < this.width; x++) {
        if (this.data[(row + x) * 4 + 3] !== 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  }

  /** Extrait une sous-region (les parties hors limites sont transparentes). */
  crop(r: Rect): Bitmap {
    const out = new Bitmap(Math.max(1, r.w), Math.max(1, r.h))
    for (let y = 0; y < out.height; y++) {
      const sy = r.y + y
      if (sy < 0 || sy >= this.height) continue
      for (let x = 0; x < out.width; x++) {
        const sx = r.x + x
        if (sx < 0 || sx >= this.width) continue
        out.u32[y * out.width + x] = this.u32[sy * this.width + sx]
      }
    }
    return out
  }

  /** Colle `src` en (dx,dy). `blendPixels` a false ecrase, a true composite. */
  paste(src: Bitmap, dx: number, dy: number, blendPixels = false): void {
    for (let y = 0; y < src.height; y++) {
      const ty = dy + y
      if (ty < 0 || ty >= this.height) continue
      for (let x = 0; x < src.width; x++) {
        const tx = dx + x
        if (tx < 0 || tx >= this.width) continue
        const c = src.u32[y * src.width + x]
        if (blendPixels) this.blend(tx, ty, c)
        else this.u32[ty * this.width + tx] = c
      }
    }
  }

  /** Redimensionnement au plus proche voisin : preserve la nettete du pixel art. */
  resizeNearest(w: number, h: number): Bitmap {
    const out = new Bitmap(w, h)
    const sx = this.width / w
    const sy = this.height / h
    for (let y = 0; y < h; y++) {
      const py = Math.min(this.height - 1, Math.floor(y * sy))
      for (let x = 0; x < w; x++) {
        const px = Math.min(this.width - 1, Math.floor(x * sx))
        out.u32[y * w + x] = this.u32[py * this.width + px]
      }
    }
    return out
  }

  /** Redimensionnement bilineaire, pour les usages non pixel-art (previews, imports). */
  resizeSmooth(w: number, h: number): Bitmap {
    const out = new Bitmap(w, h)
    for (let y = 0; y < h; y++) {
      const fy = ((y + 0.5) * this.height) / h - 0.5
      const y0 = Math.floor(fy), ty = fy - y0
      for (let x = 0; x < w; x++) {
        const fx = ((x + 0.5) * this.width) / w - 0.5
        const x0 = Math.floor(fx), tx = fx - x0
        const o = (y * w + x) * 4
        for (let ch = 0; ch < 4; ch++) {
          const s = (px: number, py: number) => {
            const cx = Math.min(this.width - 1, Math.max(0, px))
            const cy = Math.min(this.height - 1, Math.max(0, py))
            return this.data[(cy * this.width + cx) * 4 + ch]
          }
          const top = s(x0, y0) * (1 - tx) + s(x0 + 1, y0) * tx
          const bot = s(x0, y0 + 1) * (1 - tx) + s(x0 + 1, y0 + 1) * tx
          out.data[o + ch] = top * (1 - ty) + bot * ty
        }
      }
    }
    return out
  }

  flipH(): Bitmap {
    const out = new Bitmap(this.width, this.height)
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        out.u32[y * this.width + x] = this.u32[y * this.width + (this.width - 1 - x)]
    return out
  }

  flipV(): Bitmap {
    const out = new Bitmap(this.width, this.height)
    for (let y = 0; y < this.height; y++) {
      const sy = this.height - 1 - y
      out.u32.set(this.u32.subarray(sy * this.width, sy * this.width + this.width), y * this.width)
    }
    return out
  }

  /** Rotation de 90 degres dans le sens horaire ; les dimensions sont echangees. */
  rotate90(): Bitmap {
    const out = new Bitmap(this.height, this.width)
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        out.u32[x * out.width + (this.height - 1 - y)] = this.u32[y * this.width + x]
    return out
  }

  /** Decale le contenu (utile pour l'outil deplacement et les tuiles seamless). */
  shift(dx: number, dy: number, wrap = false): Bitmap {
    const out = new Bitmap(this.width, this.height)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let sx = x - dx, sy = y - dy
        if (wrap) {
          sx = ((sx % this.width) + this.width) % this.width
          sy = ((sy % this.height) + this.height) % this.height
        } else if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) continue
        out.u32[y * this.width + x] = this.u32[sy * this.width + sx]
      }
    }
    return out
  }

  toImageData(): ImageData {
    return new ImageData(new Uint8ClampedArray(this.data), this.width, this.height)
  }

  static fromImageData(img: ImageData): Bitmap {
    return new Bitmap(img.width, img.height, new Uint8ClampedArray(img.data))
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = this.width
    c.height = this.height
    c.getContext('2d')!.putImageData(this.toImageData(), 0, 0)
    return c
  }

  /** Liste des couleurs distinctes, triees par frequence decroissante. */
  uniqueColors(limit = 4096): RGBA[] {
    const counts = new Map<number, number>()
    for (let i = 0; i < this.u32.length; i++) {
      const c = this.u32[i]
      if (getA(c) === 0) continue
      counts.set(c, (counts.get(c) ?? 0) + 1)
      if (counts.size > limit * 4) break
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map((e) => e[0])
  }

  /** Rend toutes les couleurs opaques sous un seuil d'alpha (utile avant export indexe). */
  thresholdAlpha(threshold: number): void {
    for (let i = 3; i < this.data.length; i += 4) {
      this.data[i] = this.data[i] >= threshold ? 255 : 0
    }
  }
}

/** Cree un bitmap depuis un tableau de couleurs (test / generation procedurale). */
export function bitmapFrom(width: number, height: number, fn: (x: number, y: number) => RGBA): Bitmap {
  const b = new Bitmap(width, height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      b.u32[y * width + x] = fn(x, y)
  return b
}

export { rgba }
