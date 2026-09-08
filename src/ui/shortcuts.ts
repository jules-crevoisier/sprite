import type { Editor } from '../core/editor'
import { beginMove, applyMove, endMove, toolByShortcut } from '../tools'
import type { Command } from './commands'

/** Combinaison canonique : modificateurs tries puis touche en minuscule. */
export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'
  if (key === 'escape') key = 'esc'
  parts.push(key)
  return parts.join('+')
}

/** Raccourci -> identifiant de commande. Les libelles affiches sont separes. */
const BINDINGS: Record<string, string> = {
  'ctrl+n': 'file.new',
  'ctrl+o': 'file.open',
  'ctrl+s': 'file.save',
  'ctrl+e': 'file.export',
  'ctrl+shift+e': 'file.export-png',

  'ctrl+z': 'edit.undo',
  'ctrl+shift+z': 'edit.redo',
  'ctrl+y': 'edit.redo',
  'ctrl+x': 'edit.cut',
  'ctrl+c': 'edit.copy',
  'ctrl+v': 'edit.paste',
  delete: 'edit.delete',
  backspace: 'edit.delete',
  f: 'edit.fill',
  'ctrl+a': 'edit.select-all',
  'ctrl+d': 'edit.deselect',
  'ctrl+i': 'edit.invert-selection',

  'ctrl+alt+c': 'sprite.canvas-size',
  'ctrl+alt+i': 'sprite.scale',
  'shift+h': 'sprite.flip-h',
  'shift+v': 'sprite.flip-v',

  'shift+n': 'layer.new',
  'ctrl+j': 'layer.duplicate',
  'ctrl+m': 'layer.merge-down',
  'ctrl+shift+m': 'layer.flatten',
  pageup: 'layer.up',
  pagedown: 'layer.down',

  'alt+n': 'frame.new',
  'ctrl+alt+n': 'frame.duplicate',
  '.': 'frame.next',
  ',': 'frame.prev',
  home: 'frame.first',
  end: 'frame.last',
  enter: 'frame.play',
  'ctrl+t': 'frame.tag',
  'alt+o': 'frame.onion',

  '+': 'view.zoom-in',
  '=': 'view.zoom-in',
  '-': 'view.zoom-out',
  'ctrl+0': 'view.zoom-fit',
  'ctrl+1': 'view.zoom-100',
  "ctrl+'": 'view.grid',
  'alt+t': 'view.tiled',

  f1: 'help.shortcuts',
  'ctrl+k': 'help.palette',
  'ctrl+shift+p': 'help.palette',
}

function isTyping(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  if (!node) return false
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable
}

export interface ShortcutHost {
  ed: Editor
  runCommand(id: string): void
  setTool(id: string): void
  /** Retourne true si un geste etait en cours. */
  cancelActive(): boolean
}

/** Installe la gestion clavier globale. */
export function installShortcuts(host: ShortcutHost, commands: () => Command[]): () => void {
  const ed = host.ed

  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return
    const combo = comboOf(e)

    // Echap annule le geste en cours ; a defaut il deselectionne.
    if (combo === 'esc') {
      if (!host.cancelActive() && ed.selection.active) host.runCommand('edit.deselect')
      return
    }

    // Deplacement des pixels selectionnes au clavier.
    const arrows: Record<string, [number, number]> = {
      arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1],
    }
    const arrow = arrows[e.key.toLowerCase()]
    if (arrow && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      const step = e.shiftKey ? 8 : 1
      if (beginMove(ed)) {
        applyMove(ed, arrow[0] * step, arrow[1] * step)
        endMove(ed)
      }
      return
    }

    if (combo === '[' || combo === ']') {
      e.preventDefault()
      const delta = combo === '[' ? -1 : 1
      ed.updateSettings({ brushSize: Math.max(1, Math.min(64, ed.settings.brushSize + delta)) })
      return
    }
    if (combo === 'x') { e.preventDefault(); ed.swapColors(); return }

    const commandId = BINDINGS[combo]
    if (commandId) {
      e.preventDefault()
      host.runCommand(commandId)
      return
    }

    // Outils : lettre seule ou Maj + lettre.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-z]$/.test(e.key.toLowerCase())) {
      const label = e.shiftKey ? `Shift+${e.key.toUpperCase()}` : e.key.toUpperCase()
      const tool = toolByShortcut(label)
      if (tool) {
        e.preventDefault()
        host.setTool(tool.id)
      }
    }
  }

  window.addEventListener('keydown', onKey)
  void commands
  return () => window.removeEventListener('keydown', onKey)
}

/** Libelle lisible d'un raccourci, pour les menus. */
export function keyLabel(commandId: string): string | undefined {
  const entry = Object.entries(BINDINGS).find(([, id]) => id === commandId)
  if (!entry) return undefined
  return entry[0]
    .split('+')
    .map((part) => {
      switch (part) {
        case 'ctrl': return 'Ctrl'
        case 'alt': return 'Alt'
        case 'shift': return 'Maj'
        case 'delete': return 'Suppr'
        case 'backspace': return 'Retour'
        case 'enter': return 'Entree'
        case 'home': return 'Origine'
        case 'end': return 'Fin'
        case 'pageup': return 'Page↑'
        case 'pagedown': return 'Page↓'
        case 'arrowup': return '↑'
        default: return part.length === 1 ? part.toUpperCase() : part.toUpperCase()
      }
    })
    .join('+')
}
