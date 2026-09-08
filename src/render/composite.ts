import { Bitmap } from '../core/bitmap'
import { compositeBitmap } from '../core/blend'
import type { Sprite } from '../core/document'

export interface CompositeOptions {
  /** Inclut les calques marques comme reference (exclus a l'export). */
  includeReference?: boolean
  /** Ne composite qu'un seul calque (index). */
  onlyLayer?: number | null
  /** Ignore l'etat "visible" des calques. */
  ignoreVisibility?: boolean
  /** Bitmap de destination reutilise, pour eviter les allocations. */
  into?: Bitmap | null
  /** Substitue le contenu d'une case (previsualisation d'outil). */
  override?: { layer: number; frame: number; bitmap: Bitmap } | null
}

/** Aplatit une frame du sprite en un seul bitmap RGBA. */
export function compositeFrame(sprite: Sprite, frame: number, opts: CompositeOptions = {}): Bitmap {
  const out = opts.into && opts.into.width === sprite.width && opts.into.height === sprite.height
    ? opts.into
    : new Bitmap(sprite.width, sprite.height)
  out.clear()

  for (let i = 0; i < sprite.layers.length; i++) {
    const layer = sprite.layers[i]
    if (opts.onlyLayer != null && opts.onlyLayer !== i) continue
    if (!opts.ignoreVisibility && !layer.visible) continue
    if (layer.reference && !opts.includeReference) continue
    const cel = layer.cels[frame]
    const bitmap = opts.override && opts.override.layer === i && opts.override.frame === frame
      ? opts.override.bitmap
      : cel?.bitmap
    if (!bitmap) continue
    const celOpacity = cel ? cel.opacity : 255
    const opacity = (layer.opacity * celOpacity) / 255
    if (opacity <= 0) continue
    compositeBitmap(out, bitmap, layer.blendMode, opacity)
  }
  return out
}

/** Cache de composition invalide par un numero de version. */
export class FrameCache {
  private cache = new Map<number, { version: number; bitmap: Bitmap }>()

  get(sprite: Sprite, frame: number, version: number, opts?: CompositeOptions): Bitmap {
    const hit = this.cache.get(frame)
    if (hit && hit.version === version &&
        hit.bitmap.width === sprite.width && hit.bitmap.height === sprite.height) {
      return hit.bitmap
    }
    const bitmap = compositeFrame(sprite, frame, { ...opts, into: hit?.bitmap ?? null })
    this.cache.set(frame, { version, bitmap })
    return bitmap
  }

  invalidate(): void { this.cache.clear() }
}

/** Aplatit toutes les frames (export, previsualisation, GIF). */
export function compositeAll(sprite: Sprite, opts: CompositeOptions = {}): Bitmap[] {
  const out: Bitmap[] = []
  for (let f = 0; f < sprite.frameCount; f++) out.push(compositeFrame(sprite, f, opts))
  return out
}
