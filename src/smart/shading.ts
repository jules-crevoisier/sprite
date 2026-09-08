import type { Bitmap } from '../core/bitmap'
import {
  getA, hsvToRgba, luminance, rgbaToHsv, type RGBA,
} from '../core/color'
import { RampIndex, type Ramp } from './analysis'

/**
 * Ombrage et polissage assistes.
 *
 * Ce sont les deux corvees du pixel art : trouver les tons d'une matiere,
 * puis les poser un a un sur des centaines de pixels. Les deux se deduisent
 * pourtant de ce qui est deja dessine — la forme donne l'orientation des
 * surfaces, la palette donne les tons.
 */

/* ------------------------------------------------------------------ */
/* Fabrication d'une rampe                                             */
/* ------------------------------------------------------------------ */

export interface RampRecipe {
  /** Nombre de tons produits, la couleur de depart comprise. */
  steps: number
  /**
   * Rotation de teinte entre l'ombre et la lumiere, en degres.
   *
   * C'est le point qui separe une rampe juste d'une rampe fade. Assombrir en
   * ne baissant que la luminosite donne du gris ; les ombres reelles glissent
   * vers le bleu et les lumieres vers le jaune. Une rampe sans decalage de
   * teinte se reconnait immediatement.
   */
  hueShift: number
  /** Ecart de luminosite entre deux tons voisins, de 0 a 1. */
  contrast: number
  /** Gain de saturation dans les ombres : une ombre terne parait sale. */
  shadowSaturation: number
}

export const DEFAULT_RECIPE: RampRecipe = {
  steps: 5,
  hueShift: 28,
  contrast: 0.17,
  shadowSaturation: 0.22,
}

/** Teinte des ombres profondes : le bleu-violet du ciel. */
const SHADOW_HUE = 250
/** Teinte des pleines lumieres : le jaune-orange du soleil. */
const LIGHT_HUE = 48

/** Ecart angulaire le plus court d'une teinte vers une autre, en degres. */
function towardsHue(from: number, target: number, amount: number): number {
  const d = ((target - from + 540) % 360) - 180
  return (from + d * amount + 360) % 360
}

/**
 * Construit une rampe autour d'une couleur, de l'ombre a la lumiere.
 *
 * La couleur donnee occupe le milieu de la rampe : c'est le ton de base, et
 * l'on descend et remonte a partir de lui.
 */
export function buildRamp(base: RGBA, recipe: Partial<RampRecipe> = {}): RGBA[] {
  const r = { ...DEFAULT_RECIPE, ...recipe }
  const steps = Math.max(2, Math.round(r.steps))
  const hsv = rgbaToHsv(base)
  const milieu = (steps - 1) / 2
  const out: RGBA[] = []

  for (let i = 0; i < steps; i++) {
    const d = (i - milieu) / Math.max(1, milieu)   // -1 dans l'ombre, +1 en pleine lumiere
    const v = Math.max(0.04, Math.min(1, hsv.v + d * r.contrast * (d < 0 ? 1.15 : 1)))
    // L'ombre se sature, la lumiere se desature.
    const s = Math.max(0, Math.min(1, hsv.s + (d < 0 ? -d * r.shadowSaturation : -d * 0.18)))
    // La teinte est tiree vers une temperature, pas decalee d'un angle fixe.
    //
    // Le detail est decisif : un bleu decale de vingt-huit degres « vers le
    // froid » arrive dans le cyan, qui est l'une des teintes les plus claires
    // qui soit — l'ombre finissait plus lumineuse que sa base. En visant le
    // bleu-violet pour l'ombre et le jaune-orange pour la lumiere, le
    // glissement va toujours dans le sens de l'eclairement, quelle que soit
    // la couleur de depart.
    const pull = Math.min(0.6, (Math.abs(d) * r.hueShift) / 90)
    const h = towardsHue(hsv.h, d < 0 ? SHADOW_HUE : LIGHT_HUE, pull)
    out.push(hsvToRgba({ h, s, v, a: hsv.a }))
  }

  // Garde-fou : la rampe doit s'eclaircir a chaque cran. Une teinte tres
  // saturee peut encore contrarier la luminosite ; on rabaisse alors la
  // valeur du ton en cause jusqu'a ce que l'ordre soit franc.
  for (let i = milieu; i >= 1; i--) {
    const j = Math.floor(i)
    while (j >= 1 && luminance(out[j - 1]) >= luminance(out[j]) - 2) {
      const h = rgbaToHsv(out[j - 1])
      if (h.v <= 0.03) break
      h.v = Math.max(0.02, h.v - 0.03)
      out[j - 1] = hsvToRgba(h)
    }
  }
  for (let j = Math.ceil(milieu) + 1; j < steps; j++) {
    while (luminance(out[j]) <= luminance(out[j - 1]) + 2) {
      const h = rgbaToHsv(out[j])
      if (h.v >= 0.995 && h.s <= 0.02) break
      h.v = Math.min(1, h.v + 0.03)
      h.s = Math.max(0, h.s - 0.02)
      out[j] = hsvToRgba(h)
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Ombrage selon une direction de lumiere                              */
/* ------------------------------------------------------------------ */

export interface ShadeOptions {
  /** Direction d'ou vient la lumiere, en degres ; 0 = de la droite. */
  angle: number
  /** Force, de 0 a 1 : de combien de tons on s'ecarte au maximum. */
  strength: number
  /** Rayon d'observation de la forme, en pixels. */
  radius: number
  /** Ajoute un liseré clair sur le bord oppose a la lumiere. */
  rimLight: boolean
}

export const DEFAULT_SHADE: ShadeOptions = {
  angle: 135,
  strength: 0.7,
  radius: 3,
  rimLight: false,
}

/**
 * Normale approchee de la surface en un pixel.
 *
 * Un dessin plat n'a pas de relief, mais sa silhouette en dit long : un pixel
 * proche du bord gauche appartient a une surface qui regarde vers la gauche.
 * On mesure donc, dans un voisinage, de quel cote se trouve le vide, et l'on
 * en tire une direction — c'est suffisant pour poser un ombrage credible.
 */
function surfaceNormal(
  bm: Bitmap, x: number, y: number, radius: number,
): { nx: number; ny: number; depth: number } {
  let sx = 0, sy = 0, vides = 0, total = 0
  const r = Math.max(1, Math.round(radius))
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy
      if (d2 === 0 || d2 > r * r) continue
      total++
      const nx = x + dx, ny = y + dy
      const dehors = nx < 0 || ny < 0 || nx >= bm.width || ny >= bm.height
        || getA(bm.u32[ny * bm.width + nx]) === 0
      if (!dehors) continue
      vides++
      // Le vide tire la normale vers lui, d'autant plus qu'il est proche.
      const poids = 1 / Math.sqrt(d2)
      sx += dx * poids
      sy += dy * poids
    }
  }
  const len = Math.hypot(sx, sy)
  return {
    nx: len > 1e-6 ? sx / len : 0,
    ny: len > 1e-6 ? sy / len : 0,
    // Part de vide autour : proche de 0 au coeur de la forme, eleve au bord.
    depth: total ? vides / total : 0,
  }
}

export interface ShadeResult {
  changed: number
  /** Matieres reconnues et effectivement ombrees. */
  ramps: number
}

/**
 * Ombre un dessin selon une direction de lumiere.
 *
 * Chaque pixel est remplace par un autre ton de sa propre famille de
 * couleurs : rien n'est invente, la palette reste celle du dessin. Les
 * surfaces tournees vers la lumiere montent d'un ou deux tons, celles qui
 * s'en detournent descendent, et le coeur de la forme ne bouge pas.
 */
export function autoShade(
  bitmap: Bitmap,
  ramps: Ramp[],
  options: Partial<ShadeOptions> = {},
): ShadeResult {
  const o = { ...DEFAULT_SHADE, ...options }
  const index = new RampIndex(ramps)
  const rad = (o.angle * Math.PI) / 180
  // La lumiere pointe vers la scene ; une normale qui lui fait face recoit
  // le maximum d'eclairement.
  const lx = Math.cos(rad), ly = -Math.sin(rad)
  const source = new Uint32Array(bitmap.u32)
  const out: ShadeResult = { changed: 0, ramps: 0 }
  const vues = new Set<Ramp>()

  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const i = y * bitmap.width + x
      const color = source[i]
      if (getA(color) === 0) continue
      const place = index.find(color)
      if (!place) continue
      const ramp = place.ramp
      if (ramp.colors.length < 2) continue

      const n = surfaceNormal(bitmap, x, y, o.radius)
      if (n.depth < 0.02) continue      // coeur de la forme : rien a dire

      // Produit scalaire normale / lumiere, pondere par la proximite du bord.
      let eclairement = (n.nx * lx + n.ny * ly) * n.depth * 2
      if (o.rimLight && eclairement < -0.45) {
        // Liseré : le bord oppose attrape une lumiere rasante.
        eclairement = 0.8
      }
      const pas = Math.round(eclairement * o.strength * (ramp.colors.length - 1) * 0.6)
      if (pas === 0) continue

      const cible = Math.max(0, Math.min(ramp.colors.length - 1, place.index + pas))
      const next = ramp.colors[cible]
      if (next === color) continue
      bitmap.u32[i] = next
      vues.add(ramp)
      out.changed++
    }
  }
  out.ramps = vues.size
  return out
}

/* ------------------------------------------------------------------ */
/* Anti-crenelage                                                      */
/* ------------------------------------------------------------------ */

/**
 * Adoucit les marches d'escalier d'un contour.
 *
 * Une diagonale tracee sur une grille avance par marches. L'oeil les voit, et
 * l'usage est de poser aux angles un ton intermediaire pour les casser. Fait
 * a la main, c'est long et facile a rater ; la regle, elle, est simple : un
 * pixel en coin d'une marche prend le ton median entre sa couleur et celle
 * d'en face, pris dans sa propre rampe. Aucune couleur nouvelle n'apparait,
 * ce qui compte quand la palette est choisie.
 */
export function antiAlias(bitmap: Bitmap, ramps: Ramp[], strength = 1): number {
  const index = new RampIndex(ramps)
  const w = bitmap.width, h = bitmap.height
  const source = new Uint32Array(bitmap.u32)
  const plein = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && getA(source[y * w + x]) !== 0
  const at = (x: number, y: number): RGBA =>
    (x >= 0 && y >= 0 && x < w && y < h ? source[y * w + x] : 0)
  let changed = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const color = source[i]
      if (getA(color) === 0) continue

      // Un coin de marche : deux voisins orthogonaux vides, perpendiculaires
      // l'un a l'autre, et la diagonale entre eux vide elle aussi.
      const haut = !plein(x, y - 1), bas = !plein(x, y + 1)
      const gauche = !plein(x - 1, y), droite = !plein(x + 1, y)
      const vx = gauche ? -1 : droite ? 1 : 0
      const vy = haut ? -1 : bas ? 1 : 0
      if (vx === 0 || vy === 0) continue
      if (plein(x + vx, y + vy)) continue
      // Deux cotes opposes vides : c'est une pointe, pas une marche.
      if (gauche && droite) continue
      if (haut && bas) continue

      // Le voisin interieur donne la matiere vers laquelle adoucir.
      const dedans = at(x - vx, y - vy)
      if (getA(dedans) === 0) continue
      const place = index.find(color)
      const versPlace = index.find(dedans)
      if (!place || !versPlace || place.ramp !== versPlace.ramp) continue

      // On se rapproche du voisin interieur d'un demi-pas : le coin cesse
      // d'accrocher l'oeil sans que le contour se brouille.
      const ecart = versPlace.index - place.index
      if (ecart === 0) continue
      const pas = Math.sign(ecart) * Math.max(1, Math.round(Math.abs(ecart) / 2 * strength))
      const cible = Math.max(0, Math.min(place.ramp.colors.length - 1, place.index + pas))
      const next = place.ramp.colors[cible]
      if (next === color) continue
      bitmap.u32[i] = next
      changed++
    }
  }
  return changed
}

/**
 * Trie une rampe de l'ombre a la lumiere. Les familles extraites d'un dessin
 * ne le sont pas toujours, et l'ombrage suppose cet ordre.
 */
export const sortRamp = (colors: RGBA[]): RGBA[] =>
  [...colors].sort((a, b) => luminance(a) - luminance(b))
