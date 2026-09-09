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

const PAL_HEROS: Palette = {
  o: '#1a1420',
  h: '#8a4b2a',
  H: '#b36a3c',
  s: '#e8b892',
  y: '#2a2338',
  t: '#3f6fb5',
  T: '#5a90dd',
  b: '#7a4a22',
  p: '#2f3a52',
  B: '#241b16',
  m: '#c8a15a',
}

export const HEROS: Dessin = {
  largeur: 20,
  hauteur: 22,
  palette: PAL_HEROS,
  lignes: [
    '.....oooooo.....',
    '....ohhhhhhho...',
    '...ohHHHHHHHho..',
    '...ohsssssssho..',
    '...ohsysssyssho.',
    '...ohsssssssho..',
    '....osssssso....',
    '.....oooooo.....',
    '...ooTTTTTToo...',
    '..osTtttttTtso..',
    '..osTtttttTtso..',
    '..osTtttttTtso..',
    '...oTbbbbbbTo...',
    '...oTtttttTo....',
    '....otttttto....',
    '....oppppppo....',
    '....opp..ppo....',
    '....opp..ppo....',
    '...oBBo..oBBo...',
    '...oBBo..oBBo...',
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
  n: '#16241c',
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
