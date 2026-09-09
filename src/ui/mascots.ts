import { Bitmap } from '../core/bitmap'
import { fromHex } from '../core/color'
import { Sprite, Layer } from '../core/document'
import { Palette } from '../core/palette'

/**
 * Mascottes de PixelForge, dessinees pixel par pixel.
 *
 * Le personnage de demonstration existant sert a montrer le squelette : il
 * est proportionne pour qu'un os par segment tombe juste. Une mascotte n'a
 * pas cette contrainte — elle est animee image par image — et peut donc
 * etre plus courte, plus large, plus lisible en petit.
 *
 * Chaque lettre est une couleur. Le point est transparent. Toutes les
 * lignes font exactement la largeur de la toile : une ligne trop courte
 * decalerait tout ce qui suit.
 */

export const TAILLE = 32

export interface Mascotte {
  id: string
  nom: string
  /** Ce qu'elle raconte, et pourquoi elle s'anime bien. */
  pitch: string
  palette: Record<string, string>
  repos: string[]
}

/* ------------------------------------------------------------------ */
/* Forge — un golem de braise                                          */
/* ------------------------------------------------------------------ */

const PALETTE_FORGE: Record<string, string> = {
  o: '#140f1e',
  r: '#3b4560',
  R: '#59678a',
  L: '#8496b6',
  e: '#c2451a',
  E: '#ff7a29',
  F: '#ffc74d',
  y: '#ffe9a8',
}

const FORGE_REPOS = [
  '................................',
  '................................',
  '...............oo...............',
  '..............oFFo..............',
  '.............oFEEFo.............',
  '.............oEEEEo.............',
  '..........ooooEEEEoooo..........',
  '..........oLRRRRRRRRro..........',
  '..........oLRRRRRRRRro..........',
  '..........oLRyyRRyyRro..........',
  '..........oLRyyRRyyRro..........',
  '..........oLRRRRRRRRro..........',
  '..........oLRRREEERRro..........',
  '..........oLRRRRRRRRro..........',
  '...........oRRRRRRRRo...........',
  '............oooooooo............',
  '...........oooooooooo...........',
  '.......oooooRRRRRRRRooooo.......',
  '.......oLRRoRRRRRRRRoRRLo.......',
  '.......oLRRoRREEEERRoRRLo.......',
  '.......oLRRoRRRRRRRRoRRLo.......',
  '.......oLRRoRRRRRRRRoRRLo.......',
  '.......oLRRoRRRRRRRRoRRLo.......',
  '.......oooooRRRRRRRRooooo.......',
  '...........oRRRRRRRRo...........',
  '...........oRRo..oRRo...........',
  '...........oRRo..oRRo...........',
  '...........oRRo..oRRo...........',
  '...........oRRo..oRRo...........',
  '..........oLLLo.oLLLo...........',
  '..........ooooo.ooooo...........',
  '................................',
]

/* ------------------------------------------------------------------ */
/* Pixl — un chat fait de pixels                                       */
/* ------------------------------------------------------------------ */

const PALETTE_PIXL: Record<string, string> = {
  o: '#161020',
  f: '#7b4bd6',
  F: '#a678ff',
  l: '#c8a9ff',
  d: '#4d2b91',
  y: '#ffe27a',
  p: '#ff8ab0',
  w: '#fdf3ff',
}

const PIXL_REPOS = [
  '................................',
  '................................',
  '..........oo........oo..........',
  '.........oFFo......oFFo.........',
  '.........oFFo......oFFo.........',
  '.........oFFFooooooFFFo.........',
  '.........oFFFFFFFFFFFFo.........',
  '.........oFFFFFFFFFFFFo.........',
  '.........oFFFFFFFFFFFFo.........',
  '.........oFFyyFFFFyyFFo.........',
  '.........oFFyyFFFFyyFFo.........',
  '.........oFFFFFppFFFFFo.........',
  '.........oFFFFFFFFFFFFo.........',
  '.........oFFFFFFFFFFFFo.........',
  '.........odFFFFFFFFFFdo.........',
  '..........oFFFFFFFFFFo..........',
  '...........oFFFFFFFFo...........',
  '............oooooooo......oo....',
  '...........oFFFFFFFFo....oFFo...',
  '...........oFwwwwwwFo...oFFo....',
  '...........oFwwwwwwFo..oFFo.....',
  '...........oFFwwwwFFo.oFFo......',
  '...........oFFFFFFFFooFFo.......',
  '...........oFFFFFFFFo...........',
  '...........odFFFFFFdo...........',
  '...........oFFFFFFFFo...........',
  '...........oFFo..oFFo...........',
  '...........oFFo..oFFo...........',
  '..........olllo.olllo...........',
  '..........ooooo.ooooo...........',
  '................................',
  '................................',
]

/* ------------------------------------------------------------------ */
/* Knave — un petit encapuchonne a l'echarpe                           */
/* ------------------------------------------------------------------ */

const PALETTE_KNAVE: Record<string, string> = {
  o: '#12101c',
  c: '#2f6b52',
  C: '#3f8f6c',
  l: '#5fbb8e',
  s: '#f2cba4',
  S: '#c99a72',
  e: '#c8384f',
  E: '#ea5b6f',
  b: '#4a3a2c',
  B: '#6b543f',
  y: '#fff3d0',
}

const KNAVE_REPOS = [
  '................................',
  '................................',
  '................................',
  '.............oooooo.............',
  '...........ooCCCCCCoo...........',
  '..........oCCCCCCCCCCo..........',
  '..........oClCCCCCCCCo..........',
  '..........oClCCCCCCCCo..........',
  '..........oCCoooooooCo..........',
  '..........oCCsyysyysCo..........',
  '..........oCCssssssSCo..........',
  '..........oCCsSssssSCo..........',
  '...........oCssssssCo...........',
  '............oooooooo............',
  '...........oeEEEEEEeo...........',
  '..........oeEEEEEEEEeo..........',
  '...........oCCCCCCCCo.oEEo......',
  '...........oCCCCCCCCo..oEEo.....',
  '........ooooCCCCCCCCoCCo.oEo....',
  '........oCCoCCCCCCCCoCCo........',
  '........oCCoCCCCCCCCoCCo........',
  '........oCCoCCCCCCCCoCCo........',
  '........ossoCCCCCCCCosso........',
  '........ooooCCCCCCCCoooo........',
  '...........oCCCCCCCCo...........',
  '...........obbo..obbo...........',
  '...........obbo..obbo...........',
  '...........obbo..obbo...........',
  '..........oBBBo.oBBBo...........',
  '..........ooooo.ooooo...........',
  '................................',
  '................................',
]

export const MASCOTTES: Mascotte[] = [
  {
    id: 'forge',
    nom: 'Forge',
    pitch: 'Un golem de braise. Lourd : chaque appui s\'écrase, chaque saut '
      + 'retombe. La flamme sur sa tête suit avec un temps de retard.',
    palette: PALETTE_FORGE,
    repos: FORGE_REPOS,
  },
  {
    id: 'pixl',
    nom: 'Pixl',
    pitch: 'Un chat de pixels. Léger et rapide, une queue en trois segments '
      + 'qui fouette a contretemps du corps.',
    palette: PALETTE_PIXL,
    repos: PIXL_REPOS,
  },
  {
    id: 'knave',
    nom: 'Knave',
    pitch: 'Un petit encapuchonne. Silhouette de personnage jouable, et une '
      + 'echarpe qui traine derrière lui a chaque changement de direction.',
    palette: PALETTE_KNAVE,
    repos: KNAVE_REPOS,
  },
]

/** Peint un dessin en lettres sur un bitmap. */
export function peindre(bm: Bitmap, art: string[], palette: Record<string, string>): void {
  for (let y = 0; y < art.length; y++) {
    const ligne = art[y]
    for (let x = 0; x < ligne.length; x++) {
      const lettre = ligne[x]
      if (lettre === '.') continue
      const hex = palette[lettre]
      if (!hex) continue
      bm.set(x, y, fromHex(hex))
    }
  }
}

/** Sprite d'une seule image, pour montrer un dessin. */
export function mascotteSprite(m: Mascotte): Sprite {
  const sprite = new Sprite(TAILLE, TAILLE, Palette.preset('DawnBringer 32'))
  sprite.name = m.id
  sprite.pivot = { x: 0.5, y: 1 }
  const layer = new Layer(m.nom, 1)
  const bm = new Bitmap(TAILLE, TAILLE)
  peindre(bm, m.repos, m.palette)
  layer.cels[0] = { bitmap: bm, opacity: 255 }
  sprite.layers = [layer]
  return sprite
}
