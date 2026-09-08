import { Bitmap } from '../core/bitmap'
import { fromHex } from '../core/color'
import { Sprite, Layer, genId } from '../core/document'
import { Palette } from '../core/palette'

/**
 * Pixl, la mascotte, animee image par image.
 *
 * Les images ne sont pas dessinees une par une mais assemblees a partir de
 * pieces : tete, corps, pattes, queue. C'est la seule facon de tenir la
 * regle qui compte le plus dans un cycle — le volume ne doit pas changer
 * d'une image a l'autre. Une patte redessinee douze fois maigrit toujours
 * quelque part ; la meme patte deplacee de deux pixels, jamais.
 *
 * Les variantes existent la ou la deformation est le sujet : un corps
 * ecrase a l'atterrissage, une patte pliee au passage, une queue qui
 * fouette. Tout le reste bouge par decalage entier, ce qui garde le pixel
 * carre et le mouvement lisible.
 */

export const TAILLE = 32

const PALETTE: Record<string, string> = {
  o: '#161020',
  d: '#4d2b91',
  f: '#7b4bd6',
  F: '#a678ff',
  l: '#c8a9ff',
  y: '#ffe27a',
  p: '#ff8ab0',
  w: '#c3a6f5',
}

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

/** Tete de face, oreilles comprises. */
const TETE = [
  '.oo........oo.',
  'oFFo......oFFo',
  'oFFo......oFFo',
  'oFFFooooooFFFo',
  'oFFFFFFFFFFFFo',
  'oFFyyFFFFyyFFo',
  'oFFyyFFFFyyFFo',
  'oFFFFFppFFFFFo',
  'odFFFFFFFFFFdo',
  '.oFFFFFFFFFFo.',
  '..oFFFFFFFFo..',
  '..odFFFFFFdo..',
  '...oooooooo...',
]

/**
 * Yeux fermes, et yeux a demi clos.
 *
 * Un clignement d'une seule image, a 160 ms, ne se lit pas comme un
 * clignement mais comme un defaut d'affichage : il lui faut une image de
 * fermeture.
 */
const TETE_CLIN = TETE.map((l, i) =>
  i === 5 ? 'oFFooFFFFooFFo' : i === 6 ? 'oFFFFFFFFFFFFo' : l)
const TETE_MI_CLOS = TETE.map((l, i) =>
  i === 6 ? 'oFFooFFFFooFFo' : l)

/**
 * Tete ecrasee : une ligne de moins, et deux colonnes de plus sur les
 * joues. Un ecrasement deplace la matiere, il ne l'efface pas — l'egalite
 * des masses est verifiee par le test, pas affirmee ici.
 */
const TETE_ECRASEE = [
  '..oo........oo..',
  '.oFFo......oFFo.',
  '.oFFFooooooFFFo.',
  'oFFFFFFFFFFFFFFo',
  'oFFFyyFFFFyyFFFo',
  'oFFFyyFFFFyyFFFo',
  '.oFFFFFppFFFFFo.',
  '.odFFFFFFFFFFdo.',
  '..oFFFFFFFFFFo..',
  '...oFFFFFFFFo...',
  '...odFFFFFFdo...',
  '....oooooooo....',
]

/** La meme, yeux fermes : l'impact ferme les yeux sur l'image du choc. */
const TETE_ECRASEE_CLIN = TETE_ECRASEE.map((l, i) =>
  i === 4 ? 'oFFFooFFFFooFFFo' : i === 5 ? 'oFFFFFFFFFFFFFFo' : l)

/**
 * Corps. 12 x 8, soit 96 pixels.
 *
 * Deux pattes de quatre pixels separees de deux en font dix : un corps de
 * dix ne laissait aucun jeu, et le balancement lateral faisait
 * immanquablement deborder une patte hors du torse. A douze, le corps peut
 * se decaler d'un pixel de chaque cote sans qu'une seule colonne de patte
 * ne sorte.
 */
const CORPS = [
  'oFFFFFFFFFFo',
  'oFFwwwwwwFFo',
  'oFFwwwwwwFFo',
  'oFFwwwwwwFFo',
  'oFFFFFFFFFFo',
  'odFFFFFFFFdo',
  'odFFFFFFFFdo',
  'oFFFFFFFFFFo',
]

/** Corps ecrase : une ligne de moins, deux colonnes de plus. */
const CORPS_ECRASE = [
  '.oFFFFFFFFFFo.',
  'oFFFwwwwwwFFFo',
  'oFFFwwwwwwFFFo',
  'oFFFwwwwwwFFFo',
  'odFFFFFFFFFFdo',
  'odFFFFFFFFFFdo',
  '.oFFFFFFFFFFo.',
]

/** Corps etire : une ligne de plus, et les flancs rentres. */
const CORPS_ETIRE = [
  'oFFFFFFFFFFo',
  '.oFFwwwwFFo.',
  '.oFFwwwwFFo.',
  '.oFFwwwwFFo.',
  '.oFFwwwwFFo.',
  '.oFFFFFFFFo.',
  '.odFFFFFFdo.',
  '.odFFFFFFdo.',
  'oFFFFFFFFFFo',
]

/**
 * La patte, en un seul dessin.
 *
 * C'est le choix qui garantit la regle la plus dure d'un cycle : la masse
 * ne change pas d'une image a l'autre. Une patte redessinee pour chaque
 * pose maigrit toujours quelque part ; la meme patte deplacee de deux
 * pixels, jamais. Avancer, reculer, lever le pied : tout se fait par
 * decalage entier.
 */
const PATTE = [
  'oFFo',
  'oFFo',
  'oFFo',
  'oFFo',
  'oFFo',
  'oFFo',
  'ollo',
  'oooo',
]

/**
 * Queue, en quatre positions. Toutes partent du meme coin — quatre pixels
 * en bas a gauche du bloc — pour que le point d'attache a la hanche ne
 * bouge jamais. Une queue qui se decroche du corps est le premier defaut
 * qu'on voit.
 */
const QUEUES: Record<string, string[]> = {
  haute: [
    '....oFFo',
    '....oFo.',
    '...oFo..',
    '..oFFo..',
    '.oFFo...',
    '.oFFo...',
    'oFFFo...',
    'oooo....',
  ],
  milieu: [
    '......oo',
    '.....oFo',
    '....oFFo',
    '...oFFo.',
    '..oFFo..',
    '.oFFo...',
    'oFFFo...',
    'oooo....',
  ],
  basmilieu: [
    '........',
    '........',
    '.....ooo',
    '....oFFo',
    '...oFFFo',
    '.ooFFFo.',
    'oFFFFo..',
    'oooo....',
  ],
  basse: [
    '........',
    '........',
    '........',
    '...ooooo',
    '..oFFFFo',
    '.oFFFFo.',
    'oFFFFo..',
    'ooooo...',
  ],
  fouet: [
    '....oo..',
    '...oFFo.',
    '...oFo..',
    '..ooFo..',
    '..oFFo..',
    '.oFFFo..',
    'oFFFFo..',
    'oooo....',
  ],
}

export const PIECES = { TETE, TETE_CLIN, TETE_MI_CLOS, TETE_ECRASEE, TETE_ECRASEE_CLIN, CORPS, CORPS_ECRASE, CORPS_ETIRE, PATTE, QUEUES }

/* ------------------------------------------------------------------ */
/* Assemblage                                                          */
/* ------------------------------------------------------------------ */

export interface Pose {
  /** Coin haut-gauche de la tete. */
  tete: [number, number]
  teteArt?: string[]
  corps: [number, number]
  corpsArt?: string[]
  /** Coin haut-gauche de chaque patte. Meme dessin, deux positions. */
  patteG: [number, number]
  patteD: [number, number]
  queue: [string, number, number]
}

function poser(bm: Bitmap, art: string[], ox: number, oy: number): void {
  for (let y = 0; y < art.length; y++) {
    for (let x = 0; x < art[y].length; x++) {
      const lettre = art[y][x]
      if (lettre === '.') continue
      const hex = PALETTE[lettre]
      if (!hex) continue
      const px = ox + x, py = oy + y
      if (px < 0 || py < 0 || px >= TAILLE || py >= TAILLE) continue
      bm.set(px, py, fromHex(hex))
    }
  }
}

/** Compose une image a partir d'une pose. */
export function imageDePose(p: Pose): Bitmap {
  const bm = new Bitmap(TAILLE, TAILLE)
  // Les pattes passent derriere le corps : quand le corps s'abaisse, la
  // patte se raccourcit d'elle-meme au lieu de traverser le ventre.
  poser(bm, QUEUES[p.queue[0]], p.queue[1], p.queue[2])
  poser(bm, PATTE, p.patteG[0], p.patteG[1])
  poser(bm, PATTE, p.patteD[0], p.patteD[1])
  poser(bm, p.corpsArt ?? CORPS, p.corps[0], p.corps[1])
  poser(bm, p.teteArt ?? TETE, p.tete[0], p.tete[1])
  return bm
}

export interface ClipMascotte {
  id: string
  nom: string
  ms: number
  loop: boolean
  poses: Pose[]
}

export const PALETTE_MASCOTTE = PALETTE

/** Construit un sprite anime : une frame par pose, un tag par cycle. */
export function mascotteAnimee(clips: ClipMascotte[]): Sprite {
  const total = clips.reduce((n, c) => n + c.poses.length, 0)
  const sprite = new Sprite(TAILLE, TAILLE, Palette.preset('DawnBringer 32'))
  sprite.name = 'pixl'
  sprite.pivot = { x: 0.5, y: 1 }
  sprite.frameDurations = []
  const layer = new Layer('Pixl', 0)
  layer.cels = []
  sprite.tags = []
  let index = 0
  for (const clip of clips) {
    const debut = index
    for (const pose of clip.poses) {
      layer.cels.push({ bitmap: imageDePose(pose), opacity: 255 })
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
      color: fromHex('#a678ff'),
    })
  }
  sprite.layers = [layer]
  void total
  return sprite
}
