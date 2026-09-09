import type { Bitmap } from '../core/bitmap'
import { type RGBA, getA } from '../core/color'
import { RampIndex, makeRandom } from './analysis'

export type DetailMode =
  | 'speckle'     // grains isoles
  | 'noise'       // taches organiques
  | 'edge-shade'  // ombre sur les bords
  | 'top-light'   // lumiere sur les faces hautes
  | 'clusters'    // touffes
  | 'volume'      // degrade tramé du haut vers le bas

export interface DetailOptions {
  mode: DetailMode
  /** Proportion de pixels touches, 0..1. */
  density: number
  /** Amplitude du decalage dans la rampe, 1 = un cran. */
  strength: number
  seed: number
  /** Restreint l'effet a ces pixels (masque de selection). */
  within?: Uint8Array | null
}

export const DETAIL_MODES: { id: DetailMode; label: string; hint: string }[] = [
  { id: 'speckle', label: 'Grain', hint: 'Pixels isoles plus clairs et plus sombres' },
  { id: 'noise', label: 'Taches', hint: 'Zones irregulieres, pierre et terre' },
  { id: 'clusters', label: 'Touffes', hint: 'Petits amas, herbe et feuillage' },
  { id: 'edge-shade', label: 'Ombre des bords', hint: 'Assombrit le contour intérieur' },
  { id: 'top-light', label: 'Lumière du haut', hint: 'Eclaircit les faces tournees vers le haut' },
  { id: 'volume', label: 'Volume', hint: 'Degrade trame du haut vers le bas' },
]

/** Enchainements prets a l'emploi, pour les matieres courantes. */
export const DETAIL_PRESETS: { id: string; label: string; steps: Partial<DetailOptions>[] }[] = [
  {
    id: 'herbe',
    label: 'Herbe',
    steps: [
      { mode: 'clusters', density: 0.22, strength: 1 },
      { mode: 'speckle', density: 0.14, strength: 1 },
      { mode: 'top-light', density: 0.7, strength: 1 },
    ],
  },
  {
    id: 'pierre',
    label: 'Pierre',
    steps: [
      { mode: 'noise', density: 0.35, strength: 1 },
      { mode: 'edge-shade', density: 0.8, strength: 1 },
      { mode: 'speckle', density: 0.08, strength: 1 },
    ],
  },
  {
    id: 'terre',
    label: 'Terre',
    steps: [
      { mode: 'noise', density: 0.45, strength: 1 },
      { mode: 'speckle', density: 0.18, strength: 1 },
    ],
  },
  {
    id: 'tissu',
    label: 'Tissu',
    steps: [
      { mode: 'volume', density: 0.5, strength: 1 },
      { mode: 'edge-shade', density: 0.5, strength: 1 },
    ],
  },
  {
    id: 'metal',
    label: 'Metal',
    steps: [
      { mode: 'top-light', density: 0.9, strength: 2 },
      { mode: 'edge-shade', density: 0.9, strength: 1 },
    ],
  },
]

/** Hash spatial : le motif ne bouge pas d'un rendu a l'autre pour une graine donnee. */
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Bruit de valeur lisse : donne des taches plutot que des pixels isoles. */
function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale, fy = y / scale
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const tx = fx - x0, ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const n00 = hash2(x0, y0, seed)
  const n10 = hash2(x0 + 1, y0, seed)
  const n01 = hash2(x0, y0 + 1, seed)
  const n11 = hash2(x0 + 1, y0 + 1, seed)
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/**
 * Ajoute du detail sur les pixels opaques d'un bitmap, en restant dans les
 * couleurs deja presentes : chaque pixel se decale d'un cran dans sa propre
 * rampe, donc le resultat reste coherent avec le dessin.
 */
export function addDetail(bitmap: Bitmap, index: RampIndex, options: DetailOptions): number {
  const { mode, density, strength, seed, within } = options
  const w = bitmap.width, h = bitmap.height
  const palette = index.allColors()
  const source = bitmap.clone()
  let touched = 0

  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && getA(source.u32[y * w + x]) !== 0

  const put = (x: number, y: number, delta: number) => {
    const i = y * w + x
    if (within && !within[i]) return
    const before = bitmap.u32[i]
    if (getA(before) === 0) return
    const next: RGBA = index.step(before, delta, palette)
    if (next !== before) { bitmap.u32[i] = next; touched++ }
  }

  // Boite englobante des pixels concernes, pour le mode volume.
  let minY = h, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue
      if (within && !within[y * w + x]) continue
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxY < 0) return 0

  const rand = makeRandom(seed)
  const step = Math.max(1, Math.round(strength))

  switch (mode) {
    case 'speckle': {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!opaque(x, y)) continue
          const r = hash2(x, y, seed)
          if (r > density) continue
          put(x, y, r < density / 2 ? -step : step)
        }
      }
      break
    }
    case 'noise': {
      const scale = 2.6
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!opaque(x, y)) continue
          const n = valueNoise(x, y, scale, seed)
          const edge = density / 2
          if (n < edge) put(x, y, -step)
          else if (n > 1 - edge) put(x, y, step)
        }
      }
      break
    }
    case 'clusters': {
      // Des amas de deux a quatre pixels, plutot que des points isoles.
      const area = (maxY - minY + 1) * w
      const seeds = Math.max(1, Math.round((area * density) / 12))
      for (let k = 0; k < seeds; k++) {
        const cx = Math.floor(rand() * w)
        const cy = minY + Math.floor(rand() * (maxY - minY + 1))
        if (!opaque(cx, cy)) continue
        const delta = rand() < 0.65 ? step : -step
        const size = 1 + Math.floor(rand() * 3)
        put(cx, cy, delta)
        for (let s = 0; s < size; s++) {
          const nx = cx + (rand() < 0.5 ? -1 : 1)
          const ny = cy + (rand() < 0.55 ? -1 : 0)
          if (opaque(nx, ny)) put(nx, ny, delta)
        }
      }
      break
    }
    case 'edge-shade': {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!opaque(x, y)) continue
          const exposed =
            !opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y + 1) || !opaque(x, y - 1)
          if (!exposed) continue
          if (hash2(x, y, seed + 7) > density) continue
          put(x, y, -step)
        }
      }
      break
    }
    case 'top-light': {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!opaque(x, y) || opaque(x, y - 1)) continue
          if (hash2(x, y, seed + 13) > density) continue
          put(x, y, step)
        }
      }
      break
    }
    case 'volume': {
      const span = Math.max(1, maxY - minY)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!opaque(x, y)) continue
          // Du clair en haut vers le sombre en bas, adouci par un tramage.
          const t = (y - minY) / span
          const threshold = BAYER4[(y & 3) * 4 + (x & 3)] / 16
          const level = t * 2 - 1 + (threshold - 0.5) * density
          if (level > 0.35) put(x, y, -step)
          else if (level < -0.35) put(x, y, step)
        }
      }
      break
    }
  }
  return touched
}

/** Applique un enchainement de reglages : une matiere complete en un geste. */
export function applyPreset(
  bitmap: Bitmap,
  index: RampIndex,
  presetId: string,
  seed: number,
  intensity: number,
  within?: Uint8Array | null,
): number {
  const preset = DETAIL_PRESETS.find((p) => p.id === presetId)
  if (!preset) return 0
  let total = 0
  preset.steps.forEach((stepOptions, i) => {
    total += addDetail(bitmap, index, {
      mode: stepOptions.mode ?? 'speckle',
      density: Math.min(1, (stepOptions.density ?? 0.2) * intensity),
      strength: stepOptions.strength ?? 1,
      seed: seed + i * 977,
      within,
    })
  })
  return total
}
