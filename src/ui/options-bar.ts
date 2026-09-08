import type { Editor } from '../core/editor'
import { getA, toCss } from '../core/color'
import { DITHER_PATTERNS, brushOffsets, dither, type BrushShape } from '../tools/algorithms'
import type { PaintMode } from '../tools/painter'
import { rigState, refreshPose, toolById } from '../tools'
import { el, clear, slider, checkbox, select, segmented } from './dom'
import { icon } from './icons'

/**
 * Dessine l'empreinte exacte du pinceau. Sans elle, changer de forme en
 * dessous de trois pixels ne montre rien : toutes les formes donnent alors
 * le meme carre, et le reglage passe pour inutile.
 */
function brushPreview(size: number, shape: BrushShape): HTMLElement {
  const offsets = brushOffsets(size, shape)
  let min = 0, max = 0
  for (let i = 0; i < offsets.length; i++) {
    min = Math.min(min, offsets[i])
    max = Math.max(max, offsets[i])
  }
  const span = Math.max(1, max - min + 1)
  const cell = Math.max(1, Math.min(3, Math.floor(22 / span)))
  const canvas = el('canvas', {
    width: span * cell, height: span * cell,
    class: 'brush-preview',
    title: `${offsets.length / 2} pixels poses par pointe`,
  })
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#9aa3ba'
    for (let i = 0; i < offsets.length; i += 2) {
      ctx.fillRect((offsets[i] - min) * cell, (offsets[i + 1] - min) * cell, cell, cell)
    }
  }
  return el('div', { class: 'opt' }, canvas)
}

/** Apercu du motif de tramage, avec les deux couleurs reellement posees. */
function ditherPreview(ed: Editor): HTMLElement {
  const s = ed.settings
  const cell = 3, span = 8
  const canvas = el('canvas', {
    width: span * cell, height: span * cell,
    class: 'brush-preview',
    title: 'Melange des couleurs primaire et secondaire',
  })
  const ctx = canvas.getContext('2d')
  if (ctx) {
    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const on = dither(s.ditherPattern, x, y, s.ditherRatio)
        const color = on ? ed.primary : ed.secondary
        if (getA(color) === 0) continue
        ctx.fillStyle = toCss(color)
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }
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
    if (tool.hint) add(el('div', { class: 'opt-hint' }, tool.hint))
    return
  }

  if (opts.has('brush')) {
    add(el('div', { class: 'opt' },
      el('label', null, 'Taille'),
      slider(1, 64, s.brushSize, 1, (v) => { ed.updateSettings({ brushSize: v }); refresh() }, (v) => `${v}px`),
    ))
    add(segmented(SHAPES.map((sh) => ({ value: sh.value, icon: sh.icon, title: sh.title })), s.brushShape,
      (v) => { ed.updateSettings({ brushShape: v }); refresh() }))
    // L'empreinte reelle, dessinee : c'est la seule facon de voir ce que la
    // forme change, et pourquoi elle ne change rien en dessous de 3 pixels.
    add(brushPreview(s.brushSize, s.brushShape))
    if (s.brushSize < 3) {
      add(el('div', { class: 'opt-note' }, 'La forme agit a partir de 3 px'))
    }
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
      add(ditherPreview(ed))
      // Le tramage melange deux couleurs. Avec une secondaire transparente il
      // ne fait que trouer le trait, ce qui se lit comme un bug.
      if (getA(ed.secondary) === 0) {
        add(el('div', { class: 'opt-note warn' }, 'Secondaire transparente : le tramage troue le trait'))
      }
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

  if (tool.hint) add(el('div', { class: 'opt-hint' }, tool.hint))
}
