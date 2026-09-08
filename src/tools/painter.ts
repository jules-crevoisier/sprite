import { Bitmap, type Rect } from '../core/bitmap'
import { type RGBA, getA, withAlpha, TRANSPARENT } from '../core/color'
import type { Selection } from '../core/selection'
import { brushOffsets, dither, type BrushShape, type DitherPattern, type Plot } from './algorithms'

/** Comment un pixel pose interagit avec celui deja present. */
export type PaintMode =
  | 'normal'      // composite par-dessus
  | 'erase'       // efface (alpha a 0)
  | 'behind'      // ne peint que les pixels transparents
  | 'lock-alpha'  // ne peint que les pixels opaques, conserve leur alpha

export interface PainterOptions {
  selection?: Selection | null
  brushSize?: number
  brushShape?: BrushShape
  color?: RGBA
  /** Couleur posee la ou le motif de tramage est "off". */
  secondary?: RGBA
  ditherPattern?: DitherPattern
  /** 0..1 : proportion de couleur principale dans le tramage. */
  ditherRatio?: number
  mode?: PaintMode
  /** 0..255, applique a l'alpha de la couleur. */
  opacity?: number
  /** Axe vertical de symetrie, en pixels ; null pour desactiver. */
  symmetryX?: number | null
  /** Axe horizontal de symetrie, en pixels ; null pour desactiver. */
  symmetryY?: number | null
  /** Le dessin se replie sur les bords (mode tuile seamless). */
  tiled?: boolean
  /** Transformation par pixel : recoit la couleur de destination, renvoie la nouvelle. */
  transform?: ((dst: RGBA, x: number, y: number) => RGBA) | null
}

/**
 * Applique les traits sur un bitmap en tenant compte de la brosse, de la
 * selection, de la symetrie, du tramage et du mode de pose. Les outils
 * n'ont plus qu'a fournir des coordonnees.
 */
export class Painter {
  readonly target: Bitmap
  private opts: Required<Omit<PainterOptions, 'selection' | 'symmetryX' | 'symmetryY' | 'transform'>> & {
    selection: Selection | null
    symmetryX: number | null
    symmetryY: number | null
    transform: ((dst: RGBA, x: number, y: number) => RGBA) | null
  }
  private offsets: Int16Array
  /** Pixels deja touches dans le trait courant : evite le sur-empilement d'alpha. */
  private touched: Set<number> | null = null
  private dirty: Rect = { x: 0, y: 0, w: 0, h: 0 }
  private hasDirty = false

  constructor(target: Bitmap, options: PainterOptions = {}) {
    this.target = target
    this.opts = {
      selection: options.selection ?? null,
      brushSize: options.brushSize ?? 1,
      brushShape: options.brushShape ?? 'circle',
      color: options.color ?? TRANSPARENT,
      secondary: options.secondary ?? TRANSPARENT,
      ditherPattern: options.ditherPattern ?? 'none',
      ditherRatio: options.ditherRatio ?? 1,
      mode: options.mode ?? 'normal',
      opacity: options.opacity ?? 255,
      symmetryX: options.symmetryX ?? null,
      symmetryY: options.symmetryY ?? null,
      tiled: options.tiled ?? false,
      transform: options.transform ?? null,
    }
    this.offsets = brushOffsets(this.opts.brushSize, this.opts.brushShape)
  }

  set color(c: RGBA) { this.opts.color = c }
  get color(): RGBA { return this.opts.color }
  set mode(m: PaintMode) { this.opts.mode = m }

  /** Active la protection anti-empilement pour la duree d'un trait. */
  beginStroke(): void { this.touched = new Set() }
  endStroke(): void { this.touched = null }

  get dirtyRect(): Rect { return this.hasDirty ? this.dirty : { x: 0, y: 0, w: 0, h: 0 } }

  private markDirty(x: number, y: number): void {
    if (!this.hasDirty) {
      this.dirty = { x, y, w: 1, h: 1 }
      this.hasDirty = true
      return
    }
    const x0 = Math.min(this.dirty.x, x)
    const y0 = Math.min(this.dirty.y, y)
    const x1 = Math.max(this.dirty.x + this.dirty.w, x + 1)
    const y1 = Math.max(this.dirty.y + this.dirty.h, y + 1)
    this.dirty = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  /** Pose la brosse centree sur (x,y), symetries comprises. */
  plot: Plot = (x, y) => {
    this.stamp(x, y)
    const { symmetryX, symmetryY } = this.opts
    const mx = symmetryX !== null ? Math.round(2 * symmetryX - 1 - x) : null
    const my = symmetryY !== null ? Math.round(2 * symmetryY - 1 - y) : null
    if (mx !== null) this.stamp(mx, y)
    if (my !== null) this.stamp(x, my)
    if (mx !== null && my !== null) this.stamp(mx, my)
  }

  /** Pose un unique pixel, sans brosse ni symetrie (outils au pixel pres). */
  point(x: number, y: number): void { this.writePixel(x, y) }

  private stamp(cx: number, cy: number): void {
    const off = this.offsets
    for (let i = 0; i < off.length; i += 2) {
      this.writePixel(cx + off[i], cy + off[i + 1])
    }
  }

  private writePixel(px: number, py: number): void {
    const bm = this.target
    let x = px, y = py
    if (this.opts.tiled) {
      x = ((x % bm.width) + bm.width) % bm.width
      y = ((y % bm.height) + bm.height) % bm.height
    } else if (x < 0 || y < 0 || x >= bm.width || y >= bm.height) return

    const sel = this.opts.selection
    if (sel && sel.active && !sel.contains(x, y)) return

    const idx = y * bm.width + x
    if (this.touched) {
      if (this.touched.has(idx)) return
      this.touched.add(idx)
    }

    const dst = bm.u32[idx]
    let color: RGBA

    if (this.opts.transform) {
      color = this.opts.transform(dst, x, y)
      if (color === dst) return
      bm.u32[idx] = color
      this.markDirty(x, y)
      return
    }

    if (this.opts.mode === 'erase') {
      if (getA(dst) === 0) return
      const strength = this.opts.opacity
      bm.u32[idx] = strength >= 255 ? TRANSPARENT : withAlpha(dst, Math.max(0, getA(dst) - strength))
      this.markDirty(x, y)
      return
    }

    // Tramage : la couleur secondaire remplit les pixels "off" du motif.
    if (this.opts.ditherPattern !== 'none') {
      const on = dither(this.opts.ditherPattern, x, y, this.opts.ditherRatio)
      color = on ? this.opts.color : this.opts.secondary
      if (getA(color) === 0 && !on) return
    } else {
      color = this.opts.color
    }

    if (this.opts.opacity < 255) {
      color = withAlpha(color, (getA(color) * this.opts.opacity) / 255)
    }
    if (getA(color) === 0) return

    switch (this.opts.mode) {
      case 'behind':
        if (getA(dst) !== 0) return
        bm.u32[idx] = color
        break
      case 'lock-alpha': {
        if (getA(dst) === 0) return
        const keep = getA(dst)
        bm.blend(x, y, color)
        bm.data[idx * 4 + 3] = keep
        break
      }
      default:
        if (getA(color) === 255) bm.u32[idx] = color
        else bm.blend(x, y, color)
    }
    this.markDirty(x, y)
  }

  /** Peint tous les pixels marques dans un masque plein-cadre. */
  fillMask(mask: Uint8Array): void {
    const bm = this.target
    for (let y = 0; y < bm.height; y++) {
      for (let x = 0; x < bm.width; x++) {
        if (mask[y * bm.width + x]) this.writePixel(x, y)
      }
    }
  }
}
