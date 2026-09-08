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

const { TETE_CLIN, TETE_MI_CLOS, TETE_ECRASEE, TETE_ECRASEE_CLIN, CORPS_ECRASE, CORPS_ETIRE } = PIECES
const CORPS_NORMAL = PIECES.CORPS

/**
 * Position de repos : corps en (10, 18), pieds a la ligne 31.
 *
 * Le budget de lever se lit d'une soustraction. Le bas du corps tombe
 * toujours a `by + 8`, la patte fait six lignes et son pied touche la
 * derniere du cadre. Il reste donc, sous l'ourlet :
 *
 *   lignes de patte visibles = 24 - by - lever
 *
 * A hauteur de repos, chaque pixel de lever coute une ligne sur les six.
 * Le lever doit donc tomber sur les images ou le corps est HAUT, pas sur
 * celles ou il est bas — c'est gratuit, et c'est ce qui separe une patte
 * levee d'un moignon.
 */
const CORPS_X = 10
/**
 * Le personnage est pose bas dans le cadre : les pieds touchent la
 * derniere ligne. Ce qui reste au-dessus sert au saut — a l'ancienne
 * hauteur, le sommet du saut coupait les oreilles hors cadre.
 */
const CORPS_Y = 18
/** Les pattes montent sous le corps : six lignes restent en vue au repos. */
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

/**
 * Lignes de patte encore visibles sous le torse, pour la moins bien lotie
 * des deux.
 *
 * L'ecart de masse totale est aveugle a ce defaut : une patte pese douze
 * pixels sur trois cents, elle peut disparaitre entierement sans que le
 * chiffre bouge de plus de quatre pour cent. C'est pourtant le defaut qui
 * saute aux yeux — un personnage a une jambe.
 */
export function lignesDePatteVisibles(p: Pose): number {
  const basDuCorps = p.corps[1] + (p.corpsArt ?? CORPS_NORMAL).length
  let mini = 99
  for (const [, y] of [p.patteG, p.patteD]) {
    mini = Math.min(mini, y + 6 - Math.max(y, basDuCorps))
  }
  return Math.max(0, mini)
}

/**
 * Vrai si une patte pend dans le vide sous un corps qui est monte plus haut
 * qu'elle. Le personnage se retrouve alors en deux morceaux — c'est le
 * defaut qu'on voit avant tous les autres, et il se produit des qu'on fait
 * monter le corps sans faire suivre les pattes.
 */
export function patteDecrochee(p: Pose): boolean {
  const basDuCorps = p.corps[1] + (p.corpsArt ?? CORPS_NORMAL).length
  return [p.patteG, p.patteD].some(([, y]) => y > basDuCorps)
}

interface Reglage {
  /** Decalage du corps par rapport au repos. */
  corps?: [number, number]
  /** Decalage de la tete par rapport au corps. Elle suit avec du retard. */
  tete?: [number, number]
  corpsArt?: 'ecrase' | 'etire'
  teteArt?: 'clin' | 'miclos' | 'ecrasee' | 'ecraseeClin'
  /** Decalage de chaque patte par rapport a sa position posee. */
  gauche?: [number, number]
  droite?: [number, number]
  queue?: string
}

const ARTS_CORPS = { ecrase: CORPS_ECRASE, etire: CORPS_ETIRE }
const ARTS_TETE = {
  clin: TETE_CLIN, miclos: TETE_MI_CLOS,
  ecrasee: TETE_ECRASEE, ecraseeClin: TETE_ECRASEE_CLIN,
}

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
  // La tete ecrasee est plus large de deux pixels : elle se recentre, sans
  // quoi l'ecrasement ferait glisser le personnage d'un pixel.
  const ecrasee = r.teteArt === 'ecrasee' || r.teteArt === 'ecraseeClin'
  const teteY = (ecrasee ? by - 12 : by - 13) + dCorps
  const teteX = ecrasee ? bx - 2 : bx - 1
  const [gx, gy] = r.gauche ?? [0, 0]
  const [ddx, ddy] = r.droite ?? [0, 0]
  const nomQueue = r.queue ?? 'milieu'
  const sortie: Pose = {
    tete: [teteX + tx, teteY + ty],
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
 * l'arrondi et rien ne bouge. La tete atteint chaque extreme une image
 * apres le corps — ce retard distingue un souffle d'un aller-retour — et
 * derive lateralement d'un pixel, sans quoi elle monterait et
 * descendrait sur une verticale parfaite.
 */
const REPOS: Reglage[] = [
  { corps: [0, 0], tete: [0, 0], queue: 'milieu' },
  { corps: [0, 1], tete: [-1, 0], queue: 'milieu' },
  { corps: [0, 1], teteArt: 'miclos', tete: [-1, 1], queue: 'basmilieu' },
  { corps: [0, 1], teteArt: 'clin', tete: [0, 1], queue: 'basse' },
  { corps: [0, 1], teteArt: 'miclos', tete: [1, 1], queue: 'basmilieu' },
  { corps: [0, 0], tete: [1, 0], queue: 'milieu' },
]

/**
 * Marche de face.
 *
 * Le corps passe par zero entre les deux appuis au lieu de sauter d'un
 * cote a l'autre : moins un, moins un, zero, zero, plus un, plus un, zero,
 * zero. Un balancement en creneau teleporte le personnage de deux pixels
 * deux fois par cycle, et c'est le raccord qu'on voit.
 *
 * Les pieds ne se deplacent jamais lateralement : tout le mouvement
 * horizontal appartient au corps, qui passe au-dessus d'eux.
 */
const MARCHE: Reglage[] = [
  { corps: [-1, 1], gauche: [0, 0], droite: [0, 0], queue: 'milieu' },
  { corps: [-1, 1], tete: [0, 1], gauche: [0, 0], droite: [0, -2], queue: 'basmilieu' },
  { corps: [0, -1], tete: [-1, 1], gauche: [0, -1], droite: [0, -4], queue: 'basse' },
  { corps: [0, 0], gauche: [0, 0], droite: [0, -1], queue: 'basmilieu' },
  { corps: [1, 1], gauche: [0, 0], droite: [0, 0], queue: 'milieu' },
  { corps: [1, 1], tete: [0, 1], gauche: [0, -2], droite: [0, 0], queue: 'basmilieu' },
  { corps: [0, -1], tete: [1, 1], gauche: [0, -4], droite: [0, -1], queue: 'basse' },
  { corps: [0, 0], gauche: [0, -1], droite: [0, 0], queue: 'basmilieu' },
]

/**
 * Course. Un seul pied au sol par contact — le double appui est la
 * signature d'une marche. Meme balancement adouci que la marche, et la
 * queue en retard d'une image : quand le corps monte, elle traine encore.
 */
const COURSE: Reglage[] = [
  { corps: [-1, 0], corpsArt: 'ecrase', gauche: [0, 0], droite: [0, -3], queue: 'haute' },
  { corps: [-1, -2], tete: [0, 1], gauche: [0, -2], droite: [0, -2], queue: 'basmilieu' },
  { corps: [0, -3], tete: [0, 1], gauche: [0, -4], droite: [0, -3], queue: 'basse' },
  { corps: [1, 0], corpsArt: 'ecrase', gauche: [0, -3], droite: [0, 0], queue: 'haute' },
  { corps: [1, -2], tete: [0, 1], gauche: [0, -2], droite: [0, -2], queue: 'basmilieu' },
  { corps: [0, -3], tete: [0, 1], gauche: [0, -3], droite: [0, -4], queue: 'basse' },
]

/**
 * Saut. L'accroupissement precede la detente, et les ecarts entre images
 * valent trois, un, un, trois : le personnage dure au sommet et va vite aux
 * deux bouts. Des ecarts constants donnent un triangle, pas un saut.
 *
 * La queue traine vers le bas pendant la montee et vers le haut pendant la
 * chute. L'inverse serait physiquement impossible, et c'est pourtant ce
 * que faisait la version precedente.
 */
const SAUT: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'haute' },
  { corps: [0, -2], corpsArt: 'etire', tete: [0, 1], gauche: [0, -2], droite: [0, -2], queue: 'basse' },
  { corps: [0, -3], tete: [0, 1], gauche: [0, -4], droite: [0, -4], queue: 'basmilieu' },
  { corps: [0, -2], corpsArt: 'etire', tete: [0, 0], gauche: [0, -2], droite: [0, -2], queue: 'milieu' },
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', gauche: [-1, 0], droite: [1, 0], queue: 'fouet' },
  { corps: [0, -1], tete: [0, 0], gauche: [0, -1], droite: [0, -1], queue: 'basse' },
  { corps: [0, 0], queue: 'milieu' },
]

/**
 * Attaque : accroupissement, elan, detente, coup, amorti, retour.
 *
 * Le coup part vers le bas et l'anticipation aussi. Un recul lateral suivi
 * d'une detente verticale, ce sont deux gestes sans rapport : ils ne
 * partagent aucune ligne, donc l'ensemble ne decrit aucune courbe.
 *
 * L'image d'elan existe parce que sans elle on passait de la preparation a
 * la detente en changeant les trois quarts de l'image en quatre-vingts
 * millisecondes. Ce n'est pas un intervalle, c'est un raccord.
 */
const ATTAQUE: Reglage[] = [
  { corps: [0, 2], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'milieu' },
  { corps: [0, 0], gauche: [0, -1], droite: [0, -1], queue: 'basmilieu' },
  { corps: [0, -3], corpsArt: 'etire', tete: [0, 1], gauche: [0, -3], droite: [0, -3], queue: 'basse' },
  { corps: [0, 2], corpsArt: 'ecrase', teteArt: 'ecrasee', tete: [0, 1], gauche: [-1, 0], droite: [1, 0], queue: 'haute' },
  { corps: [0, 1], tete: [0, 1], gauche: [-1, -1], droite: [1, -1], queue: 'fouet' },
  { corps: [0, 0], queue: 'milieu' },
]

/**
 * Degats. La compression est l'impact lui-meme, pas une preparation, et
 * les yeux se ferment des cette image : une seconde de retard sur le
 * visage et la reaction n'appartient plus au coup.
 *
 * Un pied se leve a chaque changement d'appui. Deux semelles plaquees au
 * sol pendant que le corps recule de trois pixels, c'est du patinage.
 */
const DEGATS: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecraseeClin', queue: 'milieu' },
  { corps: [-3, 2], teteArt: 'clin', tete: [-1, 0], gauche: [-2, 0], droite: [-2, 0], queue: 'fouet' },
  { corps: [-1, 1], teteArt: 'clin', tete: [-1, 1], gauche: [-1, 0], droite: [-1, 0], queue: 'basse' },
  { corps: [0, 1], teteArt: 'miclos', gauche: [-1, -2], droite: [-1, 0], queue: 'basmilieu' },
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
