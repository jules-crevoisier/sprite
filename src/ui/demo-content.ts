import { Bitmap } from '../core/bitmap'
import { fromHex, getA, type RGBA } from '../core/color'
import { Sprite, Layer } from '../core/document'
import { Palette } from '../core/palette'

/** Trois tons d'une meme matiere : ombre, base, lumiere. */
type Ramp = [RGBA, RGBA, RGBA]

const ramp = (dark: string, base: string, light: string): Ramp =>
  [fromHex(dark), fromHex(base), fromHex(light)]

function fill(bm: Bitmap, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bm.set(x, y, c)
}

const SKIN = ramp('#c98d6b', '#e8b796', '#f7d8c0')
const SHIRT = ramp('#1f3273', '#3b5dc9', '#6d8dee')
const PANTS = ramp('#171d2e', '#333c57', '#4e5a7c')
const HAIR = ramp('#33153a', '#5d275d', '#843f84')
const BOOT = ramp('#0f1220', '#262b44', '#3d4460')
const BELT = ramp('#4a2c1a', '#7a4a28', '#a86a3c')
const OUTLINE = fromHex('#12141f')

/**
 * Ombre tout le dessin d'un coup : lumiere sur les pixels dont le voisin du
 * haut est vide, ombre sur ceux dont le voisin du bas ou de droite l'est.
 * Chaque matiere obtient ses trois tons, ce dont les fonctions assistees ont
 * besoin pour reconnaitre les familles de couleurs.
 */
function shade(bm: Bitmap, tones: Map<RGBA, Ramp>): void {
  const source = bm.clone()
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < bm.width && y < bm.height && getA(source.u32[y * bm.width + x]) !== 0
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      const r = tones.get(source.get(x, y))
      if (!r) continue
      if (!solid(x, y - 1)) bm.set(x, y, r[2])
      else if (!solid(x, y + 1) || !solid(x + 1, y)) bm.set(x, y, r[0])
    }
  }
}

/** Cerne le dessin d'un trait sombre : la silhouette se detache. */
function outline(bm: Bitmap, color: RGBA): void {
  const source = bm.clone()
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < bm.width && y < bm.height && getA(source.u32[y * bm.width + x]) !== 0
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      if (solid(x, y)) continue
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) bm.set(x, y, color)
    }
  }
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
export function demoCharacter(): Sprite {
  const sprite = new Sprite(48, 48, Palette.preset('DawnBringer 32'))
  sprite.name = 'demo_perso'
  sprite.pivot = { x: 0.5, y: 1 }
  const bm = new Bitmap(48, 48)

  fill(bm, 20, 34, 27, 37, PANTS[1])       // bassin
  fill(bm, 20, 38, 23, 43, PANTS[1])       // jambe gauche
  fill(bm, 24, 38, 27, 43, PANTS[1])       // jambe droite
  fill(bm, 19, 44, 23, 45, BOOT[1])        // botte gauche
  fill(bm, 24, 44, 28, 45, BOOT[1])        // botte droite
  fill(bm, 19, 21, 28, 31, SHIRT[1])       // torse
  fill(bm, 19, 32, 28, 33, BELT[1])        // ceinture
  fill(bm, 12, 22, 15, 32, SHIRT[1])       // bras gauche
  fill(bm, 32, 22, 35, 32, SHIRT[1])       // bras droit
  fill(bm, 12, 33, 15, 36, SKIN[1])        // main gauche
  fill(bm, 32, 33, 35, 36, SKIN[1])        // main droite
  fill(bm, 21, 19, 26, 21, SKIN[1])        // cou
  fill(bm, 18, 8, 29, 19, SKIN[1])         // visage
  fill(bm, 17, 4, 30, 9, HAIR[1])          // cheveux
  fill(bm, 17, 8, 18, 13, HAIR[1])         // meche gauche
  fill(bm, 29, 8, 30, 13, HAIR[1])         // meche droite

  shade(bm, new Map<RGBA, Ramp>([
    [SKIN[1], SKIN], [SHIRT[1], SHIRT], [PANTS[1], PANTS],
    [HAIR[1], HAIR], [BOOT[1], BOOT], [BELT[1], BELT],
  ]))

  // Visage pose apres l'ombrage, pour rester net.
  fill(bm, 20, 13, 21, 14, OUTLINE)
  fill(bm, 26, 13, 27, 14, OUTLINE)
  fill(bm, 22, 17, 25, 17, SKIN[0])

  outline(bm, OUTLINE)

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
