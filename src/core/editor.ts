import { Bitmap, type Rect } from './bitmap'
import { type RGBA, fromHex, TRANSPARENT } from './color'
import { Sprite, type Cel, type Tag, genId } from './document'
import { History, celDiffCommand, structureCommand, type Command } from './history'
import { Selection } from './selection'
import { Emitter } from './events'
import type { BrushShape, DitherPattern } from '../tools/algorithms'
import type { PaintMode } from '../tools/painter'

export type ToolId =
  | 'pencil' | 'eraser' | 'bucket' | 'eyedropper'
  | 'line' | 'rectangle' | 'ellipse' | 'contour' | 'curve'
  | 'select-rect' | 'select-ellipse' | 'lasso' | 'magic-wand'
  | 'move' | 'hand' | 'zoom'
  | 'shading' | 'blur' | 'spray' | 'gradient'
  | 'rig-bone' | 'rig-pose' | 'rig-weight'

/**
 * Mode de travail. Chacun a sa barre d'outils, ses panneaux et ses reglages :
 * on ne cherche pas un crayon quand on articule un personnage.
 */
export type EditorMode = 'draw' | 'rig'

export interface ToolSettings {
  tool: ToolId
  brushSize: number
  brushShape: BrushShape
  /** 0..255 */
  opacity: number
  paintMode: PaintMode
  pixelPerfect: boolean
  /** Tolerance du seau et de la baguette magique (0..255). */
  tolerance: number
  contiguous: boolean
  ditherPattern: DitherPattern
  ditherRatio: number
  /** Les formes sont remplies au lieu d'etre tracees en contour. */
  fillShapes: boolean
  /** Intensite de l'outil de shading et du flou (0..1). */
  strength: number
  sprayDensity: number
  gradientDither: boolean
}

export interface OnionSkin {
  enabled: boolean
  prev: number
  next: number
  opacity: number
  /** Teinte les frames precedentes/suivantes en rouge/bleu. */
  tint: boolean
}

export interface ViewSettings {
  zoom: number
  panX: number
  panY: number
  showGrid: boolean
  showPixelGrid: boolean
  gridColor: RGBA
  showSymmetryGuides: boolean
  tiledPreview: boolean
  showSlices: boolean
  backgroundStyle: 'checker' | 'dark' | 'light' | 'magenta'
}

export interface EditorEvents {
  /** Les pixels ou la structure du document ont change. */
  doc: void
  /** La selection a change. */
  selection: void
  /** Les reglages d'outil / de vue ont change. */
  settings: void
  /** Le calque ou la frame active a change. */
  cursor: void
  /** Message court a afficher a l'utilisateur. */
  toast: { text: string; kind?: 'info' | 'error' | 'success' }
  /** Le sprite entier a ete remplace (nouveau document, import). */
  reload: void
  /** Etat de lecture de l'animation. */
  playback: boolean
  /** Le mode de travail a change. */
  mode: EditorMode
}

interface StrokeState {
  label: string
  cel: Cel
  before: Bitmap
}

/**
 * Etat central de l'application : document courant, historique, selection,
 * reglages, et point d'entree de toutes les mutations.
 */
export class Editor {
  sprite: Sprite
  history = new History(300)
  selection: Selection
  events = new Emitter<EditorEvents>()

  /** Mode courant : dessin ou squelette. */
  mode: EditorMode = 'draw'
  /** Outil retenu pour chaque mode, pour retrouver son geste en revenant. */
  private toolByMode: Record<EditorMode, ToolId> = { draw: 'pencil', rig: 'rig-bone' }

  activeLayer = 0
  activeFrame = 0
  /** Frames selectionnees dans la timeline (operations multiples). */
  frameSelection = new Set<number>([0])

  primary: RGBA = fromHex('#ffffff')
  secondary: RGBA = TRANSPARENT

  settings: ToolSettings = {
    tool: 'pencil',
    brushSize: 1,
    brushShape: 'circle',
    opacity: 255,
    paintMode: 'normal',
    pixelPerfect: true,
    tolerance: 0,
    contiguous: true,
    ditherPattern: 'none',
    ditherRatio: 0.5,
    fillShapes: false,
    strength: 0.15,
    sprayDensity: 12,
    gradientDither: true,
  }

  onion: OnionSkin = { enabled: false, prev: 1, next: 1, opacity: 110, tint: true }

  /**
   * Affiche l'influence de chaque os en couleur par-dessus le dessin.
   * Par defaut la teinte ne sort que pendant la ponderation : une fois les
   * pixels lies, on veut revoir le dessin, pas la carte des os.
   */
  showWeights = false

  view: ViewSettings = {
    zoom: 8,
    panX: 0,
    panY: 0,
    showGrid: false,
    showPixelGrid: true,
    gridColor: fromHex('#ffffff40'),
    showSymmetryGuides: true,
    tiledPreview: false,
    showSlices: true,
    backgroundStyle: 'checker',
  }

  symmetry: { x: boolean; y: boolean; axisX: number; axisY: number } = {
    x: false, y: false, axisX: 0, axisY: 0,
  }

  /** Le dessin se replie sur les bords, pour creer des tuiles seamless. */
  tiledDrawing = false

  clipboard: { bitmap: Bitmap; mask: Uint8Array | null; w: number; h: number } | null = null

  playing = false
  /** Limite la lecture a la plage du tag courant. */
  playTagOnly = true

  private stroke: StrokeState | null = null
  private selectionBefore: Uint8Array | null = null

  constructor(sprite?: Sprite) {
    this.sprite = sprite ?? new Sprite(32, 32)
    this.selection = new Selection(this.sprite.width, this.sprite.height)
    this.symmetry.axisX = this.sprite.width / 2
    this.symmetry.axisY = this.sprite.height / 2
  }

  /* ---------------------------------------------------------------- */
  /* Mode de travail                                                   */
  /* ---------------------------------------------------------------- */

  setMode(mode: EditorMode): void {
    if (this.mode === mode) return
    this.toolByMode[this.mode] = this.settings.tool
    this.mode = mode
    this.settings.tool = this.toolByMode[mode]
    this.events.emit('mode', mode)
    this.events.emit('settings', undefined)
    this.events.emit('doc', undefined)
  }

  /* ---------------------------------------------------------------- */
  /* Acces au document                                                 */
  /* ---------------------------------------------------------------- */

  get layer() { return this.sprite.layers[this.activeLayer] }
  get frameCount() { return this.sprite.frameCount }

  /** Case active, creee si besoin. Retourne null si le calque est verrouille. */
  currentCel(): Cel | null {
    const layer = this.layer
    if (!layer || layer.locked || !layer.visible) return null
    return this.sprite.ensureCel(this.activeLayer, this.activeFrame)
  }

  /** Case active en lecture seule (peut etre null si vide). */
  peekCel(): Cel | null {
    return this.sprite.cel(this.activeLayer, this.activeFrame)
  }

  setActiveLayer(i: number): void {
    const clamped = Math.max(0, Math.min(this.sprite.layers.length - 1, i))
    if (clamped === this.activeLayer) return
    this.activeLayer = clamped
    this.events.emit('cursor', undefined)
  }

  setActiveFrame(i: number, extend = false): void {
    const clamped = Math.max(0, Math.min(this.frameCount - 1, i))
    this.activeFrame = clamped
    if (!extend) this.frameSelection = new Set([clamped])
    else this.frameSelection.add(clamped)
    this.events.emit('cursor', undefined)
  }

  /* ---------------------------------------------------------------- */
  /* Traits et historique                                              */
  /* ---------------------------------------------------------------- */

  /** Capture l'etat de la case active avant modification. */
  beginStroke(label: string): Cel | null {
    const cel = this.currentCel()
    if (!cel) {
      this.toast('Calque verrouille ou masque', 'error')
      return null
    }
    this.stroke = { label, cel, before: cel.bitmap.clone() }
    return cel
  }

  /** Bitmap de la case au moment ou le trait a commence (previsualisation). */
  get strokeBefore(): Bitmap | null { return this.stroke?.before ?? null }

  /** Restaure la case a son etat de debut de trait (formes en direct). */
  resetStroke(): void {
    if (this.stroke) this.stroke.cel.bitmap.copyFrom(this.stroke.before)
  }

  /** Valide le trait et empile la commande d'annulation. */
  commitStroke(): void {
    const s = this.stroke
    this.stroke = null
    if (!s) return
    const cmd = celDiffCommand(s.label, [{ cel: s.cel, before: s.before }])
    if (cmd) this.history.push(cmd)
    this.events.emit('doc', undefined)
  }

  /** Abandonne le trait en cours et restaure l'etat initial. */
  cancelStroke(): void {
    if (!this.stroke) return
    this.stroke.cel.bitmap.copyFrom(this.stroke.before)
    this.stroke = null
    this.events.emit('doc', undefined)
  }

  /** Execute une modification structurelle en une seule etape d'historique. */
  run(label: string, apply: () => void): void {
    const cmd = structureCommand(this.sprite, label, apply)
    this.history.push(cmd)
    this.clampCursor()
    this.events.emit('doc', undefined)
    this.events.emit('cursor', undefined)
  }

  /** Execute une modification de pixels sur plusieurs cases en une etape. */
  runPixels(label: string, cels: Cel[], apply: () => void): void {
    const befores = cels.map((c) => ({ cel: c, before: c.bitmap.clone() }))
    apply()
    const cmd = celDiffCommand(label, befores)
    if (cmd) this.history.push(cmd)
    this.events.emit('doc', undefined)
  }

  pushCommand(cmd: Command): void {
    this.history.push(cmd)
    this.events.emit('doc', undefined)
  }

  undo(): void {
    const label = this.history.undo()
    if (label) {
      this.clampCursor()
      this.syncSelectionSize()
      this.events.emit('doc', undefined)
      this.events.emit('cursor', undefined)
      this.toast(`Annule : ${label}`)
    }
  }

  redo(): void {
    const label = this.history.redo()
    if (label) {
      this.clampCursor()
      this.syncSelectionSize()
      this.events.emit('doc', undefined)
      this.events.emit('cursor', undefined)
      this.toast(`Retabli : ${label}`)
    }
  }

  private clampCursor(): void {
    this.activeLayer = Math.max(0, Math.min(this.sprite.layers.length - 1, this.activeLayer))
    this.activeFrame = Math.max(0, Math.min(this.frameCount - 1, this.activeFrame))
    this.frameSelection = new Set(
      [...this.frameSelection].filter((f) => f < this.frameCount),
    )
    if (this.frameSelection.size === 0) this.frameSelection.add(this.activeFrame)
  }

  /** Recree le masque de selection si la taille de la toile a change. */
  syncSelectionSize(): void {
    if (this.selection.width !== this.sprite.width || this.selection.height !== this.sprite.height) {
      this.selection = new Selection(this.sprite.width, this.sprite.height)
      this.symmetry.axisX = this.sprite.width / 2
      this.symmetry.axisY = this.sprite.height / 2
      this.events.emit('selection', undefined)
    }
  }

  /* ---------------------------------------------------------------- */
  /* Utilitaires                                                       */
  /* ---------------------------------------------------------------- */

  loadSprite(sprite: Sprite): void {
    this.sprite = sprite
    this.activeLayer = Math.max(0, sprite.layers.length - 1)
    this.activeFrame = 0
    this.frameSelection = new Set([0])
    this.selection = new Selection(sprite.width, sprite.height)
    this.symmetry.axisX = sprite.width / 2
    this.symmetry.axisY = sprite.height / 2
    this.history.clear()
    this.events.emit('reload', undefined)
    this.events.emit('doc', undefined)
    this.events.emit('cursor', undefined)
  }

  addTag(name: string, from: number, to: number): Tag {
    const tag: Tag = {
      id: genId(),
      name,
      from: Math.min(from, to),
      to: Math.max(from, to),
      direction: 'forward',
      repeat: 0,
      color: fromHex('#5b8cff'),
    }
    this.run(`Tag ${name}`, () => { this.sprite.tags.push(tag) })
    return tag
  }

  setPrimary(c: RGBA): void {
    this.primary = c
    this.events.emit('settings', undefined)
  }

  setSecondary(c: RGBA): void {
    this.secondary = c
    this.events.emit('settings', undefined)
  }

  swapColors(): void {
    const t = this.primary
    this.primary = this.secondary
    this.secondary = t
    this.events.emit('settings', undefined)
  }

  updateSettings(patch: Partial<ToolSettings>): void {
    Object.assign(this.settings, patch)
    this.events.emit('settings', undefined)
  }

  updateView(patch: Partial<ViewSettings>): void {
    Object.assign(this.view, patch)
    this.events.emit('settings', undefined)
  }

  /** Capture le masque courant avant une modification interactive. */
  beginSelectionChange(): void {
    this.selectionBefore = new Uint8Array(this.selection.mask)
  }

  /** Empile la modification de selection si elle a reellement change. */
  commitSelectionChange(label: string): void {
    const before = this.selectionBefore
    this.selectionBefore = null
    if (!before) return
    const after = new Uint8Array(this.selection.mask)
    let same = before.length === after.length
    if (same) {
      for (let i = 0; i < before.length; i++) {
        if (before[i] !== after[i]) { same = false; break }
      }
    }
    if (same) return
    const sel = this.selection
    this.history.push({
      label,
      undo: () => { sel.combine(before, 'replace'); this.events.emit('selection', undefined) },
      redo: () => { sel.combine(after, 'replace'); this.events.emit('selection', undefined) },
    })
  }

  setSelectionMask(mask: Uint8Array | null): void {
    if (!mask) this.selection.clear()
    else this.selection.combine(mask, 'replace')
    this.events.emit('selection', undefined)
  }

  toast(text: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    this.events.emit('toast', { text, kind })
  }

  /** Rectangle utile : la selection si active, sinon toute la toile. */
  workingRect(): Rect {
    return this.selection.active ? this.selection.bounds() : this.sprite.bounds
  }
}
