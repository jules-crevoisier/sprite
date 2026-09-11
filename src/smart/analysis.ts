import type { Bitmap } from '../core/bitmap'
import {
  type RGBA, getA, rgbaToHsv, hsvToRgba, luminance, colorDistance,
} from '../core/color'

/**
 * Une rampe : les teintes d'une meme famille classees du plus sombre au plus
 * clair. C'est l'unite de travail naturelle du pixel art — un vetement, une
 * peau, un feuillage sont chacun une rampe.
 */
export interface Ramp {
  id: number
  /** Du plus sombre au plus clair. */
  colors: RGBA[]
  /** Nombre de pixels du sprite utilisant cette rampe. */
  pixels: number
  /** Teinte moyenne en degres, ou null pour les neutres. */
  hue: number | null
  /** Nom devine, affiche dans l'interface. */
  label: string
}

const HUE_NAMES: [number, string][] = [
  [15, 'rouges'], [45, 'oranges'], [70, 'jaunes'], [160, 'verts'],
  [200, 'cyans'], [255, 'bleus'], [290, 'violets'], [335, 'roses'], [360, 'rouges'],
]

function hueName(h: number): string {
  for (const [max, name] of HUE_NAMES) if (h < max) return name
  return 'rouges'
}

/**
 * Teintes chair : orange peu sature et clair. Le critere reste etroit, sinon
 * un brun de terre passerait pour de la peau.
 */
function looksLikeSkin(h: number, s: number, v: number): boolean {
  return h >= 12 && h <= 45 && s >= 0.15 && s <= 0.5 && v >= 0.62
}

/** Les oranges sombres se lisent comme des bruns, pas comme des oranges. */
function looksBrown(h: number, s: number, v: number): boolean {
  return h >= 8 && h <= 50 && s >= 0.2 && v < 0.62
}

/**
 * Regroupe les couleurs d'un sprite en rampes.
 * Les couleurs proches en teinte forment une famille ; les gris sont
 * rassembles a part car leur teinte n'a pas de sens.
 */
export function extractRamps(bitmaps: Bitmap[], maxRamps = 12): Ramp[] {
  const counts = new Map<RGBA, number>()
  for (const bm of bitmaps) {
    for (let i = 0; i < bm.u32.length; i++) {
      const c = bm.u32[i]
      if (getA(c) === 0) continue
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
  }
  if (counts.size === 0) return []

  const entries = [...counts.entries()].map(([color, n]) => {
    const hsv = rgbaToHsv(color)
    return { color, n, h: hsv.h, s: hsv.s, v: hsv.v }
  })

  const neutrals = entries.filter((e) => e.s < 0.12)
  const chromatic = entries.filter((e) => e.s >= 0.12).sort((a, b) => a.h - b.h)

  const groups: typeof chromatic[] = []
  let current: typeof chromatic = []
  for (const e of chromatic) {
    if (current.length === 0 || e.h - current[current.length - 1].h < 24) current.push(e)
    else { groups.push(current); current = [e] }
  }
  if (current.length) groups.push(current)
  // Le rouge est a cheval sur 0 et 360 : les deux extremites se rejoignent.
  if (groups.length > 1) {
    const first = groups[0], last = groups[groups.length - 1]
    if (first[0].h + 360 - last[last.length - 1].h < 24) {
      groups[0] = [...last, ...first]
      groups.pop()
    }
  }
  if (neutrals.length) groups.push(neutrals)

  let id = 1
  const ramps: Ramp[] = groups.map((group) => {
    const colors = [...group].sort((a, b) => luminance(a.color) - luminance(b.color)).map((e) => e.color)
    const pixels = group.reduce((n, e) => n + e.n, 0)
    const isNeutral = group.every((e) => e.s < 0.12)
    // Teinte representative : celle de la couleur la plus presente.
    const dominant = group.reduce((best, e) => (e.n > best.n ? e : best), group[0])
    const label = isNeutral
      ? 'gris'
      : looksLikeSkin(dominant.h, dominant.s, dominant.v)
        ? 'peau'
        : looksBrown(dominant.h, dominant.s, dominant.v)
          ? 'bruns'
          : hueName(dominant.h)
    return { id: id++, colors, pixels, hue: isNeutral ? null : dominant.h, label }
  })

  // Les rampes les plus presentes d'abord : ce sont celles qu'on veut modifier.
  ramps.sort((a, b) => b.pixels - a.pixels)
  if (ramps.length <= maxRamps) return dedupeLabels(ramps)

  // Au-dela, les plus petites sont fondues dans la rampe la plus proche.
  const kept = ramps.slice(0, maxRamps)
  for (const extra of ramps.slice(maxRamps)) {
    let best = kept[0], bestD = Infinity
    for (const r of kept) {
      const d = colorDistance(r.colors[Math.floor(r.colors.length / 2)], extra.colors[0])
      if (d < bestD) { bestD = d; best = r }
    }
    best.colors = [...best.colors, ...extra.colors].sort((a, b) => luminance(a) - luminance(b))
    best.pixels += extra.pixels
  }
  return dedupeLabels(kept)
}

/** Deux rampes « bleus » deviennent « bleus » et « bleus 2 ». */
function dedupeLabels(ramps: Ramp[]): Ramp[] {
  const seen = new Map<string, number>()
  for (const r of ramps) {
    const n = (seen.get(r.label) ?? 0) + 1
    seen.set(r.label, n)
    if (n > 1) r.label = `${r.label} ${n}`
  }
  return ramps
}

/**
 * Index inverse : retrouve la rampe d'une couleur et sa position dedans,
 * pour se deplacer d'un cran vers l'ombre ou vers la lumiere.
 */
export class RampIndex {
  private map = new Map<RGBA, { ramp: Ramp; index: number }>()
  readonly ramps: Ramp[]

  constructor(ramps: Ramp[]) {
    this.ramps = ramps
    for (const ramp of ramps) {
      ramp.colors.forEach((c, index) => this.map.set(c, { ramp, index }))
    }
  }

  static fromBitmaps(bitmaps: Bitmap[]): RampIndex {
    return new RampIndex(extractRamps(bitmaps))
  }

  /**
   * Les rampes DEVINEES dans le dessin, corrigees par celles qu'on a
   * DECLAREES dans la palette.
   *
   * ## Pourquoi les deux, et dans cet ordre
   *
   * Deviner suffit la plupart du temps, et c'est ce qui permet a l'outil de
   * marcher sur un dessin qu'on vient d'importer, sans rien preparer. Mais
   * deviner range les couleurs par TEINTE : le vert d'un feuillage et le vert
   * d'un pantalon tombent dans la meme famille, et l'ombrage de l'un se met a
   * puiser dans l'autre.
   *
   * Un groupe declare fait donc foi : ses couleurs quittent la rampe devinee
   * pour rejoindre la sienne. Ce qui n'est dans aucun groupe garde la rampe
   * devinee — on ne punit pas celui qui n'a rien range.
   */
  static fromBitmapsAndGroups(
    bitmaps: Bitmap[],
    groupes: { nom: string; couleurs: RGBA[] }[],
  ): RampIndex {
    const devinees = extractRamps(bitmaps)
    if (!groupes.length) return new RampIndex(devinees)
    const declarees = new Set<RGBA>()
    for (const g of groupes) for (const c of g.couleurs) declarees.add(c)
    let id = 1000
    const rampes: Ramp[] = groupes
      .filter((g) => g.couleurs.length > 0)
      .map((g) => ({
        id: id++,
        colors: [...g.couleurs].sort((a, b) => luminance(a) - luminance(b)),
        pixels: 0,
        hue: null,
        label: g.nom,
      }))
    for (const r of devinees) {
      // Ce qui reste : les couleurs devinees qu'aucun groupe ne reclame.
      const restantes = r.colors.filter((c) => !declarees.has(c))
      if (restantes.length) rampes.push({ ...r, colors: restantes })
    }
    return new RampIndex(rampes)
  }

  rampOf(color: RGBA): Ramp | null { return this.map.get(color)?.ramp ?? null }

  /** Rampe d'une couleur et son rang dedans, de l'ombre a la lumiere. */
  find(color: RGBA): { ramp: Ramp; index: number } | null {
    return this.map.get(color) ?? null
  }

  /**
   * Deplace une couleur de `delta` crans dans sa rampe.
   * Une couleur inconnue est decalee en TSV puis ramenee sur la couleur la
   * plus proche parmi celles disponibles, pour rester dans l'esprit du sprite.
   */
  step(color: RGBA, delta: number, fallback: RGBA[] = []): RGBA {
    const hit = this.map.get(color)
    if (hit) {
      const i = Math.max(0, Math.min(hit.ramp.colors.length - 1, hit.index + delta))
      return hit.ramp.colors[i]
    }
    const hsv = rgbaToHsv(color)
    hsv.v = Math.min(1, Math.max(0, hsv.v + delta * 0.12))
    hsv.s = Math.min(1, Math.max(0, hsv.s - delta * 0.03))
    const shifted = hsvToRgba(hsv)
    if (!fallback.length) return shifted
    let best = shifted, bestD = Infinity
    for (const c of fallback) {
      const d = colorDistance(shifted, c)
      if (d < bestD) { bestD = d; best = c }
    }
    return best
  }

  /**
   * Deplace une couleur d'un cran, EN FABRIQUANT la teinte qui manque.
   *
   * ## Pourquoi `step` ne suffisait pas
   *
   * `step` reste dans les couleurs deja presentes : c'est le bon contrat pour
   * ombrer un dessin qui a deja ses tons. Mais il BUTE aux extremites — une
   * couleur seule dans sa rampe n'a ni voisin plus clair ni voisin plus
   * sombre, et `step` la rend inchangee.
   *
   * C'est ce qui faisait que « Ajouter du détail » ne faisait rien du tout
   * sur un dessin a plat : on pose une forme d'un seul vert, on demande de
   * l'herbe, et la boite repond « Aucun pixel touche ». Or c'est exactement
   * la qu'on veut du detail — un dessin qui a deja cinq verts n'en a pas
   * besoin.
   *
   * La teinte fabriquee est DETERMINISTE et derivee de la couleur elle-meme :
   * un meme vert donne toujours le meme vert clair, si bien que toute la
   * surface se detaille avec deux ou trois teintes et non trente. C'est la
   * meme loi que le repli de `step` pour une couleur inconnue — un cran de
   * valeur, un souffle de saturation en moins.
   */
  stepOrInvent(color: RGBA, delta: number): RGBA {
    const hit = this.map.get(color)
    /*
     * Une rampe qui a des voisins SUFFIT : on n'invente rien.
     *
     * Y compris a ses extremites. Le ton le plus sombre d'une rampe de quatre
     * verts ne descend pas plus bas, et c'est juste : quatre verts disent
     * deja tout ce qu'il faut, et en fabriquer un cinquieme etendrait la
     * palette du sprite sans qu'on l'ait demande. Le premier jet inventait
     * aux deux bouts — le banc l'a vu en comptant les couleurs etrangeres
     * apparues dans un dessin qui avait pourtant sa rampe.
     */
    if (hit && hit.ramp.colors.length > 1) return this.step(color, delta)
    // Rampe d'une seule couleur, ou couleur inconnue : le cran n'existe
    // nulle part, il faut le faire.
    return teinteVoisine(color, delta)
  }

  /** Toutes les couleurs connues, tous rampes confondues. */
  allColors(): RGBA[] { return [...this.map.keys()] }
}

/**
 * La teinte voisine d'une couleur : un cran plus claire, ou plus sombre.
 *
 * Elle garde la TEINTE et l'opacite, change la valeur, et baisse un peu la
 * saturation en montant — c'est ce que fait un peintre, et c'est ce qui evite
 * qu'un vert eclairci vire au fluo. Deterministe : la meme entree rend
 * toujours la meme sortie, faute de quoi un aplat se couvrirait de trente
 * teintes voisines au lieu de deux.
 *
 * Aux extremites, la couleur ne peut plus monter ni descendre : on rend alors
 * la couleur telle quelle, et l'appelant sait que rien n'a bouge.
 */
export function teinteVoisine(color: RGBA, delta: number): RGBA {
  const hsv = rgbaToHsv(color)
  const v = Math.min(1, Math.max(0, hsv.v + delta * 0.14))
  // Un noir pur n'a pas de teinte : l'eclaircir par la valeur seule donnerait
  // du gris. On lui accorde un minimum de valeur pour que le cran existe.
  const s = Math.min(1, Math.max(0, hsv.s - delta * 0.04))
  const neuf = hsvToRgba({ ...hsv, v, s })
  return neuf === color ? color : neuf
}

/** Masque des pixels dont la couleur appartient a la rampe donnee. */
export function rampMask(bitmap: Bitmap, ramp: Ramp): Uint8Array {
  const set = new Set(ramp.colors)
  const mask = new Uint8Array(bitmap.u32.length)
  for (let i = 0; i < bitmap.u32.length; i++) {
    if (getA(bitmap.u32[i]) !== 0 && set.has(bitmap.u32[i])) mask[i] = 255
  }
  return mask
}

/** Generateur pseudo-aleatoire deterministe : une graine donne toujours le meme resultat. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
