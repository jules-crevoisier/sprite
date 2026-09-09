import type { Editor } from '../core/editor'
import { toCss, fromHex } from '../core/color'
import { genId, type Tag } from '../core/document'
import { el, clear, iconButton, numberInput } from './dom'
import { icon } from './icons'
import { openMenu, promptDialog, openModal, showToast } from './overlay'
import { EASINGS, ease, easingPath, type EasingId } from '../smart/easing'
import type { Playback } from './playback'

/** Trace d'une courbe de vitesse, pour la lire d'un coup d'oeil. */
function easingSvg(id: EasingId): string {
  const W = 34, H = 22, pad = 3
  const points = easingPath(id, 24)
  let bas = 0, haut = 1
  for (const p of points) { bas = Math.min(bas, p.y); haut = Math.max(haut, p.y) }
  const d = points.map((p, i) => {
    const x = pad + p.x * (W - pad * 2)
    const y = H - pad - ((p.y - bas) / (haut - bas)) * (H - pad * 2)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4"`
    + ' stroke-linecap="round" stroke-linejoin="round"/></svg>'
}

const COL_W = 44
const NAME_W = 178
/** Hauteur d'une bande de tags, chevauchements empiles. */
const TAG_H = 17

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
  /**
   * Boutons et champs de la barre, batis une seule fois. Les reconstruire a
   * chaque evenement les detruisait entre l'appui et le relachement : pendant
   * la lecture, un clic sur Pause tombait dans le vide et la duree perdait le
   * focus des qu'on la tapait.
   */
  private bar: {
    play: HTMLButtonElement
    tagOnly: HTMLButtonElement
    onion: HTMLButtonElement
    duration: HTMLInputElement
    fps: HTMLElement
    total: HTMLElement
    courbe: HTMLSelectElement
    trace: HTMLElement
  } | null = null
  private showThumbs = true
  private container: HTMLElement | null = null
  /** Hauteur fixee a la souris ; null = ajustement automatique. */
  private manualHeight: number | null = null
  /**
   * Image en cours de deplacement, ou null. La grille etant refaite a chaque
   * pas du glisser, la marque visuelle ne peut pas vivre sur le noeud tire :
   * elle est reposee par le rendu.
   */
  private imageTiree: number | null = null
  /** Calque en cours de deplacement, meme raison que ci-dessus. */
  private calqueTire: number | null = null

  constructor(editor: Editor, playback: Playback, container: HTMLElement) {
    this.ed = editor
    this.playback = playback
    this.container = container
    this.scroll.appendChild(this.grid)
    this.buildToolbar()
    // Les enfants vont directement dans le conteneur : un wrapper en
    // display:contents ne peut pas recevoir de hauteur.
    clear(container)
    container.append(this.makeResizer(), this.toolbar, this.scroll)
    this.root = container

    // La molette verticale defile horizontalement quand il n'y a rien a
    // faire defiler en hauteur : c'est le sens utile ici, une souris ordinaire
    // n'a pas de second axe et les images partent vers la droite.
    this.scroll.addEventListener('wheel', (e) => {
      const s = this.scroll
      const versLeBas = Math.abs(e.deltaY) > Math.abs(e.deltaX)
      const peutDescendre = s.scrollHeight > s.clientHeight + 1
      if (!versLeBas || (peutDescendre && !e.shiftKey)) return
      if (s.scrollWidth <= s.clientWidth + 1) return
      e.preventDefault()
      s.scrollLeft += e.deltaY
    }, { passive: false })

    editor.events.on('doc', () => this.render())
    editor.events.on('cursor', () => { this.renderSelectionOnly(); this.suivreImageActive() })
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
    if (!this.container) return
    const tags = this.grid.querySelector<HTMLElement>('.tl-tags')
    const bandes = tags ? tags.getBoundingClientRect().height : 20
    const needed = 5 + 36 + 26 + Math.max(20, bandes) + this.ed.sprite.layers.length * 30 + 14
    const height = this.manualHeight ?? Math.min(window.innerHeight * 0.45, needed)
    this.container.style.height = `${Math.round(height)}px`
  }

  /**
   * Ramene l'image courante dans la fenetre de defilement.
   *
   * Pendant la lecture d'un cycle place au-dela du bord droit, la timeline
   * restait sur les premieres colonnes : on voyait le sprite bouger sans
   * jamais voir l'image lue.
   */
  private suivreImageActive(): void {
    const col = this.grid.querySelector<HTMLElement>(
      `.tl-head-cell[data-frame="${this.ed.activeFrame}"]`,
    )
    if (!col) return
    const gauche = col.offsetLeft
    const droite = gauche + col.offsetWidth
    const vue = this.scroll.scrollLeft
    // La colonne des noms est collee a gauche : elle masque ce qui passe
    // dessous, il faut donc s'arreter avant elle et pas au bord de la vue.
    const debut = vue + NAME_W
    const fin = vue + this.scroll.clientWidth
    if (gauche < debut) this.scroll.scrollLeft = gauche - NAME_W
    else if (droite > fin) this.scroll.scrollLeft = droite - this.scroll.clientWidth
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

  /** Batit la barre une fois pour toutes ; l'etat est ensuite mis a jour. */
  private buildToolbar(): void {
    clear(this.toolbar)
    const ed = this.ed
    const t = this.toolbar

    const play = iconButton(icon('play', 15), 'Lecture (Entrée)', () => this.playback.toggle(),
      { className: 'sm icon-only' })
    const tagOnly = iconButton(icon('loop', 15), 'Limiter la lecture au tag courant', () => {
      ed.playTagOnly = !ed.playTagOnly
      this.syncToolbar()
    }, { className: 'sm icon-only ghost' })
    const onion = iconButton(icon('onion', 15), 'Pelure d\'oignon', () => {
      ed.onion.enabled = !ed.onion.enabled
      ed.events.emit('settings', undefined)
      this.syncToolbar()
    }, { className: 'sm icon-only ghost' })
    // La courbe de vitesse est un reglage d'animation : sa place est ici, a
    // cote des frames, et non dans le panneau du squelette qui n'en est qu'un
    // des usages.
    const trace = el('span', { class: 'easing-preview' })
    const courbe = el('select', {
      style: { height: '24px', fontSize: '11px', maxWidth: '124px' },
      title: 'Courbe de vitesse des images intermediaires',
      onchange: () => {
        ed.easing = courbe.value as EasingId
        this.syncToolbar()
        ed.events.emit('settings', undefined)
      },
    }, ...EASINGS.map((e) => el('option', { value: e.id, title: e.hint }, e.label)))
    const retimer = iconButton(icon('sliders', 14),
      'Répartir les durées du tag courant selon la courbe',
      () => this.retimeWithCurve(), { className: 'ghost sm icon-only' })

    const duration = numberInput(100, (v) => this.setDuration(Math.max(1, v)), { min: 1, max: 60000, width: '62px' })
    const toutes = iconButton(icon('film', 14), 'Appliquer cette durée a toutes les frames',
      () => this.setDurationForAll(Math.max(1, Number(duration.value) || 100)),
      { className: 'ghost sm icon-only' })
    const fps = el('span', { style: { color: 'var(--text-faint)' } })
    const total = el('span')

    t.append(
      iconButton(icon('prev', 15), 'Frame précédente (,)', () => ed.setActiveFrame(ed.activeFrame - 1), { className: 'ghost sm icon-only' }),
      play,
      iconButton(icon('next', 15), 'Frame suivante (.)', () => ed.setActiveFrame(ed.activeFrame + 1), { className: 'ghost sm icon-only' }),
      tagOnly,
      el('div', { class: 'opt-sep' }),
      iconButton(icon('plus', 15), 'Nouvelle frame — reprend le dessin actuel (Alt+N)', () => this.addFrame(), { className: 'ghost sm icon-only' }),
      iconButton(icon('frame-empty', 15), 'Nouvelle frame vide (Alt+Maj+N)', () => this.addEmptyFrame(), { className: 'ghost sm icon-only' }),
      iconButton(icon('trash', 15), 'Supprimer la frame', () => this.deleteFrame(), { className: 'ghost sm icon-only' }),
      el('div', { class: 'opt-sep' }),
      el('div', { class: 'tl-fps' }, el('span', null, 'Durée'), duration, el('span', null, 'ms'), fps, toutes),
      el('div', { class: 'opt-sep' }),
      el('div', { class: 'tl-fps' }, el('span', null, 'Courbe'), courbe, trace, retimer),
      el('div', { class: 'opt-sep' }),
      onion,
      iconButton(icon('settings', 14), 'Réglages de la pelure d\'oignon', (e) => this.onionMenu(e), { className: 'ghost sm icon-only' }),
      el('div', { class: 'opt-sep' }),
      iconButton(icon('tag', 15), 'Nouveau tag d\'animation sur la sélection', () => this.createTag(), { className: 'ghost sm', label: 'Tag' }),
      el('div', { class: 'opt-sep' }),
      // La pile de calques se pilote depuis la timeline, sans aller-retour
      // avec le panneau de droite : c'est la que se lit une composition.
      iconButton(icon('layers', 15), 'Nouveau calque', () => this.ajouterCalque(), { className: 'ghost sm icon-only' }),
      iconButton(icon('duplicate', 15), 'Dupliquer le calque', () => this.dupliquerCalque(), { className: 'ghost sm icon-only' }),
      iconButton(icon('trash', 15), 'Supprimer le calque', () => this.supprimerCalque(), { className: 'ghost sm icon-only' }),
      el('div', { class: 'spacer' }),
      el('div', { class: 'tl-fps' }, total),
    )

    this.bar = { play, tagOnly, onion, duration, fps, total, courbe, trace }
    this.syncToolbar()
  }

  /**
   * Met la barre a l'heure sans toucher au DOM structurel : la lecture emet
   * un evenement par frame, et remplacer les boutons a ce rythme les rendrait
   * incliquables.
   */
  private syncToolbar(): void {
    const bar = this.bar
    if (!bar) return
    const ed = this.ed
    const duration = ed.sprite.frameDurations[ed.activeFrame] ?? 100

    // L'icône n'est remplacee qu'au changement d'etat : la reecrire a chaque
    // frame detacherait le dessin sous le curseur dix fois par seconde.
    if (bar.play.dataset.state !== String(ed.playing)) {
      bar.play.dataset.state = String(ed.playing)
      bar.play.innerHTML = icon(ed.playing ? 'pause' : 'play', 15)
    }
    bar.play.classList.toggle('active', ed.playing)
    bar.tagOnly.classList.toggle('active', ed.playTagOnly)
    bar.tagOnly.classList.toggle('ghost', !ed.playTagOnly)
    bar.onion.classList.toggle('active', ed.onion.enabled)
    bar.onion.classList.toggle('ghost', !ed.onion.enabled)
    // On ne bouscule pas un champ en cours de saisie.
    if (document.activeElement !== bar.duration) bar.duration.value = String(duration)
    bar.fps.textContent = `≈ ${Math.round(1000 / Math.max(1, duration))} fps`
    bar.total.textContent =
      `${ed.frameCount} frame${ed.frameCount > 1 ? 's' : ''} · ${(ed.sprite.totalDuration() / 1000).toFixed(2)}s`
    if (bar.courbe.value !== ed.easing) bar.courbe.value = ed.easing
    bar.trace.innerHTML = easingSvg(ed.easing)
    bar.trace.title = EASINGS.find((e) => e.id === ed.easing)?.hint ?? ''
  }

  private renderToolbar(): void { this.syncToolbar() }

  private tagTitle(tag: Tag): string {
    return `${tag.name} — frames ${tag.from + 1} a ${tag.to + 1} (${tag.direction})`
      + ' · glisser pour déplacer, les bords pour rallonger'
  }

  /**
   * Deplacement et redimensionnement d'un tag a la souris. Les bords
   * rallongent l'etendue, le milieu la deplace en bloc ; tout est aimante sur
   * la colonne de frame, et l'ensemble du geste ne laisse qu'une entree dans
   * l'historique.
   */
  private makeTagDraggable(node: HTMLElement, tag: Tag): void {
    const ed = this.ed
    const EDGE = 7
    const zone = (e: PointerEvent): 'start' | 'end' | 'move' => {
      const r = node.getBoundingClientRect()
      // Un tag d'une seule frame est trop etroit pour trois zones : on le
      // deplace, on le rallonge par la droite.
      if (r.width < EDGE * 3) return r.right - e.clientX <= EDGE ? 'end' : 'move'
      if (e.clientX - r.left <= EDGE) return 'start'
      if (r.right - e.clientX <= EDGE) return 'end'
      return 'move'
    }

    let dragging = false
    node.addEventListener('pointermove', (e) => {
      if (dragging) return
      node.style.cursor = zone(e) === 'move' ? 'grab' : 'ew-resize'
    })

    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const kind = zone(e)
      const startX = e.clientX
      const from0 = tag.from, to0 = tag.to
      const last = ed.sprite.frameCount - 1
      let bouge = false
      dragging = true
      node.classList.add('dragging')
      node.style.cursor = kind === 'move' ? 'grabbing' : 'ew-resize'
      node.setPointerCapture(e.pointerId)

      const place = () => {
        node.style.left = `${tag.from * COL_W + 2}px`
        node.style.width = `${(tag.to - tag.from + 1) * COL_W - 4}px`
        node.title = this.tagTitle(tag)
      }

      const move = (ev: PointerEvent) => {
        const pas = Math.round((ev.clientX - startX) / COL_W)
        let from = from0, to = to0
        if (kind === 'move') {
          const etendue = to0 - from0
          from = Math.max(0, Math.min(last - etendue, from0 + pas))
          to = from + etendue
        } else if (kind === 'start') {
          from = Math.max(0, Math.min(to0, from0 + pas))
        } else {
          to = Math.min(last, Math.max(from0, to0 + pas))
        }
        if (from === tag.from && to === tag.to) return
        bouge = true
        tag.from = from
        tag.to = to
        place()
        // La bande jouee suit le tag en direct quand la lecture s'y limite.
        if (ed.playTagOnly) ed.events.emit('playback', ed.playing)
      }

      const up = () => {
        node.removeEventListener('pointermove', move)
        node.removeEventListener('pointerup', up)
        node.removeEventListener('pointercancel', up)
        dragging = false
        node.classList.remove('dragging')
        node.style.cursor = ''
        if (!bouge) { ed.setActiveFrame(tag.from); return }
        const from1 = tag.from, to1 = tag.to
        ed.pushCommand({
          label: kind === 'move' ? 'Déplacer un tag' : 'Étendue d\'un tag',
          undo: () => { tag.from = from0; tag.to = to0; ed.events.emit('doc', undefined) },
          redo: () => { tag.from = from1; tag.to = to1; ed.events.emit('doc', undefined) },
        })
        ed.events.emit('doc', undefined)
      }

      node.addEventListener('pointermove', move)
      node.addEventListener('pointerup', up)
      node.addEventListener('pointercancel', up)
    })
  }

  private onionMenu(e: MouseEvent): void {
    const ed = this.ed
    const o = ed.onion
    openMenu(e.currentTarget as HTMLElement, [
      { title: 'Frames précédentes' },
      ...[0, 1, 2, 3].map((n) => ({
        label: `${n}`,
        checked: o.prev === n,
        onClick: () => { o.prev = n; o.enabled = true; ed.events.emit('settings', undefined); this.syncToolbar() },
      })),
      { title: 'Frames suivantes' },
      ...[0, 1, 2, 3].map((n) => ({
        label: `${n}`,
        checked: o.next === n,
        onClick: () => { o.next = n; o.enabled = true; ed.events.emit('settings', undefined); this.syncToolbar() },
      })),
      { separator: true },
      {
        label: 'Teinter (rouge / bleu)',
        checked: o.tint,
        onClick: () => { o.tint = !o.tint; ed.events.emit('settings', undefined) },
      },
    ])
  }

  ajouterCalque(): void {
    const ed = this.ed
    ed.run('Nouveau calque', () => { ed.sprite.addLayer(undefined, ed.activeLayer + 1) })
    ed.setActiveLayer(Math.min(ed.activeLayer + 1, ed.sprite.layers.length - 1))
  }

  dupliquerCalque(): void {
    const ed = this.ed
    const i = ed.activeLayer
    ed.run('Dupliquer le calque', () => { ed.sprite.duplicateLayer(i) })
    ed.setActiveLayer(Math.min(i + 1, ed.sprite.layers.length - 1))
  }

  supprimerCalque(): void {
    const ed = this.ed
    if (ed.sprite.layers.length <= 1) {
      ed.toast('Impossible de supprimer le dernier calque', 'error')
      return
    }
    const i = ed.activeLayer
    ed.run('Supprimer le calque', () => { ed.sprite.layers.splice(i, 1) })
    ed.setActiveLayer(Math.min(i, ed.sprite.layers.length - 1))
  }

  /** Renomme un calque depuis sa ligne, au double-clic sur son nom. */
  private renommerCalque(index: number, champ: HTMLElement): void {
    const ed = this.ed
    const layer = ed.sprite.layers[index]
    const input = el('input', { class: 'tl-rename', type: 'text', value: layer.name, spellcheck: false })
    champ.replaceWith(input)
    input.focus()
    input.select()
    let fini = false
    const valider = (garder: boolean) => {
      if (fini) return
      fini = true
      const nom = input.value.trim()
      if (garder && nom && nom !== layer.name) {
        ed.run('Renommer le calque', () => { layer.name = nom })
      } else {
        this.renderGrid()
      }
    }
    input.addEventListener('blur', () => valider(true))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); valider(true) }
      else if (e.key === 'Escape') { e.preventDefault(); valider(false) }
      e.stopPropagation()
    })
  }

  /**
   * Reordonne les calques en tirant leur ligne, de haut en bas.
   *
   * Les lignes sont affichees du calque du dessus vers celui du dessous ;
   * l'index du modèle va dans l'autre sens. Tout le geste passe par cette
   * conversion, sinon la pile se retourne sous la souris.
   */
  private rendreCalqueDeplacable(cell: HTMLElement, index: number): void {
    const ed = this.ed
    cell.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      if ((e.target as Element).closest('button, input')) return
      if (ed.sprite.layers.length < 2) return
      const departY = e.clientY
      const hautDeLigne = cell.getBoundingClientRect().top
      let source = index
      let bouge = false
      const trait = el('div', { class: 'tl-insert-h', hidden: true })
      this.scroll.appendChild(trait)

      /** Rang d'affichage, 0 = ligne du haut. */
      const rangAffiche = (i: number): number => ed.sprite.layers.length - 1 - i

      const move = (ev: PointerEvent) => {
        if (!bouge) {
          if (Math.abs(ev.clientY - departY) < 15) return
          bouge = true
          this.calqueTire = source
        }
        const pas = Math.round((ev.clientY - departY) / 30)
        const rang = Math.max(0, Math.min(ed.sprite.layers.length - 1, rangAffiche(index) + pas))
        const cible = ed.sprite.layers.length - 1 - rang
        trait.hidden = false
        trait.style.top = `${hautDeLigne - this.scroll.getBoundingClientRect().top
          + (rang - rangAffiche(index)) * 30}px`
        if (cible === source) return
        const [l] = ed.sprite.layers.splice(source, 1)
        ed.sprite.layers.splice(cible, 0, l)
        source = cible
        this.calqueTire = cible
        ed.activeLayer = cible
        ed.events.emit('doc', undefined)
      }

      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        trait.remove()
        this.calqueTire = null
        if (!bouge || source === index) { this.renderGrid(); return }
        const de = index, vers = source
        const bouger = (a: number, b: number) => {
          const [l] = ed.sprite.layers.splice(a, 1)
          ed.sprite.layers.splice(b, 0, l)
        }
        ed.pushCommand({
          label: 'Déplacer un calque',
          undo: () => { bouger(vers, de); ed.setActiveLayer(de) },
          redo: () => { bouger(de, vers); ed.setActiveLayer(vers) },
        })
        ed.setActiveLayer(vers)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    })
  }

  /**
   * Reordonne les images en tirant leur numero.
   *
   * On ne bouge rien tant que le curseur n'a pas franchi une demi-colonne :
   * un simple clic doit rester un clic. Le trait d'insertion montre ou
   * l'image tombera, et tout le geste ne laisse qu'une entree d'historique,
   * meme s'il traverse dix colonnes.
   */
  private rendreImageDeplacable(cell: HTMLElement, index: number): void {
    const ed = this.ed
    cell.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (ed.sprite.frameCount < 2) return
      const depart = e.clientX
      let source = index
      let bouge = false
      const trait = el('div', { class: 'tl-insert', hidden: true })
      this.scroll.appendChild(trait)

      /** Colonne devant laquelle l'image se posera, 0..frameCount. */
      const creneau = (x: number): number => {
        const r = this.scroll.getBoundingClientRect()
        const dans = x - r.left + this.scroll.scrollLeft - NAME_W
        return Math.max(0, Math.min(ed.sprite.frameCount, Math.round(dans / COL_W)))
      }

      const move = (ev: PointerEvent) => {
        if (!bouge) {
          if (Math.abs(ev.clientX - depart) < COL_W / 2) return
          bouge = true
          this.imageTiree = source
        }
        const cible = creneau(ev.clientX)
        trait.hidden = false
        trait.style.left = `${NAME_W + cible * COL_W}px`
        // Deplacement en direct : on voit le dessin passer d'une colonne a
        // l'autre au lieu de decouvrir le resultat au relachement.
        const to = cible > source ? cible - 1 : cible
        if (to === source) return
        ed.sprite.moveFrame(source, to)
        source = to
        this.imageTiree = to
        ed.activeFrame = to
        ed.events.emit('doc', undefined)
      }

      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        trait.remove()
        this.imageTiree = null
        if (!bouge || source === index) { this.renderGrid(); return }
        const de = index, vers = source
        ed.pushCommand({
          label: 'Déplacer une image',
          undo: () => { ed.sprite.moveFrame(vers, de); ed.setActiveFrame(de) },
          redo: () => { ed.sprite.moveFrame(de, vers); ed.setActiveFrame(vers) },
        })
        ed.setActiveFrame(vers)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    })
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
      if (this.imageTiree === f) cell.classList.add('dragging')
      this.rendreImageDeplacable(cell, f)
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
    // Deux tags qui se chevauchent se cachent mutuellement les bords : on les
    // repartit sur des bandes successives, la premiere ou la place est libre.
    const bandes: number[] = []
    const bandeDe = new Map<Tag['id'], number>()
    for (const tag of [...ed.sprite.tags].sort((a, b) => a.from - b.from)) {
      let i = 0
      while (i < bandes.length && bandes[i] > tag.from) i++
      bandes[i] = tag.to
      bandeDe.set(tag.id, i)
    }
    lane.style.height = `${Math.max(1, bandes.length) * TAG_H + 5}px`

    for (const tag of ed.sprite.tags) {
      const node = el('button', {
        class: 'tl-tag',
        style: {
          left: `${tag.from * COL_W + 2}px`,
          top: `${(bandeDe.get(tag.id) ?? 0) * TAG_H + 3}px`,
          width: `${(tag.to - tag.from + 1) * COL_W - 4}px`,
          background: toCss(tag.color),
        },
        title: this.tagTitle(tag),
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); this.tagMenu(e, tag) },
      }, el('span', { class: 'tl-tag-label' }, tag.name))
      this.makeTagDraggable(node, tag)
      lane.appendChild(node)
    }
    this.grid.appendChild(lane)

    // Une ligne par calque, du plus haut au plus bas.
    for (let li = ed.sprite.layers.length - 1; li >= 0; li--) {
      const layer = ed.sprite.layers[li]
      const nameCell = el('div', {
        class: `tl-cell tl-layer-cell ${li === ed.activeLayer ? 'active' : ''}`
          + `${layer.visible ? '' : ' hidden-layer'}`,
        onclick: () => ed.setActiveLayer(li),
      },
        // L'oeil etait un simple dessin : on cliquait dessus et il ne se
        // passait rien d'autre que la selection de la ligne. Il masque
        // desormais vraiment, comme celui du panneau Calques.
        el('button', {
          class: `tl-mini ${layer.visible ? 'on' : ''}`,
          title: layer.visible ? 'Masquer le calque' : 'Afficher le calque',
          html: icon(layer.visible ? 'eye' : 'eye-off', 12),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            ed.run(layer.visible ? 'Masquer le calque' : 'Afficher le calque', () => { layer.visible = !layer.visible })
          },
        }),
        el('button', {
          class: `tl-mini ${layer.locked ? 'on' : ''}`,
          title: layer.locked ? 'Deverrouiller le calque' : 'Verrouiller le calque',
          html: icon(layer.locked ? 'lock' : 'unlock', 12),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            ed.run(layer.locked ? 'Deverrouiller' : 'Verrouiller', () => { layer.locked = !layer.locked })
          },
        }),
        el('span', {
          class: 'lname',
          title: `${layer.name} — double-clic pour renommer, glisser pour réordonner`,
          ondblclick: (e: MouseEvent) => {
            e.stopPropagation()
            this.renommerCalque(li, e.currentTarget as HTMLElement)
          },
        }, layer.name),
        // L'opacite du calque, lisible et reglable sans quitter la piste.
        el('span', { class: 'tl-opacite' }, `${Math.round((layer.opacity / 255) * 100)}%`),
      )
      nameCell.dataset.layerRow = String(li)
      if (this.calqueTire === li) nameCell.classList.add('dragging')
      this.rendreCalqueDeplacable(nameCell, li)
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

  /**
   * Nouvelle frame reprenant le contenu de la frame courante. C'est le
   * comportement attendu pour animer : on repart du dessin precedent et on
   * le modifie. Une frame reellement vide passe par `addEmptyFrame`.
   */
  addFrame(): void {
    const ed = this.ed
    const at = ed.activeFrame + 1
    ed.run('Nouvelle frame', () => { ed.sprite.duplicateFrame(ed.activeFrame, at) })
    ed.setActiveFrame(at)
  }

  addEmptyFrame(): void {
    const ed = this.ed
    const at = ed.activeFrame + 1
    ed.run('Nouvelle frame vide', () => { ed.sprite.addFrame(at) })
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
    if (ed.frameCount <= 1) { ed.toast('Impossible de supprimer la dernière frame', 'error'); return }
    const frames = [...ed.frameSelection].sort((a, b) => b - a)
    ed.run('Supprimer la frame', () => {
      for (const f of frames) if (ed.sprite.frameCount > 1) ed.sprite.removeFrame(f)
    })
    ed.setActiveFrame(Math.min(ed.activeFrame, ed.frameCount - 1))
  }

  /**
   * Repartit les durees d'une plage selon la courbe de vitesse.
   *
   * Une courbe ne sert pas qu'a fabriquer des images intermediaires : sur une
   * suite deja dessinee, elle redistribue le temps. Les images ou la courbe
   * est plate durent plus longtemps, celles ou elle grimpe defilent vite — le
   * mouvement change de poids sans qu'un seul pixel bouge.
   */
  private retimeWithCurve(): void {
    const ed = this.ed
    const tag = ed.sprite.tags.find((t) => ed.activeFrame >= t.from && ed.activeFrame <= t.to)
    const from = tag ? tag.from : 0
    const to = tag ? tag.to : ed.frameCount - 1
    const n = to - from + 1
    if (n < 2) { showToast('Il faut au moins deux frames', 'error'); return }

    // On garde la duree totale : seule sa repartition change.
    const total = ed.sprite.frameDurations.slice(from, to + 1).reduce((a, b) => a + b, 0)
    const parts: number[] = []
    for (let i = 0; i < n; i++) {
      // L'ecart entre deux points de la courbe donne la vitesse a cet
      // endroit ; une image rapide doit rester peu de temps a l'ecran.
      const d = ease(ed.easing, (i + 1) / n) - ease(ed.easing, i / n)
      parts.push(Math.max(0.05, Math.abs(d)))
    }
    // Une image lente dure longtemps : la duree est l'inverse de la vitesse.
    // Les inverses sont ramenes a leur somme, sinon la sequence s'allongerait
    // ou se raccourcirait a chaque application.
    const inverses = parts.map((p) => 1 / p)
    const sommeInv = inverses.reduce((a, b) => a + b, 0)
    ed.run('Répartir les durées', () => {
      for (let i = 0; i < n; i++) {
        ed.sprite.frameDurations[from + i] = Math.max(10, Math.round(total * inverses[i] / sommeInv))
      }
    })
    const label = EASINGS.find((e) => e.id === ed.easing)?.label ?? ''
    showToast(`${n} frames reparties selon « ${label} »`
      + (tag ? ` sur le tag « ${tag.name} »` : ''), 'success')
  }

  /** Une seule cadence pour toute l'animation : le cas le plus courant. */
  private setDurationForAll(ms: number): void {
    const ed = this.ed
    ed.run('Durée de toutes les frames', () => {
      for (let f = 0; f < ed.frameCount; f++) ed.sprite.frameDurations[f] = ms
    })
    showToast(`${ms} ms sur les ${ed.frameCount} frames — ${Math.round(1000 / ms)} fps`, 'success')
  }

  private setDuration(ms: number): void {
    const ed = this.ed
    const frames = ed.frameSelection.size > 1 ? [...ed.frameSelection] : [ed.activeFrame]
    ed.run('Durée de frame', () => {
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
      { label: 'Nouvelle frame (copie du dessin)', icon: 'plus', onClick: () => this.addFrame() },
      { label: 'Nouvelle frame vide', icon: 'frame-empty', onClick: () => this.addEmptyFrame() },
      { label: 'Dupliquer', icon: 'duplicate', onClick: () => this.duplicateFrame() },
      { label: 'Supprimer', icon: 'trash', onClick: () => this.deleteFrame() },
      { separator: true },
      {
        label: 'Déplacer a gauche',
        disabled: ed.activeFrame === 0,
        onClick: () => {
          const f = ed.activeFrame
          ed.run('Déplacer la frame', () => ed.sprite.moveFrame(f, f - 1))
          ed.setActiveFrame(f - 1)
        },
      },
      {
        label: 'Déplacer a droite',
        disabled: ed.activeFrame >= ed.frameCount - 1,
        onClick: () => {
          const f = ed.activeFrame
          ed.run('Déplacer la frame', () => ed.sprite.moveFrame(f, f + 1))
          ed.setActiveFrame(f + 1)
        },
      },
      { separator: true },
      { label: 'Créer un tag ici', icon: 'tag', onClick: () => this.createTag() },
      {
        label: 'Appliquer cette durée partout',
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
        label: 'Opacité de la case…',
        onClick: async () => {
          const cel = layer.cels[frame]
          if (!cel) return
          const value = await promptDialog('Opacité de la case', 'Valeur 0-255', String(cel.opacity))
          if (value === null) return
          const n = Math.max(0, Math.min(255, Number(value)))
          if (Number.isNaN(n)) return
          ed.run('Opacité de la case', () => { cel.opacity = n })
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
        label: 'Sélectionner ses frames',
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
        ['reverse', 'Arrière'],
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
      el('label', null, 'Répétitions'), el('div', { class: 'form-row' }, repeat, el('span', { class: 'form-note' }, '0 = boucle infinie')),
      el('label', null, 'Couleur'), color,
      el('p', { class: 'form-note full' },
        'Le nom du tag devient le nom de l\'animation a l\'export : clip Unity, animation SpriteFrames Godot, entrée frameTags du JSON.'),
    )

    openModal({
      title: isNew ? 'Nouveau tag d\'animation' : 'Modifier le tag',
      icon: 'tag',
      body,
      actions: [
        { label: 'Annuler' },
        {
          label: isNew ? 'Créer' : 'Enregistrer',
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
