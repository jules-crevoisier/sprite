import { Bitmap } from '../core/bitmap'
import { Sprite, Layer } from '../core/document'
import { Palette, quantize } from '../core/palette'

/** Convertit une image chargee en bitmap RGBA. */
export function imageToBitmap(img: HTMLImageElement): Bitmap {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0)
  return Bitmap.fromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
}

export interface SheetImportOptions {
  /** Decoupe l'image en frames de cette taille. 0 = image entiere. */
  frameWidth: number
  frameHeight: number
  /** Espace entre deux frames dans la planche source. */
  padding: number
  margin: number
  /** Ignore les frames entierement transparentes. */
  skipEmpty: boolean
  /** Construit une palette a partir des couleurs de l'image. */
  buildPalette: boolean
}

export const DEFAULT_IMPORT: SheetImportOptions = {
  frameWidth: 0,
  frameHeight: 0,
  padding: 0,
  margin: 0,
  skipEmpty: true,
  buildPalette: true,
}

/**
 * Cree un sprite depuis une image. Si une taille de frame est fournie,
 * la planche est redecoupee en frames d'animation.
 */
export function spriteFromImage(
  img: HTMLImageElement,
  name: string,
  options: Partial<SheetImportOptions> = {},
): Sprite {
  const opts = { ...DEFAULT_IMPORT, ...options }
  const full = imageToBitmap(img)
  const fw = opts.frameWidth > 0 ? opts.frameWidth : full.width
  const fh = opts.frameHeight > 0 ? opts.frameHeight : full.height

  const cols = Math.max(1, Math.floor((full.width - opts.margin * 2 + opts.padding) / (fw + opts.padding)))
  const rows = Math.max(1, Math.floor((full.height - opts.margin * 2 + opts.padding) / (fh + opts.padding)))

  const cells: Bitmap[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = full.crop({
        x: opts.margin + c * (fw + opts.padding),
        y: opts.margin + r * (fh + opts.padding),
        w: fw,
        h: fh,
      })
      if (opts.skipEmpty && cell.isEmpty()) continue
      cells.push(cell)
    }
  }
  if (!cells.length) cells.push(full)

  const palette = opts.buildPalette
    ? new Palette('Depuis l\'image', quantize(cells, 64))
    : Palette.default()
  const sprite = new Sprite(fw, fh, palette.size ? palette : Palette.default())
  sprite.name = name
  sprite.grid = { x: 0, y: 0, w: fw, h: fh }
  sprite.frameDurations = cells.map(() => 100)

  const layer = new Layer('Image', cells.length)
  layer.cels = cells.map((bm) => ({ bitmap: bm, opacity: 255 }))
  sprite.layers = [layer]
  return sprite
}

/** Ajoute une image comme nouveau calque du sprite courant. */
/**
 * Un CALQUE DE RÉFÉRENCE : une image qu'on garde sous les yeux pour décalquer.
 *
 * ## Pourquoi elle est mise a l'echelle, et pas collee telle quelle
 *
 * Une reference est presque toujours plus grande que le sprite — une photo,
 * un croquis scanne, un dessin trouve ailleurs. Collee au coin superieur
 * gauche comme le fait l'import ordinaire, on n'en voit qu'un morceau de
 * trente-deux pixels : autant dire rien. Elle est donc RAMENEE dans le cadre,
 * proportions gardees, et centree.
 *
 * ## Pourquoi le lissage est autorise ICI, et seulement ici
 *
 * Tout le reste de l'editeur refuse l'interpolation — c'est du pixel art, une
 * couleur inventee entre deux pixels est une faute. Une reference, elle, n'est
 * pas du dessin : elle ne s'exporte pas, elle ne se peint pas, elle sert a
 * l'oeil. Une photo reduite au plus proche voisin devient illisible ; reduite
 * en douceur, elle garde ses formes, et c'est tout ce qu'on lui demande.
 */
export function referenceLayerFromImage(
  sprite: Sprite, img: HTMLImageElement, name: string,
): Layer {
  const l = Math.max(1, img.naturalWidth)
  const h = Math.max(1, img.naturalHeight)
  const facteur = Math.min(sprite.width / l, sprite.height / h)
  const dl = Math.max(1, Math.round(l * facteur))
  const dh = Math.max(1, Math.round(h * facteur))
  const canevas = document.createElement('canvas')
  canevas.width = sprite.width
  canevas.height = sprite.height
  const ctx = canevas.getContext('2d')
  if (ctx) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, Math.floor((sprite.width - dl) / 2), Math.floor((sprite.height - dh) / 2), dl, dh)
  }
  const bitmap = Bitmap.fromImageData(
    ctx?.getImageData(0, 0, sprite.width, sprite.height)
      ?? new ImageData(sprite.width, sprite.height),
  )
  const layer = new Layer(name, sprite.frameCount)
  layer.reference = true
  // A demi transparente : on dessine PAR-DESSUS, et une reference opaque
  // cacherait le trait qu'on est en train de poser.
  layer.opacity = 128
  // La meme image sur toutes les frames : une reference qui disparaitrait a
  // la frame deux ne servirait a rien pour animer.
  for (let f = 0; f < sprite.frameCount; f++) {
    layer.cels[f] = { bitmap: f === 0 ? bitmap : bitmap.clone(), opacity: 255 }
  }
  return layer
}

export function layerFromImage(sprite: Sprite, img: HTMLImageElement, name: string): Layer {
  const bm = imageToBitmap(img)
  const layer = new Layer(name, sprite.frameCount)
  const fitted = new Bitmap(sprite.width, sprite.height)
  fitted.paste(bm, 0, 0)
  layer.cels[0] = { bitmap: fitted, opacity: 255 }
  return layer
}
