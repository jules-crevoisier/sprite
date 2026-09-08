import { Bitmap, type Rect } from './bitmap'
import type { Cel, Layer, Sprite, Slice, Tag } from './document'
import type { BlendMode } from './blend'

export interface Command {
  label: string
  undo(): void
  redo(): void
}

/** Pile d'annulation lineaire : tout nouvel ajout supprime la branche redo. */
export class History {
  private entries: Command[] = []
  private index = -1
  private limit: number
  private listeners = new Set<() => void>()
  /** Incremente a chaque mutation : sert de cle de cache pour le rendu. */
  version = 0

  constructor(limit = 200) { this.limit = limit }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void { this.version++; for (const l of this.listeners) l() }

  get canUndo(): boolean { return this.index >= 0 }
  get canRedo(): boolean { return this.index < this.entries.length - 1 }
  get undoLabel(): string | null { return this.canUndo ? this.entries[this.index].label : null }
  get redoLabel(): string | null { return this.canRedo ? this.entries[this.index + 1].label : null }
  get depth(): number { return this.entries.length }

  /** Enregistre une commande deja appliquee. */
  push(cmd: Command): void {
    this.entries.splice(this.index + 1)
    this.entries.push(cmd)
    if (this.entries.length > this.limit) this.entries.shift()
    this.index = this.entries.length - 1
    this.emit()
  }

  undo(): string | null {
    if (!this.canUndo) return null
    const c = this.entries[this.index--]
    c.undo()
    this.emit()
    return c.label
  }

  redo(): string | null {
    if (!this.canRedo) return null
    const c = this.entries[++this.index]
    c.redo()
    this.emit()
    return c.label
  }

  /** Signale une mutation faite hors commande (rendu a rafraichir). */
  touch(): void { this.emit() }

  clear(): void { this.entries = []; this.index = -1; this.emit() }
}

/* ------------------------------------------------------------------ */
/* Diff de pixels                                                      */
/* ------------------------------------------------------------------ */

interface CelPatch { cel: Cel; region: Rect; before: Bitmap; after: Bitmap }

/** Rectangle englobant les pixels qui different entre deux bitmaps de meme taille. */
export function diffRect(a: Bitmap, b: Bitmap): Rect {
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1
  for (let y = 0; y < a.height; y++) {
    const row = y * a.width
    for (let x = 0; x < a.width; x++) {
      if (a.u32[row + x] !== b.u32[row + x]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * Construit une commande ne stockant que la zone reellement modifiee de
 * chaque case, ce qui garde l'historique leger meme sur de gros sprites.
 */
export function celDiffCommand(
  label: string,
  edits: { cel: Cel; before: Bitmap }[],
): Command | null {
  const patches: CelPatch[] = []
  for (const { cel, before } of edits) {
    const region = diffRect(before, cel.bitmap)
    if (region.w === 0) continue
    patches.push({
      cel,
      region,
      before: before.crop(region),
      after: cel.bitmap.crop(region),
    })
  }
  if (patches.length === 0) return null
  return {
    label,
    undo() { for (const p of patches) p.cel.bitmap.paste(p.before, p.region.x, p.region.y) },
    redo() { for (const p of patches) p.cel.bitmap.paste(p.after, p.region.x, p.region.y) },
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot de structure                                               */
/* ------------------------------------------------------------------ */

interface LayerSnapshot {
  layer: Layer
  name: string
  visible: boolean
  locked: boolean
  reference: boolean
  opacity: number
  blendMode: BlendMode
  cels: (Cel | null)[]
}

export interface StructureSnapshot {
  width: number
  height: number
  layers: LayerSnapshot[]
  order: Layer[]
  frameDurations: number[]
  tags: Tag[]
  slices: Slice[]
  paletteColors: number[]
  paletteName: string
}

/**
 * Copie la structure du sprite (calques, frames, tags, palette) sans dupliquer
 * les pixels : les bitmaps sont partages par reference, ce qui rend le
 * snapshot quasi gratuit. Les operations qui modifient des pixels creent de
 * nouveaux bitmaps, donc l'ancien reste valide.
 */
export function snapshotStructure(sprite: Sprite): StructureSnapshot {
  return {
    width: sprite.width,
    height: sprite.height,
    order: [...sprite.layers],
    layers: sprite.layers.map((l) => ({
      layer: l,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      reference: l.reference,
      opacity: l.opacity,
      blendMode: l.blendMode,
      cels: [...l.cels],
    })),
    frameDurations: [...sprite.frameDurations],
    tags: sprite.tags.map((t) => ({ ...t })),
    slices: sprite.slices.map((s) => ({ ...s, bounds: { ...s.bounds } })),
    paletteColors: [...sprite.palette.colors],
    paletteName: sprite.palette.name,
  }
}

export function restoreStructure(sprite: Sprite, snap: StructureSnapshot): void {
  sprite.width = snap.width
  sprite.height = snap.height
  sprite.layers = [...snap.order]
  for (const ls of snap.layers) {
    ls.layer.name = ls.name
    ls.layer.visible = ls.visible
    ls.layer.locked = ls.locked
    ls.layer.reference = ls.reference
    ls.layer.opacity = ls.opacity
    ls.layer.blendMode = ls.blendMode
    ls.layer.cels = [...ls.cels]
  }
  sprite.frameDurations = [...snap.frameDurations]
  sprite.tags = snap.tags.map((t) => ({ ...t }))
  sprite.slices = snap.slices.map((s) => ({ ...s, bounds: { ...s.bounds } }))
  sprite.palette.colors = [...snap.paletteColors]
  sprite.palette.name = snap.paletteName
}

/**
 * Enveloppe une operation structurelle : capture avant, execute, capture apres.
 * Retourne la commande a empiler (ou null si rien n'a change).
 */
export function structureCommand(
  sprite: Sprite,
  label: string,
  apply: () => void,
): Command {
  const before = snapshotStructure(sprite)
  apply()
  const after = snapshotStructure(sprite)
  return {
    label,
    undo() { restoreStructure(sprite, before) },
    redo() { restoreStructure(sprite, after) },
  }
}

export function compositeCommand(label: string, cmds: Command[]): Command {
  return {
    label,
    undo() { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo() },
    redo() { for (const c of cmds) c.redo() },
  }
}
