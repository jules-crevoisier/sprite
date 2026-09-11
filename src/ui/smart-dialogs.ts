import { Bitmap } from '../core/bitmap'
import { toCss, toHex, type RGBA } from '../core/color'
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
import {
  DEFAULT_RECIPE, DEFAULT_SHADE, antiAlias, autoShade, buildRamp,
} from '../smart/shading'
import {
  champAuto, hauteurSuggeree, tourner, masse, trousInterieurs, couleursEtrangeres, profilDe,
} from '../smart/depth'
import { comblerLesFentes, proprietaireUnique } from '../smart/combler'
import { el, checkbox, numberInput, select, slider } from './dom'
import { zoomablePreview } from './preview-zoom'
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

/**
 * Bande de couleurs d'une rampe. Au-dela de `max` teintes, le reste est
 * resume par un compteur : une vignette de 90 px ne peut pas afficher vingt
 * pastilles sans deborder sur sa voisine.
 */
function swatchRow(colors: RGBA[], max = 8): HTMLElement {
  const row = el('div', { class: 'swatch-row' })
  for (const c of colors.slice(0, max)) {
    row.appendChild(el('i', { title: toCss(c), style: { background: toCss(c) } }))
  }
  if (colors.length > max) {
    row.appendChild(el('span', { class: 'more', title: `${colors.length} teintes en tout` },
      `+${colors.length - max}`))
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
        swatchRow(ramp.colors, 12),
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
        swatchRow(variant.preview, 6),
        el('b', null, variant.label),
      )
      card.style.borderColor = 'var(--accent)'
      grid.appendChild(card)
    })
    updateSummary()
  }

  const updateSummary = () => {
    summary.textContent = chosen.size
      ? `${chosen.size} variante(s) sélectionnée(s) sur ${variants.length}. Cliquer une vignette pour l'inclure ou l'exclure.`
      : 'Aucune variante sélectionnée.'
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
    el('label', null, 'Résultat'),
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
      'les rapports d\'ombre et de lumière sont conserves.'),
    el('div', { class: 'form-section' }, 'Famille de couleurs'),
    rampList,
    el('div', { class: 'form-section' }, 'Réglages'),
    controls,
    el('div', { class: 'form-section' }, 'Aperçu'),
    grid,
    summary,
  )

  openModal({
    title: 'Variantes de couleur',
    icon: 'variants',
    wide: true,
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Appliquer',
        primary: true,
        onClick: () => {
          const picked = variants.filter((_, i) => chosen.has(i))
          if (!picked.length) { showToast('Sélectionnez au moins une variante', 'error'); return false }
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
  const cel = ed.beginStroke('Détail')
  if (!cel) return

  let presetId: string | null = 'herbe'
  let mode: DetailMode = 'speckle'
  let intensity = 1
  let density = 0.2
  let seed = Math.floor(Math.random() * 1e9)
  let onlySelection = ed.selection.active
  let passes = 0

  const apercu = zoomablePreview({ hauteur: 200 })
  const preview = apercu.node
  const info = el('p', { class: 'form-note' })
  /** Les teintes que la derniere passe a fabriquees, pour la palette. */
  let dernieresTeintes: number[] = []
  const rangee = el('div', { class: 'form-row' })
  const majPalette = () => {
    rangee.replaceChildren()
    if (!dernieresTeintes.length) return
    for (const c of dernieresTeintes.slice(0, 12)) {
      rangee.appendChild(el('span', {
        class: 'pastille-teinte',
        title: toHex(c),
        style: { background: toHex(c) },
      }))
    }
    rangee.appendChild(el('button', {
      class: 'btn sm',
      onclick: () => {
        const combien = dernieresTeintes.length
        ed.run('Teintes du détail', () => {
          for (const c of dernieresTeintes) ed.sprite.palette.add(c)
        })
        showToast(`${combien} teinte(s) ajoutée(s) à la palette`, 'success')
      },
    }, 'Ajouter à la palette'))
  }

  const apply = () => {
    ed.resetStroke()
    const target = ed.peekCel()
    if (!target) return
    /*
     * Les GROUPES de la palette font foi quand il y en a : c'est vous qui
     * avez dit quel vert va avec quel vert. Sans groupe, on devine comme
     * avant — voir `fromBitmapsAndGroups`.
     */
    const index = RampIndex.fromBitmapsAndGroups([target.bitmap], ed.sprite.palette.groupes)
    const within = onlySelection && ed.selection.active ? ed.selection.mask : null
    /*
     * Les teintes FABRIQUEES sont recensees : un dessin a plat n'a pas de
     * rampe ou puiser, et l'outil en invente a partir de la couleur elle-meme.
     * Le dire evite la surprise — « d'ou sortent ces deux verts ? » — et
     * permet de les ranger dans la palette d'un clic.
     */
    const nouvelles = new Set<number>()
    const touched = presetId
      ? applyPreset(target.bitmap, index, presetId, seed, intensity, within, nouvelles)
      : addDetail(target.bitmap, index, {
        mode, density, strength: 1, seed, within, nouvelles,
      })
    dernieresTeintes = [...nouvelles]
    ed.events.emit('doc', undefined)
    apercu.show(target.bitmap)
    const creees = dernieresTeintes.length
      ? ` · ${dernieresTeintes.length} teinte(s) créée(s)`
      : ''
    info.textContent = touched
      ? `${touched} pixels modifiés${creees} · ${passes} passe(s) déjà figée(s) · graine ${seed}`
      : 'Aucun pixel touché : baissez la sélection ou augmentez la densité.'
    majPalette()
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
    }, 'Réglage manuel'))
  }

  const manual = el('div')
  const rebuildManual = () => {
    manual.replaceChildren()
    if (presetId !== null) return
    manual.appendChild(el('div', { class: 'form-grid' },
      el('label', null, 'Effet'),
      select(DETAIL_MODES.map((m) => ({ value: m.id, label: `${m.label} — ${m.hint}` })), mode,
        (v) => { mode = v; apply() }),
      el('label', null, 'Densité'),
      slider(0.02, 1, density, 0.02, (v) => { density = v; apply() }, (v) => `${Math.round(v * 100)}%`),
    ))
  }

  rebuildPresets()
  rebuildManual()
  apply()

  const body = el('div', null,
    el('p', { class: 'form-note' },
      'Le détail reprend les couleurs déjà presentes : chaque pixel se décale d\'un cran ',
      'dans sa propre famille de teintes, donc le rendu reste coherent.'),
    el('div', { class: 'form-section' }, 'Matière'),
    presetRow,
    manual,
    el('div', { class: 'form-grid', style: { marginTop: '10px' } },
      el('label', null, 'Intensité'),
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
      checkbox('Limiter a la sélection', onlySelection, (v) => { onlySelection = v; apply() }),
    ),
    el('div', { class: 'form-section' }, 'Aperçu'),
    preview,
    info,
    rangee,
  )

  const handle = openModal({
    title: 'Ajouter du détail',
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
          if (!ed.beginStroke('Détail')) { handle.close(); return }
          seed = Math.floor(Math.random() * 1e9)
          apply()
          showToast(`Passe ${passes} ajoutee`, 'success')
          return false
        },
      },
      {
        label: 'Appliquer',
        primary: true,
        onClick: () => { ed.commitStroke() },
      },
    ],
    onClose: () => { ed.cancelStroke() },
  })
}

/* ------------------------------------------------------------------ */
/* Ombrage et polissage                                                */
/* ------------------------------------------------------------------ */

/**
 * Ombre le dessin selon une direction de lumiere, puis casse les marches
 * d'escalier. Les deux opérations n'emploient que les tons deja presents :
 * la palette du sprite reste la sienne.
 */
export function shadeDialog(ed: Editor): void {
  const cel = ed.beginStroke('Ombrage')
  if (!cel) return

  const options = { ...DEFAULT_SHADE }
  let lissage = 0
  let poses = 0

  const apercu = zoomablePreview({ hauteur: 200 })
  const preview = apercu.node
  const info = el('p', { class: 'form-note' })
  const boussole = el('div', { class: 'light-dial', title: 'Direction de la lumière' },
    el('i'), el('b'))

  const placerBoussole = () => {
    const rad = (options.angle * Math.PI) / 180
    const point = boussole.querySelector('b') as HTMLElement
    point.style.left = `${50 + Math.cos(rad) * 34}%`
    point.style.top = `${50 - Math.sin(rad) * 34}%`
  }

  const apply = () => {
    ed.resetStroke()
    const target = ed.peekCel()
    if (!target) return
    // Les groupes declares priment ici aussi : l'ombrage puise dans la
    // famille que vous avez nommee, pas dans celle qu'il devine.
    const ramps = RampIndex.fromBitmapsAndGroups(
      [target.bitmap], ed.sprite.palette.groupes).ramps
    const bilan = autoShade(target.bitmap, ramps, options)
    const lisses = lissage > 0 ? antiAlias(target.bitmap, ramps, lissage) : 0
    ed.events.emit('doc', undefined)
    apercu.show(target.bitmap)
    info.textContent = bilan.changed || lisses
      ? `${bilan.changed} pixels ombres sur ${bilan.ramps} matière(s)`
        + (lisses ? `, ${lisses} coins adoucis` : '')
        + (poses ? ` · ${poses} passe(s) déjà figee(s)` : '')
      : 'Aucun pixel touche : le dessin n\'a pas assez de tons par matière. '
        + 'Ajoutez-en avec « Rampe de couleurs ».'
  }

  const dial = (e: PointerEvent) => {
    const r = boussole.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = (r.top + r.height / 2) - e.clientY
    options.angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 15) * 15
    placerBoussole()
    apply()
  }
  boussole.addEventListener('pointerdown', (e) => {
    boussole.setPointerCapture(e.pointerId)
    dial(e)
    const move = (ev: PointerEvent) => dial(ev)
    const up = () => {
      boussole.removeEventListener('pointermove', move)
      boussole.removeEventListener('pointerup', up)
    }
    boussole.addEventListener('pointermove', move)
    boussole.addEventListener('pointerup', up)
  })
  placerBoussole()

  const controls = el('div', { class: 'form-grid' },
    el('label', null, 'Lumière'),
    el('div', { class: 'form-row' }, boussole,
      el('span', { class: 'form-note', style: { flex: '1' } },
        'Tirez dans le cadran : les surfaces tournees vers la lumière montent '
        + 'dans leur rampe, les autres descendent.')),
    el('label', null, 'Force'),
    slider(0, 1, options.strength, 0.05, (v) => { options.strength = v; apply() },
      (v) => `${Math.round(v * 100)}%`),
    el('label', null, 'Portée'),
    slider(1, 8, options.radius, 1, (v) => { options.radius = v; apply() }, (v) => `${v} px`),
    el('label', null, 'Contre-jour'),
    checkbox('Liseré clair sur le bord opposé', options.rimLight, (v) => {
      options.rimLight = v
      apply()
    }),
    el('label', null, 'Adoucir'),
    slider(0, 1, lissage, 0.25, (v) => { lissage = v; apply() },
      (v) => (v === 0 ? 'non' : `${Math.round(v * 100)}%`)),
  )

  apply()
  openModal({
    title: 'Ombrage automatique',
    icon: 'shading',
    body: el('div', null,
      el('p', { class: 'form-note' },
        'La silhouette indique l\'orientation de chaque surface : un pixel près '
        + 'du bord gauche appartient a une paroi tournee vers la gauche. Chaque '
        + 'pixel prend alors un autre ton de sa propre famille de couleurs — '
        + 'aucune teinte etrangere n\'est introduite.'),
      controls,
      el('div', { class: 'form-section' }, 'Aperçu'),
      preview,
      info,
    ),
    actions: [
      {
        label: 'Figer cette passe',
        onClick: () => {
          ed.commitStroke()
          ed.beginStroke('Ombrage')
          poses++
          apply()
          return false
        },
      },
      { label: 'Annuler', onClick: () => { ed.cancelStroke(); return true } },
      { label: 'Appliquer', primary: true, onClick: () => { ed.commitStroke(); return true } },
    ],
    onClose: () => { ed.cancelStroke() },
  })
}

/**
 * Fabrique une rampe autour de la couleur courante et l'ajoute a la palette.
 * Trouver les tons d'une matiere est la premiere friction du pixel art : une
 * ombre qui n'est qu'un gris plus sombre se voit tout de suite.
 */
export function rampDialog(ed: Editor): void {
  const recipe = { ...DEFAULT_RECIPE }
  let colors = buildRamp(ed.primary, recipe)

  const bande = el('div', { style: { display: 'grid', gap: '6px' } })
  const info = el('p', { class: 'form-note' })

  const refresh = () => {
    colors = buildRamp(ed.primary, recipe)
    bande.replaceChildren(
      el('div', { class: 'ramp-strip' }, ...colors.map((c) => el('i', {
        style: { background: toCss(c) },
        title: toHex(c),
      }))),
      el('div', { class: 'form-row' }, ...colors.map((c) => el('span', {
        class: 'form-note', style: { flex: '1', textAlign: 'center', fontSize: '10px' },
      }, toHex(c)))),
    )
    info.textContent = `${colors.length} tons autour de ${toHex(ed.primary)} — `
      + `l\'ombre glisse de ${recipe.hueShift}° vers le froid, la lumière autant vers le chaud.`
  }

  refresh()
  openModal({
    title: 'Rampe de couleurs',
    icon: 'palette',
    body: el('div', null,
      el('p', { class: 'form-note' },
        'Assombrir en ne baissant que la luminosite donne du gris. Une ombre '
        + 'réelle glisse vers le bleu et une lumière vers le jaune : c\'est ce '
        + 'décalage de teinte qui distingue une rampe juste d\'une rampe fade.'),
      bande,
      info,
      el('div', { class: 'form-grid' },
        el('label', null, 'Tons'),
        slider(3, 9, recipe.steps, 1, (v) => { recipe.steps = v; refresh() }, (v) => `${v}`),
        el('label', null, 'Teinte'),
        slider(0, 60, recipe.hueShift, 2, (v) => { recipe.hueShift = v; refresh() }, (v) => `${v}°`),
        el('label', null, 'Contraste'),
        slider(0.05, 0.3, recipe.contrast, 0.01, (v) => { recipe.contrast = v; refresh() },
          (v) => `${Math.round(v * 100)}%`),
        el('label', null, 'Ombres'),
        slider(0, 0.5, recipe.shadowSaturation, 0.02,
          (v) => { recipe.shadowSaturation = v; refresh() },
          (v) => `saturation +${Math.round(v * 100)}%`),
      ),
    ),
    actions: [
      { label: 'Annuler', onClick: () => true },
      {
        label: 'Ajouter à la palette',
        primary: true,
        onClick: () => {
          ed.run('Rampe de couleurs', () => {
            for (const c of colors) ed.sprite.palette.add(c)
          })
          showToast(`${colors.length} tons ajoutes a la palette`, 'success')
          return true
        },
      },
    ],
  })
}


/* ------------------------------------------------------------------ */
/* Rotation par relief                                                 */
/* ------------------------------------------------------------------ */

/**
 * Tourne le dessin dans les trois axes en lui pretant une epaisseur.
 *
 * Le squelette sait deja faire pivoter des membres dans le plan. Ce qu'il ne
 * sait pas faire, c'est montrer un trois-quarts : pour cela il faut savoir ce
 * qu'il y a derriere, et un dessin plat ne le dit pas. On le devine a partir
 * de la silhouette — epais au milieu, mince au bord — et on fait tourner le
 * volume obtenu.
 *
 * Ce que le resultat n'est pas : un vrai dos. Le dessin ne contient pas
 * l'information, aucun calcul ne l'inventera. C'est une base juste en
 * volume et en occultation, a retoucher au crayon comme n'importe quelle
 * pose generee.
 */
export function rotationDialog(ed: Editor): void {
  const cel = ed.beginStroke('Rotation 3D')
  if (!cel) return

  const source = cel.bitmap.clone()
  const angles = { lacet: 0, tangage: 0, roulis: 0 }
  const relief = { hauteur: hauteurSuggeree(source), galbe: 0.5 }
  // 0 = « au relief de decider ». Le curseur ne sert qu'a contredire ce choix.
  let profilChoisi = 0
  const masseSource = masse(source)
  const trousSource = trousInterieurs(source)

  const apercu = zoomablePreview({ hauteur: 220 })
  const info = el('p', { class: 'form-note' })

  const apply = () => {
    ed.resetStroke()
    const cible = ed.peekCel()
    if (!cible) return
    const champ = champAuto(source, relief)
    const profil = profilChoisi || profilDe(source, champ)
    const tourne = tourner(source, champ, angles, profilChoisi ? { profil } : {})
    cible.bitmap.copyFrom(tourne)
    ed.events.emit('doc', undefined)
    apercu.show(cible.bitmap)

    // Ce qu'on annonce, et ce qu'on obtient. Comprimer un dessin lui retire
    // de la largeur : perdre de la matiere est normal, en perdre bien plus
    // que la compression ne le prevoit ne l'est pas.
    const m = masse(tourne)
    const prevu = profil + (1 - profil) * Math.abs(Math.cos(angles.lacet))
    const reel = masseSource ? m / masseSource : 1
    const perces = trousInterieurs(tourne) - trousSource
    const etrangeres = couleursEtrangeres(source, tourne).length
    const alertes: string[] = []
    if (reel < prevu - 0.15) alertes.push(`${Math.round((prevu - reel) * 100)}% de matière perdue en trop`)
    if (perces > 0) alertes.push(`${perces} trou(s) ouvert(s)`)
    if (etrangeres > 0) alertes.push(`${etrangeres} couleur(s) etrangere(s)`)
    info.textContent = alertes.length
      ? `Attention : ${alertes.join(', ')}. Baissez l'angle, ou montez le relief.`
      : `${m} pixels, ${Math.round(prevu * 100)}% de la largeur de face, palette intacte.`
    info.style.color = alertes.length ? 'var(--warn, #e0a33e)' : 'var(--text-faint)'
  }

  const deg = (v: number) => `${Math.round((v * 180) / Math.PI)}°`
  const QUART = Math.PI / 2

  const controls = el('div', { class: 'form-grid' },
    el('label', { title: 'Le personnage se tourne sur lui-même' }, 'Lacet'),
    slider(-QUART, QUART, 0, 0.02, (v) => { angles.lacet = v; apply() }, deg),
    el('label', { title: 'Le personnage se penche en avant ou en arrière' }, 'Tangage'),
    slider(-QUART, QUART, 0, 0.02, (v) => { angles.tangage = v; apply() }, deg),
    el('label', { title: 'Rotation dans le plan du dessin' }, 'Roulis'),
    slider(-Math.PI, Math.PI, 0, 0.02, (v) => { angles.roulis = v; apply() }, deg),
    el('label', null, 'Relief'),
    slider(0, 24, relief.hauteur, 1, (v) => { relief.hauteur = v; apply() },
      (v) => (v === 0 ? 'plat' : `${v} px`)),
    el('label', { title: 'Cone, dome, ou plateau a bords tombants' }, 'Galbe'),
    slider(0.15, 1.2, relief.galbe, 0.05, (v) => { relief.galbe = v; apply() },
      (v) => (v < 0.35 ? 'plateau' : v < 0.75 ? 'dome' : 'cone')),
    el('label', { title: 'Largeur du personnage vu exactement de profil' }, 'Profil'),
    slider(0, 0.85, 0, 0.05, (v) => { profilChoisi = v; apply() },
      (v) => (v ? `${Math.round(v * 100)}% de la face` : 'depuis le relief')),
  )

  const body = el('div', null,
    el('p', { class: 'form-note', style: { margin: '0 0 8px', lineHeight: '1.6' } },
      'Le personnage reste dessiné de face et s\'amincit à mesure qu\'il se tourne, '
      + 'pendant que son relief fait glisser ses volumes sur le côté. '
      + 'Aucune couleur n\'est mélangée — les pixels sont déplacés, jamais interpolés.'),
    apercu.node,
    controls,
    info,
    el('p', { class: 'form-note' },
      'Un dessin de face ne contient pas son profil : ce qu\'on obtient est une '
      + 'base juste de proportions, à reprendre au crayon pour ce que le trois '
      + 'quarts révélerait. Le curseur Profil dit sa largeur au quart de tour.'),
  )

  apply()

  openModal({
    title: 'Tourner en 3D',
    icon: 'rig',
    body,
    actions: [
      { label: 'Annuler', onClick: () => { ed.cancelStroke() } },
      {
        label: 'Poser sur une nouvelle frame',
        onClick: () => {
          const tourne = ed.peekCel()?.bitmap.clone()
          ed.cancelStroke()
          if (!tourne) return
          const at = ed.activeFrame + 1
          ed.run('Pose tournee', () => { ed.sprite.duplicateFrame(ed.activeFrame, at) })
          ed.setActiveFrame(at)
          const cible = ed.peekCel()
          if (cible) {
            ed.run('Pose tournee', () => { cible.bitmap.copyFrom(tourne) })
          }
          showToast('Pose posee sur une nouvelle frame', 'success')
        },
      },
      { label: 'Appliquer', primary: true, onClick: () => { ed.commitStroke() } },
    ],
    onClose: () => { ed.cancelStroke() },
  })
}


/**
 * « Refermer les fentes » : rendre a un dessin fendu ce que la fente a
 * emporte.
 *
 * Le cas d'usage vient d'une pose : deux morceaux qui ne tournent pas du meme
 * angle s'ecartent et laissent un trait de vide en plein milieu du torse.
 * Mais la meme fente arrive apres un decalage a la main, un collage, un
 * agrandissement rate.
 *
 * L'algorithme ne sait pas, seul, distinguer une dechirure d'une encoche
 * voulue — l'espace entre deux oreilles a exactement la meme forme. Deux
 * garde-fous, donc : la largeur maximale, reglee bas par defaut, et la
 * selection, qui limite la reparation a la zone que l'on designe. Et le
 * compte des pixels poses est affiche avant de valider.
 */
export function comblerDialog(ed: Editor): void {
  const cel = ed.beginStroke('Refermer les fentes')
  if (!cel) return

  const source = cel.bitmap.clone()
  const zone = ed.selection.active ? ed.selection : null
  // Protection des creux decochee par defaut : sans squelette, aucun morceau
  // ne se distingue d'un autre, donc la protection reviendrait a ne rien
  // combler du tout et le dialogue s'ouvrirait sur « aucune fente trouvee ».
  // L'apercu et le compte sont la pour juger avant de valider.
  const opts = { largeurMax: 2, respecterSelection: !!zone, protegerLesCreux: false }
  const apercu = zoomablePreview({ hauteur: 200 })
  const info = el('p', { class: 'form-note' })
  const conseil = el('p', { class: 'form-note' })

  const apply = (): void => {
    ed.resetStroke()
    const cible = ed.peekCel()
    if (!cible) return
    const { image, bilan } = comblerLesFentes(source, {
      largeurMax: opts.largeurMax,
      // Sans squelette, aucun morceau ne se distingue d'un autre : le seul
      // moyen honnete de proteger les creux du dessin est de considerer tout
      // le dessin comme un seul morceau. Rien ne se comble alors, sauf ce
      // que la selection designe.
      proprietaire: opts.protegerLesCreux ? proprietaireUnique(source) : undefined,
      autorise: opts.respecterSelection && zone
        ? (x, y) => zone.contains(x, y)
        : undefined,
    })
    cible.bitmap.copyFrom(image)
    ed.events.emit('doc', undefined)
    apercu.show(cible.bitmap)

    info.textContent = bilan.combles
      ? `${bilan.combles} pixel(s) posé(s)`
        + (bilan.epargnes ? `, ${bilan.epargnes} creux laissé(s) intact(s).` : '.')
      : 'Aucune fente trouvée à cette largeur.'
        + (bilan.epargnes ? ` ${bilan.epargnes} creux protégé(s).` : '')
    info.style.color = bilan.combles ? 'var(--text-faint)' : 'var(--warn, #e0a33e)'

    // La consigne dit ce qui se passe VRAIMENT avec les reglages en cours :
    // une phrase figee finirait par decrire un autre comportement que celui
    // qu'on a sous les yeux.
    conseil.textContent = opts.protegerLesCreux
      ? 'Seuls les vides bordés par deux zones distinctes sont refermés — '
        + 'les creux d\'un dessin d\'un seul tenant sont laissés tels quels.'
      : opts.respecterSelection && zone
        ? 'La réparation s\'arrête au bord de la sélection : c\'est le moyen le '
          + 'plus sûr de ne refermer que la déchirure.'
        : `Tout vide encadré d'au plus ${opts.largeurMax} px est refermé, y compris `
          + 'un creux voulu. Faites une sélection, ou cochez ci-dessus, pour en protéger un.'
  }

  const body = el('div', null,
    el('p', { class: 'form-note', style: { margin: '0 0 8px', lineHeight: '1.6' } },
      'Chaque pixel ajouté reprend une couleur déjà présente au bord de la fente : '
      + 'la palette du dessin ne bouge pas, et rien n\'est mélangé.'),
    apercu.node,
    el('div', { class: 'form-grid' },
      el('label', { title: 'Un vide plus large que cela est considéré comme voulu' },
        'Largeur maxi'),
      slider(1, 8, opts.largeurMax, 1, (v) => { opts.largeurMax = v; apply() },
        (v) => `${v} px`),
      el('label', null, 'Creux du dessin'),
      checkbox('Ne pas les refermer', opts.protegerLesCreux,
        (v) => { opts.protegerLesCreux = v; apply() }),
      ...(zone ? [
        el('label', null, 'Sélection'),
        checkbox('Ne réparer que la sélection', opts.respecterSelection,
          (v) => { opts.respecterSelection = v; apply() }),
      ] : []),
    ),
    info,
    conseil,
  )

  apply()

  openModal({
    title: 'Refermer les fentes',
    icon: 'detail',
    body,
    actions: [
      { label: 'Annuler', onClick: () => { ed.cancelStroke() } },
      { label: 'Appliquer', primary: true, onClick: () => { ed.commitStroke() } },
    ],
    onClose: () => { ed.cancelStroke() },
  })
}
