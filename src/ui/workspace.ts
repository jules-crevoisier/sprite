import { el, clear } from './dom'
import { icon } from './icons'
import { openMenu, showToast, type MenuItem } from './overlay'

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
  timelineVisible: boolean
}

const STORAGE_KEY = 'pixelforge.layout.v3'
const MIN_DOCK = 180
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
      timelineVisible: false,
    }),
  },
  animation: {
    label: 'Animation',
    hint: 'Apercu et calques, timeline en avant',
    layout: () => ({
      docks: { left: [], right: ['preview', 'layers', 'rig'] },
      hidden: ['color', 'palette'],
      collapsed: [],
      widths: { left: 260, right: 264 },
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
      timelineVisible: false,
    }),
  },
}

/**
 * Gere les panneaux lateraux : rangement dans un dock gauche ou droit,
 * ordre, pliage, visibilite et largeur. L'etat est conserve d'une session a
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
        label: `Deplacer a ${other === 'left' ? 'gauche' : 'droite'}`,
        icon: other === 'left' ? 'panel-left' : 'panel-right',
        onClick: () => this.place(id, other, this.state.docks[other].length),
      },
      { separator: true },
      { label: 'Masquer ce panneau', icon: 'eye-off', onClick: () => this.setVisible(id, false) },
    ], 'right')
  }

  /** Menu global de l'espace de travail. */
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
  timelineVisible: true,
})

const clampWidth = (n: number): number => Math.max(MIN_DOCK, Math.min(MAX_DOCK, Math.round(n)))
