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
  /** Le meme dessin abattu, obtenu par rotation. */
  abattue: string[]
  priseAbattue: [number, number]
}

/**
 * Quart de tour vers la gauche.
 *
 * C'est la seule facon de dessiner l'arme abattue sans lui faire perdre un
 * pixel : une rotation deplace la matiere, elle n'en enleve pas. Redessiner
 * la lame a l'horizontale la ferait maigrir quelque part, et elle
 * maigrirait sur l'element le plus contraste de l'image.
 *
 * Un pixel (x, y) d'un dessin large de `l` se retrouve en (y, l - 1 - x).
 */
function pivoter(art: string[]): string[] {
  const h = art.length, l = art[0].length
  const sortie: string[][] = Array.from({ length: l }, () => Array(h).fill('.'))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      if (art[y][x] === '.') continue
      sortie[l - 1 - x][y] = art[y][x]
    }
  }
  return sortie.map((ligne) => ligne.join(''))
}

/** La prise suit la meme rotation que le dessin qui la porte. */
function prisePivotee(prise: [number, number], largeur: number): [number, number] {
  return [prise[1], largeur - 1 - prise[0]]
}

/** Complete une arme de sa version abattue, calculee et non dessinee. */
function armer(a: Omit<Arme, 'abattue' | 'priseAbattue'>): Arme {
  return { ...a, abattue: pivoter(a.art), priseAbattue: prisePivotee(a.prise, a.art[0].length) }
}

/**
 * Epee. La lame double la hauteur de la silhouette : c'est elle qui donne
 * la direction du coup, une image avant que le corps ne suive.
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
 */
const BATON = [
  '..d..',
  '.dfd.',
  '..d..',
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

export const ARMES: Arme[] = [
  armer({
    id: 'epee',
    nom: 'Epee',
    pitch: 'La lame double la hauteur de la silhouette et donne la direction du coup avant le corps.',
    art: EPEE,
    prise: [3, 9],
  }),
  armer({
    id: 'marteau',
    nom: 'Marteau',
    pitch: 'La masse est au bout du bras de levier : le meme deplacement se lit plus lourd.',
    art: MARTEAU,
    prise: [2, 10],
  }),
  armer({
    id: 'baton',
    nom: 'Baton',
    pitch: 'La gemme est le seul point clair : c\'est elle qu\'on suit, donc elle decrit le plus grand arc.',
    art: BATON,
    prise: [2, 9],
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
  haute: [2, -6],
  // Le contre-mouvement : l'arme descend avant de monter. L'accroupissement
  // seul ne la deplacait pas d'un pixel, parce que le corps descendait de
  // trois et que `levee` remontait de trois — les deux s'annulaient
  // exactement, et la preparation ne se voyait pas.
  contre: [-1, 2],
  // L'amorti : l'arme continue vers le bas apres l'impact.
  retombee: [0, 3],
  // La seule position qui change de dessin : l'arme abattue, tranchant ou
  // masse vers l'exterieur. Verticale, la lame pointait vers le ciel
  // pendant tout le coup — ca ne se lit pas comme un coup porte.
  abattue: [6, 4],
  rebond: [0, -1],
} as const

/** Les positions qui utilisent le dessin pivote. */
const ABATTUES = new Set<string>(['abattue'])

/**
 * Les positions ou l'arme passe DEVANT le personnage.
 *
 * La regle generale est l'inverse : devant, une lame couperait le visage.
 * Mais au-dessus des epaules elle ne peut rien couper, et derriere elle
 * n'a qu'une colonne de couloir visible a droite d'une tete large de
 * quatorze pixels — mesure : dix-huit pixels visibles a l'aplomb, sept a
 * un pixel de decalage, quatre a deux, un a trois. Aucun arc n'est
 * possible dans un couloir d'une colonne.
 */
const DEVANT = new Set<string>(['haute'])

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
  return [p.corps[0] - 2, p.corps[1] + 3]
}

/** Le dessin et sa prise pour une position donnee. */
export function dessinDeLArme(arme: Arme, position: PositionArme): [string[], [number, number]] {
  return ABATTUES.has(position)
    ? [arme.abattue, arme.priseAbattue]
    : [arme.art, arme.prise]
}

/** Coin haut-gauche du dessin de l'arme dans la toile, pour une position. */
export function coinDeLArme(p: Pose, arme: Arme, position: PositionArme): [number, number] {
  const [mx, my] = mainDansLaToile(p)
  const [dx, dy] = POSITIONS_ARME[position]
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
 * L'arme part en arriere pendant l'accroupissement, monte avec la detente,
 * et redescend UNE image avant que le corps ne s'ecrase. C'est ce decalage
 * qui fait qu'un coup porte : si l'arme et le corps arrivent en meme
 * temps, on ne voit pas ce qui entraine l'autre.
 *
 * La remontee de l'image huit n'est pas une erreur : c'est le rebond de
 * l'arme apres l'impact, et sans lui le retour au repos est une glissade.
 */
const COUP: PositionArme[] = [
  'contre', 'haute', 'haute', 'haute', 'portee',
  'abattue', 'abattue', 'retombee', 'rebond', 'portee',
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
      // l'arme derriere le corps et l'arme au-dessus des epaules — avec un
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
