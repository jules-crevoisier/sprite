import { Bitmap } from '../core/bitmap'
import { toCss, type RGBA } from '../core/color'
import type { Editor } from '../core/editor'
import { Layer, genId, type Cel } from '../core/document'
import { compositeFrame } from '../render/composite'
import { RampIndex, extractRamps, type Ramp } from '../smart/analysis'
import {
  DEFAULT_VARIANT_OPTIONS, STRATEGIES, applyMapping, generateVariants,
  type Variant, type VariantOptions,
} from '../smart/variants'
import {
  DETAIL_MODES, DETAIL_PRESETS, addDetail, applyPreset, type DetailMode,
} from '../smart/detail'
import { el, checkbox, numberInput, select, slider } from './dom'
import { icon } from './icons'
import { openModal, showToast } from './overlay'

/* ------------------------------------------------------------------ */
/* Utilitaires d'apercu                                                */
/* ------------------------------------------------------------------ */

/** Vignette d'un bitmap, agrandie au plus proche voisin. */
function thumb(bitmap: Bitmap, box = 64): HTMLCanvasElement {
  const scale = Math.max(1, Math.floor(Math.min(box / bitmap.width, box / bitmap.height)))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width * scale
  canvas.height = bitmap.height * scale
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bitmap.toCanvas(), 0, 0, canvas.width, canvas.height)
  return canvas
}

function swatchRow(colors: RGBA[]): HTMLElement {
  const row = el('div', { style: { display: 'flex', gap: '2px' } })
  for (const c of colors) {
    row.appendChild(el('i', {
      style: {
        width: '14px', height: '14px', borderRadius: '3px',
        background: toCss(c), border: '1px solid #0006', display: 'block',
      },
    }))
  }
  return row
}

/* ------------------------------------------------------------------ */
/* Variantes de couleur                                                */
/* ------------------------------------------------------------------ */

type ApplyTarget = 'layer' | 'frames' | 'replace'

/**
 * Detecte les familles de couleurs du sprite et propose des declinaisons
 * qui conservent l'ombrage : on change la teinte du vetement sans repeindre
 * les ombres a la main.
 */
export function variantsDialog(ed: Editor): void {
  const sourceBitmaps = ed.sprite.layers.flatMap((l) => l.cels).filter((c): c is Cel => !!c).map((c) => c.bitmap)
  const ramps = extractRamps(sourceBitmaps)
  if (!ramps.length) {
    showToast('Le sprite est vide : rien a decliner', 'error')
    return
  }

  const options: VariantOptions = { ...DEFAULT_VARIANT_OPTIONS }
  let selectedRamp: Ramp = ramps[0]
  let variants: Variant[] = []
  const chosen = new Set<number>()
  let target: ApplyTarget = 'frames'

  const rampList = el('div', { style: { display: 'grid', gap: '4px' } })
  const grid = el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: '8px' },
  })
  const summary = el('p', { class: 'form-note' })

  const base = compositeFrame(ed.sprite, ed.activeFrame)

  const renderRamps = () => {
    rampList.replaceChildren()
    for (const ramp of ramps) {
      const active = ramp.id === selectedRamp.id
      const row = el('button', {
        class: `layer-row ${active ? 'active' : ''}`,
        style: { width: '100%', textAlign: 'left', border: active ? '1px solid var(--accent)' : '1px solid transparent' },
        onclick: () => { selectedRamp = ramp; renderRamps(); refresh() },
      },
        swatchRow(ramp.colors.slice(0, 10)),
        el('span', { class: 'lname', style: { marginLeft: '8px' } },
          `${ramp.label} · ${ramp.colors.length} teintes · ${ramp.pixels} px`),
      )
      rampList.appendChild(row)
    }
  }

  const refresh = () => {
    variants = generateVariants(selectedRamp, options, ed.sprite.palette)
    chosen.clear()
    variants.forEach((_, i) => chosen.add(i))
    grid.replaceChildren()
    if (!variants.length) {
      grid.appendChild(el('p', { class: 'form-note' },
        'Aucune variante : la palette ne contient pas d\'autre rampe exploitable.'))
      summary.textContent = ''
      return
    }
    variants.forEach((variant, i) => {
      const preview = base.clone()
      applyMapping(preview, variant.mapping)
      const card = el('button', {
        class: 'preset',
        style: { display: 'grid', gap: '5px', justifyItems: 'center', padding: '7px 5px' },
        onclick: () => {
          if (chosen.has(i)) chosen.delete(i)
          else chosen.add(i)
          card.classList.toggle('active', chosen.has(i))
          card.style.borderColor = chosen.has(i) ? 'var(--accent)' : 'var(--line)'
          updateSummary()
        },
      },
        thumb(preview, 64),
        swatchRow(variant.preview.slice(0, 6)),
        el('b', null, variant.label),
      )
      card.style.borderColor = 'var(--accent)'
      grid.appendChild(card)
    })
    updateSummary()
  }

  const updateSummary = () => {
    summary.textContent = chosen.size
      ? `${chosen.size} variante(s) selectionnee(s) sur ${variants.length}. Cliquer une vignette pour l'inclure ou l'exclure.`
      : 'Aucune variante selectionnee.'
  }

  const controls = el('div', { class: 'form-grid' },
    el('label', null, 'Methode'),
    select(STRATEGIES.map((s) => ({ value: s.id, label: `${s.label} — ${s.hint}` })), options.strategy,
      (v) => { options.strategy = v; refresh() }),
    el('label', null, 'Nombre'),
    slider(2, 10, options.count, 1, (v) => { options.count = v; refresh() }),
    el('label', null, 'Saturation'),
    slider(-0.5, 0.5, options.saturation, 0.05, (v) => { options.saturation = v; refresh() },
      (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`),
    el('label', null, 'Luminosite'),
    slider(-0.5, 0.5, options.value, 0.05, (v) => { options.value = v; refresh() },
      (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`),
    el('label', null, 'Resultat'),
    select([
      { value: 'frames', label: 'Nouvelles frames (+ tag « variantes »)' },
      { value: 'layer', label: 'Nouveaux calques' },
      { value: 'replace', label: 'Remplacer le sprite (1re variante)' },
    ], target, (v) => { target = v as ApplyTarget }),
  )

  renderRamps()
  refresh()

  const body = el('div', null,
    el('p', { class: 'form-note' },
      'Les couleurs du sprite sont regroupees en familles. Choisissez celle a decliner : ',
      'les rapports d\'ombre et de lumiere sont conserves.'),
    el('div', { class: 'form-section' }, 'Famille de couleurs'),
    rampList,
    el('div', { class: 'form-section' }, 'Reglages'),
    controls,
    el('div', { class: 'form-section' }, 'Apercu'),
    grid,
    summary,
  )

  openModal({
    title: 'Variantes de couleur',
    icon: 'variants',
    wide: true,
    body,
    actions: [
      { label: 'Fermer' },
      {
        label: 'Appliquer',
        primary: true,
        onClick: () => {
          const picked = variants.filter((_, i) => chosen.has(i))
          if (!picked.length) { showToast('Selectionnez au moins une variante', 'error'); return false }
          applyVariants(ed, picked, target)
          return true
        },
      },
    ],
  })
}

/** Materialise les variantes retenues dans le document. */
function applyVariants(ed: Editor, variants: Variant[], target: ApplyTarget): void {
  const sprite = ed.sprite

  if (target === 'replace') {
    const mapping = variants[0].mapping
    const cels = sprite.layers.flatMap((l) => l.cels).filter((c): c is Cel => !!c)
    ed.runPixels('Variante de couleur', cels, () => {
      for (const cel of cels) applyMapping(cel.bitmap, mapping)
    })
    showToast('Variante appliquee', 'success')
    return
  }

  if (target === 'layer') {
    ed.run('Calques de variantes', () => {
      variants.forEach((variant, i) => {
        const layer = new Layer(`Variante ${i + 1}`, sprite.frameCount)
        layer.visible = i === 0
        for (let f = 0; f < sprite.frameCount; f++) {
          const src = sprite.layers[ed.activeLayer].cels[f]
          if (!src) continue
          const bitmap = src.bitmap.clone()
          applyMapping(bitmap, variant.mapping)
          layer.cels[f] = { bitmap, opacity: src.opacity }
        }
        sprite.layers.push(layer)
      })
    })
    showToast(`${variants.length} calques ajoutes`, 'success')
    return
  }

  // Nouvelles frames : la variante devient une pose supplementaire de
  // l'animation, directement exportable en planche.
  ed.run('Frames de variantes', () => {
    const from = sprite.frameCount
    const sourceFrame = ed.activeFrame
    for (const variant of variants) {
      const at = sprite.frameCount
      sprite.duplicateFrame(sourceFrame, at)
      for (const layer of sprite.layers) {
        const cel = layer.cels[at]
        if (cel) applyMapping(cel.bitmap, variant.mapping)
      }
    }
    sprite.tags.push({
      id: genId(),
      name: 'variantes',
      from,
      to: sprite.frameCount - 1,
      direction: 'forward',
      repeat: 0,
      color: 0xff54d6a0,
    })
  })
  showToast(`${variants.length} frames ajoutees et taguees`, 'success')
}

/* ------------------------------------------------------------------ */
/* Generateur de detail                                                */
/* ------------------------------------------------------------------ */

/**
 * Ajoute de la texture sur la case active en restant dans ses couleurs.
 * Chaque « Ajouter » fige la passe courante : les details se cumulent, et
 * « Varier » relance le tirage sans rien perdre de ce qui est deja fige.
 */
export function detailDialog(ed: Editor): void {
  const cel = ed.beginStroke('Detail')
  if (!cel) return

  let presetId: string | null = 'herbe'
  let mode: DetailMode = 'speckle'
  let intensity = 1
  let density = 0.2
  let seed = Math.floor(Math.random() * 1e9)
  let onlySelection = ed.selection.active
  let passes = 0

  const preview = el('div', { class: 'export-preview', style: { minHeight: '150px' } })
  const info = el('p', { class: 'form-note' })

  const apply = () => {
    ed.resetStroke()
    const target = ed.peekCel()
    if (!target) return
    const index = RampIndex.fromBitmaps([target.bitmap])
    const within = onlySelection && ed.selection.active ? ed.selection.mask : null
    const touched = presetId
      ? applyPreset(target.bitmap, index, presetId, seed, intensity, within)
      : addDetail(target.bitmap, index, { mode, density, strength: 1, seed, within })
    ed.events.emit('doc', undefined)
    preview.replaceChildren(thumb(target.bitmap, 190))
    info.textContent = touched
      ? `${touched} pixels modifies · ${passes} passe(s) deja figee(s) · graine ${seed}`
      : 'Aucun pixel touche : baissez la selection ou augmentez la densite.'
  }

  const presetRow = el('div', { class: 'form-row' })
  const rebuildPresets = () => {
    presetRow.replaceChildren()
    for (const preset of DETAIL_PRESETS) {
      presetRow.appendChild(el('button', {
        class: `btn sm ${presetId === preset.id ? 'active' : ''}`,
        onclick: () => { presetId = preset.id; rebuildPresets(); rebuildManual(); apply() },
      }, preset.label))
    }
    presetRow.appendChild(el('button', {
      class: `btn sm ${presetId === null ? 'active' : ''}`,
      onclick: () => { presetId = null; rebuildPresets(); rebuildManual(); apply() },
    }, 'Reglage manuel'))
  }

  const manual = el('div')
  const rebuildManual = () => {
    manual.replaceChildren()
    if (presetId !== null) return
    manual.appendChild(el('div', { class: 'form-grid' },
      el('label', null, 'Effet'),
      select(DETAIL_MODES.map((m) => ({ value: m.id, label: `${m.label} — ${m.hint}` })), mode,
        (v) => { mode = v; apply() }),
      el('label', null, 'Densite'),
      slider(0.02, 1, density, 0.02, (v) => { density = v; apply() }, (v) => `${Math.round(v * 100)}%`),
    ))
  }

  rebuildPresets()
  rebuildManual()
  apply()

  const body = el('div', null,
    el('p', { class: 'form-note' },
      'Le detail reprend les couleurs deja presentes : chaque pixel se decale d\'un cran ',
      'dans sa propre famille de teintes, donc le rendu reste coherent.'),
    el('div', { class: 'form-section' }, 'Matiere'),
    presetRow,
    manual,
    el('div', { class: 'form-grid', style: { marginTop: '10px' } },
      el('label', null, 'Intensite'),
      slider(0.2, 2, intensity, 0.1, (v) => { intensity = v; apply() }, (v) => `${Math.round(v * 100)}%`),
      el('label', null, 'Graine'),
      el('div', { class: 'form-row' },
        numberInput(seed, (v) => { seed = v; apply() }, { min: 0, max: 999999999, width: '110px' }),
        el('button', {
          class: 'btn sm',
          html: icon('dice', 14),
          onclick: () => { seed = Math.floor(Math.random() * 1e9); apply() },
        }, el('span', null, 'Varier')),
      ),
      el('label', null, ''),
      checkbox('Limiter a la selection', onlySelection, (v) => { onlySelection = v; apply() }),
    ),
    el('div', { class: 'form-section' }, 'Apercu'),
    preview,
    info,
  )

  const handle = openModal({
    title: 'Ajouter du detail',
    icon: 'detail',
    body,
    actions: [
      { label: 'Annuler', onClick: () => { ed.cancelStroke() } },
      {
        label: 'Ajouter',
        // La passe est figee et une nouvelle est preparee par-dessus.
        onClick: () => {
          ed.commitStroke()
          passes++
          if (!ed.beginStroke('Detail')) { handle.close(); return }
          seed = Math.floor(Math.random() * 1e9)
          apply()
          showToast(`Passe ${passes} ajoutee`, 'success')
          return false
        },
      },
      {
        label: 'Appliquer et fermer',
        primary: true,
        onClick: () => { ed.commitStroke() },
      },
    ],
    onClose: () => { ed.cancelStroke() },
  })
}
