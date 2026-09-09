import { Bitmap } from './bitmap'
import { compositeBitmap, type BlendMode } from './blend'
import { getA, getB, getG, getR, rgba, type RGBA } from './color'

/**
 * Effets de calque, non destructifs.
 *
 * Le dessin n'est jamais modifie : les effets sont recalcules au moment de
 * composer l'image, ce qui permet de regler une ombre en la regardant et de
 * revenir en arriere sans perte. C'est le meme principe que dans un outil de
 * maquette, adapte au pixel art sur un point essentiel : il n'y a pas de flou
 * gaussien. Une attenuation floue ferait exploser le nombre de couleurs et
 * casserait le rendu ; ici elle est soit nette, soit decoupee en paliers,
 * soit tramee — trois facons de rester dans une palette.
 */

export type EffectKind =
  | 'ombre-portee'
  | 'ombre-interne'
  | 'lueur-externe'
  | 'lueur-interne'
  | 'contour'
  | 'biseau'
  | 'teinte'
  | 'degrade'

/** Comment l'attenuation est rendue quand `size` depasse zero. */
export type Falloff = 'net' | 'paliers' | 'tramage'

/** Cote du contour par rapport a la silhouette. */
export type StrokeSide = 'dehors' | 'dedans' | 'centre'

export interface LayerEffect {
  id: number
  kind: EffectKind
  enabled: boolean
  /** Couleur principale. Pour le biseau : la lumiere. Pour le degrade : le depart. */
  color: RGBA
  /** Couleur secondaire. Biseau : l'ombre. Degrade : l'arrivee. */
  color2: RGBA
  /** 0..1 */
  opacity: number
  /** Direction de la lumiere en degres ; 0 = depuis la droite, 90 = du haut. */
  angle: number
  /** Deport de l'ombre le long de l'angle, en pixels. */
  distance: number
  /** Elargissement a pleine opacite avant l'attenuation, en pixels. */
  spread: number
  /**
   * Pixels ignores depuis le bord, pour les effets interieurs.
   *
   * La plupart des dessins de pixel art portent deja un contour sombre :
   * sans retrait, une lumiere de biseau tombe dessus et le delave au lieu
   * d'eclairer la matiere juste derriere.
   */
  inset: number
  /** Longueur de l'attenuation, en pixels. 0 = bord net. */
  size: number
  falloff: Falloff
  /** Nombre de paliers quand `falloff` vaut 'paliers'. */
  steps: number
  position: StrokeSide
  blend: BlendMode
}

let nextEffectId = 1
export const newEffectId = (): number => nextEffectId++

export interface EffectKindInfo {
  id: EffectKind
  label: string
  hint: string
  /** Champs affiches dans le panneau, dans cet ordre. */
  fields: (keyof LayerEffect)[]
  defaults: Partial<LayerEffect>
}

const NOIR = rgba(12, 10, 24, 255)
const BLANC = rgba(255, 250, 235, 255)

/**
 * Les huit effets et leurs reglages par defaut. Les valeurs de depart sont
 * choisies pour donner un resultat visible tout de suite sur un sprite de
 * quelques dizaines de pixels : une ombre de dix pixels ne se verrait pas.
 */
export const EFFECT_KINDS: EffectKindInfo[] = [
  {
    id: 'ombre-portee',
    label: 'Ombre portee',
    hint: 'Une copie sombre de la silhouette, decalee derrière le dessin',
    fields: ['color', 'opacity', 'angle', 'distance', 'spread', 'size', 'falloff', 'steps', 'blend'],
    defaults: { color: NOIR, opacity: 0.55, angle: 315, distance: 2, spread: 0, size: 1, falloff: 'tramage' },
  },
  {
    id: 'ombre-interne',
    label: 'Ombre interne',
    hint: 'Assombrit l\'intérieur du cote opposé a la lumière : donne du creux',
    fields: ['color', 'opacity', 'angle', 'distance', 'inset', 'size', 'falloff', 'steps', 'blend'],
    defaults: { color: NOIR, opacity: 0.6, angle: 315, distance: 1, size: 3, falloff: 'paliers', steps: 2 },
  },
  {
    id: 'lueur-externe',
    label: 'Lueur externe',
    hint: 'Un halo autour de la silhouette, sans décalage',
    fields: ['color', 'opacity', 'spread', 'size', 'falloff', 'steps', 'blend'],
    defaults: { color: rgba(120, 190, 255, 255), opacity: 0.7, distance: 0, spread: 1, size: 3, falloff: 'tramage', blend: 'screen' },
  },
  {
    id: 'lueur-interne',
    label: 'Lueur interne',
    hint: 'Eclaire le bord intérieur sur tout le pourtour',
    fields: ['color', 'opacity', 'inset', 'size', 'falloff', 'steps', 'blend'],
    defaults: { color: BLANC, opacity: 0.45, distance: 0, inset: 0, size: 2, falloff: 'paliers', steps: 2, blend: 'screen' },
  },
  {
    id: 'contour',
    label: 'Contour',
    hint: 'Un liseré d\'épaisseur reglable, dehors, dedans ou a cheval',
    fields: ['color', 'opacity', 'size', 'position', 'blend'],
    defaults: { color: NOIR, opacity: 1, size: 1, position: 'dehors', falloff: 'net' },
  },
  {
    id: 'biseau',
    label: 'Biseau',
    hint: 'Lumière sur un bord, ombre sur le bord opposé : le dessin prend du relief',
    fields: ['color', 'color2', 'opacity', 'angle', 'inset', 'size', 'falloff', 'steps'],
    defaults: {
      color: rgba(255, 236, 198, 255), color2: rgba(22, 16, 42, 255),
      opacity: 0.45, angle: 135, distance: 1, inset: 0, size: 1, falloff: 'paliers', steps: 1,
    },
  },
  {
    id: 'teinte',
    label: 'Teinte',
    hint: 'Recouvre le dessin d\'une couleur : silhouettes, dégâts, equipes',
    fields: ['color', 'opacity', 'blend'],
    defaults: { color: rgba(255, 80, 80, 255), opacity: 0.6 },
  },
  {
    id: 'degrade',
    label: 'Degrade',
    hint: 'Passe d\'une couleur a l\'autre sur la hauteur du dessin',
    fields: ['color', 'color2', 'opacity', 'angle', 'falloff', 'steps'],
    defaults: {
      color: rgba(255, 190, 90, 255), color2: rgba(120, 90, 255, 255),
      opacity: 0.55, angle: 90, falloff: 'tramage', steps: 4,
    },
  },
]

export const effectInfo = (kind: EffectKind): EffectKindInfo =>
  EFFECT_KINDS.find((e) => e.id === kind) ?? EFFECT_KINDS[0]

export function createEffect(kind: EffectKind): LayerEffect {
  const base: LayerEffect = {
    id: newEffectId(),
    kind,
    enabled: true,
    color: NOIR,
    color2: NOIR,
    opacity: 0.6,
    angle: 315,
    distance: 2,
    spread: 0,
    inset: 0,
    size: 2,
    falloff: 'tramage',
    steps: 3,
    position: 'dehors',
    blend: 'normal',
  }
  return { ...base, ...effectInfo(kind).defaults, id: base.id, kind }
}

/** Les effets qui remplacent la couleur du dessin plutot que de s'ajouter autour. */
const REMPLISSAGE = new Set<EffectKind>(['teinte', 'degrade'])
/* ------------------------------------------------------------------ */
/* Distance a la silhouette                                            */
/* ------------------------------------------------------------------ */

const INF = 1e12

/**
 * Transformee de distance exacte (Felzenszwalb), en distance au carre.
 *
 * Une approximation par chanfrein suffirait pour une ombre nette, mais dès
 * qu'on trame une attenuation, l'erreur se voit : les anneaux cessent d'etre
 * ronds. Le cout est lineaire, on peut donc se payer l'exactitude.
 */
function distanceSquared(masque: Uint8Array, w: number, h: number): Float64Array {
  const d = new Float64Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = masque[i] ? 0 : INF

  const taille = Math.max(w, h)
  const f = new Float64Array(taille)
  const v = new Int32Array(taille)
  const z = new Float64Array(taille + 1)

  const passe = (n: number, lire: (i: number) => number, ecrire: (i: number, val: number) => void) => {
    for (let i = 0; i < n; i++) f[i] = lire(i)
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      const dq = q - v[k]
      ecrire(q, dq * dq + f[v[k]])
    }
  }

  for (let x = 0; x < w; x++) {
    passe(h, (y) => d[y * w + x], (y, val) => { d[y * w + x] = val })
  }
  for (let y = 0; y < h; y++) {
    const ligne = y * w
    passe(w, (x) => d[ligne + x], (x, val) => { d[ligne + x] = val })
  }
  return d
}

/** Masque plein/vide du dessin. */
function silhouette(bm: Bitmap): Uint8Array {
  const m = new Uint8Array(bm.length)
  for (let i = 0; i < m.length; i++) m[i] = getA(bm.u32[i]) > 0 ? 1 : 0
  return m
}

/** Le meme masque, decale de (dx, dy). Ce qui sort du cadre disparait. */
function decaler(masque: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
  if (!dx && !dy) return masque
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const sy = y - dy
    if (sy < 0 || sy >= h) continue
    for (let x = 0; x < w; x++) {
      const sx = x - dx
      if (sx < 0 || sx >= w) continue
      out[y * w + x] = masque[sy * w + sx]
    }
  }
  return out
}

/**
 * Le complement du masque, avec le hors-cadre compte comme vide.
 *
 * Sans cela une forme qui touche le bord n'aurait pas d'ombre interne de ce
 * cote : le moteur croirait la matiere infinie au-dela du cadre.
 */
function complement(masque: Uint8Array): Uint8Array {
  const out = new Uint8Array(masque.length)
  for (let i = 0; i < masque.length; i++) out[i] = masque[i] ? 0 : 1
  return out
}

/* ------------------------------------------------------------------ */
/* Attenuation                                                         */
/* ------------------------------------------------------------------ */

// Matrice de Bayer 8x8 : l'ordre dans lequel les pixels s'allument quand
// l'attenuation descend. C'est ce qui donne le grain regulier du pixel art
// plutot que le bruit d'un tirage aleatoire.
const BAYER8 = (() => {
  // Construction recursive : chaque niveau quadruple la matrice precedente
  // et lui ajoute le motif de base [[0,2],[3,1]].
  const BASE = [[0, 2], [3, 1]]
  let m = [[0]]
  for (let n = 1; n < 8; n *= 2) {
    const taille = n * 2
    const suivant: number[][] = []
    for (let y = 0; y < taille; y++) {
      suivant[y] = []
      for (let x = 0; x < taille; x++) {
        suivant[y][x] = m[y % n][x % n] * 4 + BASE[Math.floor(y / n)][Math.floor(x / n)]
      }
    }
    m = suivant
  }
  const plat = new Float64Array(64)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) plat[y * 8 + x] = m[y][x] / 64
  return plat
})()

/** Opacite en un pixel, a `dist` pixels du bord de la source. */
function attenuation(
  dist: number, spread: number, size: number,
  falloff: Falloff, steps: number, x: number, y: number,
): number {
  if (dist <= spread) return 1
  if (size <= 0) return 0
  const t = 1 - (dist - spread) / size
  if (t <= 0) return 0
  switch (falloff) {
    case 'net': return 1
    case 'paliers': {
      const n = Math.max(1, Math.round(steps))
      return Math.ceil(t * n) / n
    }
    case 'tramage':
      return BAYER8[(y & 7) * 8 + (x & 7)] < t ? 1 : 0
  }
}

/* ------------------------------------------------------------------ */
/* Rendu des effets                                                    */
/* ------------------------------------------------------------------ */

const rad = (deg: number): number => (deg * Math.PI) / 180
/** Deport en pixels le long de l'angle. L'axe Y de l'ecran descend. */
const deport = (angle: number, distance: number): { dx: number; dy: number } => ({
  dx: Math.round(Math.cos(rad(angle)) * distance),
  dy: Math.round(-Math.sin(rad(angle)) * distance),
})

/**
 * Un halo autour de la silhouette : ombre portee et lueur externe ne
 * different que par leurs reglages par defaut.
 */
function halo(src: Bitmap, e: LayerEffect, decalage: { dx: number; dy: number }): Bitmap {
  const w = src.width, h = src.height
  const forme = decaler(silhouette(src), w, h, decalage.dx, decalage.dy)
  const d2 = distanceSquared(forme, w, h)
  const out = new Bitmap(w, h)
  const portee = e.spread + Math.max(0, e.size)
  const limite = (portee + 1) * (portee + 1)
  const r = getR(e.color), g = getG(e.color), b = getB(e.color)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (d2[i] > limite) continue
      const a = attenuation(Math.sqrt(d2[i]), e.spread, e.size, e.falloff, e.steps, x, y)
      if (a <= 0) continue
      out.u32[i] = rgba(r, g, b, Math.round(a * e.opacity * 255))
    }
  }
  return out
}

/**
 * Un halo a l'interieur de la silhouette, mesure depuis le vide decale.
 * C'est la même construction que l'ombre portee, vue de l'interieur : le
 * cote oppose a la lumiere s'assombrit parce que le vide s'en est rapproche.
 */
function haloInterne(src: Bitmap, e: LayerEffect, decalage: { dx: number; dy: number }, couleur: RGBA): Bitmap {
  const w = src.width, h = src.height
  const forme = silhouette(src)
  const vide = decaler(complement(forme), w, h, decalage.dx, decalage.dy)
  const d2 = distanceSquared(vide, w, h)
  const out = new Bitmap(w, h)
  const r = getR(couleur), g = getG(couleur), b = getB(couleur)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!forme[i]) continue
      // Le retrait saute les premiers pixels du bord, ou vit deja le contour.
      const d = Math.sqrt(d2[i]) - Math.max(0, e.inset)
      if (d < 0) continue
      const a = attenuation(d, e.spread, e.size, e.falloff, e.steps, x, y)
      if (a <= 0) continue
      // L'effet ne peut pas être plus opaque que le pixel qu'il recouvre.
      const couverture = getA(src.u32[i]) / 255
      out.u32[i] = rgba(r, g, b, Math.round(a * e.opacity * couverture * 255))
    }
  }
  return out
}

function contour(src: Bitmap, e: LayerEffect): { dessous: Bitmap | null; dessus: Bitmap | null } {
  const w = src.width, h = src.height
  const forme = silhouette(src)
  const taille = Math.max(0, e.size)
  if (taille <= 0) return { dessous: null, dessus: null }
  const dehors = e.position === 'centre' ? Math.ceil(taille / 2) : taille
  const dedans = e.position === 'centre' ? Math.floor(taille / 2) : taille
  const r = getR(e.color), g = getG(e.color), b = getB(e.color)
  const alpha = Math.round(Math.max(0, Math.min(1, e.opacity)) * 255)

  let sousCouche: Bitmap | null = null
  if (e.position !== 'dedans' && dehors > 0) {
    const d2 = distanceSquared(forme, w, h)
    sousCouche = new Bitmap(w, h)
    const limite = (dehors + 0.35) * (dehors + 0.35)
    for (let i = 0; i < d2.length; i++) {
      if (forme[i] || d2[i] > limite) continue
      sousCouche.u32[i] = rgba(r, g, b, alpha)
    }
  }

  let surCouche: Bitmap | null = null
  if (e.position !== 'dehors' && dedans > 0) {
    const d2 = distanceSquared(complement(forme), w, h)
    surCouche = new Bitmap(w, h)
    const limite = (dedans + 0.35) * (dedans + 0.35)
    for (let i = 0; i < d2.length; i++) {
      if (!forme[i] || d2[i] > limite) continue
      const couverture = getA(src.u32[i]) / 255
      surCouche.u32[i] = rgba(r, g, b, Math.round(alpha * couverture))
    }
  }
  return { dessous: sousCouche, dessus: surCouche }
}

/** Remplacement de couleur, applique sur place au contenu du calque. */
function remplissage(cible: Bitmap, e: LayerEffect): void {
  const w = cible.width, h = cible.height
  const force = Math.max(0, Math.min(1, e.opacity))
  if (e.kind === 'teinte') {
    const r = getR(e.color), g = getG(e.color), b = getB(e.color)
    for (let i = 0; i < cible.length; i++) {
      const c = cible.u32[i]
      const a = getA(c)
      if (!a) continue
      cible.u32[i] = rgba(
        Math.round(getR(c) + (r - getR(c)) * force),
        Math.round(getG(c) + (g - getG(c)) * force),
        Math.round(getB(c) + (b - getB(c)) * force),
        a,
      )
    }
    return
  }
  // Degrade : projection sur l'axe de l'angle, puis quantification pour ne
  // pas fabriquer une couleur par pixel.
  const ux = Math.cos(rad(e.angle)), uy = -Math.sin(rad(e.angle))
  let min = Infinity, max = -Infinity
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!getA(cible.u32[y * w + x])) continue
      const p = x * ux + y * uy
      if (p < min) min = p
      if (p > max) max = p
    }
  }
  if (!isFinite(min) || max - min < 1e-6) return
  const n = Math.max(1, Math.round(e.steps))
  const r1 = getR(e.color), g1 = getG(e.color), b1 = getB(e.color)
  const r2 = getR(e.color2), g2 = getG(e.color2), b2 = getB(e.color2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const c = cible.u32[i]
      const a = getA(c)
      if (!a) continue
      let t = ((x * ux + y * uy) - min) / (max - min)
      if (e.falloff === 'paliers') t = Math.round(t * n) / n
      else if (e.falloff === 'tramage') {
        // Le tramage repartit l'erreur d'arrondi : deux paliers suffisent
        // alors a donner l'illusion d'un passage continu.
        const base = Math.floor(t * n)
        const reste = t * n - base
        t = (base + (BAYER8[(y & 7) * 8 + (x & 7)] < reste ? 1 : 0)) / n
      }
      const rr = r1 + (r2 - r1) * t, gg = g1 + (g2 - g1) * t, bb = b1 + (b2 - b1) * t
      cible.u32[i] = rgba(
        Math.round(getR(c) + (rr - getR(c)) * force),
        Math.round(getG(c) + (gg - getG(c)) * force),
        Math.round(getB(c) + (bb - getB(c)) * force),
        a,
      )
    }
  }
}

/**
 * Compose le dessin avec ses effets. Le bitmap d'origine n'est pas touche.
 *
 * L'ordre est celui de la liste, mais chaque effet sait de quel cote il se
 * pose : les ombres portees et les lueurs externes passent derriere, les
 * effets interieurs par-dessus, et les remplissages modifient le dessin
 * lui-meme pour que les effets interieurs se posent sur la bonne couleur.
 */
export function renderEffects(src: Bitmap, effects: LayerEffect[]): Bitmap {
  const actifs = effects.filter((e) => e.enabled)
  if (!actifs.length) return src

  let contenu = src
  for (const e of actifs) {
    if (!REMPLISSAGE.has(e.kind)) continue
    if (contenu === src) contenu = src.clone()
    remplissage(contenu, e)
  }

  const dessous: { bm: Bitmap; e: LayerEffect }[] = []
  const dessus: { bm: Bitmap; e: LayerEffect }[] = []
  for (const e of actifs) {
    switch (e.kind) {
      case 'ombre-portee':
        dessous.push({ bm: halo(src, e, deport(e.angle, e.distance)), e })
        break
      case 'lueur-externe':
        dessous.push({ bm: halo(src, e, { dx: 0, dy: 0 }), e })
        break
      case 'ombre-interne':
        dessus.push({ bm: haloInterne(src, e, deport(e.angle, e.distance), e.color), e })
        break
      case 'lueur-interne':
        dessus.push({ bm: haloInterne(src, e, { dx: 0, dy: 0 }, e.color), e })
        break
      case 'biseau': {
        // Deux ombres internes opposees : la lumiere d'un cote, l'ombre de
        // l'autre. Leur fusion est imposee — un biseau qui ecrase la couleur
        // du dessin au lieu de l'eclaircir et de l'assombrir n'est plus un
        // relief, c'est un cerne.
        const d = Math.max(1, e.distance || 1)
        dessus.push({ bm: haloInterne(src, e, deport(e.angle + 180, d), e.color), e: { ...e, blend: 'screen' } })
        dessus.push({ bm: haloInterne(src, e, deport(e.angle, d), e.color2), e: { ...e, blend: 'multiply' } })
        break
      }
      case 'contour': {
        const { dessous: sous, dessus: sur } = contour(src, e)
        if (sous) dessous.push({ bm: sous, e })
        if (sur) dessus.push({ bm: sur, e })
        break
      }
      default:
        break
    }
  }

  if (!dessous.length && !dessus.length) return contenu

  const out = new Bitmap(src.width, src.height)
  for (const d of dessous) compositeBitmap(out, d.bm, d.e.blend, 255)
  compositeBitmap(out, contenu, 'normal', 255)
  for (const d of dessus) compositeBitmap(out, d.bm, d.e.blend, 255)
  return out
}

/** Signature des reglages : deux listes identiques donnent la meme chaine. */
export function effectsSignature(effects: LayerEffect[]): string {
  let s = ''
  for (const e of effects) {
    if (!e.enabled) { s += `${e.id}:0|`; continue }
    s += `${e.id}:${e.kind}:${e.color}:${e.color2}:${e.opacity}:${e.angle}:${e.distance}`
      + `:${e.spread}:${e.inset}:${e.size}:${e.falloff}:${e.steps}:${e.position}:${e.blend}|`
  }
  return s
}

/**
 * Meme rendu, mais garde le resultat tant que ni le dessin ni les reglages
 * n'ont change. Sans cela, chaque image d'une lecture recalculerait des
 * transformees de distance deja connues.
 */
const memoire = new WeakMap<Bitmap, { cle: string; out: Bitmap }>()

export function renderEffectsCached(
  src: Bitmap, effects: LayerEffect[], version?: number,
): Bitmap {
  if (!effects.some((e) => e.enabled)) return src
  if (version == null) return renderEffects(src, effects)
  const cle = `${version}|${effectsSignature(effects)}`
  const hit = memoire.get(src)
  if (hit && hit.cle === cle) return hit.out
  const out = renderEffects(src, effects)
  memoire.set(src, { cle, out })
  return out
}
