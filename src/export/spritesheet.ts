import { Bitmap, type Rect } from '../core/bitmap'
import type { Sprite, Tag } from '../core/document'
import { compositeFrame } from '../render/composite'

export type SheetLayout = 'horizontal' | 'vertical' | 'grid' | 'packed' | 'by-tag'

export interface SheetOptions {
  layout: SheetLayout
  /** Nombre de colonnes pour la disposition en grille. */
  columns: number
  /** Espace transparent entre deux frames. */
  padding: number
  /** Marge autour de la planche entiere. */
  margin: number
  /**
   * Duplique les pixels de bord de chaque frame vers l'exterieur.
   * Indispensable pour eviter le bleeding des tuiles avec filtrage bilineaire.
   */
  extrude: number
  /** Rogne chaque frame sur ses pixels opaques. */
  trim: boolean
  /** Force des dimensions en puissance de deux (contrainte de certains moteurs). */
  powerOfTwo: boolean
  /** Rend la planche carree. */
  forceSquare: boolean
  /** N'exporte que les frames de ces tags (vide = tout). */
  tagFilter: string[]
  /** Exporte chaque calque separement au lieu de l'aplat. */
  splitLayers: boolean
}

export const DEFAULT_SHEET_OPTIONS: SheetOptions = {
  layout: 'horizontal',
  columns: 8,
  padding: 0,
  margin: 0,
  extrude: 0,
  trim: false,
  powerOfTwo: false,
  forceSquare: false,
  tagFilter: [],
  splitLayers: false,
}

export interface FrameMeta {
  /** Index de la frame dans le sprite source. */
  index: number
  name: string
  /** Position et taille dans la planche (hors extrusion). */
  frame: Rect
  /** Decalage du contenu rogne dans la frame d'origine. */
  spriteSourceSize: Rect
  /** Taille de la frame d'origine, avant rognage. */
  sourceSize: { w: number; h: number }
  trimmed: boolean
  duration: number
  tag: string | null
  layer: string | null
  pivot: { x: number; y: number }
}

export interface SheetResult {
  bitmap: Bitmap
  frames: FrameMeta[]
  tags: Tag[]
  columns: number
  rows: number
}

interface Cell { bitmap: Bitmap; meta: Omit<FrameMeta, 'frame'> }

/** Frames retenues apres filtrage par tag. */
function selectedFrames(sprite: Sprite, opts: SheetOptions): number[] {
  if (!opts.tagFilter.length) {
    return Array.from({ length: sprite.frameCount }, (_, i) => i)
  }
  const set = new Set<number>()
  for (const name of opts.tagFilter) {
    const tag = sprite.tags.find((t) => t.name === name)
    if (!tag) continue
    for (let f = tag.from; f <= tag.to; f++) set.add(f)
  }
  return [...set].sort((a, b) => a - b)
}

function buildCells(sprite: Sprite, opts: SheetOptions): Cell[] {
  const frames = selectedFrames(sprite, opts)
  const cells: Cell[] = []

  const push = (index: number, full: Bitmap, layerName: string | null) => {
    const tag = sprite.tagAt(index)
    let bitmap = full
    let source: Rect = { x: 0, y: 0, w: sprite.width, h: sprite.height }
    let trimmed = false
    if (opts.trim) {
      const b = full.trimBounds()
      if (b.w > 0) {
        bitmap = full.crop(b)
        source = b
        trimmed = b.w !== sprite.width || b.h !== sprite.height
      } else {
        // Frame entierement vide : on garde 1x1 pour ne pas casser les index.
        bitmap = new Bitmap(1, 1)
        source = { x: 0, y: 0, w: 1, h: 1 }
        trimmed = true
      }
    }
    const base = layerName ? `${sprite.name}_${layerName}` : sprite.name
    cells.push({
      bitmap,
      meta: {
        index,
        name: `${base} ${index}`,
        spriteSourceSize: source,
        sourceSize: { w: sprite.width, h: sprite.height },
        trimmed,
        duration: sprite.frameDurations[index] ?? 100,
        tag: tag?.name ?? null,
        layer: layerName,
        pivot: { ...sprite.pivot },
      },
    })
  }

  if (opts.splitLayers) {
    for (let li = 0; li < sprite.layers.length; li++) {
      const layer = sprite.layers[li]
      if (!layer.visible || layer.reference) continue
      for (const f of frames) push(f, compositeFrame(sprite, f, { onlyLayer: li }), layer.name)
    }
  } else {
    for (const f of frames) push(f, compositeFrame(sprite, f), null)
  }
  return cells
}

/** Empaquetage par arbre binaire : compact et deterministe. */
function packBinary(sizes: { w: number; h: number }[]): { positions: { x: number; y: number }[]; w: number; h: number } {
  interface Node { x: number; y: number; w: number; h: number; used?: boolean; down?: Node; right?: Node }
  const order = sizes.map((s, i) => ({ i, ...s })).sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h))
  const positions = new Array<{ x: number; y: number }>(sizes.length)
  if (!order.length) return { positions, w: 1, h: 1 }
  let root: Node = { x: 0, y: 0, w: order[0].w, h: order[0].h }

  const find = (node: Node, w: number, h: number): Node | null => {
    if (node.used) return find(node.right!, w, h) ?? find(node.down!, w, h)
    if (w <= node.w && h <= node.h) return node
    return null
  }
  const split = (node: Node, w: number, h: number): Node => {
    node.used = true
    node.down = { x: node.x, y: node.y + h, w: node.w, h: node.h - h }
    node.right = { x: node.x + w, y: node.y, w: node.w - w, h }
    return node
  }
  const grow = (w: number, h: number): Node | null => {
    const canDown = w <= root.w
    const canRight = h <= root.h
    // On fait croitre l'atlas dans la direction qui le garde le plus carre.
    const shouldRight = canRight && root.h >= root.w + w
    const shouldDown = canDown && root.w >= root.h + h
    if (shouldRight) return growRight(w, h)
    if (shouldDown) return growDown(w, h)
    if (canRight) return growRight(w, h)
    if (canDown) return growDown(w, h)
    return null
  }
  const growRight = (w: number, h: number): Node | null => {
    root = { x: 0, y: 0, w: root.w + w, h: root.h, used: true, down: root, right: { x: root.w, y: 0, w, h: root.h } }
    const node = find(root, w, h)
    return node ? split(node, w, h) : null
  }
  const growDown = (w: number, h: number): Node | null => {
    root = { x: 0, y: 0, w: root.w, h: root.h + h, used: true, down: { x: 0, y: root.h, w: root.w, h }, right: root }
    const node = find(root, w, h)
    return node ? split(node, w, h) : null
  }

  for (const item of order) {
    const node = find(root, item.w, item.h)
    const placed = node ? split(node, item.w, item.h) : grow(item.w, item.h)
    positions[item.i] = placed ? { x: placed.x, y: placed.y } : { x: 0, y: 0 }
  }
  return { positions, w: root.w, h: root.h }
}

const nextPot = (n: number): number => {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** Assemble la planche de sprites et ses metadonnees. */
export function buildSpriteSheet(sprite: Sprite, options: Partial<SheetOptions> = {}): SheetResult {
  const opts: SheetOptions = { ...DEFAULT_SHEET_OPTIONS, ...options }
  const cells = buildCells(sprite, opts)
  if (!cells.length) {
    return { bitmap: new Bitmap(1, 1), frames: [], tags: [], columns: 0, rows: 0 }
  }

  const pad = Math.max(0, opts.padding)
  const ext = Math.max(0, opts.extrude)
  const step = pad + ext * 2
  const positions: { x: number; y: number }[] = []
  let sheetW = 0, sheetH = 0
  let columns = 0, rows = 0

  if (opts.layout === 'packed') {
    const sizes = cells.map((c) => ({ w: c.bitmap.width + step, h: c.bitmap.height + step }))
    const packed = packBinary(sizes)
    for (const p of packed.positions) positions.push({ x: p.x + ext, y: p.y + ext })
    sheetW = packed.w
    sheetH = packed.h
    columns = cells.length
    rows = 1
  } else {
    // Dispositions regulieres : toutes les cellules occupent la meme case.
    const cellW = Math.max(...cells.map((c) => c.bitmap.width))
    const cellH = Math.max(...cells.map((c) => c.bitmap.height))
    if (opts.layout === 'horizontal') columns = cells.length
    else if (opts.layout === 'vertical') columns = 1
    else if (opts.layout === 'by-tag') {
      // Une ligne par tag : la plus longue animation fixe le nombre de colonnes.
      const counts = new Map<string, number>()
      for (const c of cells) {
        const k = c.meta.tag ?? '(sans tag)'
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      columns = Math.max(1, ...counts.values())
    } else columns = Math.max(1, opts.columns)

    if (opts.layout === 'by-tag') {
      const rowOf = new Map<string, number>()
      const colOf = new Map<string, number>()
      for (const c of cells) {
        const k = c.meta.tag ?? '(sans tag)'
        if (!rowOf.has(k)) rowOf.set(k, rowOf.size)
        const col = colOf.get(k) ?? 0
        colOf.set(k, col + 1)
        positions.push({ x: col * (cellW + step) + ext, y: rowOf.get(k)! * (cellH + step) + ext })
      }
      rows = rowOf.size
    } else {
      rows = Math.ceil(cells.length / columns)
      for (let i = 0; i < cells.length; i++) {
        positions.push({
          x: (i % columns) * (cellW + step) + ext,
          y: Math.floor(i / columns) * (cellH + step) + ext,
        })
      }
    }
    sheetW = columns * (cellW + step) - pad
    sheetH = rows * (cellH + step) - pad
  }

  sheetW += opts.margin * 2
  sheetH += opts.margin * 2
  if (opts.powerOfTwo) { sheetW = nextPot(sheetW); sheetH = nextPot(sheetH) }
  if (opts.forceSquare) { const s = Math.max(sheetW, sheetH); sheetW = s; sheetH = s }

  const sheet = new Bitmap(Math.max(1, sheetW), Math.max(1, sheetH))
  const frames: FrameMeta[] = []

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const x = positions[i].x + opts.margin
    const y = positions[i].y + opts.margin
    sheet.paste(cell.bitmap, x, y)
    if (ext > 0) extrudeInto(sheet, cell.bitmap, x, y, ext)
    frames.push({ ...cell.meta, frame: { x, y, w: cell.bitmap.width, h: cell.bitmap.height } })
  }

  const usedTags = opts.tagFilter.length
    ? sprite.tags.filter((t) => opts.tagFilter.includes(t.name))
    : sprite.tags

  return { bitmap: sheet, frames, tags: usedTags, columns, rows }
}

/** Repete les pixels de bord autour d'une frame collee dans la planche. */
function extrudeInto(sheet: Bitmap, cell: Bitmap, x: number, y: number, ext: number): void {
  for (let e = 1; e <= ext; e++) {
    for (let i = 0; i < cell.width; i++) {
      sheet.set(x + i, y - e, cell.get(i, 0))
      sheet.set(x + i, y + cell.height - 1 + e, cell.get(i, cell.height - 1))
    }
    for (let j = 0; j < cell.height; j++) {
      sheet.set(x - e, y + j, cell.get(0, j))
      sheet.set(x + cell.width - 1 + e, y + j, cell.get(cell.width - 1, j))
    }
  }
  // Coins.
  for (let a = 1; a <= ext; a++) {
    for (let b = 1; b <= ext; b++) {
      sheet.set(x - a, y - b, cell.get(0, 0))
      sheet.set(x + cell.width - 1 + a, y - b, cell.get(cell.width - 1, 0))
      sheet.set(x - a, y + cell.height - 1 + b, cell.get(0, cell.height - 1))
      sheet.set(x + cell.width - 1 + a, y + cell.height - 1 + b, cell.get(cell.width - 1, cell.height - 1))
    }
  }
}
