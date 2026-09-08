import type { Command } from './commands'
import { el, clear } from './dom'
import { openModal } from './overlay'
import { icon } from './icons'
import { keyLabel } from './shortcuts'

/** Score de correspondance approximative : les lettres doivent apparaitre dans l'ordre. */
function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (t.includes(q)) return 1000 - t.indexOf(q)
  let ti = 0
  let score = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return 0
    score += found === ti ? 4 : 1
    ti = found + 1
  }
  return score
}

/** Recherche floue sur toutes les commandes disponibles. */
export function openCommandPalette(commands: Command[]): void {
  const input = el('input', {
    class: 'cmdk-input',
    type: 'text',
    placeholder: 'Rechercher une commande…',
    spellcheck: false,
  })
  const list = el('div', { class: 'cmdk-list' })
  const body = el('div', null, input, list)

  let filtered: Command[] = []
  let selected = 0

  const render = () => {
    const query = input.value.trim()
    filtered = commands
      .map((c) => ({ c, score: fuzzyScore(`${c.group} ${c.label}`, query) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((r) => r.c)

    selected = Math.min(selected, Math.max(0, filtered.length - 1))
    clear(list)
    if (!filtered.length) {
      list.appendChild(el('div', { class: 'cmdk-empty' }, 'Aucune commande'))
      return
    }
    filtered.forEach((c, i) => {
      const enabled = c.enabled?.() ?? true
      const btn = el('button', {
        class: `cmdk-item ${i === selected ? 'sel' : ''}`,
        disabled: !enabled,
        onclick: () => { handle.close(); void c.run() },
      },
        el('span', { style: { width: '18px', display: 'grid', placeItems: 'center' }, html: c.icon ? icon(c.icon, 15) : '' }),
        el('span', { class: 'label' }, c.label),
        el('span', { class: 'group' }, c.group),
      )
      const keys = keyLabel(c.id)
      if (keys) btn.appendChild(el('span', { class: 'keys' }, keys))
      list.appendChild(btn)
    })
  }

  input.addEventListener('input', () => { selected = 0; render() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = (selected + 1) % Math.max(1, filtered.length); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = (selected - 1 + filtered.length) % Math.max(1, filtered.length); render() }
    else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const cmd = filtered[selected]
      if (cmd && (cmd.enabled?.() ?? true)) { handle.close(); void cmd.run() }
    }
  })

  const handle = openModal({ title: 'Commandes', icon: 'search', body })
  render()
  input.focus()
}
