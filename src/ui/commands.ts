import type { App } from './app'
import * as ops from '../core/operations'
import * as dlg from './dialogs'
import { variantsDialog, detailDialog } from './smart-dialogs'
import { exportFramePng, exportFramesZip, exportGif } from '../export'
import { downloadText, pickFiles, safeName } from '../export/files'
import { serializeSprite, deserializeSprite, PROJECT_EXT, loadAutosave, autosaveDate } from '../io/project'
import { compositeFrame } from '../render/composite'
import { showToast, confirmDialog } from './overlay'
import { invertColors, desaturate } from '../core/operations'
import { genId as newSliceId } from '../core/document'
import { fromHex } from '../core/color'

export interface Command {
  id: string
  label: string
  group: string
  keys?: string
  icon?: string
  run: () => void | Promise<void>
  enabled?: () => boolean
  checked?: () => boolean
}

/** Toutes les actions de l'application, partagees par les menus, les
 *  raccourcis clavier et la palette de commandes. */
export function buildCommands(app: App): Command[] {
  const ed = app.ed
  const list: Command[] = []
  const add = (c: Command) => { list.push(c); return c }

  /* ---------------- Fichier ---------------- */

  add({
    id: 'file.new', label: 'Nouveau sprite…', group: 'Fichier', keys: 'Ctrl+N', icon: 'plus',
    run: () => dlg.newSpriteDialog(ed),
  })

  add({
    id: 'file.open', label: 'Ouvrir un projet…', group: 'Fichier', keys: 'Ctrl+O', icon: 'upload',
    run: async () => {
      const files = await pickFiles(`.${PROJECT_EXT},.json`)
      if (!files.length) return
      try {
        const sprite = await deserializeSprite(await files[0].text())
        ed.loadSprite(sprite)
        showToast(`« ${sprite.name} » ouvert`, 'success')
      } catch (err) {
        showToast(`Ouverture impossible : ${(err as Error).message}`, 'error')
      }
    },
  })

  add({
    id: 'file.save', label: 'Enregistrer le projet', group: 'Fichier', keys: 'Ctrl+S', icon: 'save',
    run: () => {
      downloadText(serializeSprite(ed.sprite), `${safeName(ed.sprite.name)}.${PROJECT_EXT}`, 'application/json')
      showToast('Projet enregistre', 'success')
    },
  })

  add({
    id: 'file.import-image', label: 'Importer une image…', group: 'Fichier', icon: 'upload',
    run: () => dlg.importImageDialog(ed, false),
  })

  add({
    id: 'file.import-layer', label: 'Importer comme calque…', group: 'Fichier', icon: 'layers',
    run: () => dlg.importImageDialog(ed, true),
  })

  add({
    id: 'file.export', label: 'Exporter pour un moteur…', group: 'Fichier', keys: 'Ctrl+E', icon: 'download',
    run: () => dlg.exportDialog(ed, app.exportRequest),
  })

  add({
    id: 'file.export-png', label: 'Exporter la frame en PNG', group: 'Fichier', keys: 'Ctrl+Shift+E', icon: 'download',
    run: () => exportFramePng(ed.sprite, ed.activeFrame),
  })

  add({
    id: 'file.export-gif', label: 'Exporter en GIF anime', group: 'Fichier', icon: 'film',
    enabled: () => ed.frameCount > 1,
    run: () => {
      try {
        exportGif(ed.sprite)
        showToast('GIF exporte', 'success')
      } catch (err) {
        showToast(`Export GIF impossible : ${(err as Error).message}`, 'error')
      }
    },
  })

  add({
    id: 'file.export-frames', label: 'Exporter les frames (.zip)', group: 'Fichier', icon: 'download',
    run: () => exportFramesZip(ed.sprite),
  })

  add({
    id: 'file.restore', label: 'Restaurer la sauvegarde automatique', group: 'Fichier', icon: 'undo',
    run: async () => {
      const at = autosaveDate()
      if (!at) { showToast('Aucune sauvegarde automatique', 'error'); return }
      if (!(await confirmDialog('Restaurer', `Remplacer le travail en cours par la sauvegarde du ${at.toLocaleString('fr-FR')} ?`, 'Restaurer'))) return
      const sprite = await loadAutosave()
      if (!sprite) { showToast('Sauvegarde illisible', 'error'); return }
      ed.loadSprite(sprite)
      showToast('Sauvegarde restauree', 'success')
    },
  })

  add({
    id: 'file.copy-png', label: 'Copier la frame dans le presse-papiers systeme', group: 'Fichier', icon: 'copy',
    run: async () => {
      try {
        const blob = await new Promise<Blob>((resolve, reject) => {
          compositeFrame(ed.sprite, ed.activeFrame).toCanvas()
            .toBlob((b) => (b ? resolve(b) : reject(new Error('encodage'))), 'image/png')
        })
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        showToast('Frame copiee', 'success')
      } catch {
        showToast('Le navigateur a refuse l\'acces au presse-papiers', 'error')
      }
    },
  })

  /* ---------------- Edition ---------------- */

  add({
    id: 'edit.undo', label: 'Annuler', group: 'Edition', keys: 'Ctrl+Z', icon: 'undo',
    enabled: () => ed.history.canUndo,
    run: () => ed.undo(),
  })
  add({
    id: 'edit.redo', label: 'Retablir', group: 'Edition', keys: 'Ctrl+Y', icon: 'redo',
    enabled: () => ed.history.canRedo,
    run: () => ed.redo(),
  })
  add({
    id: 'edit.cut', label: 'Couper', group: 'Edition', keys: 'Ctrl+X',
    run: () => { if (!ops.cutSelection(ed)) showToast('Rien a couper', 'error') },
  })
  add({
    id: 'edit.copy', label: 'Copier', group: 'Edition', keys: 'Ctrl+C', icon: 'copy',
    run: () => { if (ops.copySelection(ed)) showToast('Copie') },
  })
  add({
    id: 'edit.paste', label: 'Coller', group: 'Edition', keys: 'Ctrl+V',
    run: () => ops.pasteClipboard(ed),
  })
  add({
    id: 'edit.delete', label: 'Effacer la selection', group: 'Edition', keys: 'Suppr', icon: 'trash',
    run: () => ops.deleteSelection(ed),
  })
  add({
    id: 'edit.fill', label: 'Remplir avec la couleur principale', group: 'Edition', keys: 'F',
    run: () => ops.fillSelection(ed, ed.primary),
  })
  add({
    id: 'edit.select-all', label: 'Tout selectionner', group: 'Edition', keys: 'Ctrl+A',
    run: () => ops.selectAll(ed),
  })
  add({
    id: 'edit.deselect', label: 'Deselectionner', group: 'Edition', keys: 'Ctrl+D',
    enabled: () => ed.selection.active,
    run: () => ops.deselect(ed),
  })
  add({
    id: 'edit.invert-selection', label: 'Inverser la selection', group: 'Edition', keys: 'Ctrl+I',
    run: () => ops.invertSelection(ed),
  })
  add({
    id: 'edit.select-opaque', label: 'Selectionner le contenu du calque', group: 'Edition',
    run: () => ops.selectOpaque(ed),
  })
  add({
    id: 'edit.grow', label: 'Dilater la selection', group: 'Edition',
    enabled: () => ed.selection.active,
    run: () => ops.growSelection(ed, 1),
  })
  add({
    id: 'edit.shrink', label: 'Contracter la selection', group: 'Edition',
    enabled: () => ed.selection.active,
    run: () => ops.growSelection(ed, -1),
  })

  /* ---------------- Sprite ---------------- */

  add({
    id: 'sprite.canvas-size', label: 'Taille de la toile…', group: 'Sprite', keys: 'Ctrl+Alt+C', icon: 'crop',
    run: () => dlg.resizeCanvasDialog(ed),
  })
  add({
    id: 'sprite.scale', label: 'Redimensionner le sprite…', group: 'Sprite', keys: 'Ctrl+Alt+I', icon: 'crop',
    run: () => dlg.scaleSpriteDialog(ed),
  })
  add({
    id: 'sprite.crop', label: 'Rogner sur la selection', group: 'Sprite', icon: 'crop',
    enabled: () => ed.selection.active,
    run: () => { if (!ops.cropToSelection(ed)) showToast('Aucune selection', 'error') },
  })
  add({
    id: 'sprite.trim', label: 'Rogner les bords vides', group: 'Sprite', icon: 'crop',
    run: () => ops.trimSprite(ed),
  })
  add({
    id: 'sprite.flip-h', label: 'Miroir horizontal', group: 'Sprite', keys: 'Shift+H', icon: 'flip',
    run: () => ops.flip(ed, 'h', ed.selection.active ? 'cel' : 'sprite'),
  })
  add({
    id: 'sprite.flip-v', label: 'Miroir vertical', group: 'Sprite', keys: 'Shift+V', icon: 'flip',
    run: () => ops.flip(ed, 'v', ed.selection.active ? 'cel' : 'sprite'),
  })
  add({
    id: 'sprite.flip-cel-h', label: 'Miroir horizontal (case seule)', group: 'Sprite',
    run: () => ops.flip(ed, 'h', 'cel'),
  })
  add({
    id: 'sprite.rotate-cw', label: 'Rotation 90° horaire', group: 'Sprite', icon: 'rotate',
    run: () => ops.rotateSprite(ed, 1),
  })
  add({
    id: 'sprite.rotate-ccw', label: 'Rotation 90° antihoraire', group: 'Sprite', icon: 'rotate',
    run: () => ops.rotateSprite(ed, 3),
  })
  add({
    id: 'sprite.rotate-180', label: 'Rotation 180°', group: 'Sprite', icon: 'rotate',
    run: () => ops.rotateSprite(ed, 2),
  })
  add({
    id: 'sprite.grid', label: 'Grille et pivot…', group: 'Sprite', icon: 'grid',
    run: () => dlg.gridDialog(ed),
  })
  add({
    id: 'sprite.outline', label: 'Ajouter un contour…', group: 'Sprite', icon: 'contour',
    run: () => dlg.outlineDialog(ed),
  })
  add({
    id: 'sprite.invert-colors', label: 'Inverser les couleurs', group: 'Sprite',
    run: () => ops.applyColorEffect(ed, 'Inverser les couleurs', 'cel', invertColors),
  })
  add({
    id: 'sprite.desaturate', label: 'Desaturer', group: 'Sprite',
    run: () => ops.applyColorEffect(ed, 'Desaturer', 'cel', desaturate),
  })
  add({
    id: 'sprite.snap-palette', label: 'Aligner les couleurs sur la palette', group: 'Sprite', icon: 'palette',
    run: () => ops.snapToPalette(ed, 'sprite'),
  })
  add({
    id: 'rig.open', label: 'Squelette : ouvrir le panneau', group: 'Assiste', keys: 'K', icon: 'rig',
    run: () => {
      app.workspace.setVisible('rig', true)
      app.setTool('rig')
      showToast('Glissez sur la toile pour tracer un os', 'info')
    },
  })
  add({
    id: 'sprite.variants', label: 'Variantes de couleur…', group: 'Assiste', keys: 'Ctrl+Maj+V', icon: 'variants',
    run: () => variantsDialog(ed),
  })
  add({
    id: 'sprite.detail', label: 'Ajouter du detail…', group: 'Assiste', keys: 'Ctrl+Maj+D', icon: 'detail',
    run: () => detailDialog(ed),
  })

  add({
    id: 'sprite.slice-new', label: 'Nouvelle zone depuis la selection…', group: 'Sprite', icon: 'crop',
    run: () => {
      const box = ed.selection.active ? ed.selection.bounds() : ed.sprite.bounds
      dlg.sliceDialog(ed, {
        id: newSliceId(),
        name: `zone_${ed.sprite.slices.length + 1}`,
        bounds: { ...box },
        pivot: null,
        center: null,
        color: fromHex('#54d6a0'),
      }, true)
    },
  })
  add({
    id: 'sprite.slices', label: 'Zones et pivots…', group: 'Sprite', icon: 'crop',
    run: () => dlg.slicesDialog(ed),
  })
  add({
    id: 'sprite.palette-from-list', label: 'Palette depuis une liste hexa…', group: 'Sprite', icon: 'palette',
    run: () => dlg.paletteFromHexDialog(ed),
  })

  /* ---------------- Calque ---------------- */

  add({
    id: 'layer.new', label: 'Nouveau calque', group: 'Calque', keys: 'Shift+N', icon: 'plus',
    run: () => {
      ed.run('Nouveau calque', () => { ed.sprite.addLayer(undefined, ed.activeLayer + 1) })
      ed.setActiveLayer(ed.activeLayer + 1)
    },
  })
  add({
    id: 'layer.duplicate', label: 'Dupliquer le calque', group: 'Calque', keys: 'Ctrl+J', icon: 'duplicate',
    run: () => {
      ed.run('Dupliquer le calque', () => { ed.sprite.duplicateLayer(ed.activeLayer) })
      ed.setActiveLayer(ed.activeLayer + 1)
    },
  })
  add({
    id: 'layer.delete', label: 'Supprimer le calque', group: 'Calque', icon: 'trash',
    enabled: () => ed.sprite.layers.length > 1,
    run: () => {
      const i = ed.activeLayer
      ed.run('Supprimer le calque', () => { ed.sprite.removeLayer(i) })
      ed.setActiveLayer(Math.min(i, ed.sprite.layers.length - 1))
    },
  })
  add({
    id: 'layer.merge-down', label: 'Fusionner vers le bas', group: 'Calque', keys: 'Ctrl+M', icon: 'merge',
    enabled: () => ed.activeLayer > 0,
    run: () => {
      ed.run('Fusionner vers le bas', () => { ed.sprite.mergeDown(ed.activeLayer) })
      ed.setActiveLayer(Math.max(0, ed.activeLayer - 1))
    },
  })
  add({
    id: 'layer.flatten', label: 'Aplatir tous les calques', group: 'Calque', keys: 'Ctrl+Shift+M', icon: 'merge',
    enabled: () => ed.sprite.layers.length > 1,
    run: () => {
      ed.run('Aplatir', () => {
        while (ed.sprite.layers.length > 1) ed.sprite.mergeDown(ed.sprite.layers.length - 1)
        ed.sprite.layers[0].name = 'Aplati'
      })
      ed.setActiveLayer(0)
    },
  })
  add({
    id: 'layer.toggle-visible', label: 'Afficher / masquer le calque', group: 'Calque', icon: 'eye',
    run: () => {
      const layer = ed.layer
      ed.run('Visibilite du calque', () => { layer.visible = !layer.visible })
    },
  })
  add({
    id: 'layer.toggle-lock', label: 'Verrouiller / deverrouiller le calque', group: 'Calque', icon: 'lock',
    run: () => {
      const layer = ed.layer
      ed.run('Verrou du calque', () => { layer.locked = !layer.locked })
    },
  })
  add({
    id: 'layer.up', label: 'Monter le calque', group: 'Calque', keys: 'Page↑',
    enabled: () => ed.activeLayer < ed.sprite.layers.length - 1,
    run: () => {
      const i = ed.activeLayer
      ed.run('Monter le calque', () => {
        const [l] = ed.sprite.layers.splice(i, 1)
        ed.sprite.layers.splice(i + 1, 0, l)
      })
      ed.setActiveLayer(i + 1)
    },
  })
  add({
    id: 'layer.down', label: 'Descendre le calque', group: 'Calque', keys: 'Page↓',
    enabled: () => ed.activeLayer > 0,
    run: () => {
      const i = ed.activeLayer
      ed.run('Descendre le calque', () => {
        const [l] = ed.sprite.layers.splice(i, 1)
        ed.sprite.layers.splice(i - 1, 0, l)
      })
      ed.setActiveLayer(i - 1)
    },
  })

  /* ---------------- Animation ---------------- */

  add({
    id: 'frame.new', label: 'Nouvelle frame (reprend le dessin)', group: 'Animation', keys: 'Alt+N', icon: 'plus',
    run: () => app.timeline.addFrame(),
  })
  add({
    id: 'frame.new-empty', label: 'Nouvelle frame vide', group: 'Animation', keys: 'Alt+Maj+N', icon: 'frame-empty',
    run: () => app.timeline.addEmptyFrame(),
  })
  add({
    id: 'frame.duplicate', label: 'Dupliquer la frame', group: 'Animation', keys: 'Ctrl+Alt+N', icon: 'duplicate',
    run: () => app.timeline.duplicateFrame(),
  })
  add({
    id: 'frame.delete', label: 'Supprimer la frame', group: 'Animation', icon: 'trash',
    enabled: () => ed.frameCount > 1,
    run: () => app.timeline.deleteFrame(),
  })
  add({
    id: 'frame.next', label: 'Frame suivante', group: 'Animation', keys: '.', icon: 'next',
    run: () => ed.setActiveFrame(ed.activeFrame + 1),
  })
  add({
    id: 'frame.prev', label: 'Frame precedente', group: 'Animation', keys: ',', icon: 'prev',
    run: () => ed.setActiveFrame(ed.activeFrame - 1),
  })
  add({
    id: 'frame.first', label: 'Premiere frame', group: 'Animation', keys: 'Origine',
    run: () => ed.setActiveFrame(0),
  })
  add({
    id: 'frame.last', label: 'Derniere frame', group: 'Animation', keys: 'Fin',
    run: () => ed.setActiveFrame(ed.frameCount - 1),
  })
  add({
    id: 'frame.play', label: 'Lire / arreter l\'animation', group: 'Animation', keys: 'Entree', icon: 'play',
    checked: () => ed.playing,
    run: () => app.playback.toggle(),
  })
  add({
    id: 'frame.tag', label: 'Nouveau tag d\'animation…', group: 'Animation', keys: 'Ctrl+T', icon: 'tag',
    run: () => app.timeline.createTag(),
  })
  add({
    id: 'frame.propagate', label: 'Copier la case vers les frames selectionnees', group: 'Animation', icon: 'copy',
    run: () => ops.propagateCel(ed),
  })
  add({
    id: 'frame.onion', label: 'Pelure d\'oignon', group: 'Animation', keys: 'Alt+O', icon: 'onion',
    checked: () => ed.onion.enabled,
    run: () => {
      ed.onion.enabled = !ed.onion.enabled
      ed.events.emit('settings', undefined)
      ed.events.emit('doc', undefined)
    },
  })

  /* ---------------- Vue ---------------- */

  add({
    id: 'view.zoom-in', label: 'Zoom avant', group: 'Vue', keys: '+',
    run: () => app.viewport.setZoom(ed.view.zoom * 2),
  })
  add({
    id: 'view.zoom-out', label: 'Zoom arriere', group: 'Vue', keys: '-',
    run: () => app.viewport.setZoom(ed.view.zoom / 2),
  })
  add({
    id: 'view.zoom-fit', label: 'Ajuster a la fenetre', group: 'Vue', keys: 'Ctrl+0',
    run: () => app.viewport.fit(),
  })
  add({
    id: 'view.zoom-100', label: 'Zoom 100 %', group: 'Vue', keys: 'Ctrl+1',
    run: () => app.viewport.setZoom(1),
  })
  add({
    id: 'view.center', label: 'Recentrer', group: 'Vue',
    run: () => app.viewport.center(),
  })
  add({
    id: 'view.grid', label: 'Grille de tuiles', group: 'Vue', keys: 'Ctrl+\'', icon: 'grid',
    checked: () => ed.view.showGrid,
    run: () => ed.updateView({ showGrid: !ed.view.showGrid }),
  })
  add({
    id: 'view.pixel-grid', label: 'Grille de pixels', group: 'Vue', icon: 'grid',
    checked: () => ed.view.showPixelGrid,
    run: () => ed.updateView({ showPixelGrid: !ed.view.showPixelGrid }),
  })
  add({
    id: 'view.tiled', label: 'Apercu en tuiles 3×3', group: 'Vue', keys: 'Alt+T',
    checked: () => ed.view.tiledPreview,
    run: () => ed.updateView({ tiledPreview: !ed.view.tiledPreview }),
  })
  add({
    id: 'view.tiled-draw', label: 'Dessin en mode tuile (seamless)', group: 'Vue',
    checked: () => ed.tiledDrawing,
    run: () => { ed.tiledDrawing = !ed.tiledDrawing; ed.events.emit('settings', undefined) },
  })
  add({
    id: 'view.symmetry-x', label: 'Symetrie verticale', group: 'Vue', icon: 'symmetry',
    checked: () => ed.symmetry.x,
    run: () => { ed.symmetry.x = !ed.symmetry.x; ed.events.emit('settings', undefined) },
  })
  add({
    id: 'view.symmetry-y', label: 'Symetrie horizontale', group: 'Vue', icon: 'symmetry',
    checked: () => ed.symmetry.y,
    run: () => { ed.symmetry.y = !ed.symmetry.y; ed.events.emit('settings', undefined) },
  })
  add({
    id: 'view.slices', label: 'Afficher les zones et pivots', group: 'Vue',
    checked: () => ed.view.showSlices,
    run: () => ed.updateView({ showSlices: !ed.view.showSlices }),
  })
  add({
    id: 'view.background', label: 'Changer le fond de la toile', group: 'Vue',
    run: () => {
      const order = ['checker', 'dark', 'light', 'magenta'] as const
      const next = order[(order.indexOf(ed.view.backgroundStyle) + 1) % order.length]
      ed.updateView({ backgroundStyle: next })
      showToast(`Fond : ${next}`)
    },
  })

  add({
    id: 'view.workspace', label: 'Espace de travail…', group: 'Vue', icon: 'layout',
    run: () => {
      const anchor = document.querySelector<HTMLElement>('.topbar-actions button[title^="Espace"]')
      if (anchor) app.workspace.workspaceMenu(anchor)
    },
  })
  add({
    id: 'view.timeline', label: 'Afficher la timeline', group: 'Vue', keys: 'Alt+L', icon: 'panel-bottom',
    checked: () => app.workspace.timelineVisible,
    run: () => app.workspace.setTimelineVisible(!app.workspace.timelineVisible),
  })
  add({
    id: 'view.layout-reset', label: 'Reinitialiser la disposition', group: 'Vue', icon: 'refresh',
    run: () => app.workspace.reset(),
  })

  /* ---------------- Aide ---------------- */

  add({
    id: 'help.tutorials', label: 'Tutoriels guides…', group: 'Aide', keys: 'Maj+F1', icon: 'info',
    run: () => app.tutorial.openPicker(app.lessons()),
  })
  add({
    id: 'help.shortcuts', label: 'Raccourcis clavier', group: 'Aide', keys: 'F1', icon: 'info',
    run: () => dlg.shortcutsDialog(shortcutGroups(list)),
  })
  add({
    id: 'help.palette', label: 'Palette de commandes', group: 'Aide', keys: 'Ctrl+K', icon: 'search',
    run: () => app.openCommandPalette(),
  })
  add({
    id: 'help.about', label: 'A propos de PixelForge', group: 'Aide', icon: 'info',
    run: () => app.showAbout(),
  })

  return list
}

/** Regroupe les raccourcis pour la fenetre d'aide. */
function shortcutGroups(commands: Command[]): { title: string; items: [string, string][] }[] {
  const groups = new Map<string, [string, string][]>()
  for (const c of commands) {
    if (!c.keys) continue
    const arr = groups.get(c.group) ?? []
    arr.push([c.label, c.keys])
    groups.set(c.group, arr)
  }
  const out = [...groups.entries()].map(([title, items]) => ({ title, items }))
  out.push({
    title: 'Outils',
    items: [
      ['Crayon', 'B'], ['Gomme', 'E'], ['Pot de peinture', 'G'], ['Pipette', 'I'],
      ['Ligne', 'L'], ['Rectangle', 'U'], ['Ellipse', 'Shift+U'], ['Contour', 'Q'],
      ['Courbe', 'Shift+C'], ['Degrade', 'R'], ['Ombrage', 'D'], ['Flou', 'Y'],
      ['Aerographe', 'A'], ['Selection rect.', 'M'], ['Selection ellipse', 'Shift+M'],
      ['Lasso', 'Shift+L'], ['Baguette magique', 'W'], ['Deplacer', 'V'],
      ['Main', 'H'], ['Loupe', 'Z'],
    ],
  })
  out.push({
    title: 'Souris et modificateurs',
    items: [
      ['Dessiner avec la couleur secondaire', 'Clic droit'],
      ['Pipette temporaire', 'Alt + clic'],
      ['Deplacer la vue', 'Espace + glisser / clic molette'],
      ['Zoomer', 'Molette'],
      ['Contraindre a 45°', 'Maj pendant le trace'],
      ['Forme depuis le centre', 'Alt pendant le trace'],
      ['Ajouter a la selection', 'Maj'],
      ['Soustraire de la selection', 'Alt'],
      ['Deplacer les pixels au clavier', 'Fleches'],
      ['Taille de brosse', '[ et ]'],
      ['Permuter les couleurs', 'X'],
      ['Annuler l\'action en cours', 'Echap'],
    ],
  })
  return out
}
