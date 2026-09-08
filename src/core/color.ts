/**
 * Couleurs RGBA packées dans un uint32 respectant l'endianness de la machine,
 * afin de pouvoir manipuler un Uint8ClampedArray et sa vue Uint32Array
 * de maniere interchangeable.
 */

export const LITTLE_ENDIAN = (() => {
  const buf = new ArrayBuffer(4)
  new Uint32Array(buf)[0] = 0x11223344
  return new Uint8Array(buf)[0] === 0x44
})()

/** Couleur packee, telle que stockee dans la vue Uint32Array d'un Bitmap. */
export type RGBA = number

export function rgba(r: number, g: number, b: number, a = 255): RGBA {
  return LITTLE_ENDIAN
    ? (((a << 24) | (b << 16) | (g << 8) | r) >>> 0)
    : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0)
}

export const getR = (c: RGBA): number => (LITTLE_ENDIAN ? c & 0xff : (c >>> 24) & 0xff)
export const getG = (c: RGBA): number => (LITTLE_ENDIAN ? (c >>> 8) & 0xff : (c >>> 16) & 0xff)
export const getB = (c: RGBA): number => (LITTLE_ENDIAN ? (c >>> 16) & 0xff : (c >>> 8) & 0xff)
export const getA = (c: RGBA): number => (LITTLE_ENDIAN ? (c >>> 24) & 0xff : c & 0xff)

export const TRANSPARENT: RGBA = rgba(0, 0, 0, 0)

export function withAlpha(c: RGBA, a: number): RGBA {
  return rgba(getR(c), getG(c), getB(c), a)
}

/* ------------------------------------------------------------------ */
/* Hex                                                                 */
/* ------------------------------------------------------------------ */

export function toHex(c: RGBA, withAlphaChannel = false): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  const base = `#${h(getR(c))}${h(getG(c))}${h(getB(c))}`
  return withAlphaChannel ? `${base}${h(getA(c))}` : base
}

export function fromHex(hex: string): RGBA {
  let s = hex.trim().replace(/^#/, '')
  if (s.length === 3 || s.length === 4) s = s.split('').map((ch) => ch + ch).join('')
  if (s.length !== 6 && s.length !== 8) return TRANSPARENT
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16)
  const v = [n(0), n(2), n(4), s.length === 8 ? n(6) : 255]
  if (v.some((x) => Number.isNaN(x))) return TRANSPARENT
  return rgba(v[0], v[1], v[2], v[3])
}

export function toCss(c: RGBA): string {
  return `rgba(${getR(c)},${getG(c)},${getB(c)},${(getA(c) / 255).toFixed(4)})`
}

/* ------------------------------------------------------------------ */
/* HSV / HSL                                                           */
/* ------------------------------------------------------------------ */

export interface HSV { h: number; s: number; v: number; a: number }

/** h dans [0,360), s/v dans [0,1], a dans [0,255]. */
export function rgbaToHsv(c: RGBA): HSV {
  const r = getR(c) / 255, g = getG(c) / 255, b = getB(c) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a: getA(c) }
}

export function hsvToRgba({ h, s, v, a }: HSV): RGBA {
  const c = v * s
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hh < 1) [r, g, b] = [c, x, 0]
  else if (hh < 2) [r, g, b] = [x, c, 0]
  else if (hh < 3) [r, g, b] = [0, c, x]
  else if (hh < 4) [r, g, b] = [0, x, c]
  else if (hh < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = v - c
  return rgba(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
    Math.round(a),
  )
}

/** Luminance perceptuelle (Rec. 709), utile pour trier une palette ou ombrer. */
export function luminance(c: RGBA): number {
  return 0.2126 * getR(c) + 0.7152 * getG(c) + 0.0722 * getB(c)
}

/** Distance perceptuelle approximative, pour trouver la couleur de palette la plus proche. */
export function colorDistance(a: RGBA, b: RGBA): number {
  const rmean = (getR(a) + getR(b)) / 2
  const dr = getR(a) - getR(b)
  const dg = getG(a) - getG(b)
  const db = getB(a) - getB(b)
  const da = getA(a) - getA(b)
  return Math.sqrt(
    (((512 + rmean) * dr * dr) / 256) + 4 * dg * dg + (((767 - rmean) * db * db) / 256),
  ) + Math.abs(da) * 2
}

/** Melange lineaire de deux couleurs (t dans [0,1]), en espace premultiplie. */
export function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  const l = (x: number, y: number) => Math.round(x + (y - x) * t)
  return rgba(
    l(getR(a), getR(b)),
    l(getG(a), getG(b)),
    l(getB(a), getB(b)),
    l(getA(a), getA(b)),
  )
}

/** Ajuste teinte/saturation/luminosite d'une couleur, utilise par l'outil de shading. */
export function shift(c: RGBA, dh: number, ds: number, dv: number): RGBA {
  const hsv = rgbaToHsv(c)
  hsv.h = (((hsv.h + dh) % 360) + 360) % 360
  hsv.s = Math.min(1, Math.max(0, hsv.s + ds))
  hsv.v = Math.min(1, Math.max(0, hsv.v + dv))
  return hsvToRgba(hsv)
}
