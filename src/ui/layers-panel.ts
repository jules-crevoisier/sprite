import type { Editor } from '../core/editor'
import type { Layer } from '../core/document'
import { BLEND_MODES, type BlendMode } from '../core/blend'
import { fromHex, toHex, toCss } from '../core/color'
import {
  EFFECT_KINDS, createEffect, effectInfo,
  type Falloff, type LayerEffect, type StrokeSide,
} from '../core/effects'
import { compositeFrame } from '../render/composite'
import { el, clear, iconButton, segmented, select, slider } from './dom'
import { icon } from './icons'
import { openMenu, confirmDialog } from './overlay'

/** Panneau des calques : visibilite, verrou, opacite, fusion, reordonnancement. */
export class LayersPanel {
  readonly content: HTMLElement
  readonly actions: HTMLElement[]
  private ed: Editor
  private list = el('div', { class: 'layer-list' })
  private footer = el('div', { class: 'layer-foot' })
  private dragIndex: number | null = null
  /** Effet dont les reglages sont deplies, par identifiant. */
  private ouvert: number | null = null
  /** Etat des effets avant le geste de curseur en cours. */
  private geste: { layer: Layer; avant: LayerEffect[] } | null = null

  constructor(editor: Editor) {
    this.ed = editor
    this.content = el('div', { style: { display: 'contents' } },
      el('div', { class: 'panel-body tight', style: { flex: '1' } }, this.list),
      this.footer,
    )
    this.actions = [
      iconButton(icon('plus', 14), 'Nouveau calque (Maj+N)', () => this.addLayer(), { className: 'ghost sm icon-only' }),
      iconButton(icon('duplicate', 14), 'Dupliquer le calque', () => this.duplicate(), { className: 'ghost sm icon-only' }),
      iconButton(icon('merge', 14), 'Fusionner vers le bas', () => this.mergeDown(), { className: 'ghost sm icon-only' }),
      iconButton(icon('trash', 14), 'Supprimer le calque', () => this.remove(), { className: 'ghost sm icon-only' }),
    ]
    editor.events.on('doc', () => this.render())
    editor.events.on('cursor', () => this.render())
    editor.events.on('reload', () => this.render())
    this.render()
  }

  render(): void {
    clear(this.list)
    const ed = this.ed
    ed.sprite.layers.forEach((layer, index) => {
      const active = index === ed.activeLayer
      const row = el('div', {
        class: `layer-row ${active ? 'active' : ''} ${layer.visible ? '' : 'hidden-layer'}`,
        draggable: true,
        onclick: () => ed.setActiveLayer(index),
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); this.contextMenu(e, index) },
      })

      row.addEventListener('dragstart', () => { this.dragIndex = index })
      row.addEventListener('dragover', (e) => e.preventDefault())
      row.addEventListener('drop', (e) => {
        e.preventDefault()
        if (this.dragIndex === null || this.dragIndex === index) return
        const from = this.dragIndex
        this.dragIndex = null
        ed.run('Réordonner les calques', () => {
          const [moved] = ed.sprite.layers.splice(from, 1)
          ed.sprite.layers.splice(index, 0, moved)
        })
        ed.setActiveLayer(index)
      })

      const thumb = el('canvas', { class: 'layer-thumb', width: 26, height: 26 })
      this.drawThumb(thumb, index)

      row.append(
        el('button', {
          class: `mini ${layer.visible ? 'on' : ''}`,
          title: layer.visible ? 'Masquer' : 'Afficher',
          html: icon(layer.visible ? 'eye' : 'eye-off', 14),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            ed.run(layer.visible ? 'Masquer le calque' : 'Afficher le calque', () => { layer.visible = !layer.visible })
          },
        }),
        el('button', {
          class: `mini ${layer.locked ? 'on' : ''}`,
          title: layer.locked ? 'Deverrouiller' : 'Verrouiller',
          html: icon(layer.locked ? 'lock' : 'unlock', 14),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            ed.run(layer.locked ? 'Deverrouiller' : 'Verrouiller', () => { layer.locked = !layer.locked })
          },
        }),
        thumb,
        el('span', { class: 'lname', ondblclick: () => this.rename(index) }, layer.name),
      )
      this.list.appendChild(row)
    })

    this.renderFooter()
  }

  private drawThumb(canvas: HTMLCanvasElement, layerIndex: number): void {
    const ed = this.ed
    const bm = compositeFrame(ed.sprite, ed.activeFrame, { onlyLayer: layerIndex, ignoreVisibility: true, includeReference: true })
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 26, 26)
    ctx.imageSmoothingEnabled = false
    const scale = Math.min(26 / bm.width, 26 / bm.height)
    const w = Math.max(1, Math.round(bm.width * scale))
    const h = Math.max(1, Math.round(bm.height * scale))
    ctx.drawImage(bm.toCanvas(), (26 - w) / 2, (26 - h) / 2, w, h)
  }

  private renderFooter(): void {
    clear(this.footer)
    const ed = this.ed
    const layer = ed.layer
    if (!layer) return
    this.footer.append(
      el('div', { class: 'opt', style: { marginBottom: '5px' } },
        el('label', { style: { width: '52px' } }, 'Opacité'),
        slider(0, 255, layer.opacity, 1,
          (v) => {
            layer.opacity = v
            ed.history.touch()
            ed.events.emit('doc', undefined)
          },
          (v) => `${Math.round((v / 255) * 100)}%`),
      ),
      el('div', { class: 'opt' },
        el('label', { style: { width: '52px' } }, 'Fusion'),
        select(
          BLEND_MODES.map((m) => ({ value: m.id, label: m.label, group: m.group })),
          layer.blendMode,
          (v: BlendMode) => ed.run('Mode de fusion', () => { layer.blendMode = v }),
        ),
      ),
    )
    const effets = el('div', { class: 'fx-panel' })
    this.renderEffects(effets)
    this.footer.appendChild(effets)
  }

  /* ---------------------------------------------------------------- */
  /* Effets de calque                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Les effets se reglent ici plutot que dans une boite de dialogue :
   * ils sont recalcules a la volee, on veut donc voir le sprite bouger
   * pendant qu'on tire le curseur.
   */
  private renderEffects(hote: HTMLElement): void {
    const ed = this.ed
    const layer = ed.layer
    if (!layer) return

    const titre = el('div', { class: 'fx-head' },
      el('span', { class: 'fx-title' }, 'Effets'),
      iconButton(icon('plus', 14), 'Ajouter un effet', (e) => this.menuAjout(e), {
        className: 'ghost sm icon-only',
      }),
    )
    hote.appendChild(titre)

    if (!layer.effects.length) {
      // Un panneau de travail n'est pas un encart publicitaire : ce qu'un
      // effet sait faire se decouvre en l'ajoutant, pas en le lisant.
      hote.appendChild(el('p', { class: 'fx-vide' }, 'Aucun effet sur ce calque.'))
      return
    }

    layer.effects.forEach((fx, index) => {
      const info = effectInfo(fx.kind)
      const ligne = el('div', { class: `fx-row ${fx.enabled ? '' : 'off'}` },
        el('button', {
          class: `mini ${fx.enabled ? 'on' : ''}`,
          title: fx.enabled ? 'Désactiver' : 'Activer',
          html: icon(fx.enabled ? 'eye' : 'eye-off', 13),
          onclick: () => ed.run(fx.enabled ? 'Désactiver l\'effet' : 'Activer l\'effet',
            () => { fx.enabled = !fx.enabled }),
        }),
        el('span', {
          class: 'fx-name',
          title: info.hint,
          onclick: () => { this.ouvert = this.ouvert === fx.id ? null : fx.id; this.renderFooter() },
        }, info.label),
        el('span', { class: 'fx-puce', style: { background: toCss(fx.color) } }),
        iconButton(icon('trash', 12), 'Retirer l\'effet', () => {
          ed.run('Retirer l\'effet', () => { layer.effects.splice(index, 1) })
        }, { className: 'ghost sm icon-only' }),
      )
      hote.appendChild(ligne)
      if (this.ouvert === fx.id) hote.appendChild(this.reglages(fx))
    })
  }

  private menuAjout(e: MouseEvent): void {
    const ed = this.ed
    const layer = ed.layer
    openMenu(e.currentTarget as HTMLElement, EFFECT_KINDS.map((k) => ({
      label: k.label,
      title: k.hint,
      onClick: () => {
        const fx = createEffect(k.id)
        ed.run(`Ajouter : ${k.label.toLowerCase()}`, () => { layer.effects.push(fx) })
        this.ouvert = fx.id
        this.renderFooter()
      },
    })), 'right')
  }

  /** Un champ visible seulement si l'effet s'en sert. */
  private reglages(fx: LayerEffect): HTMLElement {
    const ed = this.ed
    const champs = new Set(effectInfo(fx.kind).fields)
    const corps = el('div', { class: 'fx-body' })

    // Un geste de curseur donne une seule entree d'historique : on retient
    // l'état d'avant au premier mouvement, on la publie au relachement.
    const vivant = (): void => {
      this.ouvrirGeste()
      ed.history.touch()
      ed.events.emit('doc', undefined)
    }
    const fige = (label: string): void => this.fermerGeste(label)

    const rangee = (label: string, ...contenu: (Node | string)[]): HTMLElement =>
      el('div', { class: 'fx-field' }, el('label', null, label), ...contenu)

    if (champs.has('color')) corps.appendChild(rangee(
      fx.kind === 'biseau' ? 'Lumière' : fx.kind === 'degrade' ? 'Depart' : 'Couleur',
      this.champCouleur(fx.color, (c) => { fx.color = c; vivant() }, () => fige('Couleur de l\'effet')),
    ))
    if (champs.has('color2')) corps.appendChild(rangee(
      fx.kind === 'biseau' ? 'Ombre' : 'Arrivee',
      this.champCouleur(fx.color2, (c) => { fx.color2 = c; vivant() }, () => fige('Couleur de l\'effet')),
    ))
    if (champs.has('opacity')) corps.appendChild(rangee('Opacité',
      slider(0, 100, Math.round(fx.opacity * 100), 1,
        (v) => { fx.opacity = v / 100; vivant() }, (v) => `${v}%`,
        () => fige('Opacité de l\'effet'))))
    if (champs.has('angle')) corps.appendChild(rangee('Angle',
      slider(0, 350, fx.angle, 10, (v) => { fx.angle = v; vivant() }, (v) => `${v}°`,
        () => fige('Angle de l\'effet'))))
    if (champs.has('distance')) corps.appendChild(rangee('Distance',
      slider(0, 16, fx.distance, 1, (v) => { fx.distance = v; vivant() }, (v) => `${v} px`,
        () => fige('Distance de l\'effet'))))
    if (champs.has('spread')) corps.appendChild(rangee('Diffusion',
      slider(0, 12, fx.spread, 1, (v) => { fx.spread = v; vivant() }, (v) => `${v} px`,
        () => fige('Diffusion de l\'effet'))))
    if (champs.has('inset')) corps.appendChild(rangee('Retrait',
      slider(0, 6, fx.inset, 1, (v) => { fx.inset = v; vivant() }, (v) => `${v} px`,
        () => fige('Retrait de l\'effet'))))
    if (champs.has('size')) corps.appendChild(rangee(fx.kind === 'contour' ? 'Épaisseur' : 'Étendue',
      slider(fx.kind === 'contour' ? 1 : 0, 16, fx.size, 1,
        (v) => { fx.size = v; vivant() }, (v) => `${v} px`,
        () => fige('Étendue de l\'effet'))))
    if (champs.has('position')) corps.appendChild(rangee('Cote',
      segmented<StrokeSide>([
        { value: 'dehors', label: 'Dehors' },
        { value: 'centre', label: 'Centre' },
        { value: 'dedans', label: 'Dedans' },
      ], fx.position, (v) => ed.run('Cote du contour', () => { fx.position = v }))))
    if (champs.has('falloff')) corps.appendChild(rangee('Bord',
      segmented<Falloff>([
        { value: 'net', label: 'Net', title: 'Une seule couleur, bord franc' },
        { value: 'paliers', label: 'Paliers', title: 'Quelques niveaux d\'opacité' },
        { value: 'tramage', label: 'Trame', title: 'Motif régulier : le dégradé sans nouvelles couleurs' },
      ], fx.falloff, (v) => ed.run('Bord de l\'effet', () => { fx.falloff = v }))))
    if (champs.has('steps') && fx.falloff === 'paliers') corps.appendChild(rangee('Paliers',
      slider(1, 6, fx.steps, 1, (v) => { fx.steps = v; vivant() }, undefined,
        () => fige('Paliers de l\'effet'))))
    if (champs.has('steps') && fx.kind === 'degrade' && fx.falloff !== 'paliers') {
      corps.appendChild(rangee('Tons',
        slider(2, 8, fx.steps, 1, (v) => { fx.steps = v; vivant() }, undefined,
          () => fige('Tons du dégradé'))))
    }
    if (champs.has('blend')) corps.appendChild(rangee('Fusion',
      select(BLEND_MODES.map((m) => ({ value: m.id, label: m.label, group: m.group })), fx.blend,
        (v: BlendMode) => ed.run('Fusion de l\'effet', () => { fx.blend = v }))))

    corps.appendChild(el('p', { class: 'fx-hint' }, effectInfo(fx.kind).hint))
    return corps
  }

  private ouvrirGeste(): void {
    const layer = this.ed.layer
    if (!layer || this.geste?.layer === layer) return
    this.geste = { layer, avant: layer.effects.map((e) => ({ ...e })) }
  }

  /**
   * Publie le geste en cours dans l'historique. Sans cela, regler une ombre
   * ne serait pas annulable : les modifications se font sur place pour que
   * l'apercu suive le curseur.
   */
  private fermerGeste(label: string): void {
    const g = this.geste
    this.geste = null
    if (!g) return
    const apres = g.layer.effects.map((e) => ({ ...e }))
    if (JSON.stringify(g.avant) === JSON.stringify(apres)) return
    const ed = this.ed
    ed.history.push({
      label,
      undo: () => { g.layer.effects = g.avant.map((e) => ({ ...e })); ed.events.emit('doc', undefined) },
      redo: () => { g.layer.effects = apres.map((e) => ({ ...e })); ed.events.emit('doc', undefined) },
    })
  }

  /** Pastille de couleur, doublee d'un bouton qui prend la couleur active. */
  private champCouleur(
    valeur: number,
    onChange: (c: number) => void,
    onCommit: () => void,
  ): HTMLElement {
    const ed = this.ed
    const input = el('input', {
      type: 'color',
      class: 'fx-color',
      value: toHex(valeur),
      oninput: () => { this.ouvrirGeste(); onChange(fromHex(input.value)) },
      onchange: () => onCommit(),
    })
    return el('div', { class: 'fx-color-row' },
      input,
      iconButton(icon('eyedropper', 12), 'Prendre la couleur active', () => {
        this.ouvrirGeste()
        input.value = toHex(ed.primary)
        onChange(ed.primary)
        onCommit()
      }, { className: 'ghost sm icon-only' }),
    )
  }

  private addLayer(): void {
    const ed = this.ed
    ed.run('Nouveau calque', () => { ed.sprite.addLayer(undefined, ed.activeLayer + 1) })
    ed.setActiveLayer(ed.activeLayer + 1)
  }

  private duplicate(): void {
    const ed = this.ed
    ed.run('Dupliquer le calque', () => { ed.sprite.duplicateLayer(ed.activeLayer) })
    ed.setActiveLayer(ed.activeLayer + 1)
  }

  private mergeDown(): void {
    const ed = this.ed
    if (ed.activeLayer === 0) { ed.toast('Aucun calque en dessous', 'error'); return }
    ed.run('Fusionner vers le bas', () => { ed.sprite.mergeDown(ed.activeLayer) })
    ed.setActiveLayer(Math.max(0, ed.activeLayer - 1))
  }

  private async remove(): Promise<void> {
    const ed = this.ed
    if (ed.sprite.layers.length <= 1) { ed.toast('Il faut au moins un calque', 'error'); return }
    const layer = ed.layer
    const empty = layer.cels.every((c) => !c || c.bitmap.isEmpty())
    if (!empty && !(await confirmDialog('Supprimer le calque', `« ${layer.name} » contient des pixels. Le supprimer ?`, 'Supprimer'))) return
    const index = ed.activeLayer
    ed.run('Supprimer le calque', () => { ed.sprite.removeLayer(index) })
    ed.setActiveLayer(Math.min(index, ed.sprite.layers.length - 1))
  }

  private rename(index: number): void {
    const ed = this.ed
    const row = this.list.children[index] as HTMLElement
    const span = row.querySelector('.lname') as HTMLElement
    const input = el('input', { class: 'layer-name-input', value: ed.sprite.layers[index].name })
    const commit = () => {
      const value = input.value.trim()
      if (value && value !== ed.sprite.layers[index].name) {
        ed.run('Renommer le calque', () => { ed.sprite.layers[index].name = value })
      } else this.render()
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur() }
      if (e.key === 'Escape') { e.preventDefault(); this.render() }
      e.stopPropagation()
    })
    span.replaceWith(input)
    input.focus()
    input.select()
  }

  private contextMenu(e: MouseEvent, index: number): void {
    const ed = this.ed
    const layer = ed.sprite.layers[index]
    ed.setActiveLayer(index)
    const anchor = e.currentTarget as HTMLElement
    openMenu(anchor, [
      { label: 'Renommer', onClick: () => this.rename(index) },
      { label: 'Dupliquer', icon: 'duplicate', onClick: () => this.duplicate() },
      { label: 'Fusionner vers le bas', icon: 'merge', disabled: index === 0, onClick: () => this.mergeDown() },
      { separator: true },
      {
        label: 'Monter',
        disabled: index === ed.sprite.layers.length - 1,
        onClick: () => {
          ed.run('Monter le calque', () => {
            const [l] = ed.sprite.layers.splice(index, 1)
            ed.sprite.layers.splice(index + 1, 0, l)
          })
          ed.setActiveLayer(index + 1)
        },
      },
      {
        label: 'Descendre',
        disabled: index === 0,
        onClick: () => {
          ed.run('Descendre le calque', () => {
            const [l] = ed.sprite.layers.splice(index, 1)
            ed.sprite.layers.splice(index - 1, 0, l)
          })
          ed.setActiveLayer(index - 1)
        },
      },
      { separator: true },
      {
        label: 'Calque de référence',
        checked: layer.reference,
        title: undefined,
        onClick: () => ed.run('Calque de référence', () => { layer.reference = !layer.reference }),
      },
      { label: 'Supprimer', icon: 'trash', onClick: () => this.remove() },
    ])
  }
}
