import type { Editor } from '../core/editor'
import { getA, toCss } from '../core/color'
import { DITHER_PATTERNS, brushOffsets, dither, type BrushShape } from '../tools/algorithms'
import type { PaintMode } from '../tools/painter'
import { rigState, refreshPose, toolById } from '../tools'
import { el, clear, slider, checkbox, select, segmented } from './dom'
import { icon } from './icons'

/**
 * Apercu d'un trait reel, pose avec les reglages courants.
 *
 * Deux reglages voisins agissent sur des choses differentes, et rien ne le
 * disait : la forme du pinceau decide *quels pixels* sont poses a chaque
 * point du trait, le tramage decide *quelle couleur* recoit chacun d'eux.
 * Montrer les deux separement n'y suffisait pas — un tramage a couleur
 * secondaire transparente troue le trait, ce qui ressemble a s'y meprendre a
 * un pinceau plus fin. On dessine donc le trait tel qu'il sortira.
 */
function strokePreview(ed: Editor): HTMLElement {
  const s = ed.settings
  const offsets = brushOffsets(s.brushSize, s.brushShape)
  const W = 46, H = 22, cell = 1
  const canvas = el('canvas', {
    width: W, height: H,
    class: 'brush-preview stroke',
    title: `Trait reel : ${offsets.length / 2} pixel(s) par pointe`
      + (s.ditherPattern === 'none' ? '' : ', tramage applique'),
  })
  const ctx = canvas.getContext('2d')
  if (!ctx) return el('div', { class: 'opt' }, canvas)

  // Un trait courbe : il montre a la fois l'epaisseur, la forme de la pointe
  // et, sur les obliques, ce que le tramage fait du remplissage.
  const poser = (px: number, py: number) => {
    for (let i = 0; i < offsets.length; i += 2) {
      const x = px + offsets[i], y = py + offsets[i + 1]
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      let color = ed.primary
      if (s.ditherPattern !== 'none') {
        const on = dither(s.ditherPattern, x, y, s.ditherRatio)
        color = on ? ed.primary : ed.secondary
      }
      if (getA(color) === 0) continue
      ctx.fillStyle = toCss(color)
      ctx.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  for (let t = 0; t <= 1; t += 0.02) {
    poser(Math.round(4 + t * (W - 9)), Math.round(H / 2 + Math.sin(t * Math.PI) * -5))
  }
  return el('div', { class: 'opt' }, canvas)
}

const SHAPES: { value: BrushShape; icon: string; title: string }[] = [
  { value: 'circle', icon: '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg>', title: 'Ronde' },
  { value: 'square', icon: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" fill="currentColor"/></svg>', title: 'Carree' },
  { value: 'diamond', icon: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2l5 5-5 5-5-5z" fill="currentColor"/></svg>', title: 'Losange' },
  { value: 'h-line', icon: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="6" width="12" height="2" fill="currentColor"/></svg>', title: 'Ligne horizontale' },
  { value: 'v-line', icon: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="6" y="1" width="2" height="12" fill="currentColor"/></svg>', title: 'Ligne verticale' },
]

const PAINT_MODES: { value: PaintMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'behind', label: 'Derriere' },
  { value: 'lock-alpha', label: 'Alpha verrouille' },
]

/** Barre contextuelle : n'affiche que les reglages utiles a l'outil actif. */
export function renderOptionsBar(container: HTMLElement, ed: Editor, refresh: () => void): void {
  clear(container)
  const tool = toolById(ed.settings.tool)
  const s = ed.settings
  const add = (...nodes: (Node | null)[]) => {
    for (const n of nodes) if (n) container.appendChild(n)
  }

  add(el('div', { class: 'opt' }, el('strong', { style: { color: 'var(--text)', fontSize: '12.5px' } }, tool.name)))
  add(el('div', { class: 'opt-sep' }))

  const opts = new Set(tool.options)

  // Le mode squelette a ses propres reglages : la brosse de dessin et le
  // tramage n'y ont pas de sens.
  if (ed.mode === 'rig') {
    if (opts.has('weightBrush')) {
      add(el('div', { class: 'opt' },
        el('label', null, 'Pinceau'),
        slider(1, 24, rigState.weightBrush, 1,
          (v) => { rigState.weightBrush = v; ed.events.emit('settings', undefined) },
          (v) => `${v}px`),
      ))
    }
    // Le pinceau Ponderer allume deja la carte : la case n'a de sens que
    // pour les deux autres outils.
    if (tool.id !== 'rig-weight') {
      add(el('div', { class: 'opt' },
        checkbox('Montrer l\'influence des os', ed.showWeights, (v) => {
          ed.showWeights = v
          ed.events.emit('settings', undefined)
        }),
      ))
    }
    const seamLabels = ['aucun', 'discret', 'normal', 'genereux']
    add(el('div', { class: 'opt' },
      el('label', null, 'Jointures'),
      slider(0, 3, rigState.seam, 1,
        (v) => { rigState.seam = v; refreshPose(ed) },
        (v) => seamLabels[v] ?? ''),
    ))
      return
  }

  if (opts.has('brush')) {
    add(el('div', { class: 'opt' },
      el('label', null, 'Taille'),
      slider(1, 64, s.brushSize, 1, (v) => { ed.updateSettings({ brushSize: v }); refresh() }, (v) => `${v}px`),
    ))
    add(segmented(SHAPES.map((sh) => ({ value: sh.value, icon: sh.icon, title: sh.title })), s.brushShape,
      (v) => { ed.updateSettings({ brushShape: v }); refresh() }))
    // Le trait tel qu'il sortira : c'est la seule facon de voir ce que la
    // forme change, et pourquoi elle ne change rien en dessous de 3 pixels.
    add(strokePreview(ed))
    if (s.brushSize < 3) add(el('div', { class: 'opt-note' }, 'inerte sous 3 px'))
  }

  if (opts.has('opacity')) {
    add(el('div', { class: 'opt' },
      el('label', null, 'Opacite'),
      slider(1, 255, s.opacity, 1, (v) => ed.updateSettings({ opacity: v }),
        (v) => `${Math.round((v / 255) * 100)}%`),
    ))
  }

  if (opts.has('paintMode')) {
    add(el('div', { class: 'opt' },
      el('label', null, 'Pose'),
      select(PAINT_MODES, s.paintMode, (v) => ed.updateSettings({ paintMode: v })),
    ))
  }

  if (opts.has('pixelPerfect')) {
    add(el('div', { class: 'opt' },
      checkbox('Pixel perfect', s.pixelPerfect, (v) => ed.updateSettings({ pixelPerfect: v })),
    ))
  }

  if (opts.has('dither')) {
    add(el('div', { class: 'opt' },
      el('label', null, 'Tramage'),
      select(DITHER_PATTERNS.map((d) => ({ value: d.id, label: d.label })), s.ditherPattern,
        (v) => { ed.updateSettings({ ditherPattern: v }); refresh() }),
    ))
    if (s.ditherPattern !== 'none') {
      add(slider(0, 1, s.ditherRatio, 0.05, (v) => { ed.updateSettings({ ditherRatio: v }); refresh() },
        (v) => `${Math.round(v * 100)}%`))
      // Le tramage melange deux couleurs pour simuler une teinte absente de
      // la palette. Avec une secondaire transparente il ne melange rien : il
      // troue le trait, ce qui se lit comme un pinceau defectueux.
      // Une seule note, qui oppose les deux reglages : c'est la comparaison
      // qui manque, pas la description de chacun pris a part.
      add(el('div', {
        class: 'opt-note' + (getA(ed.secondary) === 0 ? ' warn' : ''),
        title: 'La forme decide quels pixels sont poses a chaque point du trait. '
          + 'Le tramage decide de quelle couleur : il alterne la principale et la '
          + 'secondaire pour simuler une teinte absente de la palette.',
      }, getA(ed.secondary) === 0
        ? 'forme = ou · trame = avec quoi, mais il faut une secondaire'
        : 'forme = ou · trame = avec quoi'))
    }
  }

  if (opts.has('gradientDither')) {
    add(el('div', { class: 'opt' },
      checkbox('Tramage du degrade', s.gradientDither, (v) => ed.updateSettings({ gradientDither: v })),
    ))
  }

  if (opts.has('tolerance')) {
    add(el('div', { class: 'opt' },
      el('label', null, 'Tolerance'),
      slider(0, 255, s.tolerance, 1, (v) => ed.updateSettings({ tolerance: v })),
    ))
  }

  if (opts.has('contiguous')) {
    add(el('div', { class: 'opt' },
      checkbox('Zone contigue', s.contiguous, (v) => ed.updateSettings({ contiguous: v })),
    ))
  }

  if (opts.has('fillShapes')) {
    add(el('div', { class: 'opt' },
      checkbox('Remplir', s.fillShapes, (v) => ed.updateSettings({ fillShapes: v })),
    ))
  }

  if (opts.has('strength')) {
    add(el('div', { class: 'opt' },
      el('label', null, 'Intensite'),
      slider(0.02, 0.6, s.strength, 0.01, (v) => ed.updateSettings({ strength: v }),
        (v) => `${Math.round(v * 100)}%`),
    ))
  }

  if (opts.has('sprayDensity')) {
    add(el('div', { class: 'opt' },
      el('label', null, 'Debit'),
      slider(1, 60, s.sprayDensity, 1, (v) => ed.updateSettings({ sprayDensity: v })),
    ))
  }

  // Reglages globaux, toujours visibles a droite.
  add(el('div', { class: 'opt-sep' }))
  const symBtn = (axis: 'x' | 'y', label: string) => el('button', {
    class: `btn sm ${ed.symmetry[axis] ? 'active' : ''}`,
    title: `Symetrie ${label}`,
    onclick: () => { ed.symmetry[axis] = !ed.symmetry[axis]; ed.events.emit('settings', undefined); refresh() },
    html: icon('symmetry', 14),
  }, el('span', null, label))
  add(el('div', { class: 'opt' }, symBtn('x', 'X'), symBtn('y', 'Y')))

  add(el('div', { class: 'opt' }, el('button', {
    class: `btn sm ${ed.tiledDrawing ? 'active' : ''}`,
    title: 'Dessin en mode tuile : le trait se replie sur les bords opposes',
    onclick: () => { ed.tiledDrawing = !ed.tiledDrawing; ed.events.emit('settings', undefined); refresh() },
    html: icon('grid', 14),
  }, el('span', null, 'Tuile'))))

  flagOverflow(container)
}

/**
 * Marque la barre quand son contenu depasse. Elle defile sans ascenseur : sans
 * ce signal, les reglages sortis du cadre restent introuvables.
 */
function flagOverflow(root: HTMLElement): void {
  const wrap = root.parentElement
  if (!wrap || !wrap.classList.contains('optionsbar-wrap')) return
  // Apres le rendu : les largeurs ne sont connues qu'une fois la barre posee.
  requestAnimationFrame(() => {
    wrap.classList.toggle('overflowing', root.scrollWidth > root.clientWidth + 1)
  })
}
