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

const { TETE_CLIN, TETE_MI_CLOS, TETE_ECRASEE, CORPS_ECRASE, CORPS_ETIRE } = PIECES
const CORPS_NORMAL = PIECES.CORPS

/** Position de repos : corps en (11, 18), pieds a la ligne 29. */
const CORPS_X = 11
/**
 * Le personnage est pose bas dans le cadre : les pieds touchent la
 * derniere ligne. Ce qui reste au-dessus sert au saut — a l'ancienne
 * hauteur, le sommet du saut coupait les oreilles hors cadre.
 */
const CORPS_Y = 20
/**
 * Les pattes montent de deux pixels sous le corps : pas de trait de
 * jonction visible, et il en reste quatre en vue, ce qui suffit a lire un
 * pas. A un pixel de moins, le corps les avalait.
 */
const SOL = 26
const PATTE_GX = 11
const PATTE_DX = 17

/**
 * Ancrage de la queue, relatif au coin haut-gauche du corps. Le meme pour
 * les quatre positions : les quatre dessins partent du meme coin, la
 * hanche ne bouge donc jamais.
 */
const ANCRE_QUEUE_Y = -1

/**
 * Bord droit du corps selon sa variante. La queue s'y accroche : ancree a
 * une colonne fixe, elle se retrouvait enterree sous un corps ecrase (sept
 * pixels visibles) et degagee sous un corps etire (vingt-trois) — la queue
 * changeait de longueur au rythme du corps.
 */
const bordDroit = (bx: number, variante?: string): number =>
  variante === 'ecrase' ? bx + 10 : variante === 'etire' ? bx + 8 : bx + 9

/**
 * Une patte qui deborde du torse fabrique une arete d'un pixel le long de
 * la hanche, sur six rangees. A cette taille on ne la voit pas sur une
 * planche, mais elle scintille des que l'animation tourne. On la mesure
 * plutot que de compter sur l'oeil.
 *
 * Les bornes sont lues sur le dessin reellement pose, pas deduites d'un
 * nom de variante : c'est le seul moyen que la mesure reste juste si un
 * corps est redessine.
 */
export function debordsDePatte(p: Pose): number {
  const art = p.corpsArt ?? CORPS_NORMAL
  let g = 99, d = -1
  for (const ligne of art) {
    for (let i = 0; i < ligne.length; i++) {
      if (ligne[i] === '.') continue
      if (i < g) g = i
      if (i > d) d = i
    }
  }
  g += p.corps[0]
  d += p.corps[0]
  let n = 0
  for (const [x] of [p.patteG, p.patteD]) {
    if (x < g) n += g - x
    if (x + 3 > d) n += x + 3 - d
  }
  return n
}

interface Reglage {
  /** Decalage du corps par rapport au repos. */
  corps?: [number, number]
  /** Decalage de la tete par rapport au corps. Elle suit avec du retard. */
  tete?: [number, number]
  corpsArt?: 'ecrase' | 'etire'
  teteArt?: 'clin' | 'miclos' | 'ecrasee'
  /** Decalage de chaque patte par rapport a sa position posee. */
  gauche?: [number, number]
  droite?: [number, number]
  queue?: string
}

const ARTS_CORPS = { ecrase: CORPS_ECRASE, etire: CORPS_ETIRE }
const ARTS_TETE = { clin: TETE_CLIN, miclos: TETE_MI_CLOS, ecrasee: TETE_ECRASEE }

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
  // Le haut du corps se deplace avec sa variante ; la tete doit suivre,
  // sinon une ligne vide s'ouvre entre les deux et la tete flotte.
  const dCorps = r.corpsArt === 'ecrase' ? 1 : r.corpsArt === 'etire' ? -1 : 0
  const teteY = (r.teteArt === 'ecrasee' ? by - 15 : by - 16) + dCorps
  const [gx, gy] = r.gauche ?? [0, 0]
  const [ddx, ddy] = r.droite ?? [0, 0]
  const nomQueue = r.queue ?? 'milieu'
  const sortie: Pose = {
    tete: [bx - 2 + tx, teteY + ty],
    teteArt,
    corps: [cx, cy],
    corpsArt,
    patteG: [PATTE_GX + gx, SOL + gy],
    patteD: [PATTE_DX + ddx, SOL + ddy],
    queue: [nomQueue, bordDroit(bx, r.corpsArt) - 2, by + ANCRE_QUEUE_Y],
  }
  sortie.corps = [cx, cy]
  return sortie
}

/* ------------------------------------------------------------------ */
/* Cycles                                                              */
/* ------------------------------------------------------------------ */

/**
 * Repos. Le souffle vaut un pixel : en dessous il ne franchit pas
 * l'arrondi et rien ne bouge. La tete descend une image apres le corps —
 * ce retard est ce qui distingue un souffle d'un aller-retour.
 *
 * Aucune image ne repete la precedente. Trois silhouettes identiques
 * d'affilee, a 160 ms, font une demi-seconde ou l'animation a l'air
 * arretee ; le clignement seul ne suffit pas a la sauver.
 */
const REPOS: Reglage[] = [
  { corps: [0, 0], queue: 'milieu' },
  { corps: [0, 1], queue: 'milieu' },
  { corps: [0, 1], tete: [0, 1], queue: 'basmilieu' },
  { corps: [0, 0], tete: [0, 1], queue: 'basse' },
  { corps: [0, 0], teteArt: 'miclos', tete: [0, 1], queue: 'basmilieu' },
  { corps: [0, 1], teteArt: 'clin', queue: 'milieu' },
]

/**
 * Marche de face.
 *
 * Deux regles commandent tout le cycle. La premiere : le corps se penche
 * au-dessus du pied qui PORTE, jamais au-dessus de celui qu'on vient de
 * lever — c'est la difference entre marcher et perdre l'equilibre. La
 * seconde : un pied pose ne bouge pas. Tout le deplacement lateral
 * appartient a la jambe en l'air.
 *
 * De face, une patte qui passe devant l'autre les fait fusionner en un
 * seul moignon : elles restent donc toujours du meme cote, et ce qui
 * marque le pas est le report du poids, pas leur ecart.
 */
const MARCHE: Reglage[] = [
  { corps: [-1, 1], gauche: [0, 0], droite: [-1, 0], queue: 'milieu' },
  { corps: [-1, 1], tete: [0, 1], gauche: [0, 0], droite: [-1, -2], queue: 'milieu' },
  { corps: [-1, -1], tete: [-1, 0], gauche: [0, 0], droite: [-1, -3], queue: 'basse' },
  { corps: [-1, 0], tete: [-1, 0], gauche: [0, 0], droite: [-1, -1], queue: 'basmilieu' },
  { corps: [1, 1], gauche: [1, 0], droite: [0, 0], queue: 'haute' },
  { corps: [1, 1], tete: [0, 1], gauche: [1, -2], droite: [0, 0], queue: 'milieu' },
  { corps: [1, -1], tete: [1, 0], gauche: [1, -3], droite: [0, 0], queue: 'basse' },
  { corps: [1, 0], tete: [1, 0], gauche: [1, -1], droite: [0, 0], queue: 'basmilieu' },
]

/**
 * Course. Un seul pied au sol par contact : le double appui est la
 * signature d'une marche, une course n'en a jamais. Et les deux moities
 * ne sont pas la meme a deux pixels pres — le corps penche d'un cote puis
 * de l'autre, ce qui leur donne des silhouettes distinctes.
 */
const COURSE: Reglage[] = [
  { corps: [-1, 0], corpsArt: 'ecrase', tete: [-1, 0], gauche: [-1, 0], droite: [-2, -3], queue: 'haute' },
  { corps: [-1, -2], tete: [-1, 0], gauche: [-1, -1], droite: [-1, -4], queue: 'fouet' },
  { corps: [-1, -3], gauche: [-1, -3], droite: [-1, -5], queue: 'basse' },
  { corps: [1, 0], corpsArt: 'ecrase', tete: [1, 0], gauche: [2, -3], droite: [1, 0], queue: 'haute' },
  { corps: [1, -2], tete: [1, 0], gauche: [2, -4], droite: [1, -1], queue: 'fouet' },
  { corps: [1, -3], gauche: [2, -5], droite: [1, -3], queue: 'basse' },
]

/**
 * Saut. L'accroupissement precede la detente : sans lui le personnage
 * decolle sans avoir pris son elan. Les hauteurs de tete sont 7, 2, 1, 2,
 * 7 : l'ecart se resserre au sommet, ce qui y fait durer le personnage,
 * et s'ouvre au decollage et a la reception, ou tout va vite.
 *
 * La queue traine vers le bas a la montee et vers le haut a la descente.
 * La meme position dans les deux sens serait physiquement impossible.
 */
const SAUT: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'basse' },
  { corps: [0, -1], corpsArt: 'etire', tete: [1, 0], gauche: [1, -1], droite: [-1, -1], queue: 'fouet' },
  { corps: [0, -3], tete: [1, 0], gauche: [1, -3], droite: [-1, -3], queue: 'basmilieu' },
  { corps: [0, -1], corpsArt: 'etire', gauche: [1, -2], droite: [-1, -2], queue: 'haute' },
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', gauche: [-1, 0], droite: [1, 0], queue: 'fouet' },
  { corps: [0, 0], queue: 'milieu' },
]

/**
 * Bond d'attaque : recul, detente, coup, retour.
 *
 * Le corps large est reserve au coup. L'utiliser aussi pour le recul
 * rejouerait la silhouette de l'impact avant l'impact, et le coup
 * n'apporterait plus aucun contraste.
 */
const ATTAQUE: Reglage[] = [
  { corps: [0, 1], tete: [-1, 0], queue: 'fouet' },
  { corps: [0, -2], corpsArt: 'etire', tete: [1, 0], gauche: [1, -2], droite: [-1, -2], queue: 'haute' },
  { corps: [0, 0], corpsArt: 'ecrase', teteArt: 'ecrasee', tete: [0, 2], gauche: [-1, 0], droite: [1, 0], queue: 'fouet' },
  { corps: [0, 0], tete: [0, 1], queue: 'basmilieu' },
  { corps: [0, 0], queue: 'milieu' },
]

/**
 * Degats. La compression est l'impact lui-meme, pas une preparation : un
 * personnage qui encaisse ne se prepare pas. Elle tombe donc sur la meme
 * image que le coup, et le recul ne part qu'ensuite — trois pixels d'un
 * coup, puis un maintien, puis un retour amorti.
 */
const DEGATS: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'milieu' },
  { corps: [-3, 0], teteArt: 'clin', tete: [-1, 0], gauche: [-3, 0], droite: [-3, 0], queue: 'fouet' },
  { corps: [-3, 1], teteArt: 'clin', tete: [-1, 1], gauche: [-3, 0], droite: [-3, 0], queue: 'basse' },
  { corps: [-1, 1], teteArt: 'clin', gauche: [-1, 0], droite: [-1, 0], queue: 'basmilieu' },
  { corps: [0, 0], queue: 'milieu' },
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
