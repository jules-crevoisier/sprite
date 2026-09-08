import {
  PIECES, imageDePose, mascotteAnimee,
  type ClipMascotte, type Pose,
} from './mascot-anim'
import type { Sprite } from '../core/document'

/**
 * Les cycles de Pixl.
 *
 * Chaque pose est decrite par la position du corps ; la tete, les pattes et
 * la queue s'y accrochent. Les pattes, elles, restent au sol : c'est le
 * corps qui bouge au-dessus d'elles, ce qui est la difference entre un
 * personnage qui marche et un personnage qui glisse.
 */

const { TETE_CLIN, TETE_ECRASEE, CORPS_ECRASE, CORPS_ETIRE } = PIECES

/** Position de repos : corps en (11, 18), pieds a la ligne 29. */
const CORPS_X = 11
const CORPS_Y = 18
/** Les pattes montent d'un pixel sous le corps : pas de trait de jonction. */
const SOL = 25
const PATTE_GX = 11
const PATTE_DX = 17

/**
 * Ancrage de la queue, relatif au coin haut-gauche du corps. Le meme pour
 * les quatre positions : les quatre dessins partent du meme coin, la
 * hanche ne bouge donc jamais.
 */
const ANCRE_QUEUE: [number, number] = [7, -1]

interface Reglage {
  /** Decalage du corps par rapport au repos. */
  corps?: [number, number]
  /** Decalage de la tete par rapport au corps. Elle suit avec du retard. */
  tete?: [number, number]
  corpsArt?: 'ecrase' | 'etire'
  teteArt?: 'clin' | 'ecrasee'
  /** Decalage de chaque patte par rapport a sa position posee. */
  gauche?: [number, number]
  droite?: [number, number]
  queue?: string
}

const ARTS_CORPS = { ecrase: CORPS_ECRASE, etire: CORPS_ETIRE }
const ARTS_TETE = { clin: TETE_CLIN, ecrasee: TETE_ECRASEE }

/**
 * Construit une pose. Le corps commande : la tete et la queue s'y
 * accrochent, les pattes restent posees au sol. C'est cette difference —
 * le corps qui bouge au-dessus de pattes fixes — qui separe un personnage
 * qui marche d'un personnage qui glisse.
 */
function pose(r: Reglage = {}): Pose {
  const [dx, dy] = r.corps ?? [0, 0]
  const bx = CORPS_X + dx, by = CORPS_Y + dy
  const [tx, ty] = r.tete ?? [0, 0]
  const corpsArt = r.corpsArt ? ARTS_CORPS[r.corpsArt] : undefined
  // Les variantes de corps gardent le meme bas et le meme centre :
  // l'ecrase deborde d'un pixel de chaque cote, l'etire monte d'un pixel.
  // Sans ce recentrage, l'ecrasement ferait glisser le personnage.
  const cx = r.corpsArt === 'ecrase' ? bx - 1 : bx
  const cy = r.corpsArt === 'ecrase' ? by + 1 : r.corpsArt === 'etire' ? by - 1 : by
  const teteArt = r.teteArt ? ARTS_TETE[r.teteArt] : undefined
  const teteY = r.teteArt === 'ecrasee' ? by - 15 : by - 16
  const [gx, gy] = r.gauche ?? [0, 0]
  const [ddx, ddy] = r.droite ?? [0, 0]
  const nomQueue = r.queue ?? 'milieu'
  return {
    tete: [bx - 2 + tx, teteY + ty],
    teteArt,
    corps: [cx, cy],
    corpsArt,
    patteG: [PATTE_GX + gx, SOL + gy],
    patteD: [PATTE_DX + ddx, SOL + ddy],
    queue: [nomQueue, bx + ANCRE_QUEUE[0], by + ANCRE_QUEUE[1]],
  }
}

/* ------------------------------------------------------------------ */
/* Cycles                                                              */
/* ------------------------------------------------------------------ */

/**
 * Repos. Le souffle vaut un pixel : en dessous il ne franchit pas
 * l'arrondi et l'animation ne bouge pas. La tete descend une image apres
 * le corps, et c'est ce retard qui distingue un souffle d'un aller-retour.
 */
const REPOS: Reglage[] = [
  { corps: [0, 0], queue: 'milieu' },
  { corps: [0, 1], queue: 'milieu' },
  { corps: [0, 1], tete: [0, 1], queue: 'basse' },
  { corps: [0, 0], tete: [0, 1], queue: 'basse' },
  { corps: [0, 0], queue: 'milieu' },
  { corps: [0, 0], teteArt: 'clin', queue: 'haute' },
]

/**
 * Marche de face. Le corps se balance au-dessus des pattes posees, monte
 * au passage et descend a l'appui : c'est ce va-et-vient vertical qui
 * donne le poids, pas l'ecart des pattes.
 */
const MARCHE: Reglage[] = [
  { corps: [0, 0], gauche: [2, 0], droite: [-2, 0], queue: 'milieu' },
  { corps: [1, 1], tete: [0, 0], gauche: [2, 0], droite: [-2, 0], queue: 'basse' },
  { corps: [1, 0], tete: [1, 0], gauche: [0, 0], droite: [0, -2], queue: 'milieu' },
  { corps: [0, -1], tete: [1, 0], gauche: [0, 0], droite: [0, 0], queue: 'haute' },
  { corps: [0, 0], gauche: [-2, 0], droite: [2, 0], queue: 'milieu' },
  { corps: [-1, 1], tete: [0, 0], gauche: [-2, 0], droite: [2, 0], queue: 'basse' },
  { corps: [-1, 0], tete: [-1, 0], gauche: [0, -2], droite: [0, 0], queue: 'milieu' },
  { corps: [0, -1], tete: [-1, 0], gauche: [0, 0], droite: [0, 0], queue: 'haute' },
]

/**
 * Course. Meme structure que la marche mais deux fois plus d'amplitude,
 * un temps de suspension ou les deux pattes quittent le sol, et la queue
 * qui fouette a contretemps.
 */
const COURSE: Reglage[] = [
  { corps: [0, -1], corpsArt: 'etire', gauche: [2, 0], droite: [0, -2], queue: 'fouet' },
  { corps: [0, 1], gauche: [2, 0], droite: [-2, 0], queue: 'basse' },
  { corps: [0, -2], corpsArt: 'etire', tete: [0, -1], gauche: [1, -3], droite: [-1, -3], queue: 'haute' },
  { corps: [0, -1], corpsArt: 'etire', gauche: [0, -2], droite: [2, 0], queue: 'fouet' },
  { corps: [0, 1], gauche: [-2, 0], droite: [2, 0], queue: 'basse' },
  { corps: [0, -2], corpsArt: 'etire', tete: [0, -1], gauche: [1, -3], droite: [-1, -3], queue: 'haute' },
]

/**
 * Saut. Il commence par descendre : sans cette anticipation, le
 * personnage decolle sans avoir pris son elan et le saut ne pese rien.
 */
const SAUT: Reglage[] = [
  { corps: [0, 2], corpsArt: 'ecrase', teteArt: 'ecrasee', gauche: [0, -2], droite: [0, -2], queue: 'basse' },
  { corps: [0, -3], corpsArt: 'etire', tete: [0, -1], gauche: [0, -3], droite: [0, -3], queue: 'fouet' },
  { corps: [0, -5], tete: [0, -1], gauche: [0, -5], droite: [0, -5], queue: 'haute' },
  { corps: [0, -3], corpsArt: 'etire', gauche: [0, -3], droite: [0, -3], queue: 'fouet' },
  { corps: [0, 2], corpsArt: 'ecrase', teteArt: 'ecrasee', gauche: [0, -2], droite: [0, -2], queue: 'basse' },
]

/** Bond d'attaque : recul, detente, retour. */
const ATTAQUE: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', tete: [0, 1], gauche: [0, -2], droite: [0, -2], queue: 'fouet' },
  { corps: [0, -2], corpsArt: 'etire', tete: [0, -2], gauche: [0, -1], droite: [0, -1], queue: 'haute' },
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', tete: [0, 1], gauche: [0, -2], droite: [0, -2], queue: 'basse' },
  { corps: [0, 0], gauche: [0, 0], droite: [0, 0], queue: 'milieu' },
]

/** Degats : le corps part en arriere, les yeux se ferment, la queue suit. */
const DEGATS: Reglage[] = [
  { corps: [-1, -1], teteArt: 'clin', tete: [-1, 0], gauche: [-2, 0], droite: [2, 0], queue: 'fouet' },
  { corps: [-2, 0], teteArt: 'clin', tete: [-1, 1], gauche: [-2, 0], droite: [2, 0], queue: 'basse' },
  { corps: [-1, 1], teteArt: 'clin', tete: [0, 0], gauche: [0, 0], droite: [0, 0], queue: 'basse' },
  { corps: [0, 0], gauche: [0, 0], droite: [0, 0], queue: 'milieu' },
]

export const CLIPS_PIXL: ClipMascotte[] = [
  { id: 'repos', nom: 'Repos', ms: 160, loop: true, poses: REPOS.map(pose) },
  { id: 'marche', nom: 'Marche', ms: 110, loop: true, poses: MARCHE.map(pose) },
  { id: 'course', nom: 'Course', ms: 80, loop: true, poses: COURSE.map(pose) },
  { id: 'saut', nom: 'Saut', ms: 100, loop: false, poses: SAUT.map(pose) },
  { id: 'attaque', nom: 'Attaque', ms: 80, loop: false, poses: ATTAQUE.map(pose) },
  { id: 'degats', nom: 'Degats', ms: 90, loop: false, poses: DEGATS.map(pose) },
]

export function spritePixl(): Sprite { return mascotteAnimee(CLIPS_PIXL) }
export { imageDePose }
