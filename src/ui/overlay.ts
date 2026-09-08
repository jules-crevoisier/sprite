import { el, clear, qs } from './dom'
import { icon } from './icons'

const overlayRoot = (): HTMLElement => qs('#overlay-root')
const toastRoot = (): HTMLElement => qs('#toast-root')

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const MAX_TOASTS = 3

export function showToast(text: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const root = toastRoot()
  // Une rafale d'annulations ne doit pas noyer l'ecran.
  while (root.children.length >= MAX_TOASTS) root.firstElementChild?.remove()
  const last = root.lastElementChild
  if (last && last.textContent === text) last.remove()
  const node = el('div', { class: `toast ${kind}` }, text)
  root.appendChild(node)
  const life = kind === 'error' ? 4200 : kind === 'success' ? 2400 : 1500
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s'
    node.style.opacity = '0'
    node.style.transform = 'translateY(6px)'
    setTimeout(() => node.remove(), 220)
  }, life)
}

/* ------------------------------------------------------------------ */
/* Menus deroulants                                                    */
/* ------------------------------------------------------------------ */

export interface MenuItem {
  label?: string
  icon?: string
  keys?: string
  checked?: boolean
  disabled?: boolean
  separator?: boolean
  title?: string
  onClick?: () => void
}

let closeCurrentMenu: (() => void) | null = null

export function closeMenus(): void {
  closeCurrentMenu?.()
  closeCurrentMenu = null
}

/** Ouvre un menu ancre sous un element ; se ferme au clic exterieur ou avec Echap. */
export function openMenu(anchor: HTMLElement, items: MenuItem[], align: 'left' | 'right' = 'left'): void {
  closeMenus()
  const rect = anchor.getBoundingClientRect()
  const menu = el('div', { class: 'dropdown', role: 'menu' })

  for (const item of items) {
    if (item.separator) { menu.appendChild(el('div', { class: 'menu-sep' })); continue }
    if (!item.onClick && item.title) {
      menu.appendChild(el('div', { class: 'menu-title' }, item.title))
      continue
    }
    const btn = el('button', {
      class: `menu-item ${item.checked ? 'checked' : ''}`,
      disabled: item.disabled ?? false,
      onclick: () => { closeMenus(); item.onClick?.() },
    })
    btn.appendChild(el('span', {
      style: { width: '18px', display: 'grid', placeItems: 'center' },
      html: item.icon ? icon(item.icon, 16) : '',
    }))
    btn.appendChild(el('span', { class: 'label' }, item.label ?? ''))
    if (item.keys) btn.appendChild(el('span', { class: 'keys' }, item.keys))
    menu.appendChild(btn)
  }

  overlayRoot().appendChild(menu)
  // Positionnement apres insertion : la taille reelle est alors connue.
  const mr = menu.getBoundingClientRect()
  const left = align === 'right'
    ? Math.max(8, rect.right - mr.width)
    : Math.min(rect.left, window.innerWidth - mr.width - 8)
  const top = rect.bottom + mr.height > window.innerHeight - 8
    ? Math.max(8, rect.top - mr.height - 4)
    : rect.bottom + 4
  menu.style.left = `${Math.max(8, left)}px`
  menu.style.top = `${top}px`

  anchor.classList.add('open')

  const onDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeMenus()
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenus() } }
  setTimeout(() => {
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
  }, 0)

  closeCurrentMenu = () => {
    menu.remove()
    anchor.classList.remove('open')
    window.removeEventListener('mousedown', onDown, true)
    window.removeEventListener('keydown', onKey, true)
  }
}

/* ------------------------------------------------------------------ */
/* Modales                                                             */
/* ------------------------------------------------------------------ */

export interface ModalAction {
  label: string
  primary?: boolean
  danger?: boolean
  /** Retourner false empeche la fermeture. */
  onClick?: () => boolean | void
}

export interface ModalHandle {
  close(): void
  readonly body: HTMLElement
  setFooterEnabled(index: number, enabled: boolean): void
}

/** Ouvre une modale. Echap ferme, Entree declenche l'action principale. */
export function openModal(opts: {
  title: string
  icon?: string
  body: HTMLElement
  actions?: ModalAction[]
  wide?: boolean
  onClose?: () => void
}): ModalHandle {
  const backdrop = el('div', { class: 'modal-backdrop' })
  const modal = el('div', { class: `modal ${opts.wide ? 'wide' : ''}` })

  const close = () => {
    backdrop.remove()
    window.removeEventListener('keydown', onKey, true)
    opts.onClose?.()
  }

  const head = el('div', { class: 'modal-head' })
  if (opts.icon) head.appendChild(el('span', { html: icon(opts.icon, 18), style: { color: 'var(--accent)' } }))
  head.appendChild(el('h2', null, opts.title))
  head.appendChild(el('button', { class: 'btn ghost icon-only', title: 'Fermer', onclick: close, html: icon('close', 16) }))

  const body = el('div', { class: 'modal-body' }, opts.body)
  modal.append(head, body)

  const footButtons: HTMLButtonElement[] = []
  let primaryAction: ModalAction | null = null
  if (opts.actions?.length) {
    const foot = el('div', { class: 'modal-foot' })
    for (const action of opts.actions) {
      if (action.primary) primaryAction = action
      const btn = el('button', {
        class: `btn ${action.primary ? 'primary' : ''} ${action.danger ? 'danger' : ''}`.trim(),
        onclick: () => { if (action.onClick?.() !== false) close() },
      }, action.label)
      footButtons.push(btn)
      foot.appendChild(btn)
    }
    modal.appendChild(foot)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
    else if (e.key === 'Enter' && primaryAction && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      if (primaryAction.onClick?.() !== false) close()
    }
  }
  window.addEventListener('keydown', onKey, true)
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close() })

  backdrop.appendChild(modal)
  document.body.appendChild(backdrop)

  const firstField = modal.querySelector<HTMLElement>('input, select, textarea')
  firstField?.focus()
  if (firstField instanceof HTMLInputElement) firstField.select()

  return {
    close,
    body,
    setFooterEnabled(index, enabled) { if (footButtons[index]) footButtons[index].disabled = !enabled },
  }
}

export function confirmDialog(title: string, message: string, confirmLabel = 'Confirmer'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    openModal({
      title,
      icon: 'info',
      body: el('p', { class: 'form-note', style: { margin: '0', fontSize: '13px' } }, message),
      actions: [
        { label: 'Annuler', onClick: () => { done = true; resolve(false) } },
        { label: confirmLabel, primary: true, onClick: () => { done = true; resolve(true) } },
      ],
      onClose: () => { if (!done) resolve(false) },
    })
  })
}

export function promptDialog(title: string, label: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    const input = el('input', { type: 'text', value, style: { width: '100%' } })
    const body = el('div', { class: 'form-grid' }, el('label', null, label), input)
    openModal({
      title,
      body,
      actions: [
        { label: 'Annuler', onClick: () => { done = true; resolve(null) } },
        { label: 'Valider', primary: true, onClick: () => { done = true; resolve(input.value.trim() || null) } },
      ],
      onClose: () => { if (!done) resolve(null) },
    })
  })
}

/** Vide un conteneur et y insere de nouveaux enfants. */
export function replace(container: Element, ...children: (Node | string)[]): void {
  clear(container)
  for (const c of children) container.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
}
