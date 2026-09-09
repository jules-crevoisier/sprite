import { measureSpring } from 'remotion'
import { C } from './theme'
import { RECUL, type Cle } from './mouvement'

/**
 * Le montage : ou se trouve chaque sequence dans le temps et dans l'espace.
 *
 * Le film ne coupe pas d'un panneau a l'autre — il se deplace dans un plan.
 * Chaque sequence occupe une position dans un monde de quinze mille pixels de
 * large, et la camera va de l'une a l'autre. C'est ce qui permet, a la fin, de
 * reculer d'un seul mouvement et de montrer tout le chemin parcouru : un
 * enchainement de fondus ne raconterait rien de tel.
 *
 * Tout ce qui suit se deduit du tableau des stations. Aucun instant n'est
 * ecrit en secondes absolues : ils le sont en secondes depuis le debut de leur
 * station. Deplacer une sequence, ou en inserer une, ne demande alors que de
 * corriger deux nombres ici, au lieu de retrouver quarante instants disperses
 * dans dix fichiers — ce qui a ete appris en inserant la station de la
 * mascotte au milieu d'un montage deja regle.
 */
export const FPS = 60
/** Secondes vers images. */
export const s = (sec: number): number => Math.round(sec * FPS)

export interface Station {
  id: string
  titre: string
  kicker: string
  /** Debut et fin utiles, en secondes : ce que le spectateur voit au centre. */
  debut: number
  fin: number
  /** Centre de la plaque dans le monde. */
  monde: { x: number; y: number }
  accent: string
}

/**
 * Les stations, dans l'ordre du parcours. Les deplacements alternent droite,
 * bas, droite, haut : sans ce changement d'axe, le film se lit comme un long
 * defilement horizontal et perd la sensation d'un lieu.
 */
export const STATIONS: Station[] = [
  { id: 'amorce', titre: 'Un pixel', kicker: 'PixelForge', debut: 0, fin: 7.5, monde: { x: 0, y: 0 }, accent: C.indigo },
  { id: 'dessin', titre: 'Dessiner', kicker: 'Atelier', debut: 7.5, fin: 16, monde: { x: 2200, y: 0 }, accent: C.cyan },
  { id: 'variantes', titre: 'Decliner', kicker: 'Assiste', debut: 16, fin: 22.5, monde: { x: 4400, y: 0 }, accent: C.violet },
  { id: 'detail', titre: 'Matieres', kicker: 'Generateur', debut: 22.5, fin: 28, monde: { x: 4400, y: 1300 }, accent: C.menthe },
  { id: 'squelette', titre: 'Rigger', kicker: 'Squelette', debut: 28, fin: 38, monde: { x: 6600, y: 1300 }, accent: C.rose },
  { id: 'animation', titre: 'Animer', kicker: 'Banc de montage', debut: 38, fin: 48.5, monde: { x: 8800, y: 1300 }, accent: C.ambre },
  { id: 'mascotte', titre: 'Pixl', kicker: 'Mascotte', debut: 48.5, fin: 58.5, monde: { x: 11000, y: 1300 }, accent: C.violet },
  { id: 'effets', titre: 'Habiller', kicker: 'Effets de calque', debut: 58.5, fin: 68, monde: { x: 11000, y: -1200 }, accent: C.indigo },
  { id: 'ombrage', titre: 'Ombrer', kicker: 'Assiste', debut: 68, fin: 74, monde: { x: 13200, y: -1200 }, accent: C.ambre },
  { id: 'export', titre: 'Livrer', kicker: 'Export moteur', debut: 74, fin: 82, monde: { x: 15400, y: -1200 }, accent: C.menthe },
  { id: 'final', titre: 'PixelForge', kicker: 'Le chemin', debut: 82, fin: 89, monde: { x: 7700, y: 120 }, accent: C.violet },
]

export const DUREE_S = STATIONS[STATIONS.length - 1].fin
export const DUREE = s(DUREE_S)

const station = (id: string): Station => STATIONS.find((st) => st.id === id) ?? STATIONS[0]

/** Instant absolu, exprime en secondes depuis le debut d'une station. */
export const dans = (id: string, sec: number): number => s(station(id).debut + sec)

/** Vrai pendant une tranche de station, bornes en secondes locales. */
export const pendant = (frame: number, id: string, a: number, b: number): boolean =>
  frame >= dans(id, a) && frame < dans(id, b)

/**
 * Marge de montage : chaque sequence est montee un peu avant d'etre regardee
 * et demontee un peu apres. Sans elle, la station suivante apparaitrait au
 * milieu du panoramique — on verrait le decor se construire en arrivant.
 */
export const MARGE = s(1.2)

export const fenetreStation = (st: Station): { from: number; duree: number } => {
  const from = Math.max(0, s(st.debut) - MARGE)
  const fin = Math.min(DUREE, s(st.fin) + MARGE)
  return { from, duree: fin - from }
}

/**
 * Ouverture : debut du recul, sa duree naturelle, et l'instant ou il se pose.
 *
 * La duree n'est pas choisie a la main — elle est mesuree sur le ressort
 * lui-meme. Ecrite en dur, elle etirerait ou tronquerait le mouvement des
 * qu'on retoucherait un des trois reglages du ressort, et la signature, qui
 * attend ce repos, entrerait pendant que le personnage bouge encore.
 */
export const DEBUT_RECUL = s(1.3)
export const REPOS_OUVERTURE = measureSpring({ fps: FPS, config: RECUL, threshold: 0.001 })
export const FIN_RECUL = DEBUT_RECUL + REPOS_OUVERTURE

/** Delai d'arrivee de la camera sur une station, en secondes. */
const ARRIVEE_CAMERA = 0.85
/** Le recul final est long : c'est lui le mouvement, pas un raccord. */
const ARRIVEE_FINALE = 3.1

/**
 * Camera : x, y du point regarde, puis zoom.
 *
 * Le zoom reste a 1 sur toutes les stations. Ce n'est pas une timidite : un
 * zoom fractionnaire etire les pixels du sprite de facon inegale, et le seul
 * moment ou l'on s'en affranchit est le recul final, ou plus rien n'a besoin
 * d'etre lisible au pixel pres.
 */
export const CAMERA: Cle[] = (() => {
  const cles: Cle[] = []
  STATIONS.forEach((st, i) => {
    const finale = i === STATIONS.length - 1
    const v = [st.monde.x, st.monde.y, finale ? 0.105 : 1]
    if (i === 0) cles.push({ f: s(st.debut), v, mode: 'lineaire' })
    else {
      cles.push({
        f: dans(st.id, finale ? ARRIVEE_FINALE : ARRIVEE_CAMERA),
        v,
        mode: finale ? 'doux' : 'fouet',
      })
    }
    // Cle de tenue : sans elle la camera partirait vers la station suivante
    // des son arrivee, au lieu de s'arreter sur celle qu'on regarde.
    cles.push({
      f: s(st.fin),
      v: finale ? [st.monde.x, st.monde.y, 0.117] : v,
      mode: 'lineaire',
    })
  })
  return cles
})()

/**
 * Trajet du personnage a l'ecran : x, y du centre du sprite, puis echelle.
 *
 * Il ne quitte jamais le cadre : c'est lui le fil du film. On le garde en
 * espace ecran et non dans le monde, sinon chaque panoramique l'emporterait
 * hors champ et le film redeviendrait une suite de plans separes.
 */
const POSES_HERO: Record<string, number[]> = {
  dessin: [372, 566, 10],
  variantes: [960, 452, 9],
  detail: [1620, 258, 4],
  squelette: [606, 546, 12],
  animation: [576, 486, 11],
  // Sur la station de la mascotte il s'efface dans un coin : c'est elle
  // qu'on regarde, et deux sprites de meme taille se disputeraient le cadre.
  mascotte: [1668, 246, 4],
  effets: [548, 540, 12],
  ombrage: [960, 528, 14],
  export: [270, 640, 6],
  final: [960, 892, 6],
}

/** Delai d'arrivee du personnage sur une station, en secondes. */
const ARRIVEE_HERO: Record<string, number> = { final: 2.1 }

export const HERO: Cle[] = (() => {
  const cles: Cle[] = [
    // On tient l'echelle extreme une seconde et demie : le recul n'a de
    // valeur que si l'on a d'abord eu le temps de ne voir que des carres.
    { f: s(0), v: [960, 660, 26] },
    { f: DEBUT_RECUL, v: [960, 660, 26], mode: 'lineaire' },
    { f: FIN_RECUL, v: [960, 500, 13], mode: 'recul' },
    { f: s(STATIONS[0].fin), v: [960, 500, 13], mode: 'lineaire' },
  ]
  for (const st of STATIONS.slice(1)) {
    const v = POSES_HERO[st.id]
    if (!v) continue
    cles.push({ f: dans(st.id, ARRIVEE_HERO[st.id] ?? 1), v, mode: 'ressort' })
    cles.push({ f: s(st.fin), v, mode: 'lineaire' })
  }
  return cles
})()

/**
 * Trajet de la mascotte.
 *
 * Elle entre une fois le dessin allume et ne repart plus : elle traverse tout
 * le film au ras du cadre, prend le centre sur sa propre station, puis revient
 * se ranger a cote du personnage. C'est l'identite du produit — elle ne peut
 * pas se contenter d'un plan a elle au milieu du film.
 */
const POSES_PIXL: Record<string, number[]> = {
  amorce: [960, 966, 4],
  dessin: [790, 980, 4],
  variantes: [1080, 968, 4],
  detail: [1258, 950, 4],
  squelette: [762, 990, 4],
  animation: [1500, 950, 4],
  mascotte: [520, 566, 10],
  effets: [700, 986, 4],
  ombrage: [900, 986, 4],
  export: [1200, 950, 4],
  final: [1214, 916, 4],
}

export const ENTREE_PIXL = dans('amorce', 5.5)

export const PIXL: Cle[] = (() => {
  const cles: Cle[] = [
    // Elle arrive par la droite, hors cadre : on la voit entrer en courant
    // plutot qu'apparaitre sur place.
    { f: ENTREE_PIXL, v: [2060, 966, 4] },
    { f: ENTREE_PIXL + s(1.2), v: POSES_PIXL.amorce, mode: 'fouet' },
    { f: s(STATIONS[0].fin), v: POSES_PIXL.amorce, mode: 'lineaire' },
  ]
  for (const st of STATIONS.slice(1)) {
    const v = POSES_PIXL[st.id]
    if (!v) continue
    cles.push({ f: dans(st.id, st.id === 'final' ? 2.1 : 1.1), v, mode: 'ressort' })
    cles.push({ f: s(st.fin), v, mode: 'lineaire' })
  }
  return cles
})()

/** Plan serialisable, pour la verification hors navigateur. */
export interface PlanVerifiable {
  fps: number
  duree: number
  dureeSecondes: number
  stations: { id: string; debut: number; fin: number; from: number; duree: number }[]
}

export const planVerifiable = (): PlanVerifiable => ({
  fps: FPS,
  duree: DUREE,
  dureeSecondes: DUREE_S,
  stations: STATIONS.map((st) => {
    const { from, duree } = fenetreStation(st)
    return { id: st.id, debut: s(st.debut), fin: s(st.fin), from, duree }
  }),
})
