import type { Bitmap } from '../core/bitmap'
import {
  type RGBA, getA, rgbaToHsv, hsvToRgba, luminance, colorDistance,
} from '../core/color'
import type { Palette } from '../core/palette'
import { extractRamps, type Ramp } from './analysis'

export type VariantStrategy =
  | 'hue'           // teintes reparties sur le cercle chromatique
  | 'analogous'     // teintes voisines, variation discrete
  | 'complementary' // teinte opposee et ses voisines
  | 'palette'       // rampes issues de la palette du sprite
  | 'value'         // meme teinte, clair a sombre

export const STRATEGIES: { id: VariantStrategy; label: string; hint: string }[] = [
  { id: 'hue', label: 'Tour du cercle', hint: 'Teintes reparties, variantes bien distinctes' },
  { id: 'analogous', label: 'Teintes voisines', hint: 'Variation discrete, meme ambiance' },
  { id: 'complementary', label: 'Complementaire', hint: 'Autour de la teinte opposee' },
  { id: 'palette', label: 'Depuis la palette', hint: 'Reste strictement dans la palette du sprite' },
  { id: 'value', label: 'Clair / sombre', hint: 'Meme teinte, luminosite decalee' },
]

/** Une variante : la table de remplacement des couleurs d'une rampe. */
export interface Variant {
  label: string
  /** Ancienne couleur -> nouvelle couleur. */
  mapping: Map<RGBA, RGBA>
  /** Apercu de la rampe obtenue. */
  preview: RGBA[]
}

export interface VariantOptions {
  strategy: VariantStrategy
  count: number
  /** Decalage de saturation applique en plus, -1..1. */
  saturation: number
  /** Decalage de luminosite applique en plus, -1..1. */
  value: number
}

export const DEFAULT_VARIANT_OPTIONS: VariantOptions = {
  strategy: 'hue',
  count: 5,
  saturation: 0,
  value: 0,
}

/** Remappe une rampe entiere par decalage de teinte, en gardant l'ombrage. */
function shiftRamp(ramp: Ramp, dh: number, ds: number, dv: number): Map<RGBA, RGBA> {
  const mapping = new Map<RGBA, RGBA>()
  for (const color of ramp.colors) {
    const hsv = rgbaToHsv(color)
    hsv.h = (((hsv.h + dh) % 360) + 360) % 360
    hsv.s = Math.min(1, Math.max(0, hsv.s + ds))
    hsv.v = Math.min(1, Math.max(0, hsv.v + dv))
    mapping.set(color, hsvToRgba(hsv))
  }
  return mapping
}

/**
 * Projette une rampe sur une autre en respectant l'ordre des luminosites :
 * la couleur la plus sombre de la source prend la plus sombre de la cible.
 * C'est ce qui preserve le modele du dessin quand on change de palette.
 */
function mapOntoRamp(source: Ramp, target: RGBA[]): Map<RGBA, RGBA> {
  const mapping = new Map<RGBA, RGBA>()
  const sorted = [...target].sort((a, b) => luminance(a) - luminance(b))
  const n = source.colors.length
  source.colors.forEach((color, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1)
    const idx = Math.round(t * (sorted.length - 1))
    mapping.set(color, sorted[Math.max(0, Math.min(sorted.length - 1, idx))])
  })
  return mapping
}

/** Construit les variantes d'une rampe selon la strategie demandee. */
export function generateVariants(
  ramp: Ramp,
  options: VariantOptions,
  palette: Palette,
): Variant[] {
  const { strategy, count, saturation, value } = options
  const out: Variant[] = []
  const ds = saturation
  const dv = value

  const push = (label: string, mapping: Map<RGBA, RGBA>) => {
    out.push({ label, mapping, preview: ramp.colors.map((c) => mapping.get(c) ?? c) })
  }

  switch (strategy) {
    case 'hue': {
      for (let i = 0; i < count; i++) {
        const dh = ((i + 1) * 360) / (count + 1)
        push(`+${Math.round(dh)}°`, shiftRamp(ramp, dh, ds, dv))
      }
      break
    }
    case 'analogous': {
      const span = 60
      for (let i = 0; i < count; i++) {
        const dh = -span / 2 + (span * i) / Math.max(1, count - 1)
        push(`${dh >= 0 ? '+' : ''}${Math.round(dh)}°`, shiftRamp(ramp, dh, ds, dv))
      }
      break
    }
    case 'complementary': {
      for (let i = 0; i < count; i++) {
        const dh = 180 - 25 + (50 * i) / Math.max(1, count - 1)
        push(`${Math.round(dh)}°`, shiftRamp(ramp, dh, ds, dv))
      }
      break
    }
    case 'value': {
      for (let i = 0; i < count; i++) {
        const d = -0.3 + (0.6 * i) / Math.max(1, count - 1)
        push(`${d >= 0 ? '+' : ''}${Math.round(d * 100)}%`, shiftRamp(ramp, 0, ds, dv + d))
      }
      break
    }
    case 'palette': {
      // Les rampes de la palette servent de cibles : le resultat reste
      // exactement dans les couleurs du projet.
      const targets = extractRamps([paletteAsBitmap(palette)], 16)
        .filter((r) => r.colors.length >= 2)
        .filter((r) => colorDistance(r.colors[0], ramp.colors[0]) > 40)
      for (const target of targets.slice(0, count)) {
        push(target.label, mapOntoRamp(ramp, target.colors))
      }
      break
    }
  }
  return out
}

/** Petite image contenant une fois chaque couleur de la palette. */
function paletteAsBitmap(palette: Palette): Bitmap {
  // Import direct impossible sans cycle : on fabrique un objet compatible.
  const w = Math.max(1, palette.colors.length)
  const data = new Uint8ClampedArray(w * 4)
  const u32 = new Uint32Array(data.buffer)
  palette.colors.forEach((c, i) => { u32[i] = c })
  return {
    width: w, height: 1, data, u32,
    length: w,
  } as unknown as Bitmap
}

/** Applique une table de remplacement a un bitmap, en place. */
export function applyMapping(bitmap: Bitmap, mapping: Map<RGBA, RGBA>): number {
  let changed = 0
  const u = bitmap.u32
  for (let i = 0; i < u.length; i++) {
    if (getA(u[i]) === 0) continue
    const next = mapping.get(u[i])
    if (next !== undefined && next !== u[i]) { u[i] = next; changed++ }
  }
  return changed
}
