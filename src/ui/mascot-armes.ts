import { Bitmap } from '../core/bitmap'
import { fromHex } from '../core/color'
import { Layer, Sprite, genId } from '../core/document'
import { Palette } from '../core/palette'
import { Pose, TAILLE, imageDePose } from './mascot-anim'

/**
 * Armes tenues par la mascotte.
 *
 * Le principe est celui du reste du personnage : rien n'est redessine
 * d'une image a l'autre. Une arme est UN dessin, et le geste se fait
 * entierement par deplacement en pixels entiers. Une arme redessinee a
 * chaque pose maigrit toujours quelque part, exactement comme une patte —
 * et une lame qui maigrit en tournant se lit comme un clignotement.
 *
 * Deux contraintes commandent le reste :
 *
 * 1. L'arme doit TOUCHER le personnage. Pixl n'a pas de bras : une arme
 *    posee a cote de lui serait un deuxieme morceau, et un morceau detache
 *    est le premier defaut qu'on voit. Chaque dessin porte donc sa patte,
 *    deux pixels de fourrure qui font le pont avec le flanc — et le test
 *    verifie que la silhouette armee reste d'un seul tenant.
 *
 * 2. L'arme passe DERRIERE le personnage. Devant, la lame couperait le
 *    visage ; le flanc reste visible sous elle, ce qui suffit a lire la
 *    prise.
 *
 * Le geste est vertical, pas rotatif. Sur une toile de trente-deux pixels,
 * faire tourner une lame demande de la redessiner a chaque angle : on perd
 * la masse constante, et on la perd sur l'element le plus contraste du
 * dessin. Un coup porte de haut en bas se lit tout aussi bien.
 */

const PALETTE_ARMES: Record<string, string> = {
  o: '#161020',
  A: '#8f9bb8',
  b: '#d7e0f2',
  c: '#8a5a2b',
  C: '#5d3a1a',
  d: '#ffe27a',
  f: '#ff8ab0',
  P: '#a678ff',
}

export interface Arme {
  id: string
  nom: string
  /** Ce qu'elle change au personnage quand il la porte. */
  pitch: string
  art: string[]
  /**
   * Colonne et ligne, dans le dessin, du pixel tenu par la patte. C'est ce
   * point qu'on pose au flanc du corps ; tout le reste suit.
   */
  prise: [number, number]
  /**
   * Les trois paliers de l'armement, propres a l'arme.
   *
   * Un offset global ne peut pas faire monter les trois armes au-dessus de
   * la tete : l'epee se detache a moins cinq et moins six et redevient
   * valide a moins sept, tandis que la tete du marteau touche le bord haut
   * a moins six et en sort a moins sept. Les paliers sont donc par arme, et
   * chacun est le maximum verifie pour elle.
   */
  montee: [[number, number], [number, number], [number, number]]
  /**
   * Ou tombe l'arme a l'impact, et ou elle traine a la retombee.
   *
   * Propre a l'arme comme les paliers d'armement : un offset unique
   * arretait la masse du marteau un pixel au-dessus du sol et la gemme du
   * baton deux, alors que c'est justement leur point de chute qui donne le
   * poids.
   */
  frappe: [[number, number], [number, number]]
  /**
   * Le dessin de l'impact : l'arme abattue en diagonale, tranchant vers le
   * bas et vers l'exterieur.
   *
   * Il a d'abord été obtenu par rotation d'un quart de tour, ce qui
   * garantissait l'egalite des masses sans rien dessiner. Mais une
   * rotation met la prise a l'oppose du tranchant : pour sortir la lame du
   * corps il fallait enfoncer la poignee dans le personnage, et les deux
   * pixels de patte finissaient dessines ENTRE ses pieds. La moitie de
   * l'arme passait derrière les pattes, et l'image la plus importante du
   * cycle montrait une planche posee par terre.
   *
   * Le dessin est donc fait a la main, et l'egalite des masses est exigee
   * par le test au lieu d'etre offerte par la construction.
   */
  impact: string[]
  priseImpact: [number, number]
}

/**
 * Epee. La plus longue des trois : c'est elle qui donne la direction du
 * coup, une image avant que le corps ne suive.
 *
 * Deux colonnes, une claire et une sombre. A une seule colonne, la lame
 * n'etait qu'un trait : en aplat, l'epee et le baton ne se distinguaient
 * que par trois pixels de pointe, et une arme qu'on ne reconnait pas a sa
 * silhouette ne sert a rien dans un jeu.
 */
const EPEE = [
  '..b...',
  '..bA..',
  '..bA..',
  '..bA..',
  '..bA..',
  '..bA..',
  '..bA..',
  '..bA..',
  '.AAAA.',
  '...cPP',
  '...cPP',
  '...C..',
]

/**
 * Marteau. La tete pese les deux tiers du dessin et se trouve au bout du
 * bras de levier : c'est ce qui fait que le meme deplacement se lit plus
 * lourd qu'avec l'epee, sans qu'aucun reglage ne change.
 *
 * Elle fait cinq pixels de large, cerclee de son contour. A trois de
 * large, elle se lisait comme un bout de manche epaissi et le poids
 * disparaissait — or c'est la seule chose que cette arme doit dire.
 */
const MARTEAU = [
  'ooooo',
  'oAAAo',
  'oAAAo',
  'ooooo',
  '..c..',
  '..c..',
  '..c..',
  '..c..',
  '..c..',
  '..c..',
  '..cPP',
  '..cPP',
  '..C..',
]

/**
 * Baton. La gemme est le seul point clair du dessin : c'est elle qu'on
 * suit du regard, donc c'est sa trajectoire qui doit etre la plus ample.
 *
 * Le manche est epais sur quatre rangees et la diagonale abattue va deux
 * rangees plus loin que celle des deux autres armes : a dix-huit pixels,
 * l'image d'impact du baton ne debordait pas d'une colonne de plus que son
 * image portee. En aplat, le coup n'existait pas.
 */
const BATON = [
  '..d..',
  '.dfd.',
  '..d..',
  '..cc.',
  '..cc.',
  '..cc.',
  '..cc.',
  '..c..',
  '..c..',
  '..cPP',
  '..cPP',
  '..C..',
]

/**
 * L'épée abattue : la lame descend en diagonale vers l'exterieur, la
 * poignee reste sous la patte. Vingt-six pixels, comme le dessin porte.
 */
const EPEE_IMPACT = [
  '........C..',
  '........cPP',
  '........cPP',
  '....AAAAA..',
  '.....bA....',
  '....bA.....',
  '...bA......',
  '..bA.......',
  '.bA........',
  'bA.........',
  'bb.........',
]

/** Le marteau abattu : la masse arrive au sol. Trente-trois pixels. */
const MARTEAU_IMPACT = [
  '........C..',
  '........cPP',
  '........cPP',
  '.......cc..',
  '......cc...',
  '.....cc....',
  '.ooooo.....',
  '.oAAAo.....',
  '.oAAAo.....',
  '.ooooo.....',
]

/** Le baton abattu : la gemme finit sa course au sol. Vingt-deux pixels. */
const BATON_IMPACT = [
  '........C..',
  '........cPP',
  '........cPP',
  '.......cc..',
  '......cc...',
  '.....cc....',
  '....cc.....',
  '...cc......',
  '...d.......',
  '..dfd......',
  '...d.......',
]

export const ARMES: Arme[] = [
  ({
    id: 'epee',
    nom: 'Épée',
    pitch: 'Celle qui deborde le plus au moment du coup : sept colonnes hors du corps, contre six et trois.',
    art: EPEE,
    prise: [3, 9],
    montee: [[0, -4], [0, -8], [0, -9]],
    frappe: [[3, -2], [3, -2]],
    impact: EPEE_IMPACT,
    priseImpact: [8, 1],
  }),
  ({
    id: 'marteau',
    nom: 'Marteau',
    pitch: 'La masse est au bout du bras de levier : le même déplacement se lit plus lourd.',
    art: MARTEAU,
    prise: [2, 12],
    montee: [[0, -3], [0, -5], [0, -6]],
    frappe: [[3, -1], [3, -1]],
    impact: MARTEAU_IMPACT,
    priseImpact: [8, 1],
  }),
  ({
    id: 'baton',
    nom: 'Baton',
    pitch: 'La gemme est le seul point clair : c\'est elle qu\'on suit, donc elle decrit le plus grand arc.',
    art: BATON,
    prise: [2, 9],
    montee: [[0, -4], [0, -8], [0, -9]],
    frappe: [[3, -2], [3, -2]],
    impact: BATON_IMPACT,
    priseImpact: [8, 1],
  }),
]

/**
 * Les positions de l'arme, en decalage par rapport a la prise au repos.
 *
 * Ce sont des deplacements, pas des dessins : la masse est donc constante
 * par construction, et il n'y a rien a verifier de ce cote-la.
 */
export const POSITIONS_ARME = {
  portee: [0, 0],
  // Le retard : l'arme est encore a la hauteur de l'image precedente
  // pendant que le corps a deja bouge. Sans ces deux positions, une arme de
  // douze pixels de long portee pendant une marche est soudee au flanc et
  // ne ballotte jamais.
  retard: [0, -1],
  retardBas: [0, 1],
  // Le retard vaut UNE IMAGE, pas une compensation. A un seul pixel, il
  // annulait exactement le pas du corps : l'arme restait clouee a la meme
  // altitude sur les huit images de la marche pendant que le personnage
  // tressautait dessous. C'est l'objet qui doit trainer le plus qui ne
  // bougeait pas du tout.
  retardHaut: [0, 2],
  // Les trois paliers de l'armement. Les valeurs ici ne servent que de
  // repli : chaque arme donne les siennes, parce qu'aucun offset unique ne
  // les fait toutes monter au-dessus de la tete.
  armement1: [0, -4],
  armement2: [0, -8],
  armement3: [0, -9],
  // Le contre-mouvement : l'arme descend avant de monter. L'accroupissement
  // seul ne la deplacait pas d'un pixel, parce que le corps descendait de
  // trois et que `levee` remontait de trois — les deux s'annulaient
  // exactement, et la preparation ne se voyait pas.
  contre: [0, 2],
  // L'amorti : l'arme continue vers le bas apres l'impact.
  retombee: [0, 3],
  // La seule position qui change de dessin : l'impact, tranchant ou masse
  // vers le bas et vers l'exterieur. Verticale, la lame pointait vers le
  // ciel pendant tout le coup — ca ne se lit pas comme un coup porte.
  impact: [3, -2],
  rebond: [0, -1],
} as const

/**
 * Les positions qui utilisent le dessin d'impact.
 *
 * La retombee en fait partie : la lame reste au sol une image de plus, et
 * c'est le rebond qui la redresse. Avec le dessin porte des la retombee,
 * la pointe remontait de quinze rangees en quatre-vingts millisecondes,
 * une image apres avoir touche le sol.
 */
const IMPACTS = new Set<string>(['impact', 'retombee'])

/**
 * Les positions ou l'arme passerait DEVANT le personnage. Aucune.
 *
 * L'idee etait de gagner de la lisibilite au-dessus des epaules, la ou une
 * lame ne peut rien couper. Elle achetait la couleur et perdait la
 * silhouette : l'arme brandie n'ajoutait plus que quatre a cinq pixels au
 * contour du personnage, et effacait une dizaine de pixels de son trait
 * noir. En aplat, le personnage n'etait plus arme au moment meme ou il
 * frappe. Sortir l'arme du corps réglé les deux d'un coup ; passer devant
 * ne reglait que le second.
 */
const DEVANT = new Set<string>([])

export type PositionArme = keyof typeof POSITIONS_ARME

/** Masse d'un dessin, en pixels opaques. */
export function masseDArme(art: string[]): number {
  let n = 0
  for (const ligne of art) for (const c of ligne) if (c !== '.') n++
  return n
}

/**
 * Le point de prise dans la toile, deduit de la pose.
 *
 * Il se calcule a partir du corps et jamais d'une table par image : quand
 * les poses changent — et elles ont beaucoup change — l'arme suit toute
 * seule au lieu de se decrocher en silence. Deux colonnes a gauche du
 * flanc, ce qui laisse la lame degagee de la tete.
 */
export function mainDansLaToile(p: Pose): [number, number] {
  return [p.corps[0] - 3, p.corps[1] + 3]
}

/** Les paliers d'armement, dans l'ordre. */
const PALIERS: PositionArme[] = ['armement1', 'armement2', 'armement3']
/** Les deux images ou l'arme est au sol, dans l'ordre. */
const CHUTES: PositionArme[] = ['impact', 'retombee']

/** Le decalage d'une position, en tenant compte des offsets propres a l'arme. */
export function decalageDeLArme(arme: Arme, position: PositionArme): readonly [number, number] {
  const palier = PALIERS.indexOf(position)
  if (palier >= 0) return arme.montee[palier]
  const chute = CHUTES.indexOf(position)
  if (chute >= 0) return arme.frappe[chute]
  return POSITIONS_ARME[position]
}

/** Le dessin et sa prise pour une position donnee. */
export function dessinDeLArme(arme: Arme, position: PositionArme): [string[], [number, number]] {
  return IMPACTS.has(position)
    ? [arme.impact, arme.priseImpact]
    : [arme.art, arme.prise]
}

/** Coin haut-gauche du dessin de l'arme dans la toile, pour une position. */
export function coinDeLArme(p: Pose, arme: Arme, position: PositionArme): [number, number] {
  const [mx, my] = mainDansLaToile(p)
  const [dx, dy] = decalageDeLArme(arme, position)
  const [, prise] = dessinDeLArme(arme, position)
  return [mx + dx - prise[0], my + dy - prise[1]]
}

/**
 * Les seuls pixels d'arme qui se voient dans l'image finale.
 *
 * Deriver ca d'une soustraction « image armee moins image nue » serait
 * faux des que l'arme passe devant : elle remplace alors des pixels du
 * personnage au lieu d'en ajouter, et la soustraction compte zero la ou
 * l'arme se voit le mieux.
 */
export function armeSeule(p: Pose, arme: Arme, position: PositionArme): Bitmap {
  const brut = dessinDeLArmeSeul(p, arme, position)
  if (DEVANT.has(position)) return brut
  const perso = imageDePose(p)
  for (let i = 0; i < brut.u32.length; i++) {
    if (perso.u32[i] >>> 24) brut.u32[i] = 0
  }
  return brut
}

/** L'arme peinte seule, sans tenir compte du personnage. */
function dessinDeLArmeSeul(p: Pose, arme: Arme, position: PositionArme): Bitmap {
  const bm = new Bitmap(TAILLE, TAILLE)
  const [ox, oy] = coinDeLArme(p, arme, position)
  const [art] = dessinDeLArme(arme, position)
  for (let y = 0; y < art.length; y++) {
    const ligne = art[y]
    for (let x = 0; x < ligne.length; x++) {
      const lettre = ligne[x]
      if (lettre === '.') continue
      const hex = PALETTE_ARMES[lettre]
      if (!hex) continue
      const px = ox + x, py = oy + y
      if (px < 0 || py < 0 || px >= TAILLE || py >= TAILLE) continue
      bm.set(px, py, fromHex(hex))
    }
  }
  return bm
}

/**
 * Compose une pose armee. L'arme passe derriere le personnage, sauf
 * au-dessus des epaules ou elle ne peut rien couper.
 */
export function imageDePoseArmee(p: Pose, arme: Arme, position: PositionArme): Bitmap {
  const bm = new Bitmap(TAILLE, TAILLE)
  const perso = imageDePose(p)
  const seule = armeSeule(p, arme, position)
  for (let i = 0; i < perso.u32.length; i++) bm.u32[i] = perso.u32[i]
  for (let i = 0; i < seule.u32.length; i++) {
    if (seule.u32[i] >>> 24) bm.u32[i] = seule.u32[i]
  }
  return bm
}

/* ------------------------------------------------------------------ */
/* Cycles armes                                                        */
/* ------------------------------------------------------------------ */

export interface ImageArmee {
  pose: Pose
  position: PositionArme
}

export interface ClipArme {
  id: string
  nom: string
  ms: number
  loop: boolean
  images: ImageArmee[]
}

/**
 * Le coup porte, position par position.
 *
 * L'arme part en arrière pendant l'accroupissement, monte avec la detente,
 * et redescend UNE image avant que le corps ne s'écrase. C'est ce decalage
 * qui fait qu'un coup porte : si l'arme et le corps arrivent en meme
 * temps, on ne voit pas ce qui entraine l'autre.
 *
 * La remontee de l'image huit n'est pas une erreur : c'est le rebond de
 * l'arme après l'impact, et sans lui le retour au repos est une glissade.
 */
const COUP: PositionArme[] = [
  'contre', 'armement1', 'armement2', 'armement3', 'portee',
  'impact', 'retombee', 'rebond', 'portee',
]

/**
 * Le ballant de l'arme portee, cycle par cycle.
 *
 * Une position par image, alignee sur le sens dans lequel le corps vient de
 * bouger : quand il descend l'arme est encore haute, quand il monte elle
 * est encore basse.
 */
const BALLANT: Record<string, PositionArme[]> = {
  repos: ['portee', 'retard', 'portee', 'portee', 'portee', 'retardBas', 'portee', 'portee'],
  marche: ['portee', 'retard', 'retardHaut', 'retard', 'portee', 'retard', 'retardHaut', 'retard'],
}

/**
 * Cycles d'une mascotte armee.
 *
 * Les poses sont exactement celles du personnage nu : l'arme est une
 * couche par-dessus, pas une deuxieme animation. Quand un cycle de base
 * est corrige, l'arme suit sans qu'on y touche — et c'est arrive
 * plusieurs fois.
 */
export function clipsArmes(
  arme: Arme,
  base: { id: string; nom: string; ms: number; loop: boolean; poses: Pose[] }[],
): ClipArme[] {
  const trouver = (id: string) => base.find((c) => c.id === id)
  const sortie: ClipArme[] = []

  for (const id of ['repos', 'marche']) {
    const c = trouver(id)
    if (!c) continue
    sortie.push({
      id: `${id}-${arme.id}`,
      nom: `${c.nom} · ${arme.nom}`,
      ms: c.ms, loop: c.loop,
      images: c.poses.map((pose, i) => ({
        pose,
        position: BALLANT[id]?.[i] ?? ('portee' as PositionArme),
      })),
    })
  }

  const attaque = trouver('attaque')
  if (attaque) {
    sortie.push({
      id: `coup-${arme.id}`,
      nom: `Coup · ${arme.nom}`,
      ms: attaque.ms, loop: false,
      // Si le cycle d'attaque gagne ou perd une image, la derniere
      // position tient le reste : mieux vaut une arme qui reste basse
      // qu'un tableau qui deborde en silence.
      images: attaque.poses.map((pose, i) => ({
        pose,
        position: COUP[Math.min(i, COUP.length - 1)],
      })),
      // La table doit couvrir le cycle exactement : le `Math.min` protege
      // du debordement, mais une entree de trop fait compter le tempo a
      // faux a la lecture.
    })
  }

  return sortie
}

/**
 * Un sprite anime de la mascotte armee : une image par pose, un tag par
 * cycle, les trois armes a la suite.
 *
 * Deux calques plutot qu'un : l'arme dessous, le personnage dessus. C'est
 * ainsi qu'on travaille reellement — on change d'arme sans retoucher une
 * seule image du personnage — et ca se voit des l'ouverture.
 */
export function spritePixlArme(base: { id: string; nom: string; ms: number; loop: boolean; poses: Pose[] }[]): Sprite {
  const clips = ARMES.flatMap((a) => clipsArmes(a, base).map((c) => ({ arme: a, clip: c })))
  const sprite = new Sprite(TAILLE, TAILLE, Palette.preset('DawnBringer 32'))
  sprite.name = 'pixl-arme'
  sprite.pivot = { x: 0.5, y: 1 }
  sprite.frameDurations = []
  const fond = new Layer('Pixl', 0)
  const dessus = new Layer('Arme', 0)
  fond.cels = []
  dessus.cels = []
  sprite.tags = []
  let index = 0
  for (const { arme, clip } of clips) {
    const debut = index
    for (const img of clip.images) {
      // Le calque d'arme ne porte que les pixels d'arme qui se voient, et
      // il passe AU-DESSUS : c'est le seul ordre qui rende les deux cas —
      // l'arme derrière le corps et l'arme au-dessus des epaules — avec un
      // ordre de calques fixe.
      fond.cels.push({ bitmap: imageDePose(img.pose), opacity: 255 })
      dessus.cels.push({ bitmap: armeSeule(img.pose, arme, img.position), opacity: 255 })
      sprite.frameDurations.push(clip.ms)
      index++
    }
    sprite.tags.push({
      id: genId(),
      name: clip.nom,
      from: debut,
      to: index - 1,
      direction: 'forward',
      repeat: clip.loop ? 0 : 1,
      color: fromHex('#8f9bb8'),
    })
  }
  sprite.layers = [fond, dessus]
  return sprite
}
