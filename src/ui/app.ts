import { Editor, type EditorMode, type ToolId } from '../core/editor'
import { getA, withAlpha } from '../core/color'
import { Sprite } from '../core/document'
import { Palette } from '../core/palette'
import { Viewport } from '../render/viewport'
import { DEFAULT_EXPORT, type ExportRequest } from '../export'
import { deserializeSprite } from '../io/project'
import {
  chargerProjet, enregistrerProjet, listerProjets, nouvelIdProjet,
  reprendreAncienneSauvegarde, type FicheProjet,
} from '../io/library'
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
import { poserFavicon, VuePixl, type ClipId } from './mascot-view'
import { carteAccueilPixl } from './mascot-ui'

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

  /**
   * Document ouvert avant qu'une demonstration ne prenne sa place.
   *
   * Ouvrir la mascotte remplacait le projet en cours sans laisser de porte
   * de sortie : on regardait ses six cycles et il fallait deviner que
   * Ctrl+N ramenait un editeur vide — en perdant son travail au passage.
   */
  private avantDemo: { nom: string; sprite: Sprite } | null = null

  /**
   * Entree de la bibliotheque que le document courant occupe.
   *
   * Elle est creee au premier enregistrement et suivie ensuite : sans elle,
   * chaque Ctrl+S deposerait un projet de plus et la liste se remplirait de
   * copies du meme dessin.
   */
  private projetId: string | null = null

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

    // L'onglet aussi porte la mascotte : c'est le seul endroit de
    // l'identite qui reste visible quand la fenetre est en arriere-plan.
    poserFavicon()
    this.renderTitle()

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

  /**
   * Nom du document dans l'onglet. Plusieurs sprites ouverts dans plusieurs
   * onglets etaient impossibles a distinguer : tous portaient le meme titre.
   */
  private renderTitle(): void {
    document.title = `${this.ed.sprite.name} — PixelForge`
  }
  private renderTools(): void { renderToolbar(qs('#toolbar'), this.ed, (id) => this.setTool(id as ToolId)) }
  private renderOptions(): void { renderOptionsBar(qs('#optionsbar'), this.ed, () => this.renderOptions()) }

  /** Pastilles d'information en bas de la zone de dessin. */
  private renderHud(): void {
    const hud = qs('#canvas-hud')
    clear(hud)
    const zoom = el('span', { class: 'chip' }, `${this.ed.view.zoom < 1 ? this.ed.view.zoom.toFixed(2) : this.ed.view.zoom}x`)
    hud.appendChild(zoom)
    // La taille du pinceau se regle a la molette et aux crochets : sans
    // repere pres du curseur, on la change a l'aveugle.
    if (toolById(this.ed.settings.tool).options.includes('brush')) {
      hud.appendChild(el('span', {
        class: 'chip',
        title: 'Taille du pinceau — Alt+molette, ou [ et ]',
      }, `${this.ed.settings.brushSize} px`))
    }
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
    ed.events.on('doc', () => { this.renderTop(); this.renderHud(); this.renderTitle(); this.maybeAutosave() })
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

    // Le vrai filet, c'est celui-ci et non `beforeunload` : une ecriture
    // IndexedDB est asynchrone, et une page qui se ferme n'attend pas la fin
    // d'une promesse. `visibilitychange` vers `hidden`, lui, part des qu'on
    // change d'onglet ou qu'on masque la fenetre — largement avant la
    // fermeture, avec tout le temps d'ecrire.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.maybeAutosave(true)
    })

    window.addEventListener('beforeunload', (e) => {
      if (!ed.history.canUndo) return
      // Lancee sans etre attendue : le navigateur laisse souvent une
      // transaction deja ouverte se terminer, mais rien ne le garantit.
      // C'est pour cela que le travail est aussi ecrit toutes les minutes et
      // a chaque passage en arriere-plan.
      void this.enregistrerDansBibliotheque()
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
    // Une demonstration n'est pas le travail de la personne : l'enregistrer
    // remplirait la bibliotheque de copies de la mascotte.
    if (this.avantDemo) return
    this.lastAutosave = now
    void this.enregistrerDansBibliotheque().then((ok) => { if (ok) this.status.markSaved() })
  }

  /** Identifiant de l'entree occupee par le document, ou null. */
  get projetCourant(): string | null { return this.projetId }

  /**
   * Ecrit le document dans la bibliotheque, en creant son entree au besoin.
   *
   * L'echec est rendu au lieu d'etre avale : l'ancienne sauvegarde renvoyait
   * `false` quand le quota explosait et personne ne le voyait jamais.
   */
  async enregistrerDansBibliotheque(): Promise<boolean> {
    try {
      const id = this.projetId ?? nouvelIdProjet()
      await enregistrerProjet(id, this.ed.sprite)
      this.projetId = id
      return true
    } catch (e) {
      this.ed.toast(`Enregistrement impossible : ${(e as Error).message}`, 'error')
      return false
    }
  }

  /** Ouvre un projet de la bibliotheque et s'y rattache. */
  ouvrirDeLaBibliotheque(id: string, sprite: Sprite): void {
    this.oublierDemo()
    this.ed.loadSprite(sprite)
    this.projetId = id
    showToast(`« ${sprite.name} » ouvert`, 'success')
  }

  /** Detache le document de son entree : le prochain enregistrement en cree une. */
  oublierProjetCourant(): void { this.projetId = null }

  /** Lecons disponibles, construites a la demande. */
  /** Nom de la demonstration affichee, ou null si c'est le projet de l'auteur. */
  get demoOuverte(): string | null { return this.avantDemo?.nom ?? null }

  /**
   * Ouvre une demonstration en gardant de cote le document en cours. Le
   * bouton de retour le repose tel quel : la visite ne coute rien.
   */
  ouvrirDemo(nom: string, sprite: Sprite): void {
    // Deux demos d'affilee : c'est le vrai projet qu'il faut garder, pas la
    // demo precedente.
    const precedent = this.avantDemo?.sprite ?? this.ed.sprite
    this.ed.loadSprite(sprite)
    this.avantDemo = { nom, sprite: precedent }
    this.renderTop()
  }

  /** Repose le document d'avant la demonstration. */
  quitterDemo(): void {
    const garde = this.avantDemo
    if (!garde) return
    this.avantDemo = null
    this.ed.loadSprite(garde.sprite)
    this.ed.toast(`Retour a « ${garde.sprite.name} »`, 'success')
    this.renderTop()
  }

  /** Une demo cesse d'en etre une des qu'on ouvre ou cree autre chose. */
  oublierDemo(): void { this.avantDemo = null; this.renderTop() }

  lessons(): Lesson[] { return buildLessons(this) }

  /**
   * Au demarrage : reprendre le travail precedent, sinon proposer la visite
   * guidee au tout premier lancement.
   */
  private async startupPrompts(): Promise<void> {
    const restored = await this.offerAutosaveRestore()
    if (restored) return
    await this.tutorial.offerFirstRun(this.lessons())
    // Le document est vierge et la visite a ete declinee : la toile est un
    // petit carre au milieu d'un grand fond vide. Pixl s'y installe, et
    // s'efface au premier trait.
    if (!this.tutorial.running && !this.ed.history.canUndo) {
      qs('#canvas-area').appendChild(carteAccueilPixl(this))
    }
  }

  /**
   * Propose de reprendre le dernier projet au demarrage.
   *
   * L'ancienne sauvegarde automatique de localStorage est d'abord versee
   * dans la bibliotheque : quelqu'un qui revient avec un travail en cours ne
   * doit pas le perdre parce qu'on a change de rangement.
   */
  private async offerAutosaveRestore(): Promise<boolean> {
    let dernier: FicheProjet | null = null
    try {
      dernier = await reprendreAncienneSauvegarde()
      if (!dernier) dernier = (await listerProjets())[0] ?? null
    } catch {
      // Sans stockage local, on demarre simplement sur un document vierge.
      return false
    }
    if (!dernier) return false

    const ok = await confirmDialog(
      'Reprendre votre travail ?',
      `« ${dernier.nom} » vous attend, enregistre le ${new Date(dernier.maj).toLocaleString('fr-FR')}.`,
      'Reprendre',
    )
    if (!ok) return false
    const sprite = await chargerProjet(dernier.id)
    if (!sprite) return false
    this.ed.loadSprite(sprite)
    this.projetId = dernier.id
    showToast('Travail restaure', 'success')
    return true
  }

  showAbout(): void {
    // Elle se presente en s'animant : dire « editeur d'animation » et le
    // montrer dans la meme boite vaut mieux que de l'ecrire deux fois.
    const vue = new VuePixl({ echelle: 3, clip: 'repos', titre: 'Cliquez : Pixl passe au cycle suivant' })
    const cycles: ClipId[] = ['repos', 'marche', 'course', 'saut', 'attaque', 'degats']
    let rang = 0
    const scene = el('div', { class: 'pixl-carte-scene', onclick: () => {
      rang = (rang + 1) % cycles.length
      vue.jouer(cycles[rang], cycles[rang] === 'repos' ? null : 'repos')
      legende.textContent = `Pixl · cycle ${cycles[rang]}`
    } }, vue.node)
    const legende = el('span', { class: 'pixl-carte-legende' }, 'Pixl · cycle repos')

    const body = el('div', null,
      el('div', { class: 'pixl-carte' }, scene,
        el('div', null,
          el('p', { class: 'form-note', style: { margin: '0 0 6px', fontSize: '13px', lineHeight: '1.65' } },
            'PixelForge est un editeur de sprites et d\'animation pixel art qui tourne entierement dans le navigateur. ',
            'Rien n\'est envoye sur un serveur : le document vit dans l\'onglet et la sauvegarde automatique reste locale.'),
          legende,
        ),
      ),
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
