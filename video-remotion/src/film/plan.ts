import { measureSpring } from 'remotion'
import { C } from './theme'
import { RECUL, type Cle } from './mouvement'

/**
 * Le montage : ou se trouve chaque sequence dans le temps et dans l'espace.
 *
 * Le film ne coupe pas d'un panneau a l'autre — il se deplace dans un plan.
 * Chaque sequence occupe une position dans un monde de treize mille pixels de
 * large, et la camera va de l'une a l'autre. C'est ce qui permet, a la fin, de
 * reculer d'un seul mouvement et de montrer tout le chemin parcouru : un
 * enchainement de fondus ne raconterait rien de tel.
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
  { id: 'dessin', titre: 'Dessiner', kicker: 'Atelier', debut: 7.5, fin: 16.5, monde: { x: 2200, y: 0 }, accent: C.cyan },
  { id: 'variantes', titre: 'Decliner', kicker: 'Assiste', debut: 16.5, fin: 23.5, monde: { x: 4400, y: 0 }, accent: C.violet },
  { id: 'detail', titre: 'Matieres', kicker: 'Generateur', debut: 23.5, fin: 29.5, monde: { x: 4400, y: 1300 }, accent: C.menthe },
  { id: 'squelette', titre: 'Rigger', kicker: 'Squelette', debut: 29.5, fin: 40.5, monde: { x: 6600, y: 1300 }, accent: C.rose },
  { id: 'animation', titre: 'Animer', kicker: 'Banc de montage', debut: 40.5, fin: 52.5, monde: { x: 8800, y: 1300 }, accent: C.ambre },
  { id: 'effets', titre: 'Habiller', kicker: 'Effets de calque', debut: 52.5, fin: 62.5, monde: { x: 8800, y: -1200 }, accent: C.indigo },
  { id: 'ombrage', titre: 'Ombrer', kicker: 'Assiste', debut: 62.5, fin: 69, monde: { x: 11000, y: -1200 }, accent: C.ambre },
  { id: 'export', titre: 'Livrer', kicker: 'Export moteur', debut: 69, fin: 77.5, monde: { x: 13200, y: -1200 }, accent: C.menthe },
  { id: 'final', titre: 'PixelForge', kicker: 'Le chemin', debut: 77.5, fin: 84.5, monde: { x: 6600, y: 120 }, accent: C.violet },
]

export const DUREE_S = STATIONS[STATIONS.length - 1].fin
export const DUREE = s(DUREE_S)

/**
 * Marge de montage : chaque sequence est montee un peu avant d'etre regardee
 * et demontee un peu apres. Sans elle, la station suivante apparaitrait au
 * milieu du panoramique — on verrait le decor se construire en arrivant.
 */
export const MARGE = s(1.2)

export const fenetreStation = (station: Station): { from: number; duree: number } => {
  const from = Math.max(0, s(station.debut) - MARGE)
  const fin = Math.min(DUREE, s(station.fin) + MARGE)
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

const centre = (id: string) => STATIONS.find((st) => st.id === id)?.monde ?? { x: 0, y: 0 }

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
  const pose = (sec: number, id: string, mode: Cle['mode'], zoom = 1) => {
    const m = centre(id)
    cles.push({ f: s(sec), v: [m.x, m.y, zoom], mode })
  }
  pose(0, 'amorce', 'lineaire')
  pose(7.5, 'amorce', 'lineaire')
  pose(8.35, 'dessin', 'fouet')
  pose(16.5, 'dessin', 'lineaire')
  pose(17.35, 'variantes', 'fouet')
  pose(23.5, 'variantes', 'lineaire')
  pose(24.3, 'detail', 'fouet')
  pose(29.5, 'detail', 'lineaire')
  pose(30.4, 'squelette', 'fouet')
  pose(40.5, 'squelette', 'lineaire')
  pose(41.35, 'animation', 'fouet')
  pose(52.5, 'animation', 'lineaire')
  pose(53.4, 'effets', 'fouet')
  pose(62.5, 'effets', 'lineaire')
  pose(63.35, 'ombrage', 'fouet')
  pose(69, 'ombrage', 'lineaire')
  pose(69.85, 'export', 'fouet')
  pose(77.5, 'export', 'lineaire')
  pose(80.6, 'final', 'doux', 0.115)
  pose(84.5, 'final', 'lineaire', 0.128)
  return cles
})()

/**
 * Trajet du personnage a l'ecran : x, y du centre du sprite, puis echelle.
 *
 * Il ne quitte jamais le cadre : c'est lui le fil du film. On le garde en
 * espace ecran et non dans le monde, sinon chaque panoramique l'emporterait
 * hors champ et le film redeviendrait une suite de plans separes.
 */
export const HERO: Cle[] = [
  // On tient l'echelle extreme presque une seconde : le recul n'a de valeur
  // que si l'on a d'abord eu le temps de ne voir que des carres de couleur.
  { f: s(0), v: [960, 660, 26] },
  { f: DEBUT_RECUL, v: [960, 660, 26], mode: 'lineaire' },
  { f: FIN_RECUL, v: [960, 500, 13], mode: 'recul' },
  { f: s(6.4), v: [960, 500, 13], mode: 'lineaire' },
  { f: s(7.9), v: [372, 566, 10], mode: 'ressort' },
  { f: s(16.5), v: [372, 566, 10], mode: 'lineaire' },
  { f: s(17.5), v: [960, 452, 9], mode: 'ressort' },
  { f: s(23.5), v: [960, 452, 9], mode: 'lineaire' },
  { f: s(24.4), v: [1620, 258, 4], mode: 'ressort' },
  { f: s(29.5), v: [1620, 258, 4], mode: 'lineaire' },
  { f: s(30.5), v: [606, 546, 12], mode: 'ressort' },
  { f: s(40.5), v: [606, 546, 12], mode: 'lineaire' },
  { f: s(41.5), v: [576, 486, 11], mode: 'ressort' },
  { f: s(52.5), v: [576, 486, 11], mode: 'lineaire' },
  { f: s(53.5), v: [548, 540, 12], mode: 'ressort' },
  { f: s(62.5), v: [548, 540, 12], mode: 'lineaire' },
  { f: s(63.4), v: [960, 528, 14], mode: 'ressort' },
  { f: s(69), v: [960, 528, 14], mode: 'lineaire' },
  { f: s(70), v: [270, 640, 6], mode: 'ressort' },
  { f: s(77.5), v: [270, 640, 6], mode: 'lineaire' },
  { f: s(79.6), v: [960, 892, 6], mode: 'ressort' },
  { f: s(84.5), v: [960, 892, 6], mode: 'lineaire' },
]

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
