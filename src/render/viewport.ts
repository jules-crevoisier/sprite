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
import {
  imageDeReference, poigneeRef, tirerRef, tournerRef, aimanterRef, coinsRef,
  centreRef, versMonde, curseurPoignee, RECUL_ROTATION,
  type PoigneeRef, type BoiteRef, type Aimant, type Reference,
} from '../core/reference'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 64

/**
 * Les PALIERS de zoom.
 *
 * ## Pourquoi une echelle et non une multiplication
 *
 * Le zoom multipliait par 1,15 a chaque cran de molette, puis arrondissait a
 * l'entier au-dessus de 1x — l'arrondi etant la bonne regle, un pixel du
 * sprite doit occuper un nombre entier de pixels d'ecran. Mais 1 x 1,15 fait
 * 1,15, qui s'arrondit a 1 : la molette ne sortait JAMAIS de 1x. Ni de 2x
 * (2,3 arrondi a 2), ni de 3x. Il fallait un sprite assez grand pour s'ouvrir
 * a 1x — un 512 par exemple — et l'on se retrouvait enferme, incapable de voir
 * un seul pixel. Sur un sprite de trente-deux, qui s'ouvre a 20x, personne ne
 * pouvait s'en apercevoir.
 *
 * Une echelle de paliers supprime la classe entiere de ce defaut : un cran
 * monte d'un palier, quel que soit le point de depart, et l'on ne peut pas
 * rester sur place. Elle est resserree en bas — la ou l'on cadre — et large en
 * haut, ou l'on travaille au pixel.
 */
const PALIERS = [0.25, 0.33, 0.5, 0.67, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]
/** Cote d'une poignee de reference, en pixels d'ecran. */
const TAILLE_POIGNEE = 9

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
  /**
   * Le geste en cours sur une reference : deplacer, dimensionner, tourner.
   *
   * `depart` sert a deux choses : calculer la boite courante a partir du
   * deplacement total — et non cran par cran, ce qui derive — et remplir
   * l'annulation au relachement. Un geste entier fait UNE entree d'historique,
   * pas une par pixel parcouru.
   */
  private gesteRef: {
    poignee: PoigneeRef
    depart: BoiteRef
    px: number
    py: number
    bouge: boolean
  } | null = null
  /** Les lignes de rappel de l'aimantation, le temps du geste. */
  private aimants: Aimant[] = []

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
    editor.events.on('apercu', () => this.invalidate())
    editor.events.on('references', () => this.invalidate())
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

  /**
   * Le palier au-dessus ou au-dessous du zoom courant.
   *
   * On cherche le premier palier STRICTEMENT plus grand (ou plus petit) : un
   * zoom pose entre deux paliers par l'ajustement automatique — 0,87 sur un
   * grand sprite — doit monter au palier suivant, pas y rester.
   */
  private palier(zoom: number, monte: boolean): number {
    if (monte) return PALIERS.find((p) => p > zoom + 1e-6) ?? MAX_ZOOM
    for (let i = PALIERS.length - 1; i >= 0; i--) if (PALIERS[i] < zoom - 1e-6) return PALIERS[i]
    return MIN_ZOOM
  }

  /** Zoome en gardant le point (cx,cy) ecran immobile. */
  zoomAt(factor: number, cx: number, cy: number): void {
    if (factor === 1) return
    this.poserZoom(this.palier(this.ed.view.zoom, factor > 1), cx, cy)
  }

  /**
   * Pose un zoom precis en gardant le point (cx,cy) ecran immobile.
   *
   * Au-dela de 1x le zoom reste ENTIER : chaque pixel du sprite occupe un
   * nombre entier de pixels d'ecran, donc pas de bavure ni de colonnes de
   * largeurs inegales. En dessous, la fraction est necessaire — c'est le seul
   * moyen de voir un sprite plus grand que la fenetre.
   */
  private poserZoom(zoom: number, cx: number, cy: number): void {
    const v = this.ed.view
    const before = this.toSpriteFromCanvas(cx, cy)
    const borne = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
    v.zoom = borne >= 1 ? Math.round(borne) : borne
    v.panX = cx - before.x * v.zoom
    v.panY = cy - before.y * v.zoom
    this.ed.events.emit('settings', undefined)
    this.invalidate()
  }

  /**
   * La poignee de la reference choisie sous un point, ou null.
   *
   * La marge est donnee en pixels d'ECRAN puis ramenee en pixels du sprite :
   * une poignee doit se saisir aussi facilement a 1x qu'a 32x.
   */
  private poigneeSousLeCurseur(px: number, py: number): PoigneeRef | null {
    const ed = this.ed
    if (ed.referenceActive === null || ed.mode === 'rig') return null
    const r = ed.sprite.references.find((q) => q.id === ed.referenceActive)
    if (!r || !r.visible || r.verrouille) return null
    const poignee = poigneeRef(
      r, px, py,
      (TAILLE_POIGNEE / 1.6) / ed.view.zoom,
      RECUL_ROTATION / ed.view.zoom,
    )

    /*
     * LE DESSIN GAGNE TOUJOURS SUR L'IMAGE.
     *
     * Le CORPS de la reference captait le glisser quel que soit l'outil : une
     * photo posee sur toute la toile rendait le crayon inutilisable, et l'on
     * deplacait le modele en croyant tracer un trait. C'est le contraire de ce
     * qu'on lui demande — une reference est la pour qu'on dessine PAR-DESSUS.
     *
     * Le corps ne se saisit donc qu'avec l'outil DEPLACER, comme un calque ne
     * se deplace qu'avec l'outil de deplacement partout ailleurs. Les
     * poignees, elles, restent saisissables : elles sont sur le cadre, larges
     * de neuf pixels d'ecran, et elles sont la seule chose qui DESIGNE la
     * reference a l'oeil.
     *
     * La Main en est exclue, et ce n'est pas un oubli : elle deplace la VUE,
     * et la saisie des references passant avant elle, on aurait deplace
     * l'image chaque fois qu'on aurait voulu faire glisser le cadre.
     */
    if (poignee === 'corps' && ed.settings.tool !== 'move') return null
    return poignee
  }

  /** La reference choisie, si elle est saisissable. */
  private refActive(): Reference | null {
    const ed = this.ed
    if (ed.referenceActive === null) return null
    return ed.sprite.references.find((q) => q.id === ed.referenceActive) ?? null
  }

  private toSpriteFromCanvas(cx: number, cy: number): { x: number; y: number } {
    const v = this.ed.view
    return { x: (cx - v.panX) / v.zoom, y: (cy - v.panY) / v.zoom }
  }

  /**
   * Pose un zoom demande — « 100 % », « x2 » du menu.
   *
   * Il ne passe PAS par les paliers : « Zoom 100 % » doit donner 1x et non le
   * palier le plus proche, sinon la commande ment sur ce qu'elle fait.
   */
  setZoom(z: number): void {
    const r = this.canvas.getBoundingClientRect()
    this.poserZoom(z, r.width / 2, r.height / 2)
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

  private resizeToDisplay(): { w: number; h: number; dpr: number } {
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const r = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width * dpr))
    const h = Math.max(1, Math.round(r.height * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { w: r.width, h: r.height, dpr }
  }

  private render(): void {
    const { w, h, dpr } = this.resizeToDisplay()
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
    // L'origine est calee sur un pixel d'ecran entier.
    //
    // Sans ce calage, le sprite se pose a une fraction de pixel pres et le
    // reechantillonnage au plus proche voisin distribue les colonnes de facon
    // inegale : mesure a zoom 7, un deplacement de 0,61 pixel donnait des
    // colonnes larges de six ET de sept pixels dans la meme image. Une grille
    // qui ondule, c'est exactement ce qu'un dessinateur de pixel art voit en
    // premier. `imageSmoothingEnabled = false` n'y change rien : il supprime
    // le flou, pas l'irregularite.
    //
    // Les fonds, les grilles et la selection prennent la meme origine, donc
    // tout reste aligne. L'ecart avec la position exacte est inferieur a un
    // pixel d'ecran, invisible au curseur.
    const ox = Math.round(v.panX * dpr) / dpr
    const oy = Math.round(v.panY * dpr) / dpr

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

    // Les references SOUS le dessin : le cas ordinaire, on decalque par-dessus.
    this.drawReferences(ctx, ox, oy, v.zoom, true)

    ctx.drawImage(this.frameCanvas, ox, oy, dw, dh)

    // Et celles qu'on a mises par-dessus, pour comparer son trait au modele.
    this.drawReferences(ctx, ox, oy, v.zoom, false)

    // En mode squelette, l'influence des os se lit directement sur le dessin.
    // La carte d'influence sert a ponderer : elle sort avec le pinceau
    // Ponderer, ou a la demande, mais ne recouvre pas le dessin en continu.
    const weighting = ed.settings.tool === 'rig-weight'
    if (ed.mode === 'rig' && (ed.showWeights || weighting)) this.drawWeights(ctx, ox, oy, dw, dh)

    ctx.save()
    ctx.translate(ox, oy)
    ctx.scale(v.zoom, v.zoom)

    if (v.showGrid) this.drawGrid(ctx)
    if (v.showPixelGrid && v.zoom >= 8) this.drawPixelGrid(ctx, ox, oy, dpr)
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

    // Les poignees de la reference choisie, PAR-DESSUS tout : elles servent a
    // la saisir, et une poignee cachee par le dessin ne se saisit pas.
    this.drawReferenceHandles(ctx, ox, oy, v.zoom)
  }

  /**
   * Les images de REFERENCE, dessinees a leur definition d'origine.
   *
   * Elles ne passent pas par le tampon du sprite : elles ne sont pas des
   * pixels du dessin, et les y graver reviendrait a les detruire — une photo
   * de quatre cents pixels ramenee dans un cadre de trente-deux ne montre
   * plus rien. Dessinees ici, dans l'espace de l'ECRAN, elles gardent leur
   * finesse : au zoom huit on voit la photo en grand, pas huit fois le meme
   * gros pixel.
   *
   * C'est le seul endroit de l'editeur ou l'interpolation est permise. Une
   * reference n'est pas du dessin : elle ne s'exporte pas, elle ne se peint
   * pas, elle sert a l'oeil.
   */
  private drawReferences(
    ctx: CanvasRenderingContext2D, ox: number, oy: number, zoom: number, dessous: boolean,
  ): void {
    const refs = this.ed.sprite.references
    if (!refs.length) return
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    for (const r of refs) {
      if (!r.visible || r.dessous !== dessous) continue
      const img = imageDeReference(r.source, () => this.invalidate())
      if (!img) continue
      ctx.globalAlpha = Math.max(0, Math.min(1, r.opacite))
      const l = r.l * zoom, h = r.h * zoom
      // Tout se fait autour du CENTRE : c'est le seul point qui ne bouge ni en
      // tournant, ni en retournant. Poser l'image par son coin obligerait a
      // corriger la position apres chaque rotation, et l'image glisserait.
      ctx.save()
      ctx.translate(ox + (r.x + r.l / 2) * zoom, oy + (r.y + r.h / 2) * zoom)
      if (r.rotation) ctx.rotate(r.rotation * Math.PI / 180)
      if (r.miroirX || r.miroirY) ctx.scale(r.miroirX ? -1 : 1, r.miroirY ? -1 : 1)
      ctx.drawImage(img, -l / 2, -h / 2, l, h)
      ctx.restore()
    }
    ctx.restore()
    ctx.imageSmoothingEnabled = false
  }

  /**
   * Le cadre et les poignees de la reference choisie.
   *
   * Elles se dessinent en pixels d'ECRAN et gardent la meme taille a tous les
   * zooms : une poignee qui grandirait avec le zoom couvrirait l'image
   * entiere a 32x, et une qui rapetisserait deviendrait inattrapable a 1x.
   */
  private drawReferenceHandles(ctx: CanvasRenderingContext2D, ox: number, oy: number, zoom: number): void {
    const r = this.refActive()
    if (!r || !r.visible || r.verrouille) return
    const ecran = (p: { x: number; y: number }) => ({ x: ox + p.x * zoom, y: oy + p.y * zoom })
    const coins = coinsRef(r).map(ecran)

    ctx.save()

    // Les lignes de rappel de l'aimantation, sous le cadre : elles disent a
    // quoi la boite vient de se coller. Sans elles, on croit avoir mal vise.
    for (const a of this.aimants) {
      ctx.strokeStyle = 'rgba(255,120,190,0.9)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      if (a.axe === 'x') {
        const x = Math.round(ox + a.ou * zoom) + 0.5
        ctx.moveTo(x, 0); ctx.lineTo(x, this.canvas.height)
      } else {
        const y = Math.round(oy + a.ou * zoom) + 0.5
        ctx.moveTo(0, y); ctx.lineTo(this.canvas.width, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Le cadre suit l'image tournee : un rectangle droit autour d'une image de
    // travers designerait une boite que personne ne manipule.
    //
    // Il est trace DEUX FOIS, sombre dessous et clair dessus. Un liere bleu
    // d'un pixel sur une photo coloree est invisible une fois sur deux — et un
    // cadre qu'on ne voit pas revient a ne pas en avoir.
    ctx.beginPath()
    coins.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)))
    ctx.closePath()
    ctx.strokeStyle = 'rgba(10,14,24,0.75)'
    ctx.lineWidth = 3
    ctx.setLineDash([])
    ctx.stroke()
    ctx.strokeStyle = '#8ec0ff'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])

    const t = TAILLE_POIGNEE
    const poser = (p: { x: number; y: number }, rond = false) => {
      ctx.beginPath()
      if (rond) ctx.arc(p.x, p.y, t / 2, 0, Math.PI * 2)
      else ctx.rect(Math.round(p.x - t / 2), Math.round(p.y - t / 2), t, t)
      ctx.fill()
      ctx.stroke()
    }
    ctx.fillStyle = '#6ea8fe'
    ctx.strokeStyle = 'rgba(10,14,24,0.85)'
    ctx.lineWidth = 1
    for (const [lx, ly] of [
      [0, 0], [r.l / 2, 0], [r.l, 0],
      [0, r.h / 2], [r.l, r.h / 2],
      [0, r.h], [r.l / 2, r.h], [r.l, r.h],
    ]) poser(ecran(versMonde(r, lx, ly)))

    // La poignee de ROTATION, au bout d'une tige au-dessus du bord haut —
    // comme partout ailleurs. La mettre SUR un coin la rendrait indiscernable
    // du redimensionnement, qui est le geste voisin et le plus frequent.
    const hautMilieu = ecran(versMonde(r, r.l / 2, 0))
    const centre = ecran(centreRef(r))
    const dx = hautMilieu.x - centre.x, dy = hautMilieu.y - centre.y
    const norme = Math.hypot(dx, dy) || 1
    const tige = {
      x: hautMilieu.x + (dx / norme) * RECUL_ROTATION,
      y: hautMilieu.y + (dy / norme) * RECUL_ROTATION,
    }
    ctx.strokeStyle = '#6ea8fe'
    ctx.beginPath()
    ctx.moveTo(hautMilieu.x, hautMilieu.y)
    ctx.lineTo(tige.x, tige.y)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(10,14,24,0.85)'
    poser(tige, true)

    // Pendant le geste, la mesure en cours. C'est ce que montrent les barres
    // de transformation des grands logiciels, et pour la meme raison : sans
    // chiffre, on tire jusqu'a ce que « ca ait l'air bon », et on recommence
    // le lendemain.
    const g = this.gesteRef
    if (g && g.bouge) {
      const texte = g.poignee === 'rotation'
        ? `${Math.round(r.rotation)}°`
        : g.poignee === 'corps'
          ? `${Math.round(r.x)}, ${Math.round(r.y)}`
          : `${Math.round(r.l)} × ${Math.round(r.h)} px`
      ctx.font = '600 11px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const large = ctx.measureText(texte).width + 12
      // La mesure se pose sous la boite — mais JAMAIS hors de la vue. Une
      // image posee en bas de l'ecran l'envoyait sous le bord, et le chiffre
      // qu'on regarde pendant le geste etait justement absent au moment ou
      // l'on en avait besoin.
      const bas = Math.max(...coins.map((c) => c.y))
      const milieu = coins.reduce((t2, c) => t2 + c.x, 0) / coins.length
      const dpr = window.devicePixelRatio || 1
      const largeurVue = this.canvas.width / dpr, hauteurVue = this.canvas.height / dpr
      const bx = Math.min(Math.max(large / 2 + 4, milieu), largeurVue - large / 2 - 4)
      const by = Math.min(bas + 8, hauteurVue - 26)
      ctx.fillStyle = 'rgba(10,14,24,0.86)'
      ctx.fillRect(bx - large / 2, by, large, 18)
      ctx.fillStyle = '#dbe6ff'
      ctx.fillText(texte, bx, by + 9)
    }

    ctx.restore()
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, ox: number, oy: number, dw: number, dh: number): void {
    const style = this.ed.view.backgroundStyle
    if (style === 'checker') {
      // Le damier se compte en pixels du sprite, pas en pixels d'ecran.
      //
      // A pas fixe a l'ecran, les cases tombaient a cheval sur les pixels des
      // que le zoom n'etait pas un multiple : a 12x, une case faisait 1,33
      // pixel et le fond se decalait sous le dessin a chaque deplacement.
      // C'est le genre de detail qui fatigue sans qu'on sache pourquoi.
      // On prend donc une puissance de deux de pixels du sprite — elle reste
      // alignee sur la grille des pixels ET sur celle des tuiles — choisie
      // pour que la case tourne autour de douze pixels a l'ecran.
      const zoom = this.ed.view.zoom
      let pas = 1
      for (const c of [1, 2, 4, 8, 16]) {
        if (Math.abs(c * zoom - 12) < Math.abs(pas * zoom - 12)) pas = c
      }
      const size = pas * zoom
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

  /**
   * Grille d'un pixel, plus une ligne renforcee tous les huit.
   *
   * Elle etait tracee en blanc a dix pour cent : invisible sur un aplat
   * clair, c'est-a-dire precisement la ou l'on compte les pixels. Le mode
   * `difference` la rend lisible sur n'importe quel fond — clair ou sombre —
   * sans jamais teinter le dessin, puisqu'il inverse au lieu de recouvrir.
   *
   * La ligne des huit sert a compter : au-dela de quelques pixels, l'oeil ne
   * denombre plus une grille reguliere, il a besoin de reperes.
   */
  private drawPixelGrid(
    ctx: CanvasRenderingContext2D, ox: number, oy: number, dpr: number,
  ): void {
    const s = this.ed.sprite
    const z = this.ed.view.zoom

    // La grille se trace en pixels d'ecran entiers, pas en coordonnees du
    // sprite.
    //
    // Tracee a l'echelle du sprite, chaque ligne etait centree sur la
    // frontiere entre deux pixels : large d'un pixel CSS, elle debordait d'une
    // demie de chaque cote et le lisseur la rendait sur DEUX colonnes a demi
    // intensite. Le banc mesurait des plages « 1, 6, 1 » la ou il fallait lire
    // « 1, 7 », et les couleurs du dessin en sortaient teintees — a zoom 8, un
    // gris 16 se lisait 33, 60 ou 70 selon la position du panoramique. Une
    // grille qui teinte le dessin qu'elle sert a compter ne sert a rien.
    //
    // En remplissant exactement une colonne de pixels d'ecran, la ligne est
    // franche et n'emprunte rien aux pixels voisins.
    const px = (x: number): number => Math.round((ox + x * z) * dpr)
    const py = (y: number): number => Math.round((oy + y * z) * dpr)
    const x0 = px(0), x1 = px(s.width), y0 = py(0), y1 = py(s.height)

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'difference'

    // Deux passes : la trame d'un pixel, puis les reperes tous les huit. Au
    // dela de quelques pixels l'oeil ne denombre plus une grille reguliere.
    for (const [pas, teinte] of [[1, 0.16], [8, 0.34]] as const) {
      ctx.fillStyle = `rgba(255,255,255,${teinte})`
      for (let x = pas === 1 ? 1 : 8; x < s.width; x += pas) {
        if (pas === 1 && x % 8 === 0) continue
        ctx.fillRect(px(x), y0, 1, y1 - y0)
      }
      for (let y = pas === 1 ? 1 : 8; y < s.height; y += pas) {
        if (pas === 1 && y % 8 === 0) continue
        ctx.fillRect(x0, py(y), x1 - x0, 1)
      }
    }

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
    // L'outil Texte ne pose pas une brosse mais une ligne de texte : montrer
    // une pastille de vingt pixels de large annoncerait un geste qui n'aura
    // pas lieu. Son propre apercu dit deja ou le texte commencera.
    if (tool.id === 'text') return
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

      /*
       * LA REFERENCE CHOISIE PASSE AVANT LES OUTILS.
       *
       * Elle n'est pas du dessin : aucun outil n'a rien a en faire, et la
       * saisir doit marcher quel que soit l'outil courant — comme dans
       * Blender ou Photoshop, ou l'on deplace un fond sans changer de mode.
       * On la verrouille quand on ne veut plus y toucher.
       */
      const saisie = this.poigneeSousLeCurseur(sp.x, sp.y)
      if (saisie && e.button === 0) {
        const r = this.refActive()
        if (r) {
          this.gesteRef = {
            poignee: saisie,
            depart: { x: r.x, y: r.y, l: r.l, h: r.h, rotation: r.rotation },
            px: sp.x,
            py: sp.y,
            bouge: false,
          }
          return
        }
      }

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

      if (this.gesteRef) {
        const r = this.refActive()
        if (r) {
          const g = this.gesteRef
          g.bouge = true
          let apres: BoiteRef
          if (g.poignee === 'rotation') {
            // Maj : par crans de quinze degres. C'est le pas de tous les
            // logiciels de dessin, et celui des angles qu'on vise vraiment.
            apres = tournerRef(g.depart, sp.x, sp.y, g.px, g.py, e.shiftKey ? 15 : 0)
            this.aimants = []
          } else {
            apres = tirerRef(g.depart, g.poignee, sp.x - g.px, sp.y - g.py, {
              libre: e.shiftKey,
              centre: e.altKey,
            })
            // Ctrl coupe l'aimantation : il faut pouvoir poser une image a
            // deux pixels d'un bord sans qu'elle y saute.
            if (e.ctrlKey || e.metaKey) this.aimants = []
            else {
              const colle = aimanterRef(
                apres, ed.sprite.width, ed.sprite.height, 6 / ed.view.zoom,
              )
              apres = colle.boite
              this.aimants = colle.aimants
            }
          }
          Object.assign(r, apres)
          this.ed.events.emit('doc', undefined)
          this.invalidate()
        }
        return
      }
      // Le curseur ANNONCE ce que le clic fera : sans lui, on ne devine pas
      // qu'un bord de reference se tire.
      const survol = this.poigneeSousLeCurseur(sp.x, sp.y)
      if (survol) cv.style.cursor = curseurPoignee(survol, this.refActive()?.rotation ?? 0)
      else if (!this.dragging && !this.panning) this.updateCursorStyle()
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
      if (this.gesteRef) {
        const g = this.gesteRef
        this.gesteRef = null
        this.aimants = []
        this.updateCursorStyle()
        // Le geste ENTIER fait une entree d'historique, posee au relachement.
        // Sans elle, une reference tiree de travers ne se rattrapait pas : le
        // Ctrl+Z sautait par-dessus et defaisait le trait d'avant, ce qui est
        // la pire facon de ne pas annuler. En poser une par pixel parcouru
        // remplirait l'historique d'un seul deplacement.
        const r = this.refActive()
        if (r && g.bouge) {
          const nom = g.poignee === 'rotation'
            ? 'Tourner la référence'
            : g.poignee === 'corps' ? 'Déplacer la référence' : 'Dimensionner la référence'
          this.ed.poserGesteReference(r.id, g.depart, {
            x: r.x, y: r.y, l: r.l, h: r.h, rotation: r.rotation,
          }, nom)
        }
        // Une reference deplacee doit rester deplacee quand on rouvre le
        // projet : c'est un changement du document, pas de la vue.
        this.ed.events.emit('doc', undefined)
        return
      }
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
