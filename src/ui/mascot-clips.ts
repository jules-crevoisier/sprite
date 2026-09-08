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
 * toujours a `by + 8`, la patte fait huit lignes et son pied touche la
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
const SOL = 24
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
 *
 * Le corps etire prend la meme ancre que le corps normal : il fait douze
 * de large sur ses lignes haute et basse, exactement comme lui, et reculer
 * l'ancre d'une colonne lui faisait avaler une colonne de queue de plus.
 * La queue tombait a six pixels visibles contre douze ailleurs, pile a
 * l'atterrissage du saut.
 */
const bordDroit = (bx: number, variante?: string): number =>
  variante === 'ecrase' ? bx + 10 : bx + 9

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
 * L'ecart de masse totale est aveugle a ce defaut : une patte visible pese
 * une vingtaine de pixels sur trois cents, elle peut disparaitre
 * entierement sans que le chiffre franchisse le seuil. C'est pourtant le defaut qui
 * saute aux yeux — un personnage a une jambe.
 */
export function lignesDePatteVisibles(p: Pose): number {
  const basDuCorps = p.corps[1] + (p.corpsArt ?? CORPS_NORMAL).length
  let mini = 99
  for (const [, y] of [p.patteG, p.patteD]) {
    mini = Math.min(mini, y + HAUTEUR_PATTE - Math.max(y, basDuCorps))
  }
  return Math.max(0, mini)
}

/** Hauteur du dessin de patte, semelle comprise. */
const HAUTEUR_PATTE = 8
/** Derniere ligne du cadre : c'est le sol. */
const LIGNE_DU_SOL = 31

/**
 * Vrai si au moins une semelle touche le sol.
 *
 * Une image de contact ou les deux pieds sont en l'air fait clignoter le bas
 * de la silhouette : sur une marche a cent dix millisecondes, ca bat quatre
 * fois par seconde et le personnage a l'air de flotter.
 */
export function piedAuSol(p: Pose): boolean {
  return semellesPosees(p).some(Boolean)
}

/** Quelles semelles touchent le sol, dans l'ordre gauche puis droite. */
export function semellesPosees(p: Pose): [boolean, boolean] {
  const posee = ([, y]: [number, number]) => y + HAUTEUR_PATTE - 1 === LIGNE_DU_SOL
  return [posee(p.patteG), posee(p.patteD)]
}

/**
 * Vrai si les deux semelles quittent le sol en meme temps sans qu'aucune
 * force ne souleve le personnage.
 *
 * Un invariant peut en forcer un pire : interdire aux semelles de patiner
 * sans interdire ce decollage-la, c'est laisser le seul autre moyen de
 * repositionner deux appuis en une image — faire leviter le personnage.
 * On l'autorise donc quand le corps est pousse lateralement d'au moins deux
 * pixels, ou quand il monte : dans ces deux cas quelque chose le souleve.
 */
export function decollageSansPoussee(avant: Pose, apres: Pose): boolean {
  const a = semellesPosees(avant), b = semellesPosees(apres)
  if (!(a[0] && a[1])) return false
  if (b[0] || b[1]) return false
  const pousse = Math.abs(apres.corps[0] - avant.corps[0]) >= 2
  const monte = apres.corps[1] < avant.corps[1]
  return !pousse && !monte
}

/**
 * Pieds poses qui glissent d'une image a l'autre.
 *
 * Un pied qui porte ne se deplace pas : c'est le corps qui passe au-dessus
 * de lui. Une semelle qui derape est ce qui fait qu'un personnage patine au
 * lieu de marcher, et cela ne se voit pas image par image.
 */
export function semellesQuiGlissent(a: Pose, b: Pose): number {
  const paires: [[number, number], [number, number]][] = [
    [a.patteG, b.patteG], [a.patteD, b.patteD],
  ]
  let n = 0
  for (const [avant, apres] of paires) {
    const poseeAvant = avant[1] + HAUTEUR_PATTE - 1 === LIGNE_DU_SOL
    const poseeApres = apres[1] + HAUTEUR_PATTE - 1 === LIGNE_DU_SOL
    if (poseeAvant && poseeApres && avant[0] !== apres[0]) n++
  }
  return n
}

/** Largeur du dessin de patte. */
const LARGEUR_PATTE = 4

/**
 * Ecart, en colonnes vides, entre les deux blocs de patte.
 *
 * Il vaut deux au repos. Rien ne le gardait, et deux images sur six du
 * cycle de degats avaient fini a zero puis a moins un : les deux pattes
 * fusionnaient en un tronc unique, et le personnage se retrouvait avec une
 * jambe pendant cent quatre-vingts millisecondes. Ni la masse totale ni le
 * compte de morceaux ne peuvent voir ca — les pixels sont tous la, et le
 * personnage reste d'un seul tenant.
 */
export function ecartDePattes(p: Pose): number {
  return Math.abs(p.patteD[0] - p.patteG[0]) - LARGEUR_PATTE
}

/**
 * Masse reellement posee par une pose : la somme des pixels de ses pieces.
 *
 * C'est la vraie regle de masse constante. Celle qu'on mesurait jusqu'ici
 * comparait les images composees, donc elle mesurait surtout combien du
 * personnage se cache lui-meme — de l'occlusion, pas de la matiere. Une
 * pose qui choisirait une variante de tete deux fois plus legere passerait
 * inapercue si le torse la recouvrait au bon moment.
 */
export function masseDessinee(p: Pose): number {
  const compter = (art: string[]) => {
    let n = 0
    for (const ligne of art) for (const c of ligne) if (c !== '.') n++
    return n
  }
  return compter(p.teteArt ?? PIECES.TETE)
    + compter(p.corpsArt ?? CORPS_NORMAL)
    + 2 * compter(PIECES.PATTE)
    + compter(PIECES.QUEUES[p.queue[0]])
}

/** Vrai si la pose ecrase le torse : l'image qui suit a droit a un grand ecart. */
export function corpsEcrase(p: Pose): boolean {
  return p.corpsArt === CORPS_ECRASE
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
 *
 * L'oeil se ferme en une image et se rouvre en deux. C'est le sens
 * physique du clignement, et c'est deja ce que fait le cycle de degats :
 * l'ordre inverse donnait une paupiere qui remonte d'un coup.
 *
 * Le souffle fait exactement huit images, comme le clip : une periode de
 * six dans un cycle de huit bafouille au raccord, une fois par tour.
 *
 * La tete descend d'un pixel par image et jamais de deux. Le retour la
 * faisait tomber de 7 a 5 d'un coup pendant que le corps n'en bougeait que
 * d'un : sur un cycle qui tourne, ce seul intervalle double se voit comme
 * une coupure. Hauteurs de tete : 5, 6, 7, 7, 7, 6, 5, 5.
 */
const REPOS: Reglage[] = [
  { corps: [0, 0], tete: [0, 0], queue: 'milieu' },
  { corps: [0, 1], tete: [-1, 0], queue: 'milieu' },
  { corps: [0, 1], tete: [-1, 1], queue: 'basmilieu' },
  { corps: [0, 1], tete: [0, 1], queue: 'basse' },
  { corps: [0, 1], tete: [1, 1], queue: 'basmilieu' },
  { corps: [0, 0], tete: [1, 1], queue: 'basmilieu' },
  { corps: [0, 0], teteArt: 'clin', tete: [0, 0], queue: 'milieu' },
  { corps: [0, 0], teteArt: 'miclos', tete: [-1, 0], queue: 'milieu' },
]

/**
 * Marche de face.
 *
 * Le corps descend a l'appui et remonte au passage : contact, creux,
 * passage, remontee. Sans ce creux, le contact et le temps bas sont a la
 * meme hauteur et le corps ne s'enfonce jamais sous la charge.
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
  { corps: [-1, 0], gauche: [0, 0], droite: [0, 0], queue: 'milieu' },
  { corps: [-1, 1], gauche: [0, 0], droite: [0, -1], queue: 'haute' },
  { corps: [0, -1], tete: [-1, 0], gauche: [0, 0], droite: [1, -4], queue: 'basse' },
  { corps: [0, 0], gauche: [0, 0], droite: [1, -2], queue: 'basmilieu' },
  { corps: [1, 0], gauche: [0, 0], droite: [0, 0], queue: 'milieu' },
  { corps: [1, 1], gauche: [0, -1], droite: [0, 0], queue: 'haute' },
  { corps: [0, -1], tete: [1, 0], gauche: [-1, -4], droite: [0, 0], queue: 'basse' },
  { corps: [0, 0], gauche: [-1, -2], droite: [0, 0], queue: 'basmilieu' },
]

/**
 * Course. Un seul pied au sol par contact — le double appui est la
 * signature d'une marche. Meme balancement adouci que la marche, et la
 * queue en retard d'une image : quand le corps monte, elle traine encore.
 *
 * Les deux contacts sont poses a bx 9 et 11. Le recentrage d'un pixel que
 * `pose` applique au corps ecrase existe justement pour que les deux
 * variantes partagent le meme centre : les contacts se dessinent donc
 * centres sur 14,5 et 16,5, symetriques autour de 15,5, qui est le centre
 * du reste du cycle. Les pousser a 10 et 12 les recentrait sur 16,5 —
 * decale d'un pixel par rapport aux images de vol — et c'est CA qui
 * faisait boiter le personnage une fois par tour.
 *
 * Le ciseau continue pendant le vol : sans ca les images 2 et 3 avaient
 * exactement les memes pattes, et la jambe restait figee cent soixante
 * millisecondes en pleine foulee.
 */
const COURSE: Reglage[] = [
  { corps: [-1, 0], corpsArt: 'ecrase', gauche: [0, 0], droite: [0, -3], queue: 'haute' },
  { corps: [-1, -2], tete: [0, 1], gauche: [-2, -4], droite: [0, -3], queue: 'basmilieu' },
  { corps: [0, -3], tete: [0, 1], gauche: [0, -6], droite: [0, -3], queue: 'basse' },
  { corps: [1, 0], corpsArt: 'ecrase', gauche: [0, -3], droite: [0, 0], queue: 'haute' },
  { corps: [1, -2], tete: [0, 1], gauche: [0, -3], droite: [2, -4], queue: 'basmilieu' },
  { corps: [0, -3], tete: [0, 1], gauche: [0, -3], droite: [0, -6], queue: 'basse' },
]

/**
 * Saut. Ce qui compte est la suite des hauteurs REELLEMENT dessinees, pas
 * celle des reglages : `pose` remonte d'un pixel un corps etire et en
 * redescend un ecrase, si bien qu'une belle courbe de reglages peut sortir
 * plate. Celle-ci donne 20, 16, 15, 14, 15, 17, 21, 17, 18 — quatre pixels
 * a la detente, un seul de part et d'autre du sommet, quatre a la chute.
 * Le personnage dure en haut et file aux deux bouts.
 *
 * La deuxieme image garde les deux semelles au sol : le corps s'etire avant
 * que les pieds quittent le sol, c'est ce qui fait la poussee. Sans elle le
 * personnage se contente de monter.
 *
 * Le sommet garde le corps etire comme les images qui l'encadrent. Avec le
 * corps normal, le torse s'elargissait de deux pixels pendant une seule
 * image, pile la ou le personnage est cense se suspendre : un pouls de
 * largeur sur les trois images les plus lentes de l'arc.
 *
 * La queue traine vers le bas pendant la montee et vers le haut pendant la
 * chute. L'inverse serait physiquement impossible, et c'est pourtant ce
 * que faisait la version precedente.
 */
const SAUT: Reglage[] = [
  { corps: [0, 1], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'haute' },
  { corps: [0, -1], corpsArt: 'etire', tete: [0, 1], queue: 'basse' },
  { corps: [0, -2], corpsArt: 'etire', tete: [0, 1], gauche: [0, -3], droite: [0, -3], queue: 'basse' },
  { corps: [0, -3], corpsArt: 'etire', tete: [0, 0], gauche: [0, -6], droite: [0, -6], queue: 'basmilieu' },
  { corps: [0, -2], corpsArt: 'etire', tete: [1, 0], gauche: [0, -3], droite: [0, -3], queue: 'milieu' },
  { corps: [0, 0], corpsArt: 'etire', gauche: [0, 0], droite: [0, 0], queue: 'haute' },
  { corps: [0, 2], corpsArt: 'ecrase', teteArt: 'ecrasee', gauche: [0, 0], droite: [0, 0], queue: 'fouet' },
  { corps: [0, -1], tete: [0, 0], gauche: [0, 0], droite: [0, 0], queue: 'basmilieu' },
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
 * millisecondes. Ce n'est pas un intervalle, c'est un raccord. La chute sur
 * le coup avait le meme defaut, en pire : soixante pour cent de la
 * silhouette changeaient d'un coup. Elle a maintenant son intervalle.
 *
 * L'ecrasement pose les pieds sur leurs colonnes de repos. Ecartes d'un
 * pixel, il fallait ensuite les y ramener un pied a la fois — la regle
 * anti-patinage l'exige — et cela coutait trois images pendant lesquelles
 * ni le corps ni la tete ne bougeaient d'un pixel. L'ecart existe toujours,
 * mais sur les images ou les pieds sont en l'air et donc libres.
 *
 * Le retour depasse le repos d'un pixel avant de s'y poser : un geste qui
 * s'arrete exactement sur sa cible s'arrete comme un mecanisme. Le
 * depassement se fait en montant le corps entier et non la seule tete :
 * monter la tete seule ouvre une ligne vide entre elle et le torse, et le
 * personnage se coupe en deux.
 *
 * Le coup va quelque part, et ca se lit sur les centres REELLEMENT
 * dessines — pas sur `corps[0]`, qui est le bord gauche de dessins de
 * largeurs differentes : 16,5 · 16,5 · 17,5 · 16,5 · 16,5 · 15,5 · 14,5 ·
 * 15,5 · 15,5 · 15,5. Le maximum de recul tombe sur le sommet de
 * l'armement, puis le torse parcourt trois colonnes d'affilee dans le sens
 * du coup sans jamais repartir en arriere. La version precedente
 * oscillait autour du centre avec une periode de quatre images : ce n'est
 * pas un trajet, c'est un tremblement.
 *
 * L'image d'amorti apres l'impact existe parce que sans elle le retour au
 * repos etait le plus grand intervalle du cycle — le personnage revenait
 * plus vite qu'il ne frappait.
 */
const ATTAQUE: Reglage[] = [
  { corps: [1, 2], corpsArt: 'ecrase', teteArt: 'ecrasee', queue: 'milieu' },
  { corps: [1, 1], gauche: [0, 0], droite: [0, 0], queue: 'basmilieu' },
  { corps: [2, -3], corpsArt: 'etire', tete: [0, 1], gauche: [1, -3], droite: [1, -3], queue: 'basse' },
  { corps: [1, -1], gauche: [0, -3], droite: [2, -3], queue: 'basmilieu' },
  { corps: [1, 1], gauche: [0, -2], droite: [1, -2], queue: 'milieu' },
  { corps: [0, 2], corpsArt: 'ecrase', teteArt: 'ecrasee', tete: [0, 1], gauche: [0, 0], droite: [0, 0], queue: 'fouet' },
  { corps: [-1, 2], corpsArt: 'ecrase', teteArt: 'ecrasee', gauche: [0, 0], droite: [0, 0], queue: 'basse' },
  { corps: [0, 1], gauche: [0, 0], droite: [0, 0], queue: 'fouet' },
  { corps: [0, -1], gauche: [0, 0], droite: [0, 0], queue: 'milieu' },
  { corps: [0, 0], queue: 'milieu' },
]

/**
 * Degats. La compression est l'impact lui-meme, pas une preparation, et
 * les yeux se ferment des cette image : une seconde de retard sur le
 * visage et la reaction n'appartient plus au coup. Le corps descend d'un
 * pixel sur le choc avant de remonter : sans ce creux, l'impact est un
 * pousse purement horizontal et rien n'est encaisse.
 *
 * Le coup arrache le personnage du sol pendant une image. C'est ce qui
 * remplace le patinage : deux semelles plaquees au sol pendant que le corps
 * recule de trois pixels, ca ne s'appelle pas encaisser, ca s'appelle
 * glisser. Le recul se fait donc en deux temps, les pieds en l'air : les
 * centres de torse font 9, 8, 7, 9, 12, 10. La version precedente
 * annoncait deux temps et n'en faisait qu'un — le corps etait a la meme
 * colonne sur les images deux et trois.
 *
 * Le depassement du retour vaut deux pixels, les deux tiers du recul. A un
 * seul pixel il se perdait dans le bruit du reste du dessin.
 */
const DEGATS: Reglage[] = [
  { corps: [0, 2], corpsArt: 'ecrase', teteArt: 'ecraseeClin', queue: 'milieu' },
  { corps: [-1, 1], corpsArt: 'ecrase', teteArt: 'ecraseeClin', tete: [-1, 0], gauche: [-1, -2], droite: [-1, -2], queue: 'haute' },
  { corps: [-3, 2], teteArt: 'clin', tete: [-1, 0], gauche: [-2, 0], droite: [-2, 0], queue: 'fouet' },
  { corps: [-1, 1], teteArt: 'clin', tete: [-1, 1], gauche: [-2, -2], droite: [-2, 0], queue: 'basse' },
  { corps: [2, 1], teteArt: 'miclos', tete: [-2, 0], gauche: [1, -2], droite: [1, -2], queue: 'basmilieu' },
  { corps: [0, 0], gauche: [0, 0], droite: [0, 0], queue: 'milieu' },
]

export const CLIPS_PIXL: ClipMascotte[] = [
  { id: 'repos', nom: 'Repos', ms: 150, loop: true, poses: REPOS.map(pose) },
  { id: 'marche', nom: 'Marche', ms: 110, loop: true, poses: MARCHE.map(pose) },
  { id: 'course', nom: 'Course', ms: 80, loop: true, poses: COURSE.map(pose) },
  { id: 'saut', nom: 'Saut', ms: 80, loop: false, poses: SAUT.map(pose) },
  { id: 'attaque', nom: 'Attaque', ms: 80, loop: false, poses: ATTAQUE.map(pose) },
  { id: 'degats', nom: 'Degats', ms: 90, loop: false, poses: DEGATS.map(pose) },
]

export function spritePixl(): Sprite { return mascotteAnimee(CLIPS_PIXL) }
export { imageDePose }
