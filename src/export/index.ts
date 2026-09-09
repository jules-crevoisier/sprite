import type { Sprite } from '../core/document'
import { compositeFrame, compositeAll } from '../render/composite'
import { buildSpriteSheet, DEFAULT_SHEET_OPTIONS, type SheetOptions, type SheetResult } from './spritesheet'
import { buildAsepriteJson, type JsonFormat } from './json'
import { buildUnityMeta, buildUnityAnimations, unityGuid, DEFAULT_UNITY_OPTIONS, type UnityOptions } from './unity'
import { buildGodotSpriteFrames, buildGodotTileSet } from './godot'
import { encodeGif } from './gif'
import { buildZip, textBytes, type ZipEntry } from './zip'
import { bitmapToPngBlob, bitmapToPngBytes, download, safeName } from './files'

export * from './spritesheet'
export * from './files'
export { buildAsepriteJson } from './json'
export { encodeGif } from './gif'

export type ExportTarget = 'generic' | 'unity' | 'godot'

export interface ExportRequest {
  sheet: Partial<SheetOptions>
  target: ExportTarget
  /** Facteur d'agrandissement au plus proche voisin applique a la planche. */
  scale: number
  jsonFormat: JsonFormat
  unity: Partial<UnityOptions>
  /** Chemin de la texture dans le projet Godot. */
  godotResPath: string
  /** Ajoute une ressource TileSet Godot basee sur la grille. */
  godotTileSet: boolean
}

export const DEFAULT_EXPORT: ExportRequest = {
  sheet: DEFAULT_SHEET_OPTIONS,
  target: 'generic',
  scale: 1,
  jsonFormat: 'hash',
  unity: DEFAULT_UNITY_OPTIONS,
  godotResPath: '',
  godotTileSet: false,
}

/** Exporte la frame courante en PNG. */
export async function exportFramePng(sprite: Sprite, frame: number, scale = 1): Promise<void> {
  const bm = compositeFrame(sprite, frame)
  const blob = await bitmapToPngBlob(bm, scale)
  download(blob, `${safeName(sprite.name)}_${frame}.png`)
}

/** Exporte chaque frame dans un fichier PNG separe, regroupes en archive. */
export async function exportFramesZip(sprite: Sprite, scale = 1): Promise<void> {
  const entries: ZipEntry[] = []
  const frames = compositeAll(sprite)
  for (let i = 0; i < frames.length; i++) {
    const tag = sprite.tagAt(i)
    const name = tag ? `${safeName(tag.name)}/${String(i).padStart(3, '0')}.png` : `${String(i).padStart(3, '0')}.png`
    entries.push({ name, data: await bitmapToPngBytes(frames[i], scale) })
  }
  download(buildZip(entries), `${safeName(sprite.name)}_frames.zip`)
}

/** Exporte l'animation en GIF anime. */
export function exportGif(sprite: Sprite, scale = 1): void {
  let frames = compositeAll(sprite)
  if (scale > 1) frames = frames.map((f) => f.resizeNearest(f.width * scale, f.height * scale))
  const bytes = encodeGif(frames, sprite.frameDurations)
  download(new Blob([bytes as unknown as BlobPart], { type: 'image/gif' }), `${safeName(sprite.name)}.gif`)
}

/** Construit la planche et ses metadonnees sans declencher de telechargement. */
export function buildExport(sprite: Sprite, req: ExportRequest): SheetResult {
  let sheet = buildSpriteSheet(sprite, req.sheet)
  if (req.scale > 1) {
    const scaled = sheet.bitmap.resizeNearest(sheet.bitmap.width * req.scale, sheet.bitmap.height * req.scale)
    sheet = {
      ...sheet,
      bitmap: scaled,
      frames: sheet.frames.map((f) => ({
        ...f,
        frame: {
          x: f.frame.x * req.scale, y: f.frame.y * req.scale,
          w: f.frame.w * req.scale, h: f.frame.h * req.scale,
        },
        sourceSize: { w: f.sourceSize.w * req.scale, h: f.sourceSize.h * req.scale },
      })),
    }
  }
  return sheet
}

/**
 * Exporte une archive prete a deposer dans le projet : la planche PNG plus
 * les fichiers de configuration attendus par le moteur cible.
 */
export async function exportPackage(sprite: Sprite, req: ExportRequest): Promise<{ files: string[] }> {
  const sheet = buildExport(sprite, req)
  const base = safeName(sprite.name)
  const pngName = `${base}.png`
  const entries: ZipEntry[] = [{ name: pngName, data: await bitmapToPngBytes(sheet.bitmap) }]

  if (req.target === 'unity') {
    const guid = unityGuid(`${base}.png`)
    entries.push({ name: `${pngName}.meta`, data: textBytes(buildUnityMeta(sprite, sheet, guid, req.unity)) })
    if (req.unity.generateAnimations ?? true) {
      for (const clip of buildUnityAnimations(sprite, sheet, guid, req.unity)) {
        entries.push({ name: clip.name, data: textBytes(clip.content) })
      }
    }
    entries.push({ name: 'LISEZ-MOI.txt', data: textBytes(UNITY_README(base)) })
  } else if (req.target === 'godot') {
    const resPath = req.godotResPath || `res://${pngName}`
    entries.push({
      name: `${base}_frames.tres`,
      data: textBytes(buildGodotSpriteFrames(sprite, sheet, { resPath })),
    })
    if (req.godotTileSet) {
      entries.push({ name: `${base}_tileset.tres`, data: textBytes(buildGodotTileSet(sprite, resPath)) })
    }
    entries.push({ name: 'LISEZ-MOI.txt', data: textBytes(GODOT_README(base, resPath)) })
  }

  // Le JSON generique accompagne tous les exports : il sert de reference et
  // fonctionne tel quel avec Phaser, PixiJS, LibGDX, Defold, MonoGame...
  entries.push({
    name: `${base}.json`,
    data: textBytes(buildAsepriteJson(sprite, sheet, pngName, req.jsonFormat)),
  })

  download(buildZip(entries), `${base}_${req.target}.zip`)
  return { files: entries.map((e) => e.name) }
}

/** Exporte uniquement la planche PNG. */
export async function exportSheetPng(sprite: Sprite, req: ExportRequest): Promise<void> {
  const sheet = buildExport(sprite, req)
  download(await bitmapToPngBlob(sheet.bitmap), `${safeName(sprite.name)}.png`)
}

const UNITY_README = (base: string) => `Import dans Unity
=================

1. Glissez ${base}.png ET ${base}.png.meta ensemble dans le dossier Assets.
   Le .meta contient déjà le découpage en sprites, le pivot et les réglages
   d'import (Point filter, sans compression) : ne le renommez pas.
2. Les fichiers .anim sont des AnimationClip prets a l'emploi. Glissez-en un
   sur un GameObject possedant un SpriteRenderer pour créer l'Animator, puis
   ajoutez les autres clips dans l'Animator Controller.
3. Si Unity ne montre pas les sprites decoupes, faites un clic droit sur la
   texture puis Reimport.

Le fichier ${base}.json suit le format Aseprite et reste utilisable par des
outils tiers.
`

const GODOT_README = (base: string, resPath: string) => `Import dans Godot 4
===================

1. Copiez ${base}.png et ${base}_frames.très dans votre projet.
   Le .très pointe vers ${resPath} : adaptez le chemin si vous rangez la
   texture ailleurs (ouvrez le .très dans un éditeur de texte).
2. Sélectionnez la texture dans le FileSystem, onglet Import, mettez
   Filter sur Nearest puis Reimport. C'est indispensable pour du pixel art.
3. Ajoutez un AnimatedSprite2D et assignez ${base}_frames.très a sa
   propriété Sprite Frames. Chaque tag d'animation devient une animation.

Les durées par frame sont conservees via le multiplicateur de durée de Godot.
`
