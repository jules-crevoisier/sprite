import { el, clear } from './dom'
import { icon } from './icons'
import { confirmDialog, openMenu, promptDialog, showToast, type MenuItem } from './overlay'

export type DockSide = 'left' | 'right'
export type WorkMode = 'draw' | 'rig'

export interface PanelDef {
  id: string
  title: string
  icon: string
  /** Contenu du panneau, construit une seule fois puis deplace. */
  content: HTMLElement
  /** Boutons affiches dans l'entete. */
  actions?: HTMLElement[]
  /** Le panneau se partage la hauteur restante du dock. */
  grow?: boolean
  minHeight?: number
}

export interface LayoutState {
  docks: Record<DockSide, string[]>
  hidden: string[]
  collapsed: string[]
  widths: Record<DockSide, number>
  /**
   * Hauteur imposee a un panneau, en pixels. Un panneau absent de cette table
   * se dimensionne sur son contenu, comme avant.
   *
   * Sans elle, la colonne de droite imposait ses proportions : le selecteur de
   * couleur gardait ses 130 pixels de carre alors qu'on aurait voulu le voir
   * grand, et la palette rendait la moitie du dock a un vide inutile.
   */
  heights: Record<string, number>
  timelineVisible: boolean
}

/** Une disposition que quelqu'un a composee, nommee et rangee. */
export interface DispositionEnregistree {
  nom: string
  /** Une disposition par mode : les deux voyagent ensemble. */
  draw: LayoutState
  rig: LayoutState
  /** Date d'enregistrement, pour trier du plus recent au plus ancien. */
  quand: number
}

const STORAGE_KEY = 'pixelforge.layout.v3'
const CLE_DISPOSITIONS = 'pixelforge.dispositions.v1'
/** Hauteur minimale d'un panneau qu'on retaille : de quoi voir son en-tete. */
const MIN_PANEL = 64
const MAX_PANEL = 1400
// A 180 les en-tetes de panneau sortaient du dock et se faisaient rogner,
// et l'opacite affichait « 10 » au lieu de « 100% ». Le contenu reel en
// demande 240.
const MIN_DOCK = 240
const MAX_DOCK = 520

/** Dispositions proposees dans le menu, adaptees a une facon de travailler. */
export const PRESETS: Record<string, { label: string; hint: string; layout: () => LayoutState }> = {
  complet: {
    label: 'Complet',
    hint: 'Tous les panneaux a droite',
    layout: () => ({
      docks: { left: [], right: ['preview', 'layers', 'color', 'palette', 'rig'] },
      hidden: ['rig'],
      collapsed: [],
      widths: { left: 260, right: 264 },
      heights: {},
      timelineVisible: true,
    }),
  },
  dessin: {
    label: 'Dessin',
    hint: 'Couleur et palette, grande toile',
    layout: () => ({
      docks: { left: [], right: ['color', 'palette', 'layers'] },
      hidden: ['preview', 'rig'],
      collapsed: [],
      widths: { left: 260, right: 250 },
      heights: {},
      timelineVisible: false,
    }),
  },
  animation: {
    label: 'Animation',
    hint: 'Aperçu et calques, timeline en avant',
    layout: () => ({
      docks: { left: [], right: ['preview', 'layers', 'rig'] },
      hidden: ['color', 'palette'],
      collapsed: [],
      widths: { left: 260, right: 264 },
      heights: {},
      timelineVisible: true,
    }),
  },
  double: {
    label: 'Deux colonnes',
    hint: 'Outils a gauche, couleurs a droite',
    layout: () => ({
      docks: { left: ['preview', 'layers'], right: ['color', 'palette'] },
      hidden: ['rig'],
      collapsed: [],
      widths: { left: 232, right: 246 },
      heights: {},
      timelineVisible: true,
    }),
  },
  minimal: {
    label: 'Minimal',
    hint: 'Rien que la toile',
    layout: () => ({
      docks: { left: [], right: ['palette'] },
      hidden: ['preview', 'layers', 'color', 'rig'],
      collapsed: [],
      widths: { left: 260, right: 200 },
      heights: {},
      timelineVisible: false,
    }),
  },
}

/**
 * Gere les panneaux lateraux : rangement dans un dock gauche ou droit,
 * ordre, pliage, visibilite et largeur. L'état est conserve d'une session a
 * l'autre dans le navigateur.
 */
export class Workspace {
  private panels = new Map<string, PanelDef>()
  /** Une disposition par mode : le squelette n'a pas les memes besoins. */
  private states: Record<WorkMode, LayoutState>
  private mode: WorkMode = 'draw'
  private docks: Record<DockSide, HTMLElement>
  private splitters: Record<DockSide, HTMLElement>
  private timelineEl: HTMLElement
  private dragging: string | null = null
  private onLayoutChange: (reason: 'layout' | 'resize') => void

  constructor(
    panels: PanelDef[],
    elements: {
      left: HTMLElement
      right: HTMLElement
      splitLeft: HTMLElement
      splitRight: HTMLElement
      timeline: HTMLElement
    },
    onLayoutChange: (reason: 'layout' | 'resize') => void = () => {},
  ) {
    for (const p of panels) this.panels.set(p.id, p)
    this.docks = { left: elements.left, right: elements.right }
    this.splitters = { left: elements.splitLeft, right: elements.splitRight }
    this.timelineEl = elements.timeline
    this.onLayoutChange = onLayoutChange
    this.states = { draw: this.load('draw'), rig: this.load('rig') }
    this.bindSplitters()
    this.render()
  }

  /* ---------------------------------------------------------------- */
  /* Persistance                                                       */
  /* ---------------------------------------------------------------- */

  /** Disposition courante du mode actif. */
  private get state(): LayoutState { return this.states[this.mode] }
  private set state(next: LayoutState) { this.states[this.mode] = next }

  /** Bascule de mode : la disposition suit. */
  setMode(mode: WorkMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.render()
  }

  private load(mode: WorkMode): LayoutState {
    const fallback = mode === 'rig' ? RIG_LAYOUT() : PRESETS.complet.layout()
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}.${mode}`)
      if (!raw) return fallback
      const parsed = JSON.parse(raw) as Partial<LayoutState>
      const merged: LayoutState = {
        docks: {
          left: parsed.docks?.left?.filter((id) => this.panels.has(id)) ?? [],
          right: parsed.docks?.right?.filter((id) => this.panels.has(id)) ?? [],
        },
        hidden: parsed.hidden?.filter((id) => this.panels.has(id)) ?? [],
        collapsed: parsed.collapsed?.filter((id) => this.panels.has(id)) ?? [],
        widths: {
          left: clampWidth(parsed.widths?.left ?? fallback.widths.left),
          right: clampWidth(parsed.widths?.right ?? fallback.widths.right),
        },
        heights: nettoyerHauteurs(parsed.heights, (id) => this.panels.has(id)),
        timelineVisible: parsed.timelineVisible ?? true,
      }
      // Un panneau ajoute par une mise a jour doit apparaitre quelque part.
      const known = new Set([...merged.docks.left, ...merged.docks.right, ...merged.hidden])
      for (const id of this.panels.keys()) if (!known.has(id)) merged.docks.right.push(id)
      return merged
    } catch {
      return fallback
    }
  }

  private save(): void {
    try { localStorage.setItem(`${STORAGE_KEY}.${this.mode}`, JSON.stringify(this.state)) } catch { /* quota */ }
  }

  /* ---------------------------------------------------------------- */
  /* Rendu                                                             */
  /* ---------------------------------------------------------------- */

  render(): void {
    for (const side of ['left', 'right'] as DockSide[]) {
      const dock = this.docks[side]
      clear(dock)
      const ids = this.state.docks[side].filter((id) => !this.state.hidden.includes(id))
      for (const id of ids) {
        const panel = this.panels.get(id)
        if (panel) dock.appendChild(this.renderPanel(panel, side))
      }
      const empty = ids.length === 0
      dock.classList.toggle('is-empty', empty)
      dock.style.width = empty ? '0' : `${this.state.widths[side]}px`
      this.splitters[side].classList.toggle('is-hidden', empty)
      // Zone de depot en fin de dock, pour ranger un panneau tout en bas.
      if (!empty) dock.appendChild(this.dropZone(side, ids.length))
    }
    this.timelineEl.classList.toggle('is-hidden', !this.state.timelineVisible)
    this.save()
    this.onLayoutChange('layout')
  }

  private renderPanel(panel: PanelDef, side: DockSide): HTMLElement {
    const collapsed = this.state.collapsed.includes(panel.id)

    const chevron = el('button', {
      class: `panel-toggle ${collapsed ? '' : 'open'}`,
      title: collapsed ? 'Deplier' : 'Plier',
      html: icon('chevron', 12),
      onclick: (e: MouseEvent) => { e.stopPropagation(); this.toggleCollapsed(panel.id) },
    })

    const head = el('div', { class: 'panel-head', draggable: true },
      chevron,
      el('span', { class: 'panel-title' }, panel.title),
      el('span', { class: 'spacer' }),
    )
    for (const action of panel.actions ?? []) head.appendChild(action)
    head.appendChild(el('button', {
      class: 'panel-toggle',
      title: 'Options du panneau',
      html: icon('sliders', 12),
      onclick: (e: MouseEvent) => { e.stopPropagation(); this.panelMenu(e.currentTarget as HTMLElement, panel.id, side) },
    }))

    head.addEventListener('dblclick', () => this.toggleCollapsed(panel.id))
    head.addEventListener('dragstart', (e) => {
      this.dragging = panel.id
      e.dataTransfer?.setData('text/plain', panel.id)
      section.classList.add('is-dragging')
    })
    head.addEventListener('dragend', () => {
      this.dragging = null
      section.classList.remove('is-dragging')
    })

    const section = el('section', {
      class: `panel ${panel.grow ? 'grow' : ''} ${collapsed ? 'collapsed' : ''}`,
      dataset: { panel: panel.id },
    }, head, panel.content)
    if (panel.minHeight) section.style.minHeight = `${panel.minHeight}px`

    // Hauteur choisie a la main : elle prend le pas sur le contenu et sur la
    // regle « ce panneau-ci s'etire ».
    const hauteur = this.state.heights[panel.id]
    if (hauteur && !collapsed) {
      section.style.height = `${hauteur}px`
      section.style.flex = 'none'
      // Le plafond de 36vh du corps d'un panneau extensible n'a plus lieu
      // d'etre : c'est la hauteur demandee qui commande.
      section.classList.add('hauteur-reglee')
    }
    if (!collapsed) section.appendChild(this.poigneeHauteur(panel, section))

    // Deposer sur la moitie haute insere avant, sur la moitie basse apres.
    section.addEventListener('dragover', (e) => {
      if (!this.dragging || this.dragging === panel.id) return
      e.preventDefault()
      const r = section.getBoundingClientRect()
      const after = e.clientY > r.top + r.height / 2
      section.classList.toggle('drop-before', !after)
      section.classList.toggle('drop-after', after)
    })
    section.addEventListener('dragleave', () => {
      section.classList.remove('drop-before', 'drop-after')
    })
    section.addEventListener('drop', (e) => {
      e.preventDefault()
      const after = section.classList.contains('drop-after')
      section.classList.remove('drop-before', 'drop-after')
      const moved = this.dragging
      if (!moved) return
      const target = this.state.docks[side].indexOf(panel.id)
      this.place(moved, side, after ? target + 1 : target)
    })

    return section
  }

  /** Bande de depot sous le dernier panneau du dock. */
  private dropZone(side: DockSide, index: number): HTMLElement {
    const zone = el('div', { class: 'dock-drop' })
    zone.addEventListener('dragover', (e) => {
      if (!this.dragging) return
      e.preventDefault()
      zone.classList.add('active')
    })
    zone.addEventListener('dragleave', () => zone.classList.remove('active'))
    zone.addEventListener('drop', (e) => {
      e.preventDefault()
      zone.classList.remove('active')
      if (this.dragging) this.place(this.dragging, side, index)
    })
    return zone
  }

  /* ---------------------------------------------------------------- */
  /* Operations                                                        */
  /* ---------------------------------------------------------------- */

  /** Range un panneau dans un dock, a une position donnee. */
  place(id: string, side: DockSide, index: number): void {
    for (const s of ['left', 'right'] as DockSide[]) {
      const at = this.state.docks[s].indexOf(id)
      if (at >= 0) {
        this.state.docks[s].splice(at, 1)
        if (s === side && at < index) index--
      }
    }
    this.state.hidden = this.state.hidden.filter((h) => h !== id)
    this.state.docks[side].splice(Math.max(0, Math.min(index, this.state.docks[side].length)), 0, id)
    this.render()
  }

  toggleCollapsed(id: string): void {
    const at = this.state.collapsed.indexOf(id)
    if (at >= 0) this.state.collapsed.splice(at, 1)
    else this.state.collapsed.push(id)
    this.render()
  }

  setVisible(id: string, visible: boolean): void {
    if (visible) {
      this.state.hidden = this.state.hidden.filter((h) => h !== id)
      const inDock = this.state.docks.left.includes(id) || this.state.docks.right.includes(id)
      if (!inDock) this.state.docks.right.push(id)
    } else if (!this.state.hidden.includes(id)) {
      this.state.hidden.push(id)
    }
    this.render()
  }

  isVisible(id: string): boolean { return !this.state.hidden.includes(id) }

  get timelineVisible(): boolean { return this.state.timelineVisible }
  setTimelineVisible(visible: boolean): void {
    this.state.timelineVisible = visible
    this.render()
  }

  applyPreset(name: keyof typeof PRESETS): void {
    const preset = PRESETS[name]
    if (!preset) return
    this.state = preset.layout()
    // Un panneau enregistre apres coup ne doit pas disparaitre du preset.
    const known = new Set([...this.state.docks.left, ...this.state.docks.right, ...this.state.hidden])
    for (const id of this.panels.keys()) if (!known.has(id)) this.state.docks.right.push(id)
    this.render()
    showToast(`Disposition « ${preset.label} »`, 'success')
  }

  reset(): void {
    if (this.mode === 'rig') { this.state = RIG_LAYOUT(); this.render(); return }
    this.applyPreset('complet')
  }

  /* ---------------------------------------------------------------- */
  /* Menus                                                             */
  /* ---------------------------------------------------------------- */

  private panelMenu(anchor: HTMLElement, id: string, side: DockSide): void {
    const other: DockSide = side === 'left' ? 'right' : 'left'
    openMenu(anchor, [
      {
        label: this.state.collapsed.includes(id) ? 'Deplier' : 'Plier',
        icon: 'chevron',
        onClick: () => this.toggleCollapsed(id),
      },
      {
        label: `Déplacer a ${other === 'left' ? 'gauche' : 'droite'}`,
        icon: other === 'left' ? 'panel-left' : 'panel-right',
        onClick: () => this.place(id, other, this.state.docks[other].length),
      },
      { separator: true },
      { label: 'Masquer ce panneau', icon: 'eye-off', onClick: () => this.setVisible(id, false) },
    ], 'right')
  }

  /** Menu global de l'espace de travail. */
  /**
   * Bande a tirer au bas d'un panneau pour en regler la hauteur.
   *
   * Elle vit dans le panneau plutot qu'entre deux panneaux : ainsi le dernier
   * de la colonne se regle comme les autres, et une poignee ne se retrouve
   * jamais orpheline quand le panneau du dessous est masque. Le double-clic
   * rend la hauteur au contenu.
   */
  private poigneeHauteur(panel: PanelDef, section: HTMLElement): HTMLElement {
    const poignee = el('div', {
      class: 'panel-grip',
      title: 'Glisser pour régler la hauteur · double-clic pour la hauteur automatique',
    })
    poignee.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault()
      poignee.setPointerCapture(e.pointerId)
      poignee.classList.add('active')
      const departY = e.clientY
      const departH = section.getBoundingClientRect().height
      const plancher = Math.max(MIN_PANEL, panel.minHeight ?? 0)
      const move = (ev: PointerEvent) => {
        const h = Math.max(plancher, Math.min(MAX_PANEL, Math.round(departH + ev.clientY - departY)))
        this.state.heights[panel.id] = h
        section.style.height = `${h}px`
        section.style.flex = 'none'
        section.classList.add('hauteur-reglee')
        this.onLayoutChange('resize')
      }
      const up = () => {
        poignee.classList.remove('active')
        poignee.removeEventListener('pointermove', move)
        poignee.removeEventListener('pointerup', up)
        this.save()
      }
      poignee.addEventListener('pointermove', move)
      poignee.addEventListener('pointerup', up)
    })
    poignee.addEventListener('dblclick', () => {
      delete this.state.heights[panel.id]
      this.save()
      this.render()
    })
    return poignee
  }

  /* ---------------------------------------------------------------- */
  /* Dispositions enregistrees                                         */
  /* ---------------------------------------------------------------- */

  /** Les dispositions rangees par la personne, de la plus recente a la plus ancienne. */
  dispositions(): DispositionEnregistree[] {
    try {
      const brut = JSON.parse(localStorage.getItem(CLE_DISPOSITIONS) ?? '[]') as DispositionEnregistree[]
      if (!Array.isArray(brut)) return []
      return brut
        .filter((d) => d && typeof d.nom === 'string' && d.draw && d.rig)
        .sort((a, b) => (b.quand ?? 0) - (a.quand ?? 0))
    } catch {
      return []
    }
  }

  private ecrireDispositions(liste: DispositionEnregistree[]): void {
    try { localStorage.setItem(CLE_DISPOSITIONS, JSON.stringify(liste)) } catch { /* quota */ }
  }

  /**
   * Range la disposition courante sous un nom.
   *
   * Les deux modes partent ensemble : quelqu'un qui a passe du temps a poser
   * ses panneaux de dessin ET ceux du squelette ne veut pas avoir a
   * enregistrer deux fois, ni decouvrir au retour que la moitie a ete perdue.
   */
  enregistrerDisposition(nom: string): void {
    const propre = nom.trim().slice(0, 40)
    if (!propre) return
    const liste = this.dispositions().filter((d) => d.nom !== propre)
    liste.unshift({
      nom: propre,
      draw: structuredClone(this.states.draw),
      rig: structuredClone(this.states.rig),
      quand: Date.now(),
    })
    this.ecrireDispositions(liste.slice(0, 24))
    showToast(`Disposition « ${propre} » enregistrée`, 'success')
  }

  appliquerDisposition(nom: string): void {
    const d = this.dispositions().find((x) => x.nom === nom)
    if (!d) return
    this.states.draw = this.valider(d.draw)
    this.states.rig = this.valider(d.rig)
    this.render()
    showToast(`Disposition « ${nom} »`, 'success')
  }

  supprimerDisposition(nom: string): void {
    this.ecrireDispositions(this.dispositions().filter((d) => d.nom !== nom))
  }

  /**
   * Remet une disposition venue du stockage dans les clous.
   *
   * Une disposition enregistree avant l'ajout d'un panneau ne le connait pas :
   * sans ce passage, ce panneau disparaitrait de l'interface sans moyen de le
   * faire revenir.
   */
  private valider(etat: LayoutState): LayoutState {
    const out: LayoutState = {
      docks: {
        left: (etat.docks?.left ?? []).filter((id) => this.panels.has(id)),
        right: (etat.docks?.right ?? []).filter((id) => this.panels.has(id)),
      },
      hidden: (etat.hidden ?? []).filter((id) => this.panels.has(id)),
      collapsed: (etat.collapsed ?? []).filter((id) => this.panels.has(id)),
      widths: {
        left: clampWidth(etat.widths?.left ?? 260),
        right: clampWidth(etat.widths?.right ?? 264),
      },
      heights: nettoyerHauteurs(etat.heights, (id) => this.panels.has(id)),
      timelineVisible: etat.timelineVisible ?? true,
    }
    const connus = new Set([...out.docks.left, ...out.docks.right, ...out.hidden])
    for (const id of this.panels.keys()) if (!connus.has(id)) out.docks.right.push(id)
    return out
  }

  workspaceMenu(anchor: HTMLElement): void {
    const items: MenuItem[] = [{ title: 'Dispositions' }]
    for (const [key, preset] of Object.entries(PRESETS)) {
      items.push({
        label: `${preset.label} — ${preset.hint}`,
        icon: 'layout',
        onClick: () => this.applyPreset(key),
      })
    }
    items.push({ separator: true }, { title: 'Panneaux' })
    for (const panel of this.panels.values()) {
      items.push({
        label: panel.title,
        icon: panel.icon,
        checked: this.isVisible(panel.id),
        onClick: () => this.setVisible(panel.id, !this.isVisible(panel.id)),
      })
    }
    const miennes = this.dispositions()
    if (miennes.length) {
      items.push({ separator: true }, { title: 'Mes dispositions' })
      for (const d of miennes) {
        items.push({
          label: d.nom,
          icon: 'library',
          onClick: () => this.appliquerDisposition(d.nom),
        })
      }
    }

    items.push(
      { separator: true },
      {
        label: 'Enregistrer la disposition actuelle…',
        icon: 'save',
        hint: 'Les panneaux, leurs largeurs et leurs hauteurs, pour les deux modes',
        onClick: () => {
          void promptDialog('Enregistrer la disposition', 'Nom', '').then((nom) => {
            if (nom?.trim()) this.enregistrerDisposition(nom)
          })
        },
      },
    )
    if (miennes.length) {
      items.push({
        label: 'Supprimer une disposition…',
        icon: 'trash',
        onClick: () => this.menuSuppression(anchor),
      })
    }

    items.push(
      { separator: true },
      {
        label: 'Timeline',
        icon: 'panel-bottom',
        checked: this.state.timelineVisible,
        onClick: () => this.setTimelineVisible(!this.state.timelineVisible),
      },
      { separator: true },
      { label: 'Reinitialiser la disposition', icon: 'refresh', onClick: () => this.reset() },
    )
    openMenu(anchor, items, 'right')
  }

  /** Second menu, ou l'on choisit la disposition a jeter. */
  private menuSuppression(anchor: HTMLElement): void {
    const items: MenuItem[] = [{ title: 'Supprimer une disposition' }]
    for (const d of this.dispositions()) {
      items.push({
        label: d.nom,
        icon: 'trash',
        onClick: () => {
          void confirmDialog('Supprimer',
            `Supprimer la disposition « ${d.nom} » ? Les panneaux en place ne bougent pas.`,
            'Supprimer').then((ok) => {
            if (!ok) return
            this.supprimerDisposition(d.nom)
            showToast(`Disposition « ${d.nom} » supprimée`, 'success')
          })
        },
      })
    }
    openMenu(anchor, items, 'right')
  }

  /* ---------------------------------------------------------------- */
  /* Redimensionnement                                                 */
  /* ---------------------------------------------------------------- */

  private bindSplitters(): void {
    for (const side of ['left', 'right'] as DockSide[]) {
      const splitter = this.splitters[side]
      splitter.addEventListener('pointerdown', (e) => {
        splitter.setPointerCapture(e.pointerId)
        splitter.classList.add('active')
        const startX = e.clientX
        const startW = this.state.widths[side]
        const move = (ev: PointerEvent) => {
          const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX
          this.state.widths[side] = clampWidth(startW + delta)
          this.docks[side].style.width = `${this.state.widths[side]}px`
          this.onLayoutChange('resize')
        }
        const up = () => {
          splitter.classList.remove('active')
          splitter.removeEventListener('pointermove', move)
          splitter.removeEventListener('pointerup', up)
          this.save()
        }
        splitter.addEventListener('pointermove', move)
        splitter.addEventListener('pointerup', up)
      })
      splitter.addEventListener('dblclick', () => {
        this.state.widths[side] = 264
        this.render()
      })
    }
  }
}

/** Disposition par defaut du mode squelette : la hierarchie prend la place. */
const RIG_LAYOUT = (): LayoutState => ({
  docks: { left: [], right: ['rig', 'preview', 'layers'] },
  hidden: ['color', 'palette'],
  collapsed: [],
  widths: { left: 260, right: 288 },
  heights: {},
  timelineVisible: true,
})

const clampWidth = (n: number): number => Math.max(MIN_DOCK, Math.min(MAX_DOCK, Math.round(n)))
const clampHauteur = (n: number): number => Math.max(MIN_PANEL, Math.min(MAX_PANEL, Math.round(n)))

/**
 * Ne garde que des hauteurs plausibles, pour des panneaux qui existent.
 *
 * Le stockage du navigateur n'est pas de confiance : il traverse les mises a
 * jour, et une hauteur de zero ou de trois mille pixels rendrait la colonne
 * inutilisable sans qu'on comprenne pourquoi.
 */
function nettoyerHauteurs(
  brut: Record<string, number> | undefined,
  connu: (id: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, h] of Object.entries(brut ?? {})) {
    if (!connu(id) || !Number.isFinite(h)) continue
    out[id] = clampHauteur(h)
  }
  return out
}
