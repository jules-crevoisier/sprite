import { type RGBA, fromHex, toHex, colorDistance, luminance, rgbaToHsv, getA } from './color'
import type { Bitmap } from './bitmap'

/** Palettes de reference largement utilisees en pixel art / game jam. */
export const PALETTE_PRESETS: Record<string, string[]> = {
  'DawnBringer 32': ['000000','222034','45283c','663931','8f563b','df7126','d9a066','eec39a','fbf236','99e550','6abe30','37946e','4b692f','524b24','323c39','3f3f74','306082','5b6ee1','639bff','5fcde4','cbdbfc','ffffff','9badb7','847e87','696a6a','595652','76428a','ac3232','d95763','d77bba','8f974a','8a6f30'],
  'PICO-8': ['000000','1d2b53','7e2553','008751','ab5236','5f574f','c2c3c7','fff1e8','ff004d','ffa300','ffec27','00e436','29adff','83769c','ff77a8','ffccaa'],
  'Sweetie 16': ['1a1c2c','5d275d','b13e53','ef7d57','ffcd75','a7f070','38b764','257179','29366f','3b5dc9','41a6f6','73eff7','f4f4f4','94b0c2','566c86','333c57'],
  'Endesga 32': ['be4a2f','d77643','ead4aa','e4a672','b86f50','733e39','3e2731','a22633','e43b44','f77622','feae34','fee761','63c74d','3e8948','265c42','193c3e','124e89','0099db','2ce8f5','ffffff','c0cbdc','8b9bb4','5a6988','3a4466','262b44','181425','ff0044','68386c','b55088','f6757a','e8b796','c28569'],
  'Vinik 24': ['000000','6f6776','9a9a97','c5ccb8','8b5580','c38890','a593a5','666092','9a4f50','c28d75','7ca1c0','416aa3','8d6268','be955c','68aca9','387080','6e6962','93a167','6eaa78','557064','9d9f7f','7e9e99','5d6872','433455'],
  'Game Boy (DMG)': ['0f380f','306230','8bac0f','9bbc0f'],
  'CGA 16': ['000000','0000aa','00aa00','00aaaa','aa0000','aa00aa','aa5500','aaaaaa','555555','5555ff','55ff55','55ffff','ff5555','ff55ff','ffff55','ffffff'],
  'NES': ['7c7c7c','0000fc','0000bc','4428bc','940084','a80020','a81000','881400','503000','007800','006800','005800','004058','000000','bcbcbc','0078f8','0058f8','6844fc','d800cc','e40058','f83800','e45c10','ac7c00','00b800','00a800','00a844','008888','f8f8f8','3cbcfc','6888fc','9878f8','f878f8','f85898','f87858','fca044','f8b800','b8f818','58d854','58f898','00e8d8','787878','fcfcfc','a4e4fc','b8b8f8','d8b8f8','f8b8f8','f8a4c0','f0d0b0','fce0a8','f8d878','d8f878','b8f8b8','b8f8d8','00fcfc','f8d8f8'],
  'Grayscale 16': ['000000','111111','222222','333333','444444','555555','666666','777777','888888','999999','aaaaaa','bbbbbb','cccccc','dddddd','eeeeee','ffffff'],
  'Journey 64': ['050914','110524','3b063a','691749','9c3247','d46453','f5a15d','ffcf8e','ff7a7d','ff417d','d61a88','94007a','680048','4b0038','2d0032','000000','5d275d','b13e53','ef7d57','ffcd75','a7f070','38b764','257179','29366f','3b5dc9','41a6f6','73eff7','f4f4f4','94b0c2','566c86','333c57','1a1c2c'],
}

/**
 * Un GROUPE de palette : des couleurs qui vont ensemble, sous un nom.
 *
 * ## Pourquoi une palette a besoin de groupes
 *
 * Trente-deux pastilles alignees ne disent rien de ce qu'elles sont. Le
 * pixel art travaille par FAMILLES — l'herbe, la peau, le metal, le ciel — et
 * chaque famille est une rampe qu'on parcourt de l'ombre a la lumiere. C'est
 * l'unite de travail reelle, et elle n'existait nulle part : ni a l'oeil, ni
 * pour les outils.
 *
 * Un groupe est donc une rampe NOMMEE, et c'est deliberement la meme chose
 * que ce que `extractRamps` devine dans un dessin. La difference tient en un
 * mot : ici, c'est vous qui le dites. Les outils assistes — le detail,
 * l'ombrage — s'en servent alors au lieu de deviner, et cessent de se
 * tromper sur un vert de mousse qu'ils rangeaient avec le vert du pantalon.
 */
export interface GroupePalette {
  nom: string
  /** Les couleurs, de l'ombre a la lumiere. C'est l'ordre d'une rampe. */
  couleurs: RGBA[]
}

/** Ensemble ordonne de couleurs, avec ou sans doublons (l'index compte). */
export class Palette {
  name: string
  colors: RGBA[]
  /**
   * Les familles declarees. Vide : personne n'a encore rien range, et les
   * outils devinent comme avant.
   */
  groupes: GroupePalette[] = []

  constructor(name: string, colors: RGBA[]) {
    this.name = name
    this.colors = colors
  }

  static fromHexList(name: string, hex: string[]): Palette {
    return new Palette(name, hex.map(fromHex))
  }

  static preset(name: string): Palette {
    const hex = PALETTE_PRESETS[name]
    return hex ? Palette.fromHexList(name, hex) : Palette.default()
  }

  static default(): Palette {
    return Palette.fromHexList('DawnBringer 32', PALETTE_PRESETS['DawnBringer 32'])
  }

  get size(): number { return this.colors.length }

  clone(): Palette {
    const p = new Palette(this.name, [...this.colors])
    p.groupes = this.groupes.map((g) => ({ nom: g.nom, couleurs: [...g.couleurs] }))
    return p
  }

  /* ---------------------------------------------------------------- */
  /* Les groupes                                                       */
  /* ---------------------------------------------------------------- */

  /** Le groupe qui contient cette couleur, ou null. */
  groupeDe(c: RGBA): GroupePalette | null {
    return this.groupes.find((g) => g.couleurs.includes(c)) ?? null
  }

  /**
   * Cree un groupe, ou rend celui qui porte deja ce nom.
   *
   * Deux groupes du meme nom rendraient « lequel ? » sans reponse — la meme
   * regle que partout ailleurs ici.
   */
  creerGroupe(nom: string, couleurs: RGBA[] = []): GroupePalette {
    const propre = nom.trim() || 'groupe'
    const deja = this.groupes.find((g) => g.nom === propre)
    if (deja) {
      for (const c of couleurs) this.ajouterAuGroupe(propre, c)
      return deja
    }
    const g: GroupePalette = { nom: propre, couleurs: [] }
    this.groupes.push(g)
    for (const c of couleurs) this.ajouterAuGroupe(propre, c)
    return g
  }

  /**
   * Range une couleur dans un groupe.
   *
   * Une couleur n'appartient qu'a UN groupe : elle quitte l'ancien. Sans
   * cette regle, un vert range a la fois dans « herbe » et dans « pantalon »
   * laisserait les outils choisir au hasard lequel des deux fait foi.
   *
   * Et le groupe reste trie par luminance : un groupe EST une rampe, et une
   * rampe se parcourt de l'ombre a la lumiere. Y ajouter une couleur au bout
   * ferait une rampe ou le cran suivant serait parfois plus sombre.
   */
  ajouterAuGroupe(nom: string, c: RGBA): void {
    const g = this.groupes.find((q) => q.nom === nom)
    if (!g) return
    for (const autre of this.groupes) {
      if (autre === g) continue
      const i = autre.couleurs.indexOf(c)
      if (i >= 0) autre.couleurs.splice(i, 1)
    }
    if (!g.couleurs.includes(c)) g.couleurs.push(c)
    g.couleurs.sort((a, b) => luminance(a) - luminance(b))
    // La couleur entre aussi dans la palette : ranger une teinte qui n'y est
    // pas ferait un groupe qui montre ce que la palette ignore.
    this.add(c)
  }

  retirerDuGroupe(nom: string, c: RGBA): void {
    const g = this.groupes.find((q) => q.nom === nom)
    if (!g) return
    const i = g.couleurs.indexOf(c)
    if (i >= 0) g.couleurs.splice(i, 1)
  }

  renommerGroupe(nom: string, neuf: string): boolean {
    const propre = neuf.trim()
    if (!propre || this.groupes.some((g) => g.nom === propre)) return false
    const g = this.groupes.find((q) => q.nom === nom)
    if (!g) return false
    g.nom = propre
    return true
  }

  /** Defait un groupe. Les couleurs restent dans la palette : on range, on ne jette pas. */
  retirerGroupe(nom: string): void {
    const i = this.groupes.findIndex((g) => g.nom === nom)
    if (i >= 0) this.groupes.splice(i, 1)
  }

  indexOf(c: RGBA): number { return this.colors.indexOf(c) }

  /** Index de la couleur la plus proche perceptuellement. */
  nearestIndex(c: RGBA): number {
    let best = 0, bestD = Infinity
    for (let i = 0; i < this.colors.length; i++) {
      const d = colorDistance(c, this.colors[i])
      if (d < bestD) { bestD = d; best = i }
    }
    return best
  }

  nearest(c: RGBA): RGBA { return this.colors[this.nearestIndex(c)] ?? c }

  add(c: RGBA): number {
    const existing = this.indexOf(c)
    if (existing >= 0) return existing
    this.colors.push(c)
    return this.colors.length - 1
  }

  removeAt(i: number): void { this.colors.splice(i, 1) }

  sortBy(mode: 'luminance' | 'hue' | 'saturation'): void {
    const key = (c: RGBA) => {
      if (mode === 'luminance') return luminance(c)
      const hsv = rgbaToHsv(c)
      return mode === 'hue' ? hsv.h * 1000 + hsv.v : hsv.s
    }
    this.colors.sort((a, b) => key(a) - key(b))
  }

  toHexList(): string[] { return this.colors.map((c) => toHex(c)) }

  /** Format GPL (GIMP), lisible par Aseprite, Krita, LibreSprite. */
  toGPL(): string {
    const lines = ['GIMP Palette', `Name: ${this.name}`, 'Columns: 8', '#']
    for (const c of this.colors) {
      const hex = toHex(c).slice(1)
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${toHex(c)}`)
    }
    return lines.join('\n') + '\n'
  }

  static fromGPL(text: string, name = 'Importée'): Palette {
    const colors: RGBA[] = []
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#') || /^(GIMP Palette|Name:|Columns:)/i.test(t)) continue
      const m = t.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/)
      if (m) colors.push(fromHex(`#${[1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, '0')).join('')}`))
    }
    return new Palette(name, colors)
  }

  /** Palette hexadecimale simple, une couleur par ligne (format .hex de Lospec). */
  toHEXFile(): string {
    return this.colors.map((c) => toHex(c).slice(1).toUpperCase()).join('\n') + '\n'
  }

  static fromHEXFile(text: string, name = 'Importée'): Palette {
    const colors = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(l))
      .map((l) => fromHex(l))
    return new Palette(name, colors)
  }
}

/**
 * Quantification par median cut : extrait les `max` couleurs les plus
 * representatives d'un ensemble de bitmaps.
 */
export function quantize(bitmaps: Bitmap[], max = 32): RGBA[] {
  const pixels: [number, number, number][] = []
  const seen = new Set<number>()
  for (const bm of bitmaps) {
    for (let i = 0; i < bm.u32.length; i++) {
      const c = bm.u32[i]
      if (getA(c) === 0) continue
      if (seen.has(c)) continue
      seen.add(c)
      pixels.push([bm.data[i * 4], bm.data[i * 4 + 1], bm.data[i * 4 + 2]])
    }
  }
  if (pixels.length === 0) return []
  if (pixels.length <= max) return pixels.map((p) => fromHex(`#${p.map((v) => v.toString(16).padStart(2, '0')).join('')}`))

  let buckets: [number, number, number][][] = [pixels]
  while (buckets.length < max) {
    // Coupe le bucket dont l'etendue sur un canal est la plus grande.
    let target = -1, targetRange = -1, targetCh = 0
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]
      if (b.length < 2) continue
      for (let ch = 0; ch < 3; ch++) {
        let mn = 255, mx = 0
        for (const p of b) { if (p[ch] < mn) mn = p[ch]; if (p[ch] > mx) mx = p[ch] }
        if (mx - mn > targetRange) { targetRange = mx - mn; target = i; targetCh = ch }
      }
    }
    if (target < 0 || targetRange <= 0) break
    const b = buckets[target].slice().sort((p, q) => p[targetCh] - q[targetCh])
    const mid = b.length >> 1
    buckets = [...buckets.slice(0, target), b.slice(0, mid), b.slice(mid), ...buckets.slice(target + 1)]
  }

  return buckets.filter((b) => b.length).map((b) => {
    const avg = [0, 0, 0]
    for (const p of b) { avg[0] += p[0]; avg[1] += p[1]; avg[2] += p[2] }
    const h = avg.map((v) => Math.round(v / b.length).toString(16).padStart(2, '0')).join('')
    return fromHex(`#${h}`)
  })
}
