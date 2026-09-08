import { Bitmap } from './bitmap'

/**
 * Modes de fusion alignes sur ceux d'Aseprite (eux-memes bases sur la
 * specification W3C Compositing and Blending). Les calculs se font sur des
 * canaux non premultiplies normalises dans [0,1].
 */
export type BlendMode =
  | 'normal'
  | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion'
  | 'hue' | 'saturation' | 'color' | 'luminosity'
  | 'addition' | 'subtract' | 'divide'

export const BLEND_MODES: { id: BlendMode; label: string; group: string }[] = [
  { id: 'normal', label: 'Normal', group: 'Base' },
  { id: 'darken', label: 'Obscurcir', group: 'Sombre' },
  { id: 'multiply', label: 'Produit', group: 'Sombre' },
  { id: 'color-burn', label: 'Densite couleur +', group: 'Sombre' },
  { id: 'lighten', label: 'Eclaircir', group: 'Clair' },
  { id: 'screen', label: 'Superposition', group: 'Clair' },
  { id: 'color-dodge', label: 'Densite couleur -', group: 'Clair' },
  { id: 'addition', label: 'Addition', group: 'Clair' },
  { id: 'overlay', label: 'Incrustation', group: 'Contraste' },
  { id: 'soft-light', label: 'Lumiere tamisee', group: 'Contraste' },
  { id: 'hard-light', label: 'Lumiere crue', group: 'Contraste' },
  { id: 'difference', label: 'Difference', group: 'Inversion' },
  { id: 'exclusion', label: 'Exclusion', group: 'Inversion' },
  { id: 'subtract', label: 'Soustraction', group: 'Inversion' },
  { id: 'divide', label: 'Division', group: 'Inversion' },
  { id: 'hue', label: 'Teinte', group: 'Composantes' },
  { id: 'saturation', label: 'Saturation', group: 'Composantes' },
  { id: 'color', label: 'Couleur', group: 'Composantes' },
  { id: 'luminosity', label: 'Luminosite', group: 'Composantes' },
]

const SEPARABLE: Record<string, (b: number, s: number) => number> = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  'color-dodge': (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (b, s) => (s <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b)),
  'soft-light': (b, s) => {
    if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b)
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
    return b + (2 * s - 1) * (d - b)
  },
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  addition: (b, s) => Math.min(1, b + s),
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (b === 0 ? 0 : s === 0 ? 1 : Math.min(1, b / s)),
}

const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b
const sat = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b)

function clipColor(c: [number, number, number]): [number, number, number] {
  const l = lum(c[0], c[1], c[2])
  const n = Math.min(c[0], c[1], c[2])
  const x = Math.max(c[0], c[1], c[2])
  let [r, g, b] = c
  if (n < 0) {
    r = l + ((r - l) * l) / (l - n)
    g = l + ((g - l) * l) / (l - n)
    b = l + ((b - l) * l) / (l - n)
  }
  if (x > 1) {
    r = l + ((r - l) * (1 - l)) / (x - l)
    g = l + ((g - l) * (1 - l)) / (x - l)
    b = l + ((b - l) * (1 - l)) / (x - l)
  }
  return [r, g, b]
}

function setLum(c: [number, number, number], l: number): [number, number, number] {
  const d = l - lum(c[0], c[1], c[2])
  return clipColor([c[0] + d, c[1] + d, c[2] + d])
}

function setSat(c: [number, number, number], s: number): [number, number, number] {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b])
  const out: [number, number, number] = [0, 0, 0]
  const [mn, md, mx] = idx
  if (c[mx] > c[mn]) {
    out[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn])
    out[mx] = s
  }
  out[mn] = 0
  return out
}

const NON_SEPARABLE: Record<string, (b: [number, number, number], s: [number, number, number]) => [number, number, number]> = {
  hue: (b, s) => setLum(setSat(s, sat(b[0], b[1], b[2])), lum(b[0], b[1], b[2])),
  saturation: (b, s) => setLum(setSat(b, sat(s[0], s[1], s[2])), lum(b[0], b[1], b[2])),
  color: (b, s) => setLum(s, lum(b[0], b[1], b[2])),
  luminosity: (b, s) => setLum(b, lum(s[0], s[1], s[2])),
}

/**
 * Composite `src` sur `dst` en place.
 * @param opacity 0..255, multiplie l'alpha de la source.
 */
export function compositeBitmap(
  dst: Bitmap,
  src: Bitmap,
  mode: BlendMode,
  opacity: number,
  offsetX = 0,
  offsetY = 0,
): void {
  if (opacity <= 0) return
  const op = opacity / 255
  const fast = mode === 'normal'
  const sepFn = SEPARABLE[mode]
  const nonSepFn = NON_SEPARABLE[mode]
  const d = dst.data
  const s = src.data

  for (let y = 0; y < src.height; y++) {
    const ty = y + offsetY
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = x + offsetX
      if (tx < 0 || tx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const saRaw = s[si + 3]
      if (saRaw === 0) continue
      const di = (ty * dst.width + tx) * 4

      const as = (saRaw / 255) * op
      const ab = d[di + 3] / 255

      // Chemin rapide : source opaque en mode normal.
      if (fast && as >= 1) {
        d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = 255
        continue
      }

      const ar = as + ab * (1 - as)
      if (ar <= 0) { d[di + 3] = 0; continue }

      const cs: [number, number, number] = [s[si] / 255, s[si + 1] / 255, s[si + 2] / 255]
      const cb: [number, number, number] = [d[di] / 255, d[di + 1] / 255, d[di + 2] / 255]

      let mixed: [number, number, number]
      if (fast) mixed = cs
      else if (nonSepFn) mixed = nonSepFn(cb, cs)
      else if (sepFn) mixed = [sepFn(cb[0], cs[0]), sepFn(cb[1], cs[1]), sepFn(cb[2], cs[2])]
      else mixed = cs

      // Le fond ne "teinte" la source qu'a hauteur de sa propre opacite.
      for (let ch = 0; ch < 3; ch++) {
        const csp = (1 - ab) * cs[ch] + ab * mixed[ch]
        d[di + ch] = (((1 - as) * ab * cb[ch] + as * csp) / ar) * 255
      }
      d[di + 3] = ar * 255
    }
  }
}
