import { Bitmap, type Rect } from './bitmap'
import { compositeBitmap, type BlendMode } from './blend'
import type { RGBA } from './color'
import { Palette } from './palette'
import { emptyRig, type Rig } from '../smart/rig'

let nextId = 1
export const genId = (): number => nextId++
export const seedIds = (from: number): void => { nextId = Math.max(nextId, from + 1) }

/** Une case de la timeline : le contenu d'un calque sur une frame donnee. */
export interface Cel {
  bitmap: Bitmap
  /** 0..255, multiplie l'opacite du calque. */
  opacity: number
}

export type AnimDirection = 'forward' | 'reverse' | 'pingpong' | 'pingpong-reverse'

/** Marque une plage de frames comme une animation nommee (idle, run, hit...). */
export interface Tag {
  id: number
  name: string
  from: number
  to: number
  direction: AnimDirection
  /** 0 = boucle infinie. */
  repeat: number
  color: RGBA
}

/** Zone nommee : point de pivot, hitbox, decoupe 9-slice pour l'UI. */
export interface Slice {
  id: number
  name: string
  bounds: Rect
  /** Pivot relatif au coin haut-gauche de `bounds`, ou null. */
  pivot: { x: number; y: number } | null
  /** Zone centrale du 9-slice, relative a `bounds`, ou null. */
  center: Rect | null
  color: RGBA
}

export class Layer {
  id = genId()
  name: string
  visible = true
  locked = false
  /** Exclu de l'export final : calques de reference, guides, notes. */
  reference = false
  opacity = 255
  blendMode: BlendMode = 'normal'
  /** Une case par frame ; null = case vide. */
  cels: (Cel | null)[] = []

  constructor(name: string, frameCount = 1) {
    this.name = name
    this.cels = new Array(frameCount).fill(null)
  }
}

export class Sprite {
  name = 'sans-titre'
  width: number
  height: number
  layers: Layer[] = []
  /** Duree de chaque frame en millisecondes. */
  frameDurations: number[] = []
  tags: Tag[] = []
  slices: Slice[] = []
  palette: Palette
  /** Grille d'aide, aussi utilisee comme taille de tuile par defaut a l'export. */
  grid = { x: 0, y: 0, w: 16, h: 16 }
  /** Origine du sprite, exportee vers Unity/Godot comme pivot par defaut. */
  pivot = { x: 0.5, y: 0.5 }
  /** Squelette optionnel, pour poser le dessin plutot que le redessiner. */
  rig: Rig = emptyRig()

  constructor(width = 32, height = 32, palette?: Palette) {
    this.width = width
    this.height = height
    this.palette = palette ?? Palette.default()
    this.frameDurations = [100]
    const layer = new Layer('Calque 1', 1)
    layer.cels[0] = this.makeCel()
    this.layers.push(layer)
  }

  get frameCount(): number { return this.frameDurations.length }
  get bounds(): Rect { return { x: 0, y: 0, w: this.width, h: this.height } }

  makeCel(bitmap?: Bitmap): Cel {
    return { bitmap: bitmap ?? new Bitmap(this.width, this.height), opacity: 255 }
  }

  layerIndex(layer: Layer): number { return this.layers.indexOf(layer) }

  cel(layerIdx: number, frame: number): Cel | null {
    return this.layers[layerIdx]?.cels[frame] ?? null
  }

  /** Retourne la case existante ou en cree une vide. */
  ensureCel(layerIdx: number, frame: number): Cel {
    const layer = this.layers[layerIdx]
    let c = layer.cels[frame]
    if (!c) { c = this.makeCel(); layer.cels[frame] = c }
    return c
  }

  /* ---------------------------------------------------------------- */
  /* Calques                                                           */
  /* ---------------------------------------------------------------- */

  addLayer(name?: string, at?: number): Layer {
    const layer = new Layer(name ?? `Calque ${this.layers.length + 1}`, this.frameCount)
    const idx = at ?? this.layers.length
    this.layers.splice(idx, 0, layer)
    return layer
  }

  duplicateLayer(idx: number): Layer {
    const src = this.layers[idx]
    const copy = new Layer(`${src.name} copie`, this.frameCount)
    copy.visible = src.visible
    copy.opacity = src.opacity
    copy.blendMode = src.blendMode
    copy.cels = src.cels.map((c) => (c ? { bitmap: c.bitmap.clone(), opacity: c.opacity } : null))
    this.layers.splice(idx + 1, 0, copy)
    return copy
  }

  removeLayer(idx: number): void {
    if (this.layers.length <= 1) return
    this.layers.splice(idx, 1)
  }

  /** Fusionne le calque `idx` dans celui juste en dessous. */
  mergeDown(idx: number): boolean {
    if (idx <= 0 || idx >= this.layers.length) return false
    const top = this.layers[idx]
    const bottom = this.layers[idx - 1]
    for (let f = 0; f < this.frameCount; f++) {
      const tc = top.cels[f]
      if (!tc) continue
      const merged = new Bitmap(this.width, this.height)
      const bc = bottom.cels[f]
      if (bc) {
        compositeBitmap(merged, bc.bitmap, bottom.blendMode, (bottom.opacity * bc.opacity) / 255)
      }
      compositeBitmap(merged, tc.bitmap, top.blendMode, (top.opacity * tc.opacity) / 255)
      bottom.cels[f] = { bitmap: merged, opacity: 255 }
    }
    bottom.blendMode = 'normal'
    bottom.opacity = 255
    this.layers.splice(idx, 1)
    return true
  }

  /* ---------------------------------------------------------------- */
  /* Frames                                                            */
  /* ---------------------------------------------------------------- */

  addFrame(at?: number, duration?: number): number {
    const idx = at ?? this.frameCount
    this.frameDurations.splice(idx, 0, duration ?? this.frameDurations[Math.max(0, idx - 1)] ?? 100)
    for (const l of this.layers) l.cels.splice(idx, 0, null)
    this.shiftTagsForInsert(idx)
    return idx
  }

  duplicateFrame(src: number, at?: number): number {
    const idx = at ?? src + 1
    this.frameDurations.splice(idx, 0, this.frameDurations[src])
    for (const l of this.layers) {
      const c = l.cels[src]
      l.cels.splice(idx, 0, c ? { bitmap: c.bitmap.clone(), opacity: c.opacity } : null)
    }
    this.shiftTagsForInsert(idx)
    return idx
  }

  removeFrame(idx: number): boolean {
    if (this.frameCount <= 1) return false
    this.frameDurations.splice(idx, 1)
    for (const l of this.layers) l.cels.splice(idx, 1)
    this.tags = this.tags
      .map((t) => ({
        ...t,
        from: t.from > idx ? t.from - 1 : t.from,
        to: t.to >= idx ? t.to - 1 : t.to,
      }))
      .filter((t) => t.to >= t.from)
    return true
  }

  moveFrame(from: number, to: number): void {
    if (from === to) return
    const [dur] = this.frameDurations.splice(from, 1)
    this.frameDurations.splice(to, 0, dur)
    for (const l of this.layers) {
      const [c] = l.cels.splice(from, 1)
      l.cels.splice(to, 0, c)
    }
  }

  private shiftTagsForInsert(idx: number): void {
    for (const t of this.tags) {
      if (t.from >= idx) t.from++
      if (t.to >= idx) t.to++
    }
  }

  /* ---------------------------------------------------------------- */
  /* Geometrie                                                         */
  /* ---------------------------------------------------------------- */

  /** Redimensionne la toile sans redimensionner le contenu. */
  resizeCanvas(w: number, h: number, offsetX: number, offsetY: number): void {
    for (const l of this.layers) {
      l.cels = l.cels.map((c) => {
        if (!c) return null
        const nb = new Bitmap(w, h)
        nb.paste(c.bitmap, offsetX, offsetY)
        return { ...c, bitmap: nb }
      })
    }
    this.width = w
    this.height = h
  }

  /** Redimensionne le sprite et son contenu. */
  scale(w: number, h: number, smooth = false): void {
    for (const l of this.layers) {
      l.cels = l.cels.map((c) =>
        c ? { ...c, bitmap: smooth ? c.bitmap.resizeSmooth(w, h) : c.bitmap.resizeNearest(w, h) } : null,
      )
    }
    this.width = w
    this.height = h
  }

  /** Rogne la toile sur la boite englobante de tous les pixels opaques. */
  trimBounds(): Rect {
    let box: Rect = { x: this.width, y: this.height, w: 0, h: 0 }
    let found = false
    for (const l of this.layers) {
      if (!l.visible) continue
      for (const c of l.cels) {
        if (!c) continue
        const b = c.bitmap.trimBounds()
        if (b.w === 0) continue
        if (!found) { box = b; found = true } else {
          const x = Math.min(box.x, b.x), y = Math.min(box.y, b.y)
          box = {
            x, y,
            w: Math.max(box.x + box.w, b.x + b.w) - x,
            h: Math.max(box.y + box.h, b.y + b.h) - y,
          }
        }
      }
    }
    return found ? box : { x: 0, y: 0, w: this.width, h: this.height }
  }

  tagAt(frame: number): Tag | null {
    return this.tags.find((t) => frame >= t.from && frame <= t.to) ?? null
  }

  totalDuration(from = 0, to = this.frameCount - 1): number {
    let d = 0
    for (let i = from; i <= to; i++) d += this.frameDurations[i] ?? 0
    return d
  }
}
