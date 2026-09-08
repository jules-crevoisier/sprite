import { Bitmap } from '../core/bitmap'
import { fromHex } from '../core/color'
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
}

/**
 * Epee. La lame double la hauteur de la silhouette : c'est elle qui donne
 * la direction du coup, une image avant que le corps ne suive.
 */
const EPEE = [
  '..b..',
  '..b..',
  '..b..',
  '..b..',
  '..b..',
  '..b..',
  '..b..',
  '..b..',
  '.AAA.',
  '..cPP',
  '..cPP',
  '..C..',
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
  {
    id: 'epee',
    nom: 'Epee',
    pitch: 'La lame double la hauteur de la silhouette et donne la direction du coup avant le corps.',
    art: EPEE,
    prise: [2, 9],
  },
  {
    id: 'marteau',
    nom: 'Marteau',
    pitch: 'La masse est au bout du bras de levier : le meme deplacement se lit plus lourd.',
    art: MARTEAU,
    prise: [2, 10],
  },
  {
    id: 'baton',
    nom: 'Baton',
    pitch: 'La gemme est le seul point clair : c\'est elle qu\'on suit, donc elle decrit le plus grand arc.',
    art: BATON,
    prise: [2, 9],
  },
]

/**
 * Les positions de l'arme, en decalage par rapport a la prise au repos.
 *
 * Ce sont des deplacements, pas des dessins : la masse est donc constante
 * par construction, et il n'y a rien a verifier de ce cote-la.
 */
export const POSITIONS_ARME = {
  portee: [0, 0],
  levee: [-1, -3],
  haute: [0, -6],
  frappe: [1, 4],
} as const

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

/** Coin haut-gauche du dessin de l'arme dans la toile, pour une position. */
export function coinDeLArme(p: Pose, arme: Arme, position: PositionArme): [number, number] {
  const [mx, my] = mainDansLaToile(p)
  const [dx, dy] = POSITIONS_ARME[position]
  return [mx + dx - arme.prise[0], my + dy - arme.prise[1]]
}

/**
 * Compose une pose armee. L'arme est peinte d'abord, le personnage
 * par-dessus : devant, la lame couperait le visage.
 */
export function imageDePoseArmee(p: Pose, arme: Arme, position: PositionArme): Bitmap {
  const bm = new Bitmap(TAILLE, TAILLE)
  const [ox, oy] = coinDeLArme(p, arme, position)
  for (let y = 0; y < arme.art.length; y++) {
    const ligne = arme.art[y]
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
  const perso = imageDePose(p)
  for (let i = 0; i < perso.u32.length; i++) {
    if (perso.u32[i] >>> 24) bm.u32[i] = perso.u32[i]
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
  'levee', 'haute', 'haute', 'haute', 'portee',
  'frappe', 'frappe', 'levee', 'portee', 'portee',
]

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
      images: c.poses.map((pose) => ({ pose, position: 'portee' as PositionArme })),
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
    })
  }

  return sortie
}
