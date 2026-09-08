type Child = Node | string | number | null | undefined | false

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>

/**
 * Fabrique d'elements. `props` accepte : class, html (innerHTML), style
 * (objet), dataset, les gestionnaires onX, et toute propriete DOM directe.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue
      if (key === 'class') node.className = String(value)
      else if (key === 'html') node.innerHTML = String(value)
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
      else if (key === 'dataset') Object.assign(node.dataset, value)
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      } else if (key in node) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (node as any)[key] = value
      } else node.setAttribute(key, String(value))
    }
  }
  append(node, children)
  return node
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)))
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector)
  if (!found) throw new Error(`Element introuvable : ${selector}`)
  return found
}

/** Bouton avec icone SVG et libelle optionnel. */
export function iconButton(
  svg: string,
  title: string,
  onClick: (e: MouseEvent) => void,
  opts: { label?: string; className?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const btn = el('button', {
    class: `btn ${opts.label ? '' : 'icon-only'} ${opts.className ?? ''}`.trim(),
    title,
    'aria-label': title,
    disabled: opts.disabled ?? false,
    onclick: onClick,
    html: svg,
  })
  if (opts.label) btn.appendChild(el('span', null, opts.label))
  return btn
}

/** Curseur numerique avec valeur affichee et rappel de changement. */
export function slider(
  min: number, max: number, value: number, step: number,
  onInput: (v: number) => void,
  format: (v: number) => string = (v) => String(v),
  /** Appele au relachement : un geste complet, pas chaque pixel parcouru. */
  onCommit?: (v: number) => void,
): HTMLElement {
  const badge = el('span', { class: 'num-badge' }, format(value))
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: () => {
      const v = Number(input.value)
      badge.textContent = format(v)
      onInput(v)
    },
    onchange: () => { onCommit?.(Number(input.value)) },
  })
  return el('div', { class: 'opt' }, input, badge)
}

export function labeled(label: string, ...content: Child[]): HTMLElement {
  return el('div', { class: 'opt' }, el('label', null, label), ...content)
}

export function select<T extends string>(
  options: { value: T; label: string; group?: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const node = el('select', { onchange: () => onChange(node.value as T) })
  const groups = new Map<string, HTMLElement>()
  for (const opt of options) {
    const option = el('option', { value: opt.value, selected: opt.value === value }, opt.label)
    if (opt.group) {
      let g = groups.get(opt.group)
      if (!g) { g = el('optgroup', { label: opt.group }); groups.set(opt.group, g); node.appendChild(g) }
      g.appendChild(option)
    } else node.appendChild(option)
  }
  node.value = value
  return node
}

export function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) })
  return el('label', { class: 'check' }, input, el('span', null, label))
}

export function numberInput(
  value: number,
  onChange: (v: number) => void,
  opts: { min?: number; max?: number; step?: number; width?: string } = {},
): HTMLInputElement {
  const input = el('input', {
    type: 'number',
    value: String(value),
    min: opts.min ?? 0,
    max: opts.max ?? 9999,
    step: opts.step ?? 1,
    onchange: () => onChange(Number(input.value)),
  })
  if (opts.width) input.style.width = opts.width
  return input
}

/** Groupe de boutons exclusifs. */
export function segmented<T extends string>(
  items: { value: T; label?: string; icon?: string; title?: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const wrap = el('div', { class: 'seg' })
  for (const item of items) {
    const btn = el('button', {
      class: item.value === value ? 'active' : '',
      title: item.title ?? item.label ?? '',
      onclick: () => onChange(item.value),
      html: item.icon ?? '',
    })
    if (item.label) btn.appendChild(el('span', null, item.label))
    wrap.appendChild(btn)
  }
  return wrap
}
