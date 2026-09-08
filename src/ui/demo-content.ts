import { Bitmap } from '../core/bitmap'
import { fromHex, type RGBA } from '../core/color'
import { Sprite, Layer } from '../core/document'
import { Palette } from '../core/palette'

/** Trois tons d'une meme matiere : ombre, base, lumiere. */
type Ramp = [RGBA, RGBA, RGBA]

const ramp = (dark: string, base: string, light: string): Ramp =>
  [fromHex(dark), fromHex(base), fromHex(light)]

/**
 * Pave ombre : lumiere en haut et a gauche, ombre en bas et a droite.
 * Chaque matiere obtient ainsi une vraie rampe de trois tons, ce que les
 * fonctions assistees savent exploiter.
 */
function shadedBox(bm: Bitmap, x0: number, y0: number, x1: number, y1: number, r: Ramp): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const light = y === y0 || x === x0
      const dark = y === y1 || x === x1
      bm.set(x, y, light ? r[2] : dark ? r[0] : r[1])
    }
  }
}

function box(bm: Bitmap, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bm.set(x, y, c)
}

const SKIN = ramp('#c28569', '#e8b796', '#f5d2ba')
const SHIRT = ramp('#243c8c', '#3b5dc9', '#5f80e8')
const PANTS = ramp('#1d2438', '#333c57', '#4a5573')
const HAIR = ramp('#3d1a3d', '#5d275d', '#7d3a7d')
const BOOT = ramp('#15182b', '#262b44', '#3a4059')

/** Personnage de face, sur 32x32, pense pour etre rigge puis pose. */
export function demoCharacter(): Sprite {
  const sprite = new Sprite(32, 32, Palette.preset('DawnBringer 32'))
  sprite.name = 'demo_perso'
  const bm = new Bitmap(32, 32)

  shadedBox(bm, 12, 11, 19, 21, SHIRT)   // torse
  shadedBox(bm, 9, 11, 11, 19, SHIRT)    // bras gauche
  shadedBox(bm, 20, 11, 22, 19, SHIRT)   // bras droit
  shadedBox(bm, 9, 20, 11, 22, SKIN)     // main gauche
  shadedBox(bm, 20, 20, 22, 22, SKIN)    // main droite
  shadedBox(bm, 13, 6, 18, 10, SKIN)     // visage
  shadedBox(bm, 12, 3, 19, 6, HAIR)      // cheveux
  box(bm, 14, 8, 14, 8, fromHex('#1d2438'))
  box(bm, 17, 8, 17, 8, fromHex('#1d2438'))
  shadedBox(bm, 12, 22, 15, 28, PANTS)   // jambe gauche
  shadedBox(bm, 16, 22, 19, 28, PANTS)   // jambe droite
  shadedBox(bm, 12, 29, 15, 30, BOOT)
  shadedBox(bm, 16, 29, 19, 30, BOOT)

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

  box(bm, 0, 0, 15, 0, grass[2])
  box(bm, 0, 1, 15, 3, grass[1])
  box(bm, 0, 4, 15, 4, grass[0])
  box(bm, 0, 5, 15, 5, dirt[2])
  box(bm, 0, 6, 15, 14, dirt[1])
  box(bm, 0, 15, 15, 15, dirt[0])

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
    box(bm, 0, 30, 31, 31, fromHex('#333c57'))
    return { bitmap: bm, opacity: 255 }
  })
  sprite.layers = [layer]
  return sprite
}
