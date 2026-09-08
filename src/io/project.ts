import { Bitmap } from '../core/bitmap'
import { fromHex, toHex } from '../core/color'
import { Sprite, Layer, genId, seedIds, type Slice, type Tag } from '../core/document'
import { Palette } from '../core/palette'
import type { BlendMode } from '../core/blend'

export const PROJECT_EXT = 'pixelforge'
const FORMAT = 'pixelforge'
const VERSION = 1

interface CelJson { opacity: number; png: string }
interface LayerJson {
  name: string
  visible: boolean
  locked: boolean
  reference: boolean
  opacity: number
  blendMode: BlendMode
  cels: (CelJson | null)[]
}
interface ProjectJson {
  format: string
  version: number
  name: string
  width: number
  height: number
  grid: { x: number; y: number; w: number; h: number }
  pivot: { x: number; y: number }
  frameDurations: number[]
  palette: { name: string; colors: string[] }
  tags: (Omit<Tag, 'color'> & { color: string })[]
  slices: (Omit<Slice, 'color'> & { color: string })[]
  layers: LayerJson[]
}

/** Serialise le sprite. Les pixels sont stockes en PNG base64, donc compresses. */
export function serializeSprite(sprite: Sprite): string {
  const data: ProjectJson = {
    format: FORMAT,
    version: VERSION,
    name: sprite.name,
    width: sprite.width,
    height: sprite.height,
    grid: { ...sprite.grid },
    pivot: { ...sprite.pivot },
    frameDurations: [...sprite.frameDurations],
    palette: { name: sprite.palette.name, colors: sprite.palette.toHexList() },
    tags: sprite.tags.map((t) => ({ ...t, color: toHex(t.color) })),
    slices: sprite.slices.map((s) => ({ ...s, color: toHex(s.color) })),
    layers: sprite.layers.map((l) => ({
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      reference: l.reference,
      opacity: l.opacity,
      blendMode: l.blendMode,
      cels: l.cels.map((c) =>
        c && !c.bitmap.isEmpty()
          ? { opacity: c.opacity, png: c.bitmap.toCanvas().toDataURL('image/png') }
          : null,
      ),
    })),
  }
  return JSON.stringify(data)
}

function decodePng(dataUrl: string, w: number, h: number): Promise<Bitmap> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0)
      resolve(Bitmap.fromImageData(ctx.getImageData(0, 0, w, h)))
    }
    img.onerror = () => reject(new Error('Case illisible dans le projet'))
    img.src = dataUrl
  })
}

export async function deserializeSprite(json: string): Promise<Sprite> {
  const data = JSON.parse(json) as ProjectJson
  if (data.format !== FORMAT) throw new Error('Format de projet inconnu')

  const palette = new Palette(data.palette?.name ?? 'Palette', (data.palette?.colors ?? []).map(fromHex))
  const sprite = new Sprite(data.width, data.height, palette)
  sprite.name = data.name
  sprite.grid = { ...sprite.grid, ...data.grid }
  sprite.pivot = { ...sprite.pivot, ...data.pivot }
  sprite.frameDurations = [...data.frameDurations]
  sprite.tags = (data.tags ?? []).map((t) => ({ ...t, id: genId(), color: fromHex(t.color) }))
  sprite.slices = (data.slices ?? []).map((s) => ({ ...s, id: genId(), color: fromHex(s.color) }))

  sprite.layers = []
  for (const lj of data.layers) {
    const layer = new Layer(lj.name, data.frameDurations.length)
    layer.visible = lj.visible
    layer.locked = lj.locked
    layer.reference = lj.reference ?? false
    layer.opacity = lj.opacity
    layer.blendMode = lj.blendMode
    layer.cels = await Promise.all(
      lj.cels.map(async (cj) =>
        cj ? { opacity: cj.opacity, bitmap: await decodePng(cj.png, data.width, data.height) } : null,
      ),
    )
    sprite.layers.push(layer)
  }
  if (!sprite.layers.length) sprite.layers.push(new Layer('Calque 1', sprite.frameCount))
  seedIds(Date.now() % 100000)
  return sprite
}

/* ------------------------------------------------------------------ */
/* Sauvegarde automatique                                              */
/* ------------------------------------------------------------------ */

const AUTOSAVE_KEY = 'pixelforge.autosave.v1'

/** Enregistre le travail en cours localement. Silencieux si le quota explose. */
export function autosave(sprite: Sprite): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeSprite(sprite))
    localStorage.setItem(`${AUTOSAVE_KEY}.at`, String(Date.now()))
    return true
  } catch {
    return false
  }
}

export function hasAutosave(): boolean {
  return localStorage.getItem(AUTOSAVE_KEY) !== null
}

export function autosaveDate(): Date | null {
  const at = localStorage.getItem(`${AUTOSAVE_KEY}.at`)
  return at ? new Date(Number(at)) : null
}

export async function loadAutosave(): Promise<Sprite | null> {
  const raw = localStorage.getItem(AUTOSAVE_KEY)
  if (!raw) return null
  try {
    return await deserializeSprite(raw)
  } catch {
    return null
  }
}

export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY)
  localStorage.removeItem(`${AUTOSAVE_KEY}.at`)
}
