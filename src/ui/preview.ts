import type { Editor } from '../core/editor'
import { compositeFrame } from '../render/composite'
import { el } from './dom'

/** Apercu du rendu final a l'echelle, sans grille ni onion skin. */
export class PreviewPanel {
  /** Contenu du panneau ; l'entete est fournie par l'espace de travail. */
  readonly content: HTMLElement
  private ed: Editor
  private canvas = el('canvas', { width: 64, height: 64 })
  private meta = el('div', { class: 'preview-meta' })
  private zoom: number | 'fit' = 'fit'

  constructor(editor: Editor) {
    this.ed = editor
    const box = el('div', { class: 'preview-box' }, this.canvas, this.meta)
    box.addEventListener('click', () => {
      const steps: (number | 'fit')[] = ['fit', 1, 2, 4, 8]
      this.zoom = steps[(steps.indexOf(this.zoom) + 1) % steps.length]
      this.render()
    })
    box.title = 'Cliquer pour changer l\'échelle de l\'aperçu'
    this.content = box

    editor.events.on('doc', () => this.render())
    editor.events.on('cursor', () => this.render())
    editor.events.on('reload', () => this.render())
    this.render()
  }

  render(): void {
    const ed = this.ed
    const bm = compositeFrame(ed.sprite, ed.activeFrame)
    const maxW = 232, maxH = 100
    const scale = this.zoom === 'fit'
      ? Math.max(1, Math.floor(Math.min(maxW / bm.width, maxH / bm.height)))
      : this.zoom

    this.canvas.width = bm.width
    this.canvas.height = bm.height
    this.canvas.style.width = `${bm.width * scale}px`
    this.canvas.style.height = `${bm.height * scale}px`
    const ctx = this.canvas.getContext('2d')!
    ctx.clearRect(0, 0, bm.width, bm.height)
    ctx.putImageData(bm.toImageData(), 0, 0)

    const tag = ed.sprite.tagAt(ed.activeFrame)
    this.meta.textContent = `${bm.width}x${bm.height} · ${scale}x${tag ? ` · ${tag.name}` : ''}`
  }
}
