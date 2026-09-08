import type { Editor } from '../core/editor'
import { BLEND_MODES, type BlendMode } from '../core/blend'
import { compositeFrame } from '../render/composite'
import { el, clear, iconButton, select, slider } from './dom'
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
        ed.run('Reordonner les calques', () => {
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
        el('label', { style: { width: '52px' } }, 'Opacite'),
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
        label: 'Calque de reference',
        checked: layer.reference,
        title: undefined,
        onClick: () => ed.run('Calque de reference', () => { layer.reference = !layer.reference }),
      },
      { label: 'Supprimer', icon: 'trash', onClick: () => this.remove() },
    ])
  }
}
