import type { App } from './app'
import { el, clear, iconButton, segmented } from './dom'
import { icon } from './icons'
import { openMenu, type MenuItem } from './overlay'
import { keyLabel } from './shortcuts'

/** Organisation des menus deroulants ; '---' insere un separateur. */
const MENUS: { label: string; items: string[] }[] = [
  {
    label: 'Fichier',
    items: [
      'file.new', 'file.open', 'file.save', '---',
      'file.import-image', 'file.import-layer', '---',
      'file.export', 'file.export-png', 'file.export-gif', 'file.export-frames', '---',
      'file.copy-png', 'file.restore',
    ],
  },
  {
    label: 'Edition',
    items: [
      'edit.undo', 'edit.redo', '---',
      'edit.cut', 'edit.copy', 'edit.paste', 'edit.delete', 'edit.fill', '---',
      'edit.select-all', 'edit.deselect', 'edit.invert-selection', 'edit.select-opaque',
      'edit.grow', 'edit.shrink',
    ],
  },
  {
    label: 'Sprite',
    items: [
      'sprite.canvas-size', 'sprite.scale', 'sprite.crop', 'sprite.trim', '---',
      'sprite.flip-h', 'sprite.flip-v', 'sprite.flip-cel-h', 'sprite.rotate-cw', 'sprite.rotate-ccw', 'sprite.rotate-180', '---',
      'sprite.outline', 'sprite.invert-colors', 'sprite.desaturate', 'sprite.snap-palette', '---',
      'sprite.grid', 'sprite.slice-new', 'sprite.slices', 'sprite.palette-from-list',
    ],
  },
  {
    label: 'Assiste',
    items: [
      'rig.open', '---',
      'sprite.ramp', 'sprite.shade', '---',
      'sprite.variants', 'sprite.detail',
    ],
  },
  {
    label: 'Calque',
    items: [
      'layer.new', 'layer.duplicate', 'layer.delete', '---',
      'layer.fx-ombre-portee', 'layer.fx-ombre-interne', 'layer.fx-lueur-externe',
      'layer.fx-lueur-interne', 'layer.fx-contour', 'layer.fx-biseau',
      'layer.fx-teinte', 'layer.fx-degrade',
      '---', 'layer.fx-bake', 'layer.fx-clear', '---',
      'layer.merge-down', 'layer.flatten', '---',
      'layer.up', 'layer.down', '---',
      'layer.toggle-visible', 'layer.toggle-lock',
    ],
  },
  {
    label: 'Animation',
    items: [
      'frame.new', 'frame.new-empty', 'frame.duplicate', 'frame.delete', '---',
      'frame.prev', 'frame.next', 'frame.first', 'frame.last', '---',
      'frame.play', 'frame.onion', '---',
      'frame.tag', 'frame.propagate',
    ],
  },
  {
    label: 'Vue',
    items: [
      'view.zoom-in', 'view.zoom-out', 'view.zoom-fit', 'view.zoom-100', 'view.center', '---',
      'view.grid', 'view.pixel-grid', 'view.slices', 'view.background', '---',
      'view.tiled', 'view.tiled-draw', '---',
      'view.workspace', 'view.timeline', 'view.layout-reset', '---',
      'view.symmetry-x', 'view.symmetry-y',
    ],
  },
  {
    label: 'Aide',
    items: ['help.tutorials', '---', 'help.palette', 'help.shortcuts', 'help.about'],
  },
]

/** Construit la barre superieure : marque, menus, titre du document, actions. */
export function renderTopbar(container: HTMLElement, app: App): void {
  clear(container)
  const ed = app.ed

  container.appendChild(el('div', { class: 'brand' },
    el('div', { class: 'brand-mark' },
      el('i', { style: { background: '#6c8cff' } }),
      el('i', { style: { background: '#ffb454' } }),
      el('i', { style: { background: '#54d6a0' } }),
      el('i', { style: { background: '#ff6b8a' } }),
    ),
    el('span', { class: 'brand-name' }, 'Pixel', el('b', null, 'Forge')),
  ))

  for (const menu of MENUS) {
    const btn = el('button', { class: 'menu-btn' }, menu.label)
    btn.addEventListener('click', () => {
      const items: MenuItem[] = menu.items.map((id) => {
        if (id === '---') return { separator: true }
        const cmd = app.command(id)
        if (!cmd) return { separator: true }
        return {
          label: cmd.label,
          icon: cmd.icon,
          keys: keyLabel(cmd.id),
          disabled: !(cmd.enabled?.() ?? true),
          checked: cmd.checked?.() ?? false,
          onClick: () => void cmd.run(),
        }
      })
      openMenu(btn, items)
    })
    container.appendChild(btn)
  }

  container.appendChild(el('div', { class: 'topbar-spacer' }))

  // Bascule de mode : toute l'interface suit, outils et panneaux compris.
  container.appendChild(segmented([
    { value: 'draw', label: 'Dessin', icon: icon('pencil', 14), title: 'Dessiner, animer, exporter' },
    { value: 'rig', label: 'Squelette', icon: icon('rig', 14), title: 'Articuler et poser le personnage (Maj+K)' },
  ], ed.mode, (v) => app.setMode(v as 'draw' | 'rig')))

  container.appendChild(el('div', { class: 'topbar-spacer' }))

  const title = el('input', { class: 'doc-title', type: 'text', value: ed.sprite.name, spellcheck: false })
  title.addEventListener('change', () => {
    const value = title.value.trim() || 'sans-titre'
    ed.run('Renommer le sprite', () => { ed.sprite.name = value })
  })
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur() })
  container.appendChild(title)

  const actions = el('div', { class: 'topbar-actions' },
    iconButton(icon('undo', 16), `Annuler${ed.history.undoLabel ? ` : ${ed.history.undoLabel}` : ''}`,
      () => ed.undo(), { className: 'ghost', disabled: !ed.history.canUndo }),
    iconButton(icon('redo', 16), `Retablir${ed.history.redoLabel ? ` : ${ed.history.redoLabel}` : ''}`,
      () => ed.redo(), { className: 'ghost', disabled: !ed.history.canRedo }),
    el('div', { class: 'opt-sep' }),
    iconButton(icon('layout', 16), 'Espace de travail : dispositions et panneaux',
      (e) => app.workspace.workspaceMenu(e.currentTarget as HTMLElement), { className: 'ghost' }),
    iconButton(icon('search', 16), 'Palette de commandes (Ctrl+K)', () => app.openCommandPalette(), { className: 'ghost' }),
    iconButton(icon('save', 16), 'Enregistrer le projet (Ctrl+S)', () => app.runCommand('file.save'), { className: 'ghost' }),
    iconButton(icon('download', 16), 'Exporter (Ctrl+E)', () => app.runCommand('file.export'),
      { className: 'primary', label: 'Exporter' }),
  )
  container.appendChild(actions)
}
