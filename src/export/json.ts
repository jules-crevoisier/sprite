import { toHex } from '../core/color'
import type { Sprite } from '../core/document'
import type { SheetResult } from './spritesheet'

export type JsonFormat = 'hash' | 'array'

/**
 * Metadonnees au format JSON d'Aseprite : lues telles quelles par Phaser,
 * PixiJS, LibGDX, Defold, et la plupart des chargeurs d'atlas.
 */
export function buildAsepriteJson(
  sprite: Sprite,
  sheet: SheetResult,
  imageName: string,
  format: JsonFormat = 'hash',
): string {
  const entry = (i: number) => {
    const f = sheet.frames[i]
    return {
      frame: { x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h },
      rotated: false,
      trimmed: f.trimmed,
      spriteSourceSize: {
        x: f.spriteSourceSize.x,
        y: f.spriteSourceSize.y,
        w: f.frame.w,
        h: f.frame.h,
      },
      sourceSize: { w: f.sourceSize.w, h: f.sourceSize.h },
      duration: f.duration,
    }
  }

  const frameName = (i: number) => {
    const f = sheet.frames[i]
    const layer = f.layer ? ` (${f.layer})` : ''
    return `${sprite.name}${layer} ${f.index}.png`
  }

  const frames = format === 'hash'
    ? Object.fromEntries(sheet.frames.map((_, i) => [frameName(i), entry(i)]))
    : sheet.frames.map((_, i) => ({ filename: frameName(i), ...entry(i) }))

  const meta = {
    app: 'pixelforge',
    version: '1.0',
    image: imageName,
    format: 'RGBA8888',
    size: { w: sheet.bitmap.width, h: sheet.bitmap.height },
    scale: '1',
    frameTags: sheet.tags.map((t) => ({
      name: t.name,
      from: t.from,
      to: t.to,
      direction: t.direction,
      repeat: String(t.repeat),
      color: `${toHex(t.color)}ff`,
    })),
    layers: sprite.layers
      .filter((l) => !l.reference)
      .map((l) => ({ name: l.name, opacity: l.opacity, blendMode: l.blendMode })),
    slices: sprite.slices.map((s) => ({
      name: s.name,
      color: `${toHex(s.color)}ff`,
      keys: [{
        frame: 0,
        bounds: { x: s.bounds.x, y: s.bounds.y, w: s.bounds.w, h: s.bounds.h },
        ...(s.center ? { center: s.center } : {}),
        ...(s.pivot ? { pivot: s.pivot } : {}),
      }],
    })),
    pivot: sprite.pivot,
  }

  return JSON.stringify({ frames, meta }, null, 2)
}
