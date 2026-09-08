import { Bitmap } from '../core/bitmap'
import { getA } from '../core/color'
import type { Editor } from '../core/editor'
import { compositeFrame } from './composite'
import { TOOLS, toolById, type PointerInfo, type Tool } from '../tools'
import { eyedropperTool } from '../tools/draw-tools'
import { brushOffsets } from '../tools/algorithms'
import { deform, boneColor, partFor } from '../smart/rig'
import { rigState, seamSettings } from '../tools'
import { fromHex, getR, getG, getB, toCss } from '../core/color'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 64

/**
 * Vue du sprite : gere la camera (zoom/pan), le rendu de la scene
 * (damier, onion skin, grilles, selection) et la traduction des evenements
 * pointeur en actions d'outil.
 */
export class Viewport {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private ed: Editor
  private frameBuffer: Bitmap
  private frameCanvas: HTMLCanvasElement
  private frameCtx: CanvasRenderingContext2D
  private onionCanvas: HTMLCanvasElement
  private onionCtx: CanvasRenderingContext2D
  private weightCanvas: HTMLCanvasElement
  private weightCtx: CanvasRenderingContext2D
  private owners: Uint8Array | null = null

  private needsRender = true
  private antsPhase = 0
  private lastAnts = 0

  /**
   * Geste a montrer sur la toile : une fleche animee de `from` vers `to`,
   * en coordonnees sprite. Le tutoriel s'en sert pour designer le mouvement
   * a faire, plutot que de le decrire.
   */
  gesture: { from: [number, number]; to: [number, number]; label?: string } | null = null

  /** Position du curseur en coordonnees sprite, ou null hors toile. */
  cursor: { x: number; y: number } | null = null
  private pointer: PointerInfo | null = null
  private dragging = false
  private panning = false
  private panStart = { x: 0, y: 0, panX: 0, panY: 0 }
  private spaceDown = false
  private activeTool: Tool | null = null
  private altPick = false

  onCursorMove: ((x: number, y: number) => void) | null = null

  constructor(canvas: HTMLCanvasElement, editor: Editor) {
    this.canvas = canvas
    this.ed = editor
    this.ctx = canvas.getContext('2d', { alpha: false })!
    this.frameBuffer = new Bitmap(editor.sprite.width, editor.sprite.height)
    this.frameCanvas = document.createElement('canvas')
    this.frameCtx = this.frameCanvas.getContext('2d')!
    this.onionCanvas = document.createElement('canvas')
    this.onionCtx = this.onionCanvas.getContext('2d')!
    this.weightCanvas = document.createElement('canvas')
    this.weightCtx = this.weightCanvas.getContext('2d')!

    this.bindEvents()
    editor.events.on('doc', () => this.invalidate())
    editor.events.on('selection', () => this.invalidate())
    editor.events.on('settings', () => this.invalidate())
    editor.events.on('cursor', () => this.invalidate())
    editor.events.on('reload', () => { this.fit(); this.invalidate() })

    const loop = () => {
      this.tick()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  invalidate(): void { this.needsRender = true }

  /* ---------------------------------------------------------------- */
  /* Camera                                                            */
  /* ---------------------------------------------------------------- */

  get zoom(): number { return this.ed.view.zoom }

  toSprite(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    const v = this.ed.view
    return {
      x: (clientX - r.left - v.panX) / v.zoom,
      y: (clientY - r.top - v.panY) / v.zoom,
    }
  }

  /** Zoome en gardant le point (cx,cy) ecran immobile. */
  zoomAt(factor: number, cx: number, cy: number): void {
    const v = this.ed.view
    const before = this.toSpriteFromCanvas(cx, cy)
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
    // Au-dela de 1x, on reste sur des entiers : chaque pixel du sprite
    // occupe un nombre entier de pixels ecran, donc pas de bavure.
    v.zoom = next >= 1 ? Math.round(next) : next
    v.panX = cx - before.x * v.zoom
    v.panY = cy - before.y * v.zoom
    this.ed.events.emit('settings', undefined)
    this.invalidate()
  }

  private toSpriteFromCanvas(cx: number, cy: number): { x: number; y: number } {
    const v = this.ed.view
    return { x: (cx - v.panX) / v.zoom, y: (cy - v.panY) / v.zoom }
  }

  setZoom(z: number): void {
    const r = this.canvas.getBoundingClientRect()
    this.zoomAt(z / this.ed.view.zoom, r.width / 2, r.height / 2)
  }

  /** Ajuste le zoom pour que le sprite occupe la vue avec une marge. */
  fit(): void {
    const r = this.canvas.getBoundingClientRect()
    const s = this.ed.sprite
    if (!r.width || !r.height) return
    const raw = Math.min((r.width - 48) / s.width, (r.height - 48) / s.height)
    const v = this.ed.view
    v.zoom = raw >= 1 ? Math.max(1, Math.floor(raw)) : Math.max(MIN_ZOOM, raw)
    this.center()
  }

  /**
   * Rattrape un changement de largeur de la zone de dessin en decalant le
   * panoramique : le sprite ne saute pas sous le curseur quand on tire un
   * separateur.
   */
  shiftPan(dx: number, dy = 0): void {
    this.ed.view.panX += dx
    this.ed.view.panY += dy
    this.invalidate()
  }

  /** Ramene le sprite dans la vue s'il en est completement sorti. */
  ensureVisible(): void {
    const r = this.canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    const v = this.ed.view
    const w = this.ed.sprite.width * v.zoom
    const h = this.ed.sprite.height * v.zoom
    const margin = 24
    const outside =
      v.panX + w < margin || v.panX > r.width - margin ||
      v.panY + h < margin || v.panY > r.height - margin
    if (outside) this.center()
    else this.invalidate()
  }

  center(): void {
    const r = this.canvas.getBoundingClientRect()
    const s = this.ed.sprite
    const v = this.ed.view
    v.panX = Math.round((r.width - s.width * v.zoom) / 2)
    v.panY = Math.round((r.height - s.height * v.zoom) / 2)
    this.ed.events.emit('settings', undefined)
    this.invalidate()
  }

  /* ---------------------------------------------------------------- */
  /* Boucle de rendu                                                   */
  /* ---------------------------------------------------------------- */

  private tick(): void {
    const now = performance.now()
    if (this.ed.selection.active && now - this.lastAnts > 90) {
      this.antsPhase = (this.antsPhase + 1) % 8
      this.lastAnts = now
      this.needsRender = true
    }
    if (!this.needsRender) return
    this.needsRender = false
    this.render()
  }

  private resizeToDisplay(): { w: number; h: number } {
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const r = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width * dpr))
    const h = Math.max(1, Math.round(r.height * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { w: r.width, h: r.height }
  }

  private render(): void {
    const { w, h } = this.resizeToDisplay()
    const ctx = this.ctx
    const ed = this.ed
    const s = ed.sprite
    const v = ed.view

    ctx.fillStyle = '#14161c'
    ctx.fillRect(0, 0, w, h)

    if (this.frameBuffer.width !== s.width || this.frameBuffer.height !== s.height) {
      this.frameBuffer = new Bitmap(s.width, s.height)
    }
    compositeFrame(s, ed.activeFrame, { into: this.frameBuffer, includeReference: true })
    this.frameCanvas.width = s.width
    this.frameCanvas.height = s.height
    this.frameCtx.putImageData(this.frameBuffer.toImageData(), 0, 0)

    const dw = s.width * v.zoom
    const dh = s.height * v.zoom
    const ox = v.panX
    const oy = v.panY

    ctx.imageSmoothingEnabled = false

    // Fond de la zone de travail.
    this.drawBackdrop(ctx, ox, oy, dw, dh)

    // Repetition 3x3 pour verifier le raccord des tuiles.
    if (v.tiledPreview) {
      ctx.globalAlpha = 0.4
      for (let ty = -1; ty <= 1; ty++) {
        for (let tx = -1; tx <= 1; tx++) {
          if (tx === 0 && ty === 0) continue
          ctx.drawImage(this.frameCanvas, ox + tx * dw, oy + ty * dh, dw, dh)
        }
      }
      ctx.globalAlpha = 1
    }

    if (ed.onion.enabled && !ed.playing) this.drawOnionSkin(ctx, ox, oy, dw, dh)

    ctx.drawImage(this.frameCanvas, ox, oy, dw, dh)

    // En mode squelette, l'influence des os se lit directement sur le dessin.
    // La carte d'influence sert a ponderer : elle sort avec le pinceau
    // Ponderer, ou a la demande, mais ne recouvre pas le dessin en continu.
    const weighting = ed.settings.tool === 'rig-weight'
    if (ed.mode === 'rig' && (ed.showWeights || weighting)) this.drawWeights(ctx, ox, oy, dw, dh)

    ctx.save()
    ctx.translate(ox, oy)
    ctx.scale(v.zoom, v.zoom)

    if (v.showGrid) this.drawGrid(ctx)
    if (v.showPixelGrid && v.zoom >= 8) this.drawPixelGrid(ctx)
    if (v.showSlices) this.drawSlices(ctx)
    if (v.showSymmetryGuides) this.drawSymmetry(ctx)

    const tool = toolById(ed.settings.tool)
    tool.overlay?.(ed, { ctx, zoom: v.zoom }, this.pointer)

    if (this.gesture) this.drawGesture(ctx)
    if (ed.selection.active) this.drawAnts(ctx)
    if (!ed.playing) this.drawBrushCursor(ctx)

    ctx.restore()

    // Bord de la toile.
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = 1
    ctx.strokeRect(ox - 0.5, oy - 0.5, dw + 1, dh + 1)
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, ox: number, oy: number, dw: number, dh: number): void {
    const style = this.ed.view.backgroundStyle
    if (style === 'checker') {
      const size = Math.max(4, Math.min(16, this.ed.view.zoom * 2))
      ctx.save()
      ctx.beginPath()
      ctx.rect(ox, oy, dw, dh)
      ctx.clip()
      ctx.fillStyle = '#c8c8c8'
      ctx.fillRect(ox, oy, dw, dh)
      ctx.fillStyle = '#8f8f8f'
      const cols = Math.ceil(dw / size), rows = Math.ceil(dh / size)
      for (let y = 0; y < rows; y++) {
        for (let x = (y % 2); x < cols; x += 2) {
          ctx.fillRect(ox + x * size, oy + y * size, size, size)
        }
      }
      ctx.restore()
    } else {
      ctx.fillStyle = style === 'dark' ? '#101014' : style === 'light' ? '#f2f2f2' : '#ff00ff'
      ctx.fillRect(ox, oy, dw, dh)
    }
  }

  private drawOnionSkin(ctx: CanvasRenderingContext2D, ox: number, oy: number, dw: number, dh: number): void {
    const ed = this.ed
    const o = ed.onion
    const s = ed.sprite
    this.onionCanvas.width = s.width
    this.onionCanvas.height = s.height

    const draw = (frame: number, distance: number, before: boolean) => {
      if (frame < 0 || frame >= s.frameCount) return
      const bm = compositeFrame(s, frame)
      if (o.tint) {
        // Teinte rouge pour le passe, bleue pour le futur.
        for (let i = 0; i < bm.u32.length; i++) {
          if (getA(bm.u32[i]) === 0) continue
          const p = i * 4
          const lum = (bm.data[p] + bm.data[p + 1] + bm.data[p + 2]) / 3
          bm.data[p] = before ? Math.min(255, lum * 1.1 + 60) : lum * 0.5
          bm.data[p + 1] = lum * 0.45
          bm.data[p + 2] = before ? lum * 0.45 : Math.min(255, lum * 1.1 + 70)
        }
      }
      this.onionCtx.clearRect(0, 0, s.width, s.height)
      this.onionCtx.putImageData(bm.toImageData(), 0, 0)
      ctx.globalAlpha = (o.opacity / 255) / (distance * 0.8 + 1)
      ctx.drawImage(this.onionCanvas, ox, oy, dw, dh)
      ctx.globalAlpha = 1
    }

    for (let i = o.prev; i >= 1; i--) draw(ed.activeFrame - i, i, true)
    for (let i = o.next; i >= 1; i--) draw(ed.activeFrame + i, i, false)
  }

  /**
   * Teinte chaque pixel selon l'os qui le porte. Les proprietaires sont
   * recalcules dans l'espace de la pose, pas du repos : la couleur suit donc
   * le membre quand il bouge.
   */
  private drawWeights(ctx: CanvasRenderingContext2D, ox: number, oy: number, dw: number, dh: number): void {
    const ed = this.ed
    const rig = ed.sprite.rig
    // La carte montre l'influence sur le calque en cours d'edition.
    const layer = ed.sprite.layers[ed.activeLayer]
    const part = layer ? partFor(rig, layer.id) : null
    if (!part || !rig.bones.length) return
    const w = part.rest.width, h = part.rest.height
    if (!this.owners || this.owners.length !== w * h) this.owners = new Uint8Array(w * h)
    this.owners.fill(255)
    // La carte d'influence n'a pas besoin de finesse : seule compte
    // l'appartenance de chaque pixel.
    deform(rig, part, { ...seamSettings(rigState.seam), owners: this.owners })

    this.weightCanvas.width = w
    this.weightCanvas.height = h
    const img = this.weightCtx.createImageData(w, h)
    const selectedIndex = rig.bones.findIndex((b) => b.id === rigState.selected)
    for (let i = 0; i < this.owners.length; i++) {
      const owner = this.owners[i]
      if (owner === 255) continue
      const color = fromHex(boneColor(owner))
      img.data[i * 4] = getR(color)
      img.data[i * 4 + 1] = getG(color)
      img.data[i * 4 + 2] = getB(color)
      // Assez pour lire l'appartenance, assez discret pour voir le dessin.
      img.data[i * 4 + 3] = owner === selectedIndex ? 165 : 78
    }
    this.weightCtx.putImageData(img, 0, 0)
    ctx.drawImage(this.weightCanvas, ox, oy, dw, dh)
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const g = this.ed.sprite.grid
    if (g.w <= 0 || g.h <= 0) return
    const s = this.ed.sprite
    ctx.save()
    ctx.strokeStyle = toCss(this.ed.view.gridColor)
    ctx.lineWidth = 1 / this.ed.view.zoom
    ctx.beginPath()
    for (let x = g.x % g.w; x <= s.width; x += g.w) { ctx.moveTo(x, 0); ctx.lineTo(x, s.height) }
    for (let y = g.y % g.h; y <= s.height; y += g.h) { ctx.moveTo(0, y); ctx.lineTo(s.width, y) }
    ctx.stroke()
    ctx.restore()
  }

  private drawPixelGrid(ctx: CanvasRenderingContext2D): void {
    const s = this.ed.sprite
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1 / this.ed.view.zoom
    ctx.beginPath()
    for (let x = 1; x < s.width; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, s.height) }
    for (let y = 1; y < s.height; y++) { ctx.moveTo(0, y); ctx.lineTo(s.width, y) }
    ctx.stroke()
    ctx.restore()
  }

  private drawSymmetry(ctx: CanvasRenderingContext2D): void {
    const sym = this.ed.symmetry
    const s = this.ed.sprite
    if (!sym.x && !sym.y) return
    ctx.save()
    ctx.strokeStyle = '#ff9f43'
    ctx.lineWidth = 1 / this.ed.view.zoom
    ctx.setLineDash([4 / this.ed.view.zoom, 3 / this.ed.view.zoom])
    ctx.beginPath()
    if (sym.x) { ctx.moveTo(sym.axisX, 0); ctx.lineTo(sym.axisX, s.height) }
    if (sym.y) { ctx.moveTo(0, sym.axisY); ctx.lineTo(s.width, sym.axisY) }
    ctx.stroke()
    ctx.restore()
  }

  private drawSlices(ctx: CanvasRenderingContext2D): void {
    const z = this.ed.view.zoom
    ctx.save()
    ctx.lineWidth = 1 / z
    for (const slice of this.ed.sprite.slices) {
      ctx.strokeStyle = toCss(slice.color)
      ctx.strokeRect(slice.bounds.x, slice.bounds.y, slice.bounds.w, slice.bounds.h)
      if (slice.center) {
        ctx.setLineDash([2 / z, 2 / z])
        ctx.strokeRect(
          slice.bounds.x + slice.center.x, slice.bounds.y + slice.center.y,
          slice.center.w, slice.center.h,
        )
        ctx.setLineDash([])
      }
      if (slice.pivot) {
        const px = slice.bounds.x + slice.pivot.x
        const py = slice.bounds.y + slice.pivot.y
        ctx.beginPath()
        ctx.moveTo(px - 3 / z, py); ctx.lineTo(px + 3 / z, py)
        ctx.moveTo(px, py - 3 / z); ctx.lineTo(px, py + 3 / z)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  /** Fleche pulsee du point de depart vers le point d'arrivee du geste. */
  private drawGesture(ctx: CanvasRenderingContext2D): void {
    const g = this.gesture
    if (!g) return
    const z = this.ed.view.zoom
    const unit = 1 / z
    const [x1, y1] = g.from
    const [x2, y2] = g.to
    const phase = (performance.now() % 1400) / 1400
    const ease = 0.5 - Math.cos(phase * Math.PI * 2) / 2
    const cx = x1 + (x2 - x1) * ease
    const cy = y1 + (y2 - y1) * ease

    ctx.save()
    ctx.strokeStyle = '#ffb454'
    ctx.lineWidth = 1.8 * unit
    ctx.setLineDash([4 * unit, 3 * unit])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])

    // Depart : un cercle. Arrivee : une cible. Entre les deux, le curseur.
    ctx.beginPath()
    ctx.arc(x1, y1, 3 * unit, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x2, y2, 4 * unit, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, 2.4 * unit, 0, Math.PI * 2)
    ctx.fillStyle = '#ffb454'
    ctx.fill()
    ctx.restore()
    this.invalidate()
  }

  private drawAnts(ctx: CanvasRenderingContext2D): void {
    const seg = this.ed.selection.outline()
    if (!seg.length) return
    const z = this.ed.view.zoom
    ctx.save()
    ctx.lineWidth = 1.4 / z
    ctx.beginPath()
    for (let i = 0; i < seg.length; i += 4) {
      ctx.moveTo(seg[i], seg[i + 1])
      ctx.lineTo(seg[i + 2], seg[i + 3])
    }
    ctx.strokeStyle = '#000'
    ctx.setLineDash([])
    ctx.stroke()
    ctx.strokeStyle = '#fff'
    ctx.setLineDash([4 / z, 4 / z])
    ctx.lineDashOffset = this.antsPhase / z
    ctx.stroke()
    ctx.restore()
  }

  private drawBrushCursor(ctx: CanvasRenderingContext2D): void {
    const c = this.cursor
    if (!c) return
    const ed = this.ed
    const tool = toolById(ed.settings.tool)
    if (tool.group === 'nav' || tool.group === 'select') return
    const z = ed.view.zoom
    if (z < 2) return
    const px = Math.floor(c.x), py = Math.floor(c.y)
    const offsets = brushOffsets(ed.settings.brushSize, ed.settings.brushShape)
    ctx.save()
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1 / z
    for (let i = 0; i < offsets.length; i += 2) {
      const x = px + offsets[i], y = py + offsets[i + 1]
      ctx.fillRect(x, y, 1, 1)
    }
    ctx.strokeRect(px + 0.5 / z, py + 0.5 / z, 1 - 1 / z, 1 - 1 / z)
    ctx.restore()
  }

  /* ---------------------------------------------------------------- */
  /* Entrees                                                           */
  /* ---------------------------------------------------------------- */

  private makePointer(e: PointerEvent, start?: { x: number; y: number }): PointerInfo {
    const s = this.toSprite(e.clientX, e.clientY)
    const px = Math.floor(s.x), py = Math.floor(s.y)
    const prev = this.pointer
    return {
      x: s.x,
      y: s.y,
      px,
      py,
      startPx: start ? Math.floor(start.x) : prev?.startPx ?? px,
      startPy: start ? Math.floor(start.y) : prev?.startPy ?? py,
      prevPx: prev?.px ?? px,
      prevPy: prev?.py ?? py,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      button: e.button,
      pressure: e.pressure || 1,
    }
  }

  private bindEvents(): void {
    const cv = this.canvas
    cv.addEventListener('contextmenu', (e) => e.preventDefault())

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId)
      const ed = this.ed
      const sp = this.toSprite(e.clientX, e.clientY)

      // Pan : bouton du milieu, ou barre espace, ou outil Main.
      if (e.button === 1 || this.spaceDown || ed.settings.tool === 'hand') {
        this.panning = true
        this.panStart = { x: e.clientX, y: e.clientY, panX: ed.view.panX, panY: ed.view.panY }
        cv.style.cursor = 'grabbing'
        return
      }

      if (ed.settings.tool === 'zoom') {
        const r = cv.getBoundingClientRect()
        this.zoomAt(e.button === 2 || e.altKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top)
        return
      }

      const p = this.makePointer(e, sp)
      // Alt sur un outil de dessin : pipette temporaire, comme dans Aseprite.
      const drawing = toolById(ed.settings.tool).group === 'draw'
      this.altPick = e.altKey && drawing && ed.settings.tool !== 'eyedropper'
      this.activeTool = this.altPick ? eyedropperTool : toolById(ed.settings.tool)
      this.dragging = true
      this.pointer = p
      this.activeTool.down(ed, p)
      this.invalidate()
    })

    cv.addEventListener('pointermove', (e) => {
      const ed = this.ed
      const sp = this.toSprite(e.clientX, e.clientY)
      this.cursor = sp.x >= 0 && sp.y >= 0 && sp.x < ed.sprite.width && sp.y < ed.sprite.height
        ? sp
        : null
      this.onCursorMove?.(Math.floor(sp.x), Math.floor(sp.y))

      if (this.panning) {
        ed.view.panX = this.panStart.panX + (e.clientX - this.panStart.x)
        ed.view.panY = this.panStart.panY + (e.clientY - this.panStart.y)
        this.invalidate()
        return
      }

      const p = this.makePointer(e)
      if (this.dragging && this.activeTool) {
        this.activeTool.move(ed, p)
      } else {
        toolById(ed.settings.tool).hover?.(ed, p)
      }
      this.pointer = p
      this.invalidate()
    })

    const finish = (e: PointerEvent) => {
      if (this.panning) {
        this.panning = false
        this.updateCursorStyle()
        return
      }
      if (this.dragging && this.activeTool) {
        this.activeTool.up(this.ed, this.makePointer(e))
        this.dragging = false
        this.activeTool = null
        this.altPick = false
      }
      this.invalidate()
    }
    cv.addEventListener('pointerup', finish)
    cv.addEventListener('pointercancel', finish)

    cv.addEventListener('pointerleave', () => {
      this.cursor = null
      this.invalidate()
    })

    cv.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = cv.getBoundingClientRect()
      // Alt, et pas Ctrl : sur un pave tactile le pincement arrive
      // justement sous la forme d'une molette avec Ctrl. Le prendre pour la
      // taille du pinceau supprimerait le zoom a deux doigts.
      if (e.altKey) {
        const s = this.ed.settings
        const taille = Math.max(1, Math.min(64, s.brushSize + (e.deltaY < 0 ? 1 : -1)))
        if (taille !== s.brushSize) this.ed.updateSettings({ brushSize: taille })
        return
      }
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        this.zoomAt(factor, e.clientX - r.left, e.clientY - r.top)
      } else {
        this.ed.view.panX -= e.deltaX || e.deltaY
        this.invalidate()
      }
    }, { passive: false })

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.spaceDown) {
        const t = e.target as HTMLElement
        if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return
        this.spaceDown = true
        this.updateCursorStyle()
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false
        this.updateCursorStyle()
      }
    })
    window.addEventListener('resize', () => this.invalidate())
  }

  updateCursorStyle(): void {
    const tool = TOOLS[this.ed.settings.tool]
    this.canvas.style.cursor = this.spaceDown ? 'grab' : (tool?.cursor ?? 'crosshair')
  }

  /**
   * Annule l'action en cours (Echap, changement d'outil).
   * Retourne true si un geste etait effectivement en cours.
   */
  cancelActive(): boolean {
    const wasActive = this.dragging || this.activeTool !== null
    const tool = this.activeTool ?? toolById(this.ed.settings.tool)
    tool.cancel?.(this.ed)
    this.dragging = false
    this.activeTool = null
    this.invalidate()
    return wasActive
  }
}
