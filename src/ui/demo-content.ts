import { Bitmap } from '../core/bitmap'
import { fromHex, type RGBA } from '../core/color'
import { Sprite, Layer } from '../core/document'
import { Palette } from '../core/palette'

/** Trois tons d'une meme matiere : ombre, base, lumiere. */
type Ramp = [RGBA, RGBA, RGBA]

const ramp = (dark: string, base: string, light: string): Ramp =>
  [fromHex(dark), fromHex(base), fromHex(light)]

function fill(bm: Bitmap, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bm.set(x, y, c)
}




/**
 * Personnage de face sur 48x48, dessine pour se rigger proprement.
 *
 * Les bras sont ecartes du torse de trois pixels : le contour de chacun
 * garde alors une colonne libre entre eux, si bien que la liaison au
 * squelette separe le bras du corps au lieu de couper au milieu d'une masse
 * continue. Les membres sont allonges dans l'axe de leur os, ce qui rend la
 * rotation lisible.
 */
/*
 * Personnage de demonstration, dessine pixel par pixel plutot que compose de
 * rectangles : c'est lui qui sert de reference pour le squelette, les cycles
 * et le demi-tour, donc il doit tenir la comparaison avec un vrai sprite.
 *
 * Chaque lettre est une couleur de la palette ci-dessous. Les membres sont
 * separes par un contour et proportionnes pour qu'un os par segment tombe
 * juste : epaule-coude, coude-main, hanche-genou, genou-pied.
 */
const CHARACTER_ART = [
  '.........oooooooo.........',
  '.......ooddddddddoo.......',
  '......oddhhhhhhhhddo......',
  '......odhllhhhhhhhdo......',
  '......odhllhhhhhhhdo......',
  '......odhhhhhhhhhhdo......',
  '......odhsssssssHhdo......',
  '......odhseesseeShdo......',
  '......odhsssssssshdo......',
  '......odhsSsssssShdo......',
  '.......ohsSsssssSho.......',
  '.......ooSssssssSoo.......',
  '........oSSssssSSo........',
  '.........osssso...........',
  '........otttttttto........',
  '....oooooutttttTToooo.....',
  '....otttoutttttTTottto....',
  '....otutoutttttTTotTto....',
  '....otutoutttttTTotTto....',
  '....otutoutttttTTotTto....',
  '....oooooutttttTToooo.....',
  '....ossooggggggggoosso....',
  '....ossoogGgggGggoosso....',
  '....ossoooooooooooosso....',
  '....oSsoopppPPpppoosSo....',
  '....ooooopppPPpppooooo....',
  '........opppPPpppo........',
  '........opppPPpppo........',
  '........opppoopppo........',
  '........opppooPppo........',
  '........opppooPppo........',
  '........oppPooPppo........',
  '........oppPooPppo........',
  '........obBbooBbBo........',
  '.......obbBbooBbbBo.......',
  '.......obbbboobbbbo.......',
  '.......oooooooooooo.......',
]

/**
 * Palette du personnage.
 *
 * Les tons sombres ont ete remontes et le trait assombri sur constat du
 * verificateur : le contour ne tranchait que sur 53% de ce qu'il touchait, ce
 * qui veut dire qu'une moitie de la silhouette se lisait comme une seule masse
 * des que le fond s'eclaircissait. Les valeurs viennent de la mesure, pas de
 * l'oeil — l'ecart de luminance vise est de quarante-cinq sur deux cent
 * cinquante-cinq.
 */
const CHARACTER_PALETTE: Record<string, string> = {
  'o': '#100c1a',
  's': '#f2cba4',
  'S': '#cc9169',
  'H': '#ffe6c9',
  'h': '#7b41ab',
  'd': '#5f2f89',
  'l': '#a86ed8',
  't': '#3d60cf',
  'T': '#2d49ac',
  'u': '#6488f4',
  'p': '#4b5580',
  'P': '#39426a',
  'b': '#33261e',
  'B': '#453224',
  'g': '#a8672f',
  'G': '#70401b',
  'e': '#100c1a',
}

export function demoCharacter(): Sprite {
  const sprite = new Sprite(48, 48, Palette.preset('DawnBringer 32'))
  sprite.name = 'demo_perso'
  sprite.pivot = { x: 0.5, y: 1 }
  const bm = new Bitmap(48, 48)

  const artWidth = CHARACTER_ART[0].length
  const artHeight = CHARACTER_ART.length
  // Centre horizontalement, pose les pieds a deux pixels du bas : un sprite
  // de jeu s'aligne sur le sol, pas sur le milieu de la toile.
  const ox = Math.floor((48 - artWidth) / 2)
  const oy = 48 - artHeight - 2
  const couleurs = new Map<string, RGBA>()
  for (const [lettre, hex] of Object.entries(CHARACTER_PALETTE)) couleurs.set(lettre, fromHex(hex))

  for (let y = 0; y < artHeight; y++) {
    const ligne = CHARACTER_ART[y]
    for (let x = 0; x < ligne.length; x++) {
      const couleur = couleurs.get(ligne[x])
      if (couleur !== undefined) bm.set(ox + x, oy + y, couleur)
    }
  }

  const layer = new Layer('Personnage', 1)
  layer.cels[0] = { bitmap: bm, opacity: 255 }
  sprite.layers = [layer]
  return sprite
}

/** Bloc d'herbe et de terre, pour essayer le generateur de detail. */
export function demoGrassBlock(): Sprite {
  const sprite = new Sprite(16, 16, Palette.preset('DawnBringer 32'))
  sprite.name = 'demo_herbe'
  sprite.grid = { x: 0, y: 0, w: 16, h: 16 }
  const bm = new Bitmap(16, 16)

  const grass = ramp('#2c6b2f', '#3e8c3a', '#57ad4a')
  const dirt = ramp('#5a3d26', '#8f6642', '#a87c52')

  fill(bm, 0, 0, 15, 0, grass[2])
  fill(bm, 0, 1, 15, 3, grass[1])
  fill(bm, 0, 4, 15, 4, grass[0])
  fill(bm, 0, 5, 15, 5, dirt[2])
  fill(bm, 0, 6, 15, 14, dirt[1])
  fill(bm, 0, 15, 15, 15, dirt[0])

  const layer = new Layer('Tuile', 1)
  layer.cels[0] = { bitmap: bm, opacity: 255 }
  sprite.layers = [layer]
  return sprite
}

/** Balle sur quatre frames, pour la lecon d'animation. */
export function demoBall(): Sprite {
  const sprite = new Sprite(32, 32, Palette.preset('Sweetie 16'))
  sprite.name = 'demo_balle'
  sprite.frameDurations = [90, 90, 90, 90]
  const ball = ramp('#b13e53', '#ef7d57', '#ffcd75')

  const layer = new Layer('Balle', 4)
  const heights = [4, 12, 18, 12]
  layer.cels = heights.map((top) => {
    const bm = new Bitmap(32, 32)
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const dx = x - 4.5, dy = y - 4.5
        const d = Math.hypot(dx, dy)
        if (d > 5) continue
        const tone = d < 2.4 ? ball[2] : d < 4 ? ball[1] : ball[0]
        bm.set(11 + x, top + y, tone)
      }
    }
    fill(bm, 0, 30, 31, 31, fromHex('#333c57'))
    return { bitmap: bm, opacity: 255 }
  })
  sprite.layers = [layer]
  return sprite
}
