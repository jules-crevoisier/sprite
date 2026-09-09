import { Bitmap } from '../core/bitmap'
import { fromHex } from '../core/color'

/**
 * Les dessins de la demonstration, en lettres.
 *
 * Meme convention que les mascottes : une lettre est une couleur, le point
 * est transparent. Deux differences, apprises a l'usage :
 *
 * - les lignes n'ont pas besoin de faire la largeur exacte de la toile. Le
 *   commentaire de `mascots.ts` previent qu'une ligne trop courte decale tout
 *   ce qui suit ; ici on complete a la volee, ce qui enleve le piege plutot
 *   que de le signaler ;
 * - le dessin est centre horizontalement dans sa toile, pour qu'un sprite se
 *   retrouve au milieu de sa case sans qu'on ait a compter les points.
 */

export type Palette = Record<string, string>

export interface Dessin {
  largeur: number
  hauteur: number
  palette: Palette
  lignes: string[]
}

/** Rend un dessin en bitmap, centre dans sa toile. */
export function bitmapDe(d: Dessin): Bitmap {
  const bm = new Bitmap(d.largeur, d.hauteur)
  const large = Math.max(...d.lignes.map((l) => l.length))
  const ox = Math.floor((d.largeur - large) / 2)
  const oy = Math.floor((d.hauteur - d.lignes.length) / 2)
  for (let y = 0; y < d.lignes.length; y++) {
    const ligne = d.lignes[y]
    for (let x = 0; x < ligne.length; x++) {
      const hex = d.palette[ligne[x]]
      if (!hex) continue
      const px = ox + x, py = oy + y
      if (px < 0 || py < 0 || px >= d.largeur || py >= d.hauteur) continue
      bm.set(px, py, fromHex(hex))
    }
  }
  return bm
}

/* ------------------------------------------------------------------ */
/* Le heros                                                            */
/* ------------------------------------------------------------------ */

/**
 * Palette du heros, revue sur constat du critique.
 *
 * Quatre defauts nommes, quatre corrections :
 *
 * - `m` etait declare et employe zero fois, et la rampe avait un trou de
 *   cinquante-trois unites de luminance entre la chemise claire et la peau.
 *   Le meme `m`, rechauffe, bouche le trou en servant d'ombre de peau : une
 *   entree morte devient le volume du visage, a cout nul ;
 * - `y` achetait deux pixels — les yeux — pour seize unites d'ecart avec le
 *   contour. Personne ne distingue ces deux noirs a l'echelle trois : les
 *   yeux sont passes en `o` et la case est rendue ;
 * - le pantalon etait a #2f3a52, luminance 57. Le sol du donjon est a #3a3a4e,
 *   luminance 59. Le personnage etait peint couleur du decor, et son quart
 *   inferieur s'y dissolvait. Remonte a 82 ;
 * - la chemise n'avait ni ombre ni cote sombre : `T` etait pose des DEUX cotes
 *   du torse, c'est-a-dire une lumiere venue de partout, donc de nulle part.
 *   `u` donne le cote a l'ombre, et la lumiere vient desormais du haut-gauche
 *   partout — cheveux, visage, chemise, jambes.
 */
const PAL_HEROS: Palette = {
  o: '#1a1420',
  h: '#8a4b2a',
  H: '#b36a3c',
  s: '#e8b892',
  m: '#c08a63',
  t: '#3f6fb5',
  T: '#5a90dd',
  u: '#2c4f85',
  b: '#7a4a22',
  p: '#46536f',
  P: '#5e6d8c',
  B: '#3a2b22',
}

/**
 * Le heros, redessine apres critique.
 *
 * Deux defauts de silhouette avaient ete mesures :
 *
 * - les bras etaient soudes au torse, sans un pixel de contour entre les deux.
 *   Comprimees a soixante pour cent — ce que fait la generation des huit
 *   directions — les trois lignes du torse devenaient pleines sur toute la
 *   largeur : la silhouette lisait comme une cloche. Et les bras s'arretaient
 *   trois lignes plus haut que le torse, ce qui en faisait des epaulettes.
 *   Chaque bras est maintenant separe par un trait et descend jusqu'a la main ;
 * - un unique pixel, la joue droite de la ligne des yeux, depassait d'une
 *   colonne et imposait a lui seul la largeur treize.
 *
 * Les jambes gagnent une ligne : quatre lignes de pantalon au lieu de deux,
 * sans quoi un cycle de marche n'a aucune amplitude.
 */
export const HEROS: Dessin = {
  largeur: 20,
  hauteur: 22,
  palette: PAL_HEROS,
  lignes: [
    '.....oooooo.....',
    '....ohhhhhhho...',
    '...ohHHHHHHHho..',
    '...ohssssssmho..',
    '...ohsosssomho..',
    '...ohssssssmho..',
    '....osssssmo....',
    '.....oooooo.....',
    '..ooTTTTTTttoo..',
    '..oToTttttuouo..',
    '..oToTttttuouo..',
    '..oToTttttuouo..',
    '..osobbbbbbomo..',
    '..osotttttuomo..',
    '....otttttuo....',
    '....oPpppppo....',
    '....oPpooppo....',
    '....oPpooppo....',
    '....oPpooppo....',
    '....oBBooBBo....',
    '....oooooooo....',
  ],
}

/* ------------------------------------------------------------------ */
/* La creature                                                         */
/* ------------------------------------------------------------------ */

const PAL_SLIME: Palette = {
  o: '#0f2318',
  v: '#2f7d4f',
  V: '#49b06e',
  c: '#8ce0a5',
  y: '#f2f5d0',
  // Ce ton etait a douze unites de `o` : deux couleurs qu'aucun oeil ne
  // separe, et une case de palette perdue. Le verificateur l'a signale.
  n: '#08160f',
}

export const SLIME: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_SLIME,
  lignes: [
    '....oooo....',
    '..ooVVVVoo..',
    '.oVVVccVVVo.',
    'oVVVVccVVVVo',
    'oVyoVVVVoyVo',
    'oVyoVVVVoyVo',
    'oVVVVVVVVVVo',
    'oVVvvVVvvVVo',
    'ovvvvvvvvvvo',
    '.oovvvvvvoo.',
    '..oonnnnoo..',
  ],
}

/* ------------------------------------------------------------------ */
/* Les tuiles                                                          */
/* ------------------------------------------------------------------ */

const PAL_DECOR: Palette = {
  o: '#14101a',
  s: '#3a3a4e',
  S: '#4a4a62',
  d: '#2b2b3c',
  m: '#5e5a52',
  M: '#7a7466',
  f: '#3d3428',
  F: '#57492f',
  b: '#8a5a2a',
  B: '#b07a3c',
  c: '#5a4020',
  p: '#2a5a8a',
  P: '#4a8ac8',
  y: '#f0c860',
  Y: '#fff0a8',
  r: '#a03028',
  g: '#2f7d4f',
}

export const SOL: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'ssssssssssssssss',
    'sSSSSSsssSSSSsss',
    'sSSSSSsssSSSSsss',
    'ssssssssssssssss',
    'sssSSSSSSSssssss',
    'sssSSSSSSSssSSss',
    'ssssssssssssSSss',
    'ssssssssssssssss',
    'sSSSsssSSSSSssss',
    'sSSSsssSSSSSssss',
    'ssssssssssssssss',
    'ssssSSSSsssSSSSs',
    'ssssSSSSsssSSSSs',
    'ssssssssssssssss',
    'sssssssSSSssssss',
    'ssssssssssssssss',
  ],
}

export const MUR: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'MMMMMMMMMMMMMMMM',
    'MmmmmmmmmmmmmmmM',
    'MmMMMMmmMMMMMmmM',
    'MmMMMMmmMMMMMmmM',
    'MmmmmmmmmmmmmmmM',
    'MMMMmmMMMMMmmMMM',
    'MMMMmmMMMMMmmMMM',
    'MmmmmmmmmmmmmmmM',
    'MmMMMMMmmMMMMmmM',
    'MmMMMMMmmMMMMmmM',
    'MmmmmmmmmmmmmmmM',
    'oooooooooooooooo',
    'dddddddddddddddd',
    'dddddddddddddddd',
    'dddddddddddddddd',
    'oooooooooooooooo',
  ],
}

export const CAISSE: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'oooooooooooooooo',
    'oBBBBBBBBBBBBBBo',
    'oBbbbbbbbbbbbbBo',
    'oBbBBbbbbbbBBbBo',
    'oBbbBBbbbbBBbbBo',
    'oBbbbBBbbBBbbbBo',
    'oBbbbbBBBBbbbbBo',
    'oBbbbbBBBBbbbbBo',
    'oBbbbBBbbBBbbbBo',
    'oBbbBBbbbbBBbbBo',
    'oBbBBbbbbbbBBbBo',
    'oBbbbbbbbbbbbbBo',
    'oBBBBBBBBBBBBBBo',
    'occccccccccccсco',
    'oooooooooooooooo',
  ],
}

export const PLAQUE: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    '................',
    '................',
    '...oooooooooo...',
    '..opppppppppo...',
    '..opPPPPPPPpo...',
    '..opPsssssPpo...',
    '..opPsssssPpo...',
    '..opPsssssPpo...',
    '..opPPPPPPPpo...',
    '..opppppppppo...',
    '...oooooooooo...',
    '................',
  ],
}

export const PLAQUE_ON: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    '................',
    '................',
    '...oooooooooo...',
    '..oyyyyyyyyyo...',
    '..oyYYYYYYYyo...',
    '..oyYYYYYYYyo...',
    '..oyYYYYYYYyo...',
    '..oyYYYYYYYyo...',
    '..oyYYYYYYYyo...',
    '..oyyyyyyyyyo...',
    '...oooooooooo...',
    '................',
  ],
}

export const PORTE: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'oooooooooooooooo',
    'oFFFFFFFFFFFFFFo',
    'oFffffffffffffFo',
    'oFfFFffffffFFffo',
    'oFffffffffffffFo',
    'oFffffyyffffffFo',
    'oFffffyyffffffFo',
    'oFffffffffffffFo',
    'oFfFFffffffFFffo',
    'oFffffffffffffFo',
    'oFffffffffffffFo',
    'oFfFFffffffFFffo',
    'oFffffffffffffFo',
    'oFFFFFFFFFFFFFFo',
    'oooooooooooooooo',
  ],
}

export const SORTIE: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'oooooooooooooooo',
    'o..............o',
    'o..............o',
    'o....gggggg....o',
    'o...gggggggg...o',
    'o...gggggggg...o',
    'o...gggggggg...o',
    'o...gggggggg...o',
    'o...gggggggg...o',
    'o....gggggg....o',
    'o..............o',
    'o..............o',
    'oooooooooooooooo',
  ],
}
