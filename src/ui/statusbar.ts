import type { Editor } from '../core/editor'
import { toHex } from '../core/color'
import { el, clear } from './dom'
import { toolById } from '../tools'

/** Ligne d'etat : position du curseur, taille, zoom, selection, historique. */
export class StatusBar {
  private node: HTMLElement
  private ed: Editor
  private cursor = { x: -1, y: -1 }
  private savedAt: Date | null = null

  constructor(node: HTMLElement, editor: Editor) {
    this.node = node
    this.ed = editor
    editor.events.on('doc', () => this.render())
    editor.events.on('cursor', () => this.render())
    editor.events.on('settings', () => this.render())
    editor.events.on('selection', () => this.render())
    editor.events.on('reload', () => this.render())
    this.render()
  }

  setCursor(x: number, y: number): void {
    if (x === this.cursor.x && y === this.cursor.y) return
    this.cursor = { x, y }
    this.render()
  }

  markSaved(): void {
    this.savedAt = new Date()
    this.render()
  }

  private render(): void {
    const ed = this.ed
    clear(this.node)
    const inside = this.cursor.x >= 0 && this.cursor.y >= 0 &&
      this.cursor.x < ed.sprite.width && this.cursor.y < ed.sprite.height

    const cel = ed.peekCel()
    const under = inside && cel ? cel.bitmap.get(this.cursor.x, this.cursor.y) : null
    const sel = ed.selection
    const selBox = sel.active ? sel.bounds() : null

    const parts: (Node | string)[] = [
      el('span', null, el('b', null, `${this.cursor.x < 0 ? '—' : this.cursor.x}, ${this.cursor.y < 0 ? '—' : this.cursor.y}`)),
      el('span', null, `${ed.sprite.width}×${ed.sprite.height}`),
      el('span', null, `${ed.view.zoom < 1 ? ed.view.zoom.toFixed(2) : ed.view.zoom}x`),
      el('span', null, `${toolById(ed.settings.tool).name}`),
    ]
    // Le mode d'emploi de l'outil tenait 360 pixels dans la barre d'options,
    // qu'il poussait au debordement — et cette barre defile sans ascenseur
    // visible, donc ce qui en sortait devenait introuvable. Sa place est ici.
    const hint = toolById(ed.settings.tool).hint
    if (hint) parts.push(el('span', { class: 'status-hint' }, hint))
    if (under !== null) parts.push(el('span', null, toHex(under, true)))
    if (selBox) parts.push(el('span', null, `sel ${selBox.w}×${selBox.h} (${sel.selectedCount} px)`))

    parts.push(el('span', { class: 'spacer' }))
    parts.push(el('span', null, `calque ${ed.activeLayer + 1}/${ed.sprite.layers.length}`))
    parts.push(el('span', null, `frame ${ed.activeFrame + 1}/${ed.frameCount}`))
    if (ed.history.canUndo) parts.push(el('span', null, `${ed.history.depth} actions`))
    if (this.savedAt) {
      parts.push(el('span', null, `sauvegarde ${this.savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`))
    }

    for (const p of parts) this.node.appendChild(typeof p === 'string' ? document.createTextNode(p) : p)
  }
}
