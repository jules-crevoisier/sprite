import type { Editor } from '../core/editor'
import { Sprite, type Slice } from '../core/document'
import { Palette, PALETTE_PRESETS } from '../core/palette'
import { fromHex } from '../core/color'
import * as ops from '../core/operations'
import {
  DEFAULT_SHEET_OPTIONS, buildExport, exportPackage, exportSheetPng,
  type ExportRequest, type SheetLayout,
} from '../export'
import { spriteFromImage, layerFromImage } from '../io/import'
import { loadImageBitmap, pickFiles } from '../export/files'
import { el, checkbox, numberInput, select, slider } from './dom'
import { ICONS } from './icons'
import { zoomablePreview } from './preview-zoom'
import { openModal, showToast } from './overlay'

const SIZE_PRESETS: [string, number, number][] = [
  ['Tuile 16', 16, 16],
  ['Tuile 32', 32, 32],
  ['Perso 32', 32, 48],
  ['Perso 64', 64, 64],
  ['Icone 128', 128, 128],
  ['Game Boy', 160, 144],
  ['NES', 256, 240],
  ['Bandeau', 320, 180],
]

/* ------------------------------------------------------------------ */
/* Nouveau sprite                                                      */
/* ------------------------------------------------------------------ */

export function newSpriteDialog(ed: Editor): void {
  const name = el('input', { type: 'text', value: 'nouveau_sprite' })
  const width = numberInput(32, () => {}, { min: 1, max: 4096 })
  const height = numberInput(32, () => {}, { min: 1, max: 4096 })
  const paletteSelect = select(
    Object.keys(PALETTE_PRESETS).map((k) => ({ value: k, label: k })),
    ed.sprite.palette.name in PALETTE_PRESETS ? ed.sprite.palette.name : 'DawnBringer 32',
    () => {},
  )

  const presets = el('div', { class: 'preset-grid' })
  for (const [label, w, h] of SIZE_PRESETS) {
    presets.appendChild(el('button', {
      class: 'preset',
      onclick: () => { width.value = String(w); height.value = String(h) },
    }, label, el('b', null, `${w} × ${h}`)))
  }

  const body = el('div', null,
    el('div', { class: 'form-grid' },
      el('label', null, 'Nom'), name,
      el('label', null, 'Largeur'), el('div', { class: 'form-row' }, width, el('span', { class: 'form-note' }, 'px')),
      el('label', null, 'Hauteur'), el('div', { class: 'form-row' }, height, el('span', { class: 'form-note' }, 'px')),
      el('label', null, 'Palette'), paletteSelect,
    ),
    el('div', { class: 'form-section' }, 'Formats courants'),
    presets,
  )

  openModal({
    title: 'Nouveau sprite',
    icon: 'plus',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Creer',
        primary: true,
        onClick: () => {
          const w = Math.max(1, Math.min(4096, Number(width.value) || 32))
          const h = Math.max(1, Math.min(4096, Number(height.value) || 32))
          const sprite = new Sprite(w, h, Palette.preset(paletteSelect.value))
          sprite.name = name.value.trim() || 'sans-titre'
          sprite.grid = { x: 0, y: 0, w: Math.min(16, w), h: Math.min(16, h) }
          ed.loadSprite(sprite)
          showToast(`Sprite ${w}×${h} cree`, 'success')
        },
      },
    ],
  })
}

/* ------------------------------------------------------------------ */
/* Taille de la toile / du sprite                                      */
/* ------------------------------------------------------------------ */

export function resizeCanvasDialog(ed: Editor): void {
  const width = numberInput(ed.sprite.width, () => {}, { min: 1, max: 4096 })
  const height = numberInput(ed.sprite.height, () => {}, { min: 1, max: 4096 })
  let anchor: ops.Anchor = 'center'

  const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 30px)', gap: '3px' } })
  const anchors: ops.Anchor[] = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right',
  ]
  const buttons: HTMLButtonElement[] = []
  anchors.forEach((a) => {
    const btn = el('button', {
      class: `btn sm ${a === anchor ? 'active' : ''}`,
      style: { width: '30px', height: '30px', padding: '0' },
      title: a,
      onclick: () => {
        anchor = a
        buttons.forEach((b, i) => b.classList.toggle('active', anchors[i] === a))
      },
    }, '·')
    buttons.push(btn)
    grid.appendChild(btn)
  })

  const body = el('div', { class: 'form-grid' },
    el('label', null, 'Largeur'), width,
    el('label', null, 'Hauteur'), height,
    el('label', null, 'Ancrage'), grid,
    el('p', { class: 'form-note full' }, 'La toile est agrandie ou rognee sans redimensionner le dessin.'),
  )

  openModal({
    title: 'Taille de la toile',
    icon: 'crop',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Appliquer',
        primary: true,
        onClick: () => ops.resizeCanvas(ed, Math.max(1, Number(width.value)), Math.max(1, Number(height.value)), anchor),
      },
    ],
  })
}

export function scaleSpriteDialog(ed: Editor): void {
  const startW = ed.sprite.width
  const startH = ed.sprite.height
  const width = numberInput(startW, () => sync('w'), { min: 1, max: 4096 })
  const height = numberInput(startH, () => sync('h'), { min: 1, max: 4096 })
  let keepRatio = true
  let smooth = false

  const sync = (from: 'w' | 'h') => {
    if (!keepRatio) return
    if (from === 'w') height.value = String(Math.max(1, Math.round((Number(width.value) / startW) * startH)))
    else width.value = String(Math.max(1, Math.round((Number(height.value) / startH) * startW)))
  }

  const factors = el('div', { class: 'form-row' })
  for (const f of [0.5, 2, 3, 4, 8]) {
    factors.appendChild(el('button', {
      class: 'btn sm',
      onclick: () => {
        width.value = String(Math.max(1, Math.round(startW * f)))
        height.value = String(Math.max(1, Math.round(startH * f)))
      },
    }, `×${f}`))
  }

  const body = el('div', { class: 'form-grid' },
    el('label', null, 'Largeur'), width,
    el('label', null, 'Hauteur'), height,
    el('label', null, 'Facteurs'), factors,
    el('label', null, ''), checkbox('Conserver les proportions', keepRatio, (v) => { keepRatio = v }),
    el('label', null, ''), checkbox('Interpolation lissee (non pixel art)', smooth, (v) => { smooth = v }),
    el('p', { class: 'form-note full' },
      'Par defaut l\'agrandissement se fait au plus proche voisin : les pixels restent nets.'),
  )

  openModal({
    title: 'Redimensionner le sprite',
    icon: 'crop',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Appliquer',
        primary: true,
        onClick: () => ops.scaleSprite(ed, Math.max(1, Number(width.value)), Math.max(1, Number(height.value)), smooth),
      },
    ],
  })
}

/* ------------------------------------------------------------------ */
/* Grille et pivot                                                     */
/* ------------------------------------------------------------------ */

export function gridDialog(ed: Editor): void {
  const g = ed.sprite.grid
  const w = numberInput(g.w, () => {}, { min: 1, max: 512 })
  const h = numberInput(g.h, () => {}, { min: 1, max: 512 })
  const x = numberInput(g.x, () => {}, { min: 0, max: 512 })
  const y = numberInput(g.y, () => {}, { min: 0, max: 512 })
  const px = numberInput(ed.sprite.pivot.x, () => {}, { min: 0, max: 1, step: 0.05 })
  const py = numberInput(ed.sprite.pivot.y, () => {}, { min: 0, max: 1, step: 0.05 })

  const body = el('div', { class: 'form-grid' },
    el('div', { class: 'form-section full' }, 'Grille'),
    el('label', null, 'Taille'), el('div', { class: 'form-row' }, w, el('span', null, '×'), h),
    el('label', null, 'Decalage'), el('div', { class: 'form-row' }, x, el('span', null, ','), y),
    el('div', { class: 'form-section full' }, 'Pivot du sprite'),
    el('label', null, 'X / Y'), el('div', { class: 'form-row' }, px, py),
    el('p', { class: 'form-note full' },
      'Le pivot est exporte tel quel vers Unity (spritePivot) et sert de reference pour Godot. 0,0 = coin bas-gauche, 0.5,0.5 = centre.'),
  )

  openModal({
    title: 'Grille et pivot',
    icon: 'grid',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Appliquer',
        primary: true,
        onClick: () => ed.run('Grille et pivot', () => {
          ed.sprite.grid = {
            w: Math.max(1, Number(w.value)),
            h: Math.max(1, Number(h.value)),
            x: Number(x.value) || 0,
            y: Number(y.value) || 0,
          }
          ed.sprite.pivot = {
            x: Math.min(1, Math.max(0, Number(px.value))),
            y: Math.min(1, Math.max(0, Number(py.value))),
          }
          ed.view.showGrid = true
        }),
      },
    ],
  })
}

/* ------------------------------------------------------------------ */
/* Contour                                                             */
/* ------------------------------------------------------------------ */

export function outlineDialog(ed: Editor): void {
  let thickness = 1
  let diagonal = true
  let scope: ops.Scope = 'cel'
  let useSecondary = false

  const body = el('div', { class: 'form-grid' },
    el('label', null, 'Epaisseur'), slider(1, 8, thickness, 1, (v) => { thickness = v }, (v) => `${v} px`),
    el('label', null, 'Couleur'), checkbox('Utiliser la couleur secondaire', useSecondary, (v) => { useSecondary = v }),
    el('label', null, 'Angles'), checkbox('Inclure les diagonales', diagonal, (v) => { diagonal = v }),
    el('label', null, 'Portee'), select([
      { value: 'cel', label: 'Case active' },
      { value: 'layer', label: 'Calque entier' },
      { value: 'frame', label: 'Frame entiere' },
      { value: 'sprite', label: 'Tout le sprite' },
    ], scope, (v) => { scope = v as ops.Scope }),
  )

  openModal({
    title: 'Ajouter un contour',
    icon: 'contour',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Appliquer',
        primary: true,
        onClick: () => ops.addOutline(ed, useSecondary ? ed.secondary : ed.primary, thickness, diagonal, scope),
      },
    ],
  })
}

/* ------------------------------------------------------------------ */
/* Import d'image                                                      */
/* ------------------------------------------------------------------ */

export async function importImageDialog(ed: Editor, asLayer: boolean): Promise<void> {
  const files = await pickFiles('image/png,image/jpeg,image/gif,image/webp,image/bmp')
  if (!files.length) return
  const img = await loadImageBitmap(files[0])
  const baseName = files[0].name.replace(/\.[^.]+$/, '')

  if (asLayer) {
    ed.run('Importer comme calque', () => {
      const layer = layerFromImage(ed.sprite, img, baseName)
      ed.sprite.layers.push(layer)
    })
    ed.setActiveLayer(ed.sprite.layers.length - 1)
    showToast('Image importee comme calque', 'success')
    return
  }

  const slice = el('input', { type: 'checkbox' })
  const fw = numberInput(img.naturalWidth, () => {}, { min: 1, max: 4096 })
  const fh = numberInput(img.naturalHeight, () => {}, { min: 1, max: 4096 })
  const padding = numberInput(0, () => {}, { min: 0, max: 64 })
  const margin = numberInput(0, () => {}, { min: 0, max: 64 })
  let skipEmpty = true
  let buildPalette = true

  const body = el('div', null,
    el('p', { class: 'form-note' }, `Image source : ${img.naturalWidth} × ${img.naturalHeight} px`),
    el('div', { class: 'form-grid', style: { marginTop: '12px' } },
      el('label', null, 'Decouper'), el('label', { class: 'check' }, slice, el('span', null, 'La planche contient plusieurs frames')),
      el('label', null, 'Taille des frames'), el('div', { class: 'form-row' }, fw, el('span', null, '×'), fh),
      el('label', null, 'Espacement'), el('div', { class: 'form-row' }, padding, el('span', { class: 'form-note' }, 'entre frames'), margin, el('span', { class: 'form-note' }, 'marge')),
      el('label', null, ''), checkbox('Ignorer les frames vides', skipEmpty, (v) => { skipEmpty = v }),
      el('label', null, ''), checkbox('Construire une palette depuis l\'image', buildPalette, (v) => { buildPalette = v }),
    ),
  )

  openModal({
    title: 'Importer une image',
    icon: 'upload',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Importer',
        primary: true,
        onClick: () => {
          const sprite = spriteFromImage(img, baseName, {
            frameWidth: slice.checked ? Number(fw.value) : 0,
            frameHeight: slice.checked ? Number(fh.value) : 0,
            padding: Number(padding.value) || 0,
            margin: Number(margin.value) || 0,
            skipEmpty,
            buildPalette,
          })
          ed.loadSprite(sprite)
          showToast(`${sprite.frameCount} frame(s) importee(s)`, 'success')
        },
      },
    ],
  })
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

const LAYOUTS: { value: SheetLayout; label: string }[] = [
  { value: 'horizontal', label: 'Une ligne' },
  { value: 'vertical', label: 'Une colonne' },
  { value: 'grid', label: 'Grille' },
  { value: 'by-tag', label: 'Une ligne par tag' },
  { value: 'packed', label: 'Compact (packed)' },
]

/** Fenetre d'export avec apercu en direct de la planche generee. */
export function exportDialog(ed: Editor, request: ExportRequest): void {
  const req: ExportRequest = {
    ...request,
    sheet: { ...DEFAULT_SHEET_OPTIONS, ...request.sheet },
    unity: { ...request.unity },
  }

  // Une planche depasse vite la largeur du dialogue : sans zoom on ne peut
  // pas verifier une case, et c'est justement ce qu'on vient regarder.
  const apercu = zoomablePreview({ hauteur: 220 })
  const preview = apercu.node
  const stats = el('p', { class: 'form-note', style: { marginTop: '8px' } })
  const settings = el('div')

  const refresh = () => {
    const result = buildExport(ed.sprite, req)
    apercu.show(result.bitmap)
    const bytes = result.bitmap.width * result.bitmap.height * 4
    stats.textContent =
      `Planche ${result.bitmap.width} × ${result.bitmap.height} px · ${result.frames.length} frame(s) · ` +
      `${result.tags.length} tag(s) · ~${(bytes / 1024).toFixed(0)} Ko en memoire`
  }

  const targets: { id: ExportRequest['target']; icon: string; label: string; note: string }[] = [
    { id: 'generic', icon: 'sheet', label: 'Generique', note: 'PNG + JSON Aseprite (Phaser, Pixi, LibGDX, Defold…)' },
    { id: 'unity', icon: 'unity', label: 'Unity', note: 'PNG + .meta decoupe + AnimationClip par tag' },
    { id: 'godot', icon: 'godot', label: 'Godot 4', note: 'PNG + SpriteFrames .tres pret pour AnimatedSprite2D' },
  ]

  const cards = el('div', { class: 'target-cards' })
  const rebuildCards = () => {
    cards.replaceChildren(...targets.map((t) =>
      el('button', {
        class: `target-card ${req.target === t.id ? 'active' : ''}`,
        onclick: () => { req.target = t.id; rebuildCards(); rebuildSettings() },
      },
        el('span', { html: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${iconBody(t.icon)}</svg>` }),
        el('span', null, t.label),
        el('small', null, t.note),
      )))
  }

  const rebuildSettings = () => {
    const s = req.sheet as Required<typeof DEFAULT_SHEET_OPTIONS>
    const nodes: Node[] = []

    const grid = el('div', { class: 'form-grid' })
    grid.append(
      el('label', null, 'Disposition'),
      select(LAYOUTS, s.layout, (v) => { s.layout = v; rebuildSettings(); refresh() }),
    )
    if (s.layout === 'grid') {
      grid.append(
        el('label', null, 'Colonnes'),
        numberInput(s.columns, (v) => { s.columns = Math.max(1, v); refresh() }, { min: 1, max: 64 }),
      )
    }
    grid.append(
      el('label', null, 'Echelle'),
      select([1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `×${n}` })), String(req.scale),
        (v) => { req.scale = Number(v); refresh() }),
      el('label', null, 'Espacement'),
      el('div', { class: 'form-row' },
        numberInput(s.padding, (v) => { s.padding = v; refresh() }, { min: 0, max: 32 }),
        el('span', { class: 'form-note' }, 'px entre frames'),
      ),
      el('label', null, 'Marge'),
      el('div', { class: 'form-row' },
        numberInput(s.margin, (v) => { s.margin = v; refresh() }, { min: 0, max: 64 }),
        el('span', { class: 'form-note' }, 'px autour de la planche'),
      ),
      el('label', null, 'Extrusion'),
      el('div', { class: 'form-row' },
        numberInput(s.extrude, (v) => { s.extrude = v; refresh() }, { min: 0, max: 8 }),
        el('span', { class: 'form-note' }, 'px dupliques sur les bords (anti-bleeding)'),
      ),
      el('label', null, 'Options'),
      el('div', { class: 'form-row' },
        checkbox('Rogner les frames', s.trim, (v) => { s.trim = v; refresh() }),
        checkbox('Puissance de 2', s.powerOfTwo, (v) => { s.powerOfTwo = v; refresh() }),
        checkbox('Carree', s.forceSquare, (v) => { s.forceSquare = v; refresh() }),
      ),
      el('label', null, ''),
      checkbox('Un jeu de frames par calque', s.splitLayers, (v) => { s.splitLayers = v; refresh() }),
    )
    nodes.push(grid)

    if (ed.sprite.tags.length) {
      const tagRow = el('div', { class: 'form-row' })
      for (const tag of ed.sprite.tags) {
        tagRow.appendChild(checkbox(tag.name, !s.tagFilter.length || s.tagFilter.includes(tag.name), (v) => {
          const set = new Set(s.tagFilter.length ? s.tagFilter : ed.sprite.tags.map((t) => t.name))
          if (v) set.add(tag.name)
          else set.delete(tag.name)
          s.tagFilter = set.size === ed.sprite.tags.length ? [] : [...set]
          refresh()
        }))
      }
      nodes.push(el('div', { class: 'form-section' }, 'Animations exportees'), tagRow)
    }

    if (req.target === 'unity') {
      nodes.push(el('div', { class: 'form-section' }, 'Unity'),
        el('div', { class: 'form-grid' },
          el('label', null, 'Pixels par unite'),
          numberInput(req.unity.pixelsPerUnit ?? 16, (v) => { req.unity.pixelsPerUnit = Math.max(1, v) }, { min: 1, max: 512 }),
          el('label', null, ''),
          checkbox('Generer un AnimationClip par tag', req.unity.generateAnimations ?? true,
            (v) => { req.unity.generateAnimations = v }),
          el('p', { class: 'form-note full' },
            'Le fichier .meta accompagne le PNG : deposez les deux ensemble dans Assets pour retrouver le decoupage, le pivot et le filtrage Point.'),
        ))
    } else if (req.target === 'godot') {
      const path = el('input', { type: 'text', value: req.godotResPath, placeholder: `res://${ed.sprite.name}.png` })
      path.addEventListener('change', () => { req.godotResPath = path.value.trim() })
      nodes.push(el('div', { class: 'form-section' }, 'Godot 4'),
        el('div', { class: 'form-grid' },
          el('label', null, 'Chemin de la texture'), path,
          el('label', null, ''), checkbox('Ajouter une ressource TileSet', req.godotTileSet, (v) => { req.godotTileSet = v }),
          el('p', { class: 'form-note full' },
            'Le .tres reference la texture par ce chemin. Pensez a passer le filtre d\'import sur Nearest cote Godot.'),
        ))
    } else {
      nodes.push(el('div', { class: 'form-section' }, 'Metadonnees'),
        el('div', { class: 'form-grid' },
          el('label', null, 'Format JSON'),
          select([{ value: 'hash', label: 'Hash (par nom)' }, { value: 'array', label: 'Array (ordonne)' }],
            req.jsonFormat, (v) => { req.jsonFormat = v as 'hash' | 'array' }),
        ))
    }

    settings.replaceChildren(...nodes)
  }

  rebuildCards()
  rebuildSettings()
  refresh()

  const body = el('div', null,
    cards,
    el('div', { class: 'form-section' }, 'Planche'),
    preview,
    stats,
    settings,
  )

  openModal({
    title: 'Exporter pour le moteur de jeu',
    icon: 'download',
    wide: true,
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'PNG seul',
        onClick: () => {
          Object.assign(request, req)
          void exportSheetPng(ed.sprite, req)
          return false
        },
      },
      {
        label: 'Telecharger le pack (.zip)',
        primary: true,
        onClick: () => {
          Object.assign(request, req)
          void exportPackage(ed.sprite, req).then((r) => {
            showToast(`Pack exporte : ${r.files.length} fichiers`, 'success')
          })
        },
      },
    ],
  })
}

/** Contenu SVG d'une icone, inline dans les cartes de cible d'export. */
function iconBody(name: string): string {
  return ICONS[name] ?? ''
}

/* ------------------------------------------------------------------ */
/* Aide                                                                */
/* ------------------------------------------------------------------ */

export function shortcutsDialog(groups: { title: string; items: [string, string][] }[]): void {
  const body = el('div')
  for (const group of groups) {
    body.appendChild(el('div', { class: 'form-section' }, group.title))
    const list = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '5px 16px' } })
    for (const [label, keys] of group.items) {
      list.append(
        el('span', { style: { color: 'var(--text-dim)', fontSize: '12.5px' } }, label),
        el('span', { class: 'keys', style: { justifySelf: 'end' } }, keys),
      )
    }
    body.appendChild(list)
  }
  openModal({ title: 'Raccourcis clavier', icon: 'info', body, wide: true, actions: [{ label: 'Fermer', primary: true }] })
}

export function paletteFromHexDialog(ed: Editor): void {
  const area = el('textarea', {
    rows: 8,
    placeholder: '#1a1c2c\n#5d275d\n#b13e53\n…',
    style: { width: '100%', fontFamily: 'var(--mono)' },
  })
  const body = el('div', null,
    el('p', { class: 'form-note' }, 'Collez une liste de couleurs hexadecimales, une par ligne (format Lospec).'),
    area,
  )
  openModal({
    title: 'Palette depuis une liste',
    icon: 'palette',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Appliquer',
        primary: true,
        onClick: () => {
          const colors = area.value.split(/[\s,]+/).filter((s) => /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)).map(fromHex)
          if (!colors.length) { showToast('Aucune couleur valide', 'error'); return false }
          ed.run('Palette personnalisee', () => { ed.sprite.palette = new Palette('Personnalisee', colors) })
          showToast(`${colors.length} couleurs chargees`, 'success')
          return true
        },
      },
    ],
  })
}

/* ------------------------------------------------------------------ */
/* Zones (slices) : pivot et decoupe 9-slice                           */
/* ------------------------------------------------------------------ */

/**
 * Editeur de zone. Une zone porte un nom, un rectangle, un pivot optionnel
 * et une decoupe 9-slice ; ces informations partent vers Unity (border et
 * spritePivot) et vers le JSON.
 */
export function sliceDialog(ed: Editor, slice: Slice, isNew: boolean): void {
  const name = el('input', { type: 'text', value: slice.name })
  const bx = numberInput(slice.bounds.x, () => {}, { min: 0, max: 4096 })
  const by = numberInput(slice.bounds.y, () => {}, { min: 0, max: 4096 })
  const bw = numberInput(slice.bounds.w, () => {}, { min: 1, max: 4096 })
  const bh = numberInput(slice.bounds.h, () => {}, { min: 1, max: 4096 })

  const hasPivot = el('input', { type: 'checkbox', checked: slice.pivot !== null })
  const pxi = numberInput(slice.pivot?.x ?? Math.floor(slice.bounds.w / 2), () => {}, { min: 0, max: 4096 })
  const pyi = numberInput(slice.pivot?.y ?? Math.floor(slice.bounds.h / 2), () => {}, { min: 0, max: 4096 })

  const hasCenter = el('input', { type: 'checkbox', checked: slice.center !== null })
  const cx = numberInput(slice.center?.x ?? Math.floor(slice.bounds.w / 3), () => {}, { min: 0, max: 4096 })
  const cy = numberInput(slice.center?.y ?? Math.floor(slice.bounds.h / 3), () => {}, { min: 0, max: 4096 })
  const cw = numberInput(slice.center?.w ?? Math.ceil(slice.bounds.w / 3), () => {}, { min: 1, max: 4096 })
  const ch = numberInput(slice.center?.h ?? Math.ceil(slice.bounds.h / 3), () => {}, { min: 1, max: 4096 })

  const body = el('div', { class: 'form-grid' },
    el('label', null, 'Nom'), name,
    el('label', null, 'Position'), el('div', { class: 'form-row' }, bx, by),
    el('label', null, 'Taille'), el('div', { class: 'form-row' }, bw, bh),
    el('div', { class: 'form-section full' }, 'Pivot'),
    el('label', null, 'Definir'), el('label', { class: 'check' }, hasPivot, el('span', null, 'Point de pivot relatif a la zone')),
    el('label', null, 'X / Y'), el('div', { class: 'form-row' }, pxi, pyi),
    el('div', { class: 'form-section full' }, 'Decoupe 9-slice'),
    el('label', null, 'Definir'), el('label', { class: 'check' }, hasCenter, el('span', null, 'Zone centrale etirable')),
    el('label', null, 'Zone centrale'), el('div', { class: 'form-row' }, cx, cy, cw, ch),
    el('p', { class: 'form-note full' },
      'La zone centrale devient la propriete Border du sprite a l\'export Unity : les bords gardent leur taille quand l\'element est etire.'),
  )

  openModal({
    title: isNew ? 'Nouvelle zone' : 'Modifier la zone',
    icon: 'crop',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: isNew ? 'Creer' : 'Enregistrer',
        primary: true,
        onClick: () => {
          const patch: Slice = {
            ...slice,
            name: name.value.trim() || slice.name,
            bounds: {
              x: Number(bx.value) || 0, y: Number(by.value) || 0,
              w: Math.max(1, Number(bw.value)), h: Math.max(1, Number(bh.value)),
            },
            pivot: hasPivot.checked ? { x: Number(pxi.value) || 0, y: Number(pyi.value) || 0 } : null,
            center: hasCenter.checked
              ? {
                  x: Number(cx.value) || 0, y: Number(cy.value) || 0,
                  w: Math.max(1, Number(cw.value)), h: Math.max(1, Number(ch.value)),
                }
              : null,
          }
          ed.run(isNew ? 'Nouvelle zone' : 'Modifier la zone', () => {
            if (isNew) ed.sprite.slices.push(patch)
            else {
              const i = ed.sprite.slices.findIndex((s) => s.id === slice.id)
              if (i >= 0) ed.sprite.slices[i] = patch
            }
            ed.view.showSlices = true
          })
        },
      },
    ],
  })
}

/** Liste des zones du sprite avec acces a l'edition et a la suppression. */
export function slicesDialog(ed: Editor): void {
  const body = el('div')
  const render = () => {
    body.replaceChildren()
    if (!ed.sprite.slices.length) {
      body.appendChild(el('p', { class: 'form-note' },
        'Aucune zone. Selectionnez une region puis utilisez « Nouvelle zone depuis la selection » pour definir un pivot ou une decoupe 9-slice.'))
      return
    }
    for (const slice of ed.sprite.slices) {
      body.appendChild(el('div', { class: 'layer-row', style: { cursor: 'default' } },
        el('span', { class: 'lname' },
          `${slice.name} — ${slice.bounds.w}×${slice.bounds.h} @ ${slice.bounds.x},${slice.bounds.y}` +
          `${slice.pivot ? ' · pivot' : ''}${slice.center ? ' · 9-slice' : ''}`),
        el('button', { class: 'btn sm', onclick: () => sliceDialog(ed, slice, false) }, 'Modifier'),
        el('button', {
          class: 'btn sm danger',
          onclick: () => {
            ed.run('Supprimer la zone', () => {
              ed.sprite.slices = ed.sprite.slices.filter((s) => s.id !== slice.id)
            })
            render()
          },
        }, 'Supprimer'),
      ))
    }
  }
  render()
  openModal({ title: 'Zones et pivots', icon: 'crop', body, actions: [{ label: 'Fermer', primary: true }] })
}
