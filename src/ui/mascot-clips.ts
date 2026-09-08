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
  return {
    tete: [bx - 2 + tx, teteY + ty],
    teteArt,
    corps: [cx, cy],
    corpsArt,
    patteG: [PATTE_GX + gx, SOL + gy],
    patteD: [PATTE_DX + ddx, SOL + ddy],
    queue: [nomQueue, bordDroit(bx, r.corpsArt) - 2, by + ANCRE_QUEUE_Y],
  }
}

/* ------------------------------------------------------------------ */
/* Cycles                                                              */
/* ------------------------------------------------------------------ */

/**
 * Repos. Le souffle vaut un pixel : en dessous il ne franchit pas
 * l'arrondi et rien ne bouge. La tete descend une image apres le corps, et
 * c'est ce retard qui distingue un souffle d'un aller-retour.
 *
 * Le clignement prend deux images — paupiere a demi close, puis fermee.
 * Sur une seule il se lisait comme une image manquante.
 */
const REPOS: Reglage[] = [
  { corps: [0, 0], queue: 'milieu' },
  { corps: [0, 1], queue: 'milieu' },
  { corps: [0, 1], tete: [0, 1], queue: 'basmilieu' },
  { corps: [0, 0], tete: [0, 1], queue: 'basse' },
  { corps: [0, 0], teteArt: 'miclos', queue: 'milieu' },
  { corps: [0, 0], teteArt: 'clin', queue: 'milieu' },
]

/**
 * Marche de face.
 *
 * Les deux pattes se deplacent toujours du meme cote : de face, une patte
 * qui passe devant l'autre les fait fusionner en un seul moignon, et c'est
 * la seule chose qu'un dessin unique deplace ne sait pas raconter. Ce qui
 * marque le pas, ici, c'est le report du poids d'un cote a l'autre et le
 * pied qui se leve — sur trois images, pas sur une.
 *
 * Le corps est bas a l'appui et haut au passage : c'est ce va-et-vient
 * vertical qui donne le poids, pas l'ecart des pattes.
 */
const MARCHE: Reglage[] = [
  { corps: [0, 1], gauche: [1, 0], droite: [1, 0], queue: 'milieu' },
  { corps: [1, 1], tete: [0, 1], gauche: [1, 0], droite: [1, -1], queue: 'milieu' },
  { corps: [1, -1], tete: [1, 0], gauche: [1, 0], droite: [0, -3], queue: 'basse' },
  { corps: [1, 0], tete: [1, 0], gauche: [1, 0], droite: [0, -1], queue: 'milieu' },
  { corps: [0, 1], gauche: [-1, 0], droite: [-1, 0], queue: 'haute' },
  { corps: [-1, 1], tete: [0, 1], gauche: [-1, -1], droite: [-1, 0], queue: 'milieu' },
  { corps: [-1, -1], tete: [-1, 0], gauche: [0, -3], droite: [-1, 0], queue: 'basse' },
  { corps: [-1, 0], tete: [-1, 0], gauche: [0, -1], droite: [-1, 0], queue: 'milieu' },
]

/**
 * Course. Deux suspensions par cycle, une par demi-pas — et non deux fois
 * la meme, sinon la seconde moitie du cycle rejoue la premiere. Le contact
 * ecrase le corps : c'est ce qui fait sentir le choc.
 *
 * La queue est en retard d'une image sur le corps partout : quand le corps
 * monte, elle traine encore en bas.
 */
const COURSE: Reglage[] = [
  { corps: [0, -1], corpsArt: 'etire', gauche: [2, 0], droite: [1, -2], queue: 'haute' },
  { corps: [0, 0], corpsArt: 'ecrase', gauche: [1, 0], droite: [1, 0], queue: 'fouet' },
  { corps: [0, -2], corpsArt: 'etire', gauche: [0, -3], droite: [1, -3], queue: 'basse' },
  { corps: [0, -1], corpsArt: 'etire', gauche: [1, -2], droite: [2, 0], queue: 'haute' },
  { corps: [0, 0], corpsArt: 'ecrase', gauche: [-1, 0], droite: [-1, 0], queue: 'fouet' },
  { corps: [0, -2], corpsArt: 'etire', gauche: [-1, -3], droite: [0, -3], queue: 'basse' },
]

/**
 * Saut. Il commence par descendre : sans cette anticipation le personnage
 * decolle sans avoir pris son elan et le saut ne pese rien. L'ecart entre
 * images se resserre au sommet, ce qui y fait durer le personnage.
 *
 * L'accroupissement ne descend que d'un pixel : plus bas, le corps
 * recouvrait les pattes entierement et le personnage n'avait plus de
 * jambes du tout.
 */
const SAUT: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'basse' },
  { corps: [0, -3], corpsArt: 'etire', gauche: [0, -3], droite: [0, -3], queue: 'fouet' },
  { corps: [0, -4], gauche: [0, -4], droite: [0, -4], queue: 'haute' },
  { corps: [0, -3], corpsArt: 'etire', gauche: [0, -3], droite: [0, -3], queue: 'fouet' },
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', gauche: [-1, 0], droite: [1, 0], queue: 'fouet' },
  { corps: [0, 0], queue: 'basse' },
]

/**
 * Bond d'attaque : recul, detente, coup, retour.
 *
 * Le coup va vers la camera et non vers le haut — le corps ecrase est plus
 * large de deux pixels, c'est ce qui donne l'impression d'avancer sur une
 * vue de face.
 */
const ATTAQUE: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'fouet' },
  { corps: [0, -2], corpsArt: 'etire', gauche: [0, -2], droite: [0, -2], queue: 'haute' },
  { corps: [0, 0], corpsArt: 'ecrase', teteArt: 'ecrasee', tete: [0, 1], gauche: [-1, 0], droite: [1, 0], queue: 'fouet' },
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'basse' },
  { corps: [0, 0], queue: 'milieu' },
]

/**
 * Degats. Le coup commence par une compression, puis le corps part en
 * arriere d'un coup sec et revient doucement : trois pixels, zero, deux,
 * un. Un recul regulier ne se lit pas comme un impact.
 */
const DEGATS: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'fouet' },
  { corps: [-3, 0], teteArt: 'clin', tete: [-1, 0], gauche: [-1, 0], droite: [-1, 0], queue: 'fouet' },
  { corps: [-3, 1], teteArt: 'clin', tete: [-1, 1], gauche: [-1, 0], droite: [-1, 0], queue: 'basse' },
  { corps: [-1, 1], teteArt: 'clin', gauche: [0, 0], droite: [0, 0], queue: 'basse' },
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
