import { Bitmap } from '../../core/bitmap'
import { Sprite, Layer } from '../../core/document'
import { Palette, quantize } from '../../core/palette'
import { loadImageBitmap } from '../../export/files'
import { imageToBitmap, spriteFromImage } from '../import'
import { deserializeSprite, PROJECT_EXT } from '../project'
import { decoderGif, estUnGif } from './gif'
import { estUnAseprite, lireAseprite } from './aseprite'
import { lirePalette, type PaletteLue } from './palettes'

/**
 * Une porte d'entree unique pour tous les fichiers.
 *
 * Chaque logiciel de pixel art a son format, et personne ne commence un projet
 * sur une page blanche : on arrive avec un .aseprite, une planche PNG, un GIF
 * trouve quelque part, une palette prise sur lospec. Tant que ces fichiers ne
 * s'ouvrent pas, l'application demande de tout recommencer — ce qu'aucun
 * argument ne rattrape.
 *
 * On reconnait le contenu et non l'extension : un `.pal` est tantot du texte
 * tantot du binaire, un `.ase` est tantot un fichier Aseprite tantot un
 * nuancier Adobe, et un fichier renomme reste ce qu'il est.
 */

export type ResultatOuverture =
  | { genre: 'sprite'; sprite: Sprite; message: string }
  | { genre: 'palette'; palette: PaletteLue; message: string }

/** Extensions proposees dans les selecteurs de fichiers. */
export const EXTENSIONS_OUVERTURE = [
  `.${PROJECT_EXT}`, '.aseprite', '.ase', '.gif', '.piskel',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp',
  '.gpl', '.pal', '.act', '.hex', '.txt', '.json',
].join(',')

const EXT_PALETTE = new Set(['gpl', 'pal', 'act', 'hex'])

/** Sprite construit a partir d'un GIF, une frame par image. */
export function spriteDepuisGif(octets: Uint8Array, nom: string): Sprite {
  const gif = decoderGif(octets)
  const sprite = new Sprite(gif.largeur, gif.hauteur)
  sprite.name = nom
  const calque = new Layer('Animation', gif.images.length)
  for (let i = 0; i < gif.images.length; i++) {
    calque.cels[i] = { bitmap: gif.images[i].bitmap, opacity: 255 }
  }
  sprite.layers = [calque]
  sprite.frameDurations = gif.images.map((im) => im.delaiMs)
  // La table du GIF est deja une palette d'artiste : on la garde telle quelle
  // plutot que de la recalculer, et on ne quantifie que si elle deborde.
  const utiles = gif.couleurs.filter((c) => (c >>> 24) !== 0)
  sprite.palette = utiles.length && utiles.length <= 256
    ? new Palette('Depuis le GIF', utiles)
    : new Palette('Depuis le GIF', quantize(gif.images.map((im) => im.bitmap), 64))
  return sprite
}

/**
 * Lit un `.piskel`.
 *
 * Le fichier est du JSON dont chaque calque est lui-meme du JSON encode en
 * chaine — une bizarrerie du format, pas une erreur de lecture. Les images
 * d'un calque sont rangees dans une bande PNG horizontale, et `layout` dit
 * quelle case de la bande va sur quelle frame.
 */
export async function spriteDepuisPiskel(texte: string, nom: string): Promise<Sprite> {
  const brut = JSON.parse(texte) as {
    piskel?: { name?: string; fps?: number; width?: number; height?: number; layers?: string[] }
  }
  const p = brut.piskel
  if (!p?.width || !p?.height || !Array.isArray(p.layers)) {
    throw new Error('Fichier Piskel illisible')
  }
  const sprite = new Sprite(p.width, p.height)
  sprite.name = p.name?.trim() || nom
  sprite.layers = []
  let frames = 1

  for (const brutCalque of p.layers) {
    const donnees = JSON.parse(brutCalque) as {
      name?: string
      opacity?: number
      frameCount?: number
      chunks?: { layout: number[][]; base64PNG: string }[]
    }
    const nbFrames = Math.max(1, donnees.frameCount ?? 1)
    frames = Math.max(frames, nbFrames)
    const calque = new Layer(donnees.name || `Calque ${sprite.layers.length + 1}`, nbFrames)
    calque.opacity = Math.round(Math.min(1, Math.max(0, donnees.opacity ?? 1)) * 255)

    for (const morceau of donnees.chunks ?? []) {
      const image = await loadImageBitmap(await (await fetch(morceau.base64PNG)).blob())
      const bande = imageToBitmap(image)
      morceau.layout.forEach((cases, position) => {
        const case_ = bande.crop({ x: position * p.width!, y: 0, w: p.width!, h: p.height! })
        for (const frame of cases) {
          const copie = new Bitmap(p.width!, p.height!)
          copie.paste(case_, 0, 0)
          calque.cels[frame] = { bitmap: copie, opacity: 255 }
        }
      })
    }
    sprite.layers.push(calque)
  }

  // Piskel dit une cadence, pas une duree par image.
  const duree = Math.max(1, Math.round(1000 / (p.fps || 12)))
  sprite.frameDurations = new Array(frames).fill(duree)
  for (const l of sprite.layers) {
    for (let f = 0; f < frames; f++) if (l.cels[f] === undefined) l.cels[f] = null
  }
  if (!sprite.layers.length) sprite.layers.push(new Layer('Calque 1', frames))
  return sprite
}

/** Ouvre n'importe lequel des formats connus, en regardant son contenu. */
export async function ouvrirFichier(fichier: File): Promise<ResultatOuverture> {
  const nom = fichier.name
  const base = nom.replace(/\.[^.]+$/, '') || 'sans-titre'
  const ext = (/\.([^.]+)$/.exec(nom)?.[1] ?? '').toLowerCase()

  if (ext === PROJECT_EXT) {
    return { genre: 'sprite', sprite: await deserializeSprite(await fichier.text()), message: 'Projet ouvert' }
  }

  const octets = new Uint8Array(await fichier.arrayBuffer())

  if (estUnAseprite(octets)) {
    const sprite = await lireAseprite(octets, base)
    return {
      genre: 'sprite',
      sprite,
      message: `${sprite.layers.length} calque(s), ${sprite.frameCount} frame(s) importés d'Aseprite`,
    }
  }

  if (estUnGif(octets)) {
    const sprite = spriteDepuisGif(octets, base)
    return { genre: 'sprite', sprite, message: `GIF importé — ${sprite.frameCount} frame(s)` }
  }

  if (ext === 'piskel') {
    const sprite = await spriteDepuisPiskel(new TextDecoder().decode(octets), base)
    return { genre: 'sprite', sprite, message: `Piskel importé — ${sprite.frameCount} frame(s)` }
  }

  if (EXT_PALETTE.has(ext) || ext === 'txt') {
    const palette = lirePalette(nom, octets)
    if (palette.couleurs.length) {
      return { genre: 'palette', palette, message: `Palette « ${palette.nom} » — ${palette.couleurs.length} couleurs` }
    }
  }

  if (ext === 'json') {
    const texte = new TextDecoder().decode(octets)
    // Un JSON peut etre un projet exporte, ou une palette lospec.
    try {
      return { genre: 'sprite', sprite: await deserializeSprite(texte), message: 'Projet ouvert' }
    } catch { /* pas un projet */ }
    const palette = lirePalette(nom, octets)
    if (palette.couleurs.length) {
      return { genre: 'palette', palette, message: `Palette « ${palette.nom} » — ${palette.couleurs.length} couleurs` }
    }
    throw new Error('JSON non reconnu')
  }

  if (fichier.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
    const sprite = spriteFromImage(await loadImageBitmap(fichier), base)
    return { genre: 'sprite', sprite, message: 'Image importée' }
  }

  throw new Error(`Format inconnu : ${ext || nom}`)
}
