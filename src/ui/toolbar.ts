import { normaliserTouches } from './shortcuts'
import type { Editor } from '../core/editor'
import { toolsForMode } from '../tools'
import { el, clear } from './dom'
import { icon } from './icons'

/** Barre d'outils verticale, groupee par famille. */
export function renderToolbar(container: HTMLElement, ed: Editor, onSelect: (id: string) => void): void {
  clear(container)
  let lastGroup = ''
  for (const tool of toolsForMode(ed.mode)) {
    if (lastGroup && tool.group !== lastGroup) container.appendChild(el('div', { class: 'sep' }))
    lastGroup = tool.group
    const active = ed.settings.tool === tool.id
    const btn = el('button', {
      class: `tool ${active ? 'active' : ''}`,
      title: `${tool.name}  (${normaliserTouches(tool.shortcut)})${tool.hint ? `\n${tool.hint}` : ''}`,
      'aria-label': tool.name,
      'aria-pressed': String(active),
      onclick: () => onSelect(tool.id),
      html: tool.icon
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${tool.icon}</svg>`
        : icon('pencil'),
    })
    container.appendChild(btn)
  }
}
