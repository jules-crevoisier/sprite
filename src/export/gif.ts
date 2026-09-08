import type { Bitmap } from '../core/bitmap'
import { getA, getR, getG, getB, colorDistance, rgba } from '../core/color'
import { quantize } from '../core/palette'

export interface GifOptions {
  /** 0 = boucle infinie, n = nombre de repetitions. */
  loop: number
  /** Seuil d'alpha en dessous duquel un pixel devient transparent. */
  alphaThreshold: number
}

const DEFAULTS: GifOptions = { loop: 0, alphaThreshold: 128 }

/**
 * Encodeur GIF89a complet (LZW inclus), sans dependance externe.
 * L'index 0 de la table de couleurs est reserve a la transparence, ce qui
 * laisse 255 couleurs pour l'image : largement suffisant en pixel art.
 */
export function encodeGif(frames: Bitmap[], delaysMs: number[], options: Partial<GifOptions> = {}): Uint8Array {
  const opts = { ...DEFAULTS, ...options }
  if (!frames.length) throw new Error('Aucune frame a encoder')
  const width = frames[0].width
  const height = frames[0].height

  const palette = buildPalette(frames, opts.alphaThreshold)
  const tableSize = Math.max(2, nextPow2(palette.length))
  const minCodeSize = Math.max(2, Math.log2(tableSize))

  const out: number[] = []
  const byte = (b: number) => out.push(b & 0xff)
  const short = (v: number) => { byte(v); byte(v >> 8) }
  const str = (s: string) => { for (let i = 0; i < s.length; i++) byte(s.charCodeAt(i)) }

  str('GIF89a')
  short(width)
  short(height)
  // Table globale presente, 8 bits par couleur, taille = 2^(n+1).
  byte(0x80 | 0x70 | (Math.log2(tableSize) - 1))
  byte(0) // index de couleur de fond
  byte(0) // ratio d'aspect

  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? 0
    byte(getR(c)); byte(getG(c)); byte(getB(c))
  }

  // Extension Netscape : boucle de lecture.
  byte(0x21); byte(0xff); byte(11)
  str('NETSCAPE2.0')
  byte(3); byte(1); short(opts.loop); byte(0)

  const cache = new Map<number, number>()
  for (let f = 0; f < frames.length; f++) {
    const delay = Math.max(1, Math.round((delaysMs[f] ?? 100) / 10))

    // Controle graphique : disposal 2 (restaure le fond) + index transparent.
    byte(0x21); byte(0xf9); byte(4)
    byte((2 << 2) | 1)
    short(delay)
    byte(0)
    byte(0)

    byte(0x2c)
    short(0); short(0)
    short(width); short(height)
    byte(0) // pas de table locale, pas d'entrelacement

    const indices = mapToIndices(frames[f], palette, opts.alphaThreshold, cache)
    byte(minCodeSize)
    writeBlocks(out, lzwEncode(indices, minCodeSize))
    byte(0)
  }

  byte(0x3b)
  return new Uint8Array(out)
}

function nextPow2(n: number): number {
  let p = 2
  while (p < n) p *= 2
  return Math.min(256, p)
}

/** Index 0 transparent, puis jusqu'a 255 couleurs opaques. */
function buildPalette(frames: Bitmap[], alphaThreshold: number): number[] {
  const seen = new Set<number>()
  for (const bm of frames) {
    for (let i = 0; i < bm.u32.length; i++) {
      const c = bm.u32[i]
      if (getA(c) < alphaThreshold) continue
      seen.add(rgba(getR(c), getG(c), getB(c), 255))
      if (seen.size > 4096) break
    }
  }
  let colors = [...seen]
  if (colors.length > 255) colors = quantize(frames, 255)
  return [rgba(0, 0, 0, 255), ...colors.slice(0, 255)]
}

function mapToIndices(
  bm: Bitmap,
  palette: number[],
  alphaThreshold: number,
  cache: Map<number, number>,
): Uint8Array {
  const out = new Uint8Array(bm.u32.length)
  for (let i = 0; i < bm.u32.length; i++) {
    const c = bm.u32[i]
    if (getA(c) < alphaThreshold) { out[i] = 0; continue }
    const key = rgba(getR(c), getG(c), getB(c), 255)
    let idx = cache.get(key)
    if (idx === undefined) {
      idx = 1
      let best = Infinity
      for (let p = 1; p < palette.length; p++) {
        const d = colorDistance(key, palette[p])
        if (d < best) { best = d; idx = p }
      }
      cache.set(key, idx)
    }
    out[i] = idx
  }
  return out
}

/** Decoupe le flux LZW en sous-blocs de 255 octets maximum. */
function writeBlocks(out: number[], data: number[]): void {
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255)
    out.push(chunk.length)
    for (const b of chunk) out.push(b)
  }
}

/**
 * Compression LZW du GIF. La progression de la taille de code suit la
 * specification : le decodeur reconstruit le dictionnaire a l'identique.
 */
function lzwEncode(pixels: Uint8Array, minCodeSize: number): number[] {
  const MAX_BITS = 12
  const MAX_MAX_CODE = 1 << MAX_BITS
  const clearCode = 1 << minCodeSize
  const eofCode = clearCode + 1
  const initBits = minCodeSize + 1

  const out: number[] = []
  let accum = 0
  let bits = 0
  let nBits = initBits
  let maxCode = (1 << nBits) - 1
  let free = clearCode + 2
  let clearFlag = false
  const dict = new Map<number, number>()

  const output = (code: number) => {
    accum |= (code << bits) >>> 0
    bits += nBits
    while (bits >= 8) {
      out.push(accum & 0xff)
      accum >>>= 8
      bits -= 8
    }
    if (free > maxCode || clearFlag) {
      if (clearFlag) {
        nBits = initBits
        maxCode = (1 << nBits) - 1
        clearFlag = false
      } else {
        nBits++
        maxCode = nBits === MAX_BITS ? MAX_MAX_CODE : (1 << nBits) - 1
      }
    }
  }

  const clearBlock = () => {
    dict.clear()
    free = clearCode + 2
    clearFlag = true
    output(clearCode)
  }

  output(clearCode)
  let prefix = pixels[0]
  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i]
    const key = (prefix << 12) | c
    const found = dict.get(key)
    if (found !== undefined) { prefix = found; continue }
    output(prefix)
    prefix = c
    if (free < MAX_MAX_CODE) dict.set(key, free++)
    else clearBlock()
  }
  output(prefix)
  output(eofCode)
  if (bits > 0) out.push(accum & 0xff)
  return out
}
