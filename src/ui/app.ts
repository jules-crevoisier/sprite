import { Editor, type EditorMode, type ToolId } from '../core/editor'
import { getA, withAlpha } from '../core/color'
import { Sprite } from '../core/document'
import { Palette } from '../core/palette'
import { Viewport } from '../render/viewport'
import { DEFAULT_EXPORT, type ExportRequest } from '../export'
import { autosave, hasAutosave, autosaveDate, loadAutosave, deserializeSprite } from '../io/project'
import { loadImageBitmap } from '../export/files'
import { imageToBitmap, spriteFromImage } from '../io/import'
import { pasteClipboard } from '../core/operations'
import { installShortcuts } from './shortcuts'
import { toolById, syncRestFromCanvas, invalidateBake } from '../tools'
import { buildCommands, type Command } from './commands'
import { openCommandPalette } from './command-palette'
import { ColorPanel } from './color-panel'
import { LayersPanel } from './layers-panel'
import { PreviewPanel } from './preview'
import { RigPanel } from './rig-panel'
import { TimelinePanel } from './timeline'
import { StatusBar } from './statusbar'
import { Playback } from './playback'
import { renderToolbar } from './toolbar'
import { renderOptionsBar } from './options-bar'
import { renderTopbar } from './menubar'
import { Workspace, type PanelDef } from './workspace'
import { Tutorial, type Lesson } from './tutorial'
import { buildLessons } from './lessons'
import { el, qs, clear } from './dom'
import { openModal, showToast, confirmDialog } from './overlay'

const AUTOSAVE_INTERVAL = 45_000

/** Assemble l'application : etat, vue, panneaux, commandes et raccourcis. */
export class App {
  readonly ed = new Editor(defaultSprite())
  readonly viewport: Viewport
  readonly playback: Playback
  readonly timeline: TimelinePanel
  readonly colorPanel: ColorPanel
  readonly layersPanel: LayersPanel
  readonly preview: PreviewPanel
  readonly rigPanel: RigPanel
  readonly status: StatusBar
  readonly workspace: Workspace
  readonly tutorial: Tutorial

  exportRequest: ExportRequest = structuredClone(DEFAULT_EXPORT)

  private commands: Command[] = []
  private commandMap = new Map<string, Command>()
  private lastAutosave = 0

  constructor() {
    const canvas = qs<HTMLCanvasElement>('#canvas')
    this.viewport = new Viewport(canvas, this.ed)
    this.playback = new Playback(this.ed)
    this.status = new StatusBar(qs('#statusbar'), this.ed)

    this.colorPanel = new ColorPanel(this.ed)
    this.layersPanel = new LayersPanel(this.ed)
    this.preview = new PreviewPanel(this.ed)
    this.rigPanel = new RigPanel(this.ed)
    this.timeline = new TimelinePanel(this.ed, this.playback, qs('#timeline'))

    this.workspace = new Workspace(this.panelDefs(), {
      left: qs('#dock-left'),
      right: qs('#dock-right'),
      splitLeft: qs('#split-left'),
      splitRight: qs('#split-right'),
      timeline: qs('#timeline'),
    }, (reason) => {
      // Un changement de disposition peut sortir le sprite du cadre :
      // on le ramene, sans le faire sauter pendant un simple glissement.
      if (reason === 'layout') requestAnimationFrame(() => this.viewport.ensureVisible())
      else this.viewport.invalidate()
    })

    this.tutorial = new Tutorial(this)
    this.commands = buildCommands(this)
    this.commandMap = new Map(this.commands.map((c) => [c.id, c]))

    this.mount()
    this.wire()
    this.viewport.fit()
    this.viewport.updateCursorStyle()
    this.colorPanel.renderPalette()
    void this.startupPrompts()
  }

  /* ---------------------------------------------------------------- */
  /* Montage                                                           */
  /* ---------------------------------------------------------------- */

  /** Panneaux rangeables dans les docks lateraux. */
  private panelDefs(): PanelDef[] {
    return [
      { id: 'preview', title: 'Apercu', icon: 'film', content: this.preview.content },
      {
        id: 'layers', title: 'Calques', icon: 'layers',
        content: this.layersPanel.content, actions: this.layersPanel.actions,
        grow: true, minHeight: 150,
      },
      { id: 'color', title: 'Couleur', icon: 'palette', content: this.colorPanel.pickerContent },
      {
        id: 'palette', title: 'Palette', icon: 'sliders',
        content: this.colorPanel.paletteContent, actions: this.colorPanel.paletteActions,
        grow: true, minHeight: 104,
      },
      {
        id: 'rig', title: 'Squelette', icon: 'rig',
        content: this.rigPanel.content, actions: this.rigPanel.actions,
      },
    ]
  }

  private mount(): void {
    this.renderTop()
    this.renderTools()
    this.renderOptions()
    this.renderHud()
  }

  private renderTop(): void { renderTopbar(qs('#topbar'), this) }
  private renderTools(): void { renderToolbar(qs('#toolbar'), this.ed, (id) => this.setTool(id as ToolId)) }
  private renderOptions(): void { renderOptionsBar(qs('#optionsbar'), this.ed, () => this.renderOptions()) }

  /** Pastilles d'information en bas de la zone de dessin. */
  private renderHud(): void {
    const hud = qs('#canvas-hud')
    clear(hud)
    const zoom = el('span', { class: 'chip' }, `${this.ed.view.zoom < 1 ? this.ed.view.zoom.toFixed(2) : this.ed.view.zoom}x`)
    hud.appendChild(zoom)
    if (this.ed.tiledDrawing) hud.appendChild(el('span', { class: 'chip' }, 'mode tuile'))
    if (this.ed.symmetry.x || this.ed.symmetry.y) {
      hud.appendChild(el('span', { class: 'chip' },
        `symetrie ${this.ed.symmetry.x ? 'X' : ''}${this.ed.symmetry.y ? 'Y' : ''}`))
    }
    if (this.ed.onion.enabled) hud.appendChild(el('span', { class: 'chip' }, 'pelure d\'oignon'))
    if (this.ed.layer?.locked) hud.appendChild(el('span', { class: 'chip', style: { color: 'var(--warn)' } }, 'calque verrouille'))
    // Filet de securite : une couleur totalement transparente donne
    // l'impression que les outils ne repondent plus.
    if (getA(this.ed.primary) === 0 && toolById(this.ed.settings.tool).group === 'draw') {
      hud.appendChild(el('span', {
        class: 'chip',
        style: { color: 'var(--warn)', cursor: 'pointer' },
        title: 'Cliquer pour reprendre une couleur opaque',
        onclick: () => this.ed.setPrimary(withAlpha(this.ed.primary, 255)),
      }, 'couleur transparente'))
    }
  }

  private wire(): void {
    const ed = this.ed

    ed.events.on('toast', ({ text, kind }) => showToast(text, kind))
    ed.events.on('settings', () => { this.renderOptions(); this.renderHud(); this.viewport.updateCursorStyle() })
    ed.events.on('mode', () => { this.renderTools(); this.renderOptions(); this.renderTop() })
    ed.events.on('doc', () => { this.renderTop(); this.renderHud(); this.maybeAutosave() })
    ed.events.on('reload', () => { invalidateBake(); this.renderTop(); this.renderHud(); this.colorPanel.renderPalette() })
    ed.history.onChange(() => this.renderTop())

    this.viewport.onCursorMove = (x, y) => this.status.setCursor(x, y)

    installShortcuts(
      {
        ed,
        runCommand: (id) => this.runCommand(id),
        setTool: (id) => this.setTool(id as ToolId),
        cancelActive: () => this.viewport.cancelActive(),
      },
      () => this.commands,
    )

    // Coller une image depuis le systeme.
    window.addEventListener('paste', async (e) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      if (!item) return
      const file = item.getAsFile()
      if (!file) return
      e.preventDefault()
      const bitmap = imageToBitmap(await loadImageBitmap(file))
      ed.clipboard = { bitmap, mask: null, w: bitmap.width, h: bitmap.height }
      pasteClipboard(ed, { x: 0, y: 0 })
      showToast('Image collee', 'success')
    })

    // Glisser-deposer d'un fichier sur la fenetre.
    const area = qs('#canvas-area')
    area.addEventListener('dragover', (e) => e.preventDefault())
    area.addEventListener('drop', async (e) => {
      e.preventDefault()
      const file = (e as DragEvent).dataTransfer?.files?.[0]
      if (!file) return
      if (file.name.endsWith('.pixelforge')) {
        try {
          ed.loadSprite(await deserializeSprite(await file.text()))
          showToast('Projet ouvert', 'success')
        } catch { showToast('Projet illisible', 'error') }
        return
      }
      if (!file.type.startsWith('image/')) return
      ed.loadSprite(spriteFromImage(await loadImageBitmap(file), file.name.replace(/\.[^.]+$/, '')))
      showToast('Image importee', 'success')
    })

    window.addEventListener('beforeunload', (e) => {
      if (!ed.history.canUndo) return
      autosave(ed.sprite)
      e.preventDefault()
      e.returnValue = ''
    })

    setInterval(() => this.maybeAutosave(true), AUTOSAVE_INTERVAL)
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  /** Bascule dessin / squelette : outils, panneaux et reglages suivent. */
  setMode(mode: EditorMode): void {
    if (this.ed.mode === mode) return
    toolById(this.ed.settings.tool).cancel?.(this.ed)
    // En revenant au squelette, on reprend d'abord ce qui a ete redessine :
    // les poses suivantes partent du dessin corrige, sans reliaison.
    if (mode === 'rig' && syncRestFromCanvas(this.ed)) {
      showToast('Retouches reprises dans le squelette', 'success')
    }
    this.ed.setMode(mode)
    this.workspace.setMode(mode)
    this.renderTools()
    this.renderOptions()
    this.renderTop()
    this.viewport.updateCursorStyle()
    this.viewport.invalidate()
  }

  setTool(id: ToolId): void {
    if (this.ed.settings.tool === id) return
    // On annule proprement une forme ou une courbe encore en cours.
    toolById(this.ed.settings.tool).cancel?.(this.ed)
    this.ed.updateSettings({ tool: id })
    this.renderTools()
    this.renderOptions()
    this.viewport.updateCursorStyle()
  }

  command(id: string): Command | undefined { return this.commandMap.get(id) }

  runCommand(id: string): void {
    const cmd = this.commandMap.get(id)
    if (!cmd) return
    if (!(cmd.enabled?.() ?? true)) return
    void cmd.run()
  }

  openCommandPalette(): void { openCommandPalette(this.commands) }

  private maybeAutosave(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastAutosave < AUTOSAVE_INTERVAL) return
    if (!this.ed.history.canUndo) return
    this.lastAutosave = now
    if (autosave(this.ed.sprite)) this.status.markSaved()
  }

  /** Lecons disponibles, construites a la demande. */
  lessons(): Lesson[] { return buildLessons(this) }

  /**
   * Au demarrage : reprendre le travail precedent, sinon proposer la visite
   * guidee au tout premier lancement.
   */
  private async startupPrompts(): Promise<void> {
    const restored = await this.offerAutosaveRestore()
    if (!restored) await this.tutorial.offerFirstRun(this.lessons())
  }

  /** Propose de reprendre le travail precedent au demarrage. */
  private async offerAutosaveRestore(): Promise<boolean> {
    if (!hasAutosave()) return false
    const at = autosaveDate()
    const ok = await confirmDialog(
      'Reprendre votre travail ?',
      `Une sauvegarde automatique du ${at?.toLocaleString('fr-FR') ?? '—'} a ete trouvee dans ce navigateur.`,
      'Reprendre',
    )
    if (!ok) return false
    const sprite = await loadAutosave()
    if (sprite) {
      this.ed.loadSprite(sprite)
      showToast('Travail restaure', 'success')
      return true
    }
    return false
  }

  showAbout(): void {
    const body = el('div', null,
      el('p', { class: 'form-note', style: { fontSize: '13px', lineHeight: '1.65' } },
        'PixelForge est un editeur de sprites et d\'animation pixel art qui tourne entierement dans le navigateur. ',
        'Rien n\'est envoye sur un serveur : le document vit dans l\'onglet et la sauvegarde automatique reste locale.'),
      el('div', { class: 'form-section' }, 'Pense pour le game dev'),
      el('ul', { style: { margin: '0', paddingLeft: '18px', color: 'var(--text-dim)', lineHeight: '1.8', fontSize: '12.5px' } },
        el('li', null, 'Tags d\'animation exportes en clips Unity et en SpriteFrames Godot.'),
        el('li', null, 'Planches avec extrusion, marge et contrainte puissance de deux.'),
        el('li', null, 'JSON au format Aseprite, lu par Phaser, PixiJS, LibGDX, Defold.'),
        el('li', null, 'Mode tuile seamless, symetrie, pelure d\'oignon, tramage.'),
      ),
      el('div', { class: 'form-section' }, 'Pour commencer'),
      el('p', { class: 'form-note' },
        'Ctrl+K ouvre la palette de commandes, F1 liste les raccourcis. ',
        'Deposez une image ou une planche sur la zone de dessin pour l\'importer.'),
    )
    openModal({ title: 'A propos', icon: 'info', body, actions: [{ label: 'Fermer', primary: true }] })
  }
}

/** Document de depart : un petit sprite pret a dessiner. */
function defaultSprite(): Sprite {
  const sprite = new Sprite(32, 32, Palette.preset('DawnBringer 32'))
  sprite.name = 'sans-titre'
  sprite.grid = { x: 0, y: 0, w: 8, h: 8 }
  return sprite
}
