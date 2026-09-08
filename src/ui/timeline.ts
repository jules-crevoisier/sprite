import type { Editor } from '../core/editor'
import { toCss, fromHex } from '../core/color'
import { genId, type Tag } from '../core/document'
import { el, clear, iconButton, numberInput } from './dom'
import { icon } from './icons'
import { openMenu, promptDialog, openModal } from './overlay'
import type { Playback } from './playback'

const COL_W = 44
const NAME_W = 148

/**
 * Timeline facon Aseprite : une colonne par frame, une ligne par calque,
 * plus une bande de tags d'animation au-dessus.
 */
export class TimelinePanel {
  readonly root: HTMLElement
  private ed: Editor
  private playback: Playback
  private toolbar = el('div', { class: 'tl-toolbar' })
  private scroll = el('div', { class: 'tl-scroll' })
  private grid = el('div', { class: 'tl-grid' })
  private showThumbs = true
  private container: HTMLElement | null = null
  /** Hauteur fixee a la souris ; null = ajustement automatique. */
  private manualHeight: number | null = null

  constructor(editor: Editor, playback: Playback) {
    this.ed = editor
    this.playback = playback
    this.scroll.appendChild(this.grid)
    this.root = el('div', { style: { display: 'contents' } }, this.makeResizer(), this.toolbar, this.scroll)

    editor.events.on('doc', () => this.render())
    editor.events.on('cursor', () => this.renderSelectionOnly())
    editor.events.on('reload', () => this.render())
    editor.events.on('playback', () => this.renderToolbar())
    this.render()
  }

  render(): void {
    const cells = this.ed.sprite.layers.length * this.ed.sprite.frameCount
    this.showThumbs = cells <= 160
    this.renderToolbar()
    this.renderGrid()
    this.syncHeight()
  }

  /** Poignee de redimensionnement sur le bord superieur de la timeline. */
  private makeResizer(): HTMLElement {
    const handle = el('div', { class: 'tl-resizer', title: 'Glisser pour redimensionner la timeline' })
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId)
      const startY = e.clientY
      const startH = this.container?.getBoundingClientRect().height ?? 200
      const move = (ev: PointerEvent) => {
        this.manualHeight = Math.max(64, Math.min(window.innerHeight * 0.7, startH - (ev.clientY - startY)))
        this.syncHeight()
      }
      const up = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
    })
    handle.addEventListener('dblclick', () => { this.manualHeight = null; this.syncHeight() })
    return handle
  }

  /** Ajuste la hauteur du panneau au nombre de calques, sans exceder 45% de l'ecran. */
  private syncHeight(): void {
    this.container ??= this.toolbar.parentElement as HTMLElement | null
    if (!this.container) return
    const needed = 5 + 36 + 26 + 20 + this.ed.sprite.layers.length * 30 + 14
    const height = this.manualHeight ?? Math.min(window.innerHeight * 0.45, needed)
    this.container.style.height = `${Math.round(height)}px`
  }

  /** Mise a jour legere quand seule la position du curseur change. */
  private renderSelectionOnly(): void {
    const ed = this.ed
    for (const node of this.grid.querySelectorAll<HTMLElement>('[data-frame]')) {
      const frame = Number(node.dataset.frame)
      const layer = node.dataset.layer ? Number(node.dataset.layer) : null
      if (node.classList.contains('tl-head-cell')) {
        node.classList.toggle('current', frame === ed.activeFrame)
        node.classList.toggle('selected', ed.frameSelection.has(frame))
      } else if (layer !== null) {
        node.classList.toggle('active', frame === ed.activeFrame && layer === ed.activeLayer)
      }
    }
    for (const node of this.grid.querySelectorAll<HTMLElement>('[data-layer-row]')) {
      node.classList.toggle('active', Number(node.dataset.layerRow) === ed.activeLayer)
    }
    this.renderToolbar()
  }

  /* ---------------------------------------------------------------- */
  /* Barre d'outils                                                    */
  /* ---------------------------------------------------------------- */

  private renderToolbar(): void {
    clear(this.toolbar)
    const ed = this.ed
    const t = this.toolbar
    const duration = ed.sprite.frameDurations[ed.activeFrame] ?? 100

    t.append(
      iconButton(icon('prev', 15), 'Frame precedente (,)', () => ed.setActiveFrame(ed.activeFrame - 1), { className: 'ghost sm icon-only' }),
      iconButton(icon(ed.playing ? 'pause' : 'play', 15), 'Lecture (Entree)', () => this.playback.toggle(),
        { className: `sm icon-only ${ed.playing ? 'active' : ''}` }),
      iconButton(icon('next', 15), 'Frame suivante (.)', () => ed.setActiveFrame(ed.activeFrame + 1), { className: 'ghost sm icon-only' }),
      iconButton(icon('loop', 15), 'Limiter la lecture au tag courant', () => {
        ed.playTagOnly = !ed.playTagOnly
        this.renderToolbar()
      }, { className: `sm icon-only ${ed.playTagOnly ? 'active' : 'ghost'}` }),
      el('div', { class: 'opt-sep' }),
      iconButton(icon('plus', 15), 'Nouvelle frame (Alt+N)', () => this.addFrame(), { className: 'ghost sm icon-only' }),
      iconButton(icon('duplicate', 15), 'Dupliquer la frame (Ctrl+Alt+N)', () => this.duplicateFrame(), { className: 'ghost sm icon-only' }),
      iconButton(icon('trash', 15), 'Supprimer la frame', () => this.deleteFrame(), { className: 'ghost sm icon-only' }),
      el('div', { class: 'opt-sep' }),
    )

    const durInput = numberInput(duration, (v) => this.setDuration(Math.max(1, v)), { min: 1, max: 60000, width: '62px' })
    t.append(el('div', { class: 'tl-fps' },
      el('span', null, 'Duree'),
      durInput,
      el('span', null, 'ms'),
      el('span', { style: { color: 'var(--text-faint)' } }, `≈ ${Math.round(1000 / Math.max(1, duration))} fps`),
    ))

    t.append(
      el('div', { class: 'opt-sep' }),
      iconButton(icon('onion', 15), 'Pelure d\'oignon', () => {
        ed.onion.enabled = !ed.onion.enabled
        ed.events.emit('settings', undefined)
        this.renderToolbar()
      }, { className: `sm icon-only ${ed.onion.enabled ? 'active' : 'ghost'}` }),
      iconButton(icon('settings', 14), 'Reglages de la pelure d\'oignon', (e) => this.onionMenu(e), { className: 'ghost sm icon-only' }),
      el('div', { class: 'opt-sep' }),
      iconButton(icon('tag', 15), 'Nouveau tag d\'animation sur la selection', () => this.createTag(), { className: 'ghost sm icon-only', label: 'Tag' }),
    )

    t.append(el('div', { class: 'spacer' }))
    t.append(el('div', { class: 'tl-fps' },
      el('span', null, `${ed.frameCount} frame${ed.frameCount > 1 ? 's' : ''} · ${(ed.sprite.totalDuration() / 1000).toFixed(2)}s`),
    ))
  }

  private onionMenu(e: MouseEvent): void {
    const ed = this.ed
    const o = ed.onion
    openMenu(e.currentTarget as HTMLElement, [
      { title: 'Frames precedentes' },
      ...[0, 1, 2, 3].map((n) => ({
        label: `${n}`,
        checked: o.prev === n,
        onClick: () => { o.prev = n; o.enabled = true; ed.events.emit('settings', undefined); this.renderToolbar() },
      })),
      { title: 'Frames suivantes' },
      ...[0, 1, 2, 3].map((n) => ({
        label: `${n}`,
        checked: o.next === n,
        onClick: () => { o.next = n; o.enabled = true; ed.events.emit('settings', undefined); this.renderToolbar() },
      })),
      { separator: true },
      {
        label: 'Teinter (rouge / bleu)',
        checked: o.tint,
        onClick: () => { o.tint = !o.tint; ed.events.emit('settings', undefined) },
      },
    ])
  }

  /* ---------------------------------------------------------------- */
  /* Grille                                                            */
  /* ---------------------------------------------------------------- */

  private renderGrid(): void {
    clear(this.grid)
    const ed = this.ed
    const frames = ed.sprite.frameCount
    this.grid.style.gridTemplateColumns = `${NAME_W}px repeat(${frames}, ${COL_W}px)`

    // Ligne d'entete : numeros de frame.
    this.grid.appendChild(el('div', { class: 'tl-cell tl-corner' }))
    for (let f = 0; f < frames; f++) {
      const cell = el('div', {
        class: `tl-cell tl-head-cell ${f === ed.activeFrame ? 'current' : ''} ${ed.frameSelection.has(f) ? 'selected' : ''}`,
        title: `Frame ${f + 1} — ${ed.sprite.frameDurations[f]} ms`,
        onclick: (e: MouseEvent) => ed.setActiveFrame(f, e.ctrlKey || e.metaKey || e.shiftKey),
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); ed.setActiveFrame(f); this.frameMenu(e) },
      }, String(f + 1))
      cell.dataset.frame = String(f)
      this.grid.appendChild(cell)
    }

    // Bande des tags, superposee aux colonnes de frames.
    this.grid.appendChild(el('div', {
      class: 'tl-cell tl-layer-cell',
      style: { position: 'sticky', left: '0', zIndex: '2', height: '20px', minWidth: `${NAME_W}px`, fontSize: '10px', color: 'var(--text-faint)' },
    }, 'Tags'))
    const lane = el('div', {
      class: 'tl-tags',
      style: { gridColumn: `2 / span ${frames}`, width: `${frames * COL_W}px` },
    })
    for (const tag of ed.sprite.tags) {
      lane.appendChild(el('button', {
        class: 'tl-tag',
        style: {
          left: `${tag.from * COL_W + 2}px`,
          width: `${(tag.to - tag.from + 1) * COL_W - 4}px`,
          background: toCss(tag.color),
        },
        title: `${tag.name} — frames ${tag.from + 1} a ${tag.to + 1} (${tag.direction})`,
        onclick: () => ed.setActiveFrame(tag.from),
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); this.tagMenu(e, tag) },
      }, tag.name))
    }
    this.grid.appendChild(lane)

    // Une ligne par calque, du plus haut au plus bas.
    for (let li = ed.sprite.layers.length - 1; li >= 0; li--) {
      const layer = ed.sprite.layers[li]
      const nameCell = el('div', {
        class: `tl-cell tl-layer-cell ${li === ed.activeLayer ? 'active' : ''}`,
        onclick: () => ed.setActiveLayer(li),
      },
        el('span', { html: icon(layer.visible ? 'eye' : 'eye-off', 12), style: { color: 'var(--text-faint)', display: 'flex' } }),
        el('span', { class: 'lname' }, layer.name),
      )
      nameCell.dataset.layerRow = String(li)
      this.grid.appendChild(nameCell)

      for (let f = 0; f < ed.sprite.frameCount; f++) {
        const cel = layer.cels[f]
        const hasContent = !!cel && !cel.bitmap.isEmpty()
        const cell = el('div', {
          class: `tl-cell tl-cel ${hasContent ? 'has-content' : ''} ${f === ed.activeFrame && li === ed.activeLayer ? 'active' : ''}`,
          onclick: () => { ed.setActiveLayer(li); ed.setActiveFrame(f) },
          oncontextmenu: (e: MouseEvent) => {
            e.preventDefault()
            ed.setActiveLayer(li)
            ed.setActiveFrame(f)
            this.celMenu(e)
          },
        })
        cell.dataset.frame = String(f)
        cell.dataset.layer = String(li)
        if (hasContent && this.showThumbs) {
          const thumb = el('canvas', { width: 26, height: 26 })
          const ctx = thumb.getContext('2d')!
          ctx.imageSmoothingEnabled = false
          const bm = cel!.bitmap
          const scale = Math.min(26 / bm.width, 26 / bm.height)
          ctx.drawImage(bm.toCanvas(), (26 - bm.width * scale) / 2, (26 - bm.height * scale) / 2, bm.width * scale, bm.height * scale)
          cell.classList.remove('has-content')
          cell.appendChild(thumb)
        }
        this.grid.appendChild(cell)
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  addFrame(): void {
    const ed = this.ed
    const at = ed.activeFrame + 1
    ed.run('Nouvelle frame', () => { ed.sprite.addFrame(at) })
    ed.setActiveFrame(at)
  }

  duplicateFrame(): void {
    const ed = this.ed
    const at = ed.activeFrame + 1
    ed.run('Dupliquer la frame', () => { ed.sprite.duplicateFrame(ed.activeFrame, at) })
    ed.setActiveFrame(at)
  }

  deleteFrame(): void {
    const ed = this.ed
    if (ed.frameCount <= 1) { ed.toast('Impossible de supprimer la derniere frame', 'error'); return }
    const frames = [...ed.frameSelection].sort((a, b) => b - a)
    ed.run('Supprimer la frame', () => {
      for (const f of frames) if (ed.sprite.frameCount > 1) ed.sprite.removeFrame(f)
    })
    ed.setActiveFrame(Math.min(ed.activeFrame, ed.frameCount - 1))
  }

  private setDuration(ms: number): void {
    const ed = this.ed
    const frames = ed.frameSelection.size > 1 ? [...ed.frameSelection] : [ed.activeFrame]
    ed.run('Duree de frame', () => {
      for (const f of frames) ed.sprite.frameDurations[f] = ms
    })
  }

  /** Applique la meme duree a toutes les frames (cadence constante). */
  setAllDurations(ms: number): void {
    const ed = this.ed
    ed.run('Cadence uniforme', () => {
      ed.sprite.frameDurations = ed.sprite.frameDurations.map(() => ms)
    })
  }

  private frameMenu(e: MouseEvent): void {
    const ed = this.ed
    openMenu(e.currentTarget as HTMLElement, [
      { label: 'Inserer une frame', icon: 'plus', onClick: () => this.addFrame() },
      { label: 'Dupliquer', icon: 'duplicate', onClick: () => this.duplicateFrame() },
      { label: 'Supprimer', icon: 'trash', onClick: () => this.deleteFrame() },
      { separator: true },
      {
        label: 'Deplacer a gauche',
        disabled: ed.activeFrame === 0,
        onClick: () => {
          const f = ed.activeFrame
          ed.run('Deplacer la frame', () => ed.sprite.moveFrame(f, f - 1))
          ed.setActiveFrame(f - 1)
        },
      },
      {
        label: 'Deplacer a droite',
        disabled: ed.activeFrame >= ed.frameCount - 1,
        onClick: () => {
          const f = ed.activeFrame
          ed.run('Deplacer la frame', () => ed.sprite.moveFrame(f, f + 1))
          ed.setActiveFrame(f + 1)
        },
      },
      { separator: true },
      { label: 'Creer un tag ici', icon: 'tag', onClick: () => this.createTag() },
      {
        label: 'Appliquer cette duree partout',
        onClick: () => this.setAllDurations(ed.sprite.frameDurations[ed.activeFrame]),
      },
    ])
  }

  private celMenu(e: MouseEvent): void {
    const ed = this.ed
    const layer = ed.layer
    const frame = ed.activeFrame
    openMenu(e.currentTarget as HTMLElement, [
      {
        label: 'Vider la case',
        icon: 'trash',
        onClick: () => ed.run('Vider la case', () => { layer.cels[frame] = null }),
      },
      {
        label: 'Copier la case dans la frame suivante',
        icon: 'copy',
        disabled: frame >= ed.frameCount - 1,
        onClick: () => ed.run('Copier la case', () => {
          const cel = layer.cels[frame]
          layer.cels[frame + 1] = cel ? { bitmap: cel.bitmap.clone(), opacity: cel.opacity } : null
        }),
      },
      { separator: true },
      {
        label: 'Opacite de la case…',
        onClick: async () => {
          const cel = layer.cels[frame]
          if (!cel) return
          const value = await promptDialog('Opacite de la case', 'Valeur 0-255', String(cel.opacity))
          if (value === null) return
          const n = Math.max(0, Math.min(255, Number(value)))
          if (Number.isNaN(n)) return
          ed.run('Opacite de la case', () => { cel.opacity = n })
        },
      },
    ])
  }

  /* ---------------------------------------------------------------- */
  /* Tags                                                              */
  /* ---------------------------------------------------------------- */

  createTag(): void {
    const ed = this.ed
    const frames = [...ed.frameSelection].sort((a, b) => a - b)
    const from = frames[0] ?? ed.activeFrame
    const to = frames[frames.length - 1] ?? ed.activeFrame
    this.editTag({
      id: genId(),
      name: `anim_${ed.sprite.tags.length + 1}`,
      from,
      to,
      direction: 'forward',
      repeat: 0,
      color: fromHex(TAG_COLORS[ed.sprite.tags.length % TAG_COLORS.length]),
    }, true)
  }

  private tagMenu(e: MouseEvent, tag: Tag): void {
    const ed = this.ed
    openMenu(e.currentTarget as HTMLElement, [
      { label: 'Modifier le tag…', icon: 'tag', onClick: () => this.editTag(tag, false) },
      {
        label: 'Selectionner ses frames',
        onClick: () => {
          ed.frameSelection = new Set()
          for (let f = tag.from; f <= tag.to; f++) ed.frameSelection.add(f)
          ed.setActiveFrame(tag.from, true)
        },
      },
      { separator: true },
      {
        label: 'Supprimer le tag',
        icon: 'trash',
        onClick: () => ed.run('Supprimer le tag', () => {
          ed.sprite.tags = ed.sprite.tags.filter((t) => t.id !== tag.id)
        }),
      },
    ])
  }

  /** Formulaire de creation ou de modification d'un tag d'animation. */
  editTag(tag: Tag, isNew: boolean): void {
    const ed = this.ed
    const name = el('input', { type: 'text', value: tag.name })
    const from = numberInput(tag.from + 1, () => {}, { min: 1, max: ed.frameCount })
    const to = numberInput(tag.to + 1, () => {}, { min: 1, max: ed.frameCount })
    const direction = el('select', null,
      ...([
        ['forward', 'Avant'],
        ['reverse', 'Arriere'],
        ['pingpong', 'Aller-retour'],
        ['pingpong-reverse', 'Retour-aller'],
      ] as const).map(([value, label]) =>
        el('option', { value, selected: tag.direction === value }, label)),
    )
    const repeat = numberInput(tag.repeat, () => {}, { min: 0, max: 999 })
    const color = el('input', { type: 'color', value: `#${toCss(tag.color).match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` })
    color.style.cssText = 'width:42px;height:26px;padding:2px;background:var(--bg-3);border:1px solid var(--line);border-radius:5px'

    const body = el('div', { class: 'form-grid' },
      el('label', null, 'Nom'), name,
      el('label', null, 'De la frame'), from,
      el('label', null, 'A la frame'), to,
      el('label', null, 'Sens'), direction,
      el('label', null, 'Repetitions'), el('div', { class: 'form-row' }, repeat, el('span', { class: 'form-note' }, '0 = boucle infinie')),
      el('label', null, 'Couleur'), color,
      el('p', { class: 'form-note full' },
        'Le nom du tag devient le nom de l\'animation a l\'export : clip Unity, animation SpriteFrames Godot, entree frameTags du JSON.'),
    )

    openModal({
      title: isNew ? 'Nouveau tag d\'animation' : 'Modifier le tag',
      icon: 'tag',
      body,
      actions: [
        { label: 'Annuler' },
        {
          label: isNew ? 'Creer' : 'Enregistrer',
          primary: true,
          onClick: () => {
            const a = Math.max(0, Math.min(ed.frameCount - 1, Number(from.value) - 1))
            const b = Math.max(0, Math.min(ed.frameCount - 1, Number(to.value) - 1))
            const patch: Tag = {
              ...tag,
              name: name.value.trim() || tag.name,
              from: Math.min(a, b),
              to: Math.max(a, b),
              direction: direction.value as Tag['direction'],
              repeat: Math.max(0, Number(repeat.value) || 0),
              color: fromHex(color.value),
            }
            ed.run(isNew ? 'Nouveau tag' : 'Modifier le tag', () => {
              if (isNew) ed.sprite.tags.push(patch)
              else {
                const i = ed.sprite.tags.findIndex((t) => t.id === tag.id)
                if (i >= 0) ed.sprite.tags[i] = patch
              }
            })
          },
        },
      ],
    })
  }
}

const TAG_COLORS = ['#6c8cff', '#54d6a0', '#ffb454', '#ff6b8a', '#c78cff', '#4fd0e0']
