import type { Editor } from '../core/editor'
import {
  type RGBA, getR, getG, getB, getA, rgba, toHex, fromHex, toCss,
  rgbaToHsv, hsvToRgba, TRANSPARENT,
} from '../core/color'
import { PALETTE_PRESETS, Palette, quantize } from '../core/palette'
import { extractRamps } from '../smart/analysis'
import type { Bitmap } from '../core/bitmap'
import { el, clear, iconButton } from './dom'
import { icon } from './icons'
import { openMenu, promptDialog, showToast } from './overlay'

/**
 * Panneau couleur : selecteur TSV, champs numeriques et palette du sprite.
 * Le selecteur agit sur la couleur principale ou secondaire selon le
 * cartouche actif.
 */
export class ColorPanel {
  /** Selecteur de couleur. */
  readonly pickerContent!: HTMLElement
  /** Nuancier du sprite. */
  readonly paletteContent!: HTMLElement
  readonly paletteActions!: HTMLElement[]
  private ed: Editor
  private editing: 'primary' | 'secondary' = 'primary'
  private hsv = { h: 0, s: 0, v: 1, a: 255 }

  private svCanvas = el('canvas', { width: 240, height: 130 })
  private svDot = el('div', { class: 'picker-dot' })
  private hueDot = el('div', { class: 'strip-dot' })
  private alphaDot = el('div', { class: 'strip-dot' })
  private alphaFill = el('i')
  private hexInput = el('input', { type: 'text', spellcheck: false })
  private primarySwatch = el('div', { class: 'swatch-big active', title: 'Couleur principale (clic gauche)' }, el('i'))
  private secondarySwatch = el('div', { class: 'swatch-big', title: 'Couleur secondaire (clic droit)' }, el('i'))
  private paletteGrid = el('div', { class: 'palette-grid' })
  /** Les familles declarees : « herbe », « peau »… Voir `renderGroupes`. */
  private groupesBox = el('div', { class: 'palette-groupes' })
  /** Mode « retoucher la palette » : le sprite suit le selecteur. */
  private paletteMode = false
  private editToggle = el('button', {
    class: 'btn ghost sm icon-only',
    title: 'Retoucher la palette : le sprite se recolore en direct',
    html: '',
  })
  /**
   * Nom de la palette courante. Il vit dans le corps du panneau et non dans
   * l'en-tete : la, entre le titre et quatre boutons, « PICO-8 · 16 » passait
   * a la ligne et poussait le dernier bouton hors du panneau. En dessous, il
   * a la largeur qu'il lui faut.
   */
  private paletteName = el('div', { class: 'palette-nom' })
  private channelRows: { input: HTMLInputElement; badge: HTMLElement }[] = []
  private suppress = false
  /**
   * Retouche de palette en cours. Tant qu'elle dure, le selecteur reecrit
   * l'entree choisie et repeint le sprite en direct ; les pixels concernes
   * sont repertories une fois pour toutes, ce qui rend le va-et-vient exact
   * meme si la nouvelle teinte existait deja ailleurs.
   */
  private paletteEdit: {
    index: number
    origine: RGBA
    courante: RGBA
    cibles: { bitmap: Bitmap; idx: Uint32Array }[]
    minuteur: number
  } | null = null

  constructor(editor: Editor) {
    this.ed = editor
    this.build()
    this.syncFromEditor()
    editor.events.on('settings', () => this.syncFromEditor())
    editor.events.on('reload', () => { this.endPaletteEdit(); this.renderPalette(); this.syncFromEditor() })
    editor.events.on('doc', () => this.renderPalette())
  }

  private build(): void {
    const swatches = el('div', { class: 'color-slots' },
      this.primarySwatch,
      this.secondarySwatch,
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        iconButton(icon('flip', 14), 'Permuter les couleurs (X)', () => this.ed.swapColors(), { className: 'sm icon-only' }),
        iconButton(icon('close', 14), 'Couleur transparente', () => this.setColor(TRANSPARENT), { className: 'sm icon-only' }),
      ),
    )
    this.editToggle.innerHTML = icon('palette', 14)
    this.editToggle.addEventListener('click', () => this.togglePaletteMode())
    this.primarySwatch.addEventListener('click', () => {
      this.endPaletteEdit()
      this.editing = 'primary'
      this.syncFromEditor()
    })
    this.secondarySwatch.addEventListener('click', () => { this.editing = 'secondary'; this.syncFromEditor() })

    const svArea = el('div', { class: 'sv-area' }, this.svCanvas, this.svDot)
    this.dragArea(svArea, (nx, ny) => {
      this.hsv.s = nx
      this.hsv.v = 1 - ny
      this.commitHsv()
    })

    const hue = el('div', { class: 'hue-strip' }, this.hueDot)
    this.dragArea(hue, (nx) => { this.hsv.h = nx * 360; this.commitHsv() })

    const alpha = el('div', { class: 'alpha-strip' }, this.alphaFill, this.alphaDot)
    this.dragArea(alpha, (nx) => { this.hsv.a = Math.round(nx * 255); this.commitHsv() })

    this.hexInput.addEventListener('change', () => {
      const c = fromHex(this.hexInput.value)
      this.setColor(getA(c) === 0 && !/^#?[0-9a-f]{8}$/i.test(this.hexInput.value.trim())
        ? rgba(getR(c), getG(c), getB(c), 255)
        : c)
    })

    const hexRow = el('div', { class: 'hex-row' },
      el('span', { style: { color: 'var(--text-faint)', fontSize: '11px' } }, 'HEX'),
      this.hexInput,
    )

    const channels = el('div', { class: 'channels hidden' })
    const names = ['R', 'G', 'B', 'A']
    for (let i = 0; i < 4; i++) {
      const badge = el('span', { class: 'num-badge' }, '0')
      const input = el('input', {
        type: 'range', min: 0, max: 255, step: 1, value: '0',
        oninput: () => {
          const color = this.currentColor()
          const parts = [getR(color), getG(color), getB(color), getA(color)]
          parts[i] = Number(input.value)
          this.setColor(rgba(parts[0], parts[1], parts[2], parts[3]))
        },
      })
      this.channelRows.push({ input, badge })
      channels.append(el('label', null, names[i]), input, badge)
    }

    // Les curseurs RGBA sont replies par defaut : la palette reste visible
    // sans faire defiler le panneau lateral.
    const toggle = el('button', { class: 'picker-more' }, 'Canaux RGBA')
    toggle.addEventListener('click', () => {
      const hidden = channels.classList.toggle('hidden')
      toggle.textContent = hidden ? 'Canaux RGBA' : 'Masquer les canaux'
    })

    const picker = el('div', { class: 'panel-body fixed' },
      swatches, el('div', { style: { height: '9px' } }), svArea, hue, alpha, hexRow, toggle, channels)

    ;(this as { pickerContent: HTMLElement }).pickerContent = picker
    ;(this as { paletteContent: HTMLElement }).paletteContent =
      el('div', { class: 'panel-body tight' }, this.paletteName, this.paletteGrid, this.groupesBox)
    ;(this as { paletteActions: HTMLElement[] }).paletteActions = [
      iconButton(icon('plus', 14), 'Ajouter la couleur courante', () => this.addCurrent(), { className: 'ghost sm icon-only' }),
      this.editToggle,
      iconButton(icon('settings', 14), 'Options de palette', (e) => this.paletteMenu(e), { className: 'ghost sm icon-only' }),
    ]
  }

  /** Rend une bande ou une zone interactive au glisser. */
  private dragArea(node: HTMLElement, onMove: (nx: number, ny: number) => void): void {
    const handle = (e: PointerEvent) => {
      const r = node.getBoundingClientRect()
      onMove(
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      )
    }
    node.addEventListener('pointerdown', (e) => {
      node.setPointerCapture(e.pointerId)
      handle(e)
      const move = (ev: PointerEvent) => handle(ev)
      const up = () => {
        node.removeEventListener('pointermove', move)
        node.removeEventListener('pointerup', up)
      }
      node.addEventListener('pointermove', move)
      node.addEventListener('pointerup', up)
    })
  }

  private currentColor(): RGBA {
    return this.editing === 'primary' ? this.ed.primary : this.ed.secondary
  }

  private setColor(c: RGBA): void {
    // Une retouche de palette detourne le selecteur : c'est l'entree choisie
    // qui change, et le sprite avec elle.
    if (this.paletteEdit) { this.applyPaletteEdit(c); return }
    if (this.editing === 'primary') this.ed.setPrimary(c)
    else this.ed.setSecondary(c)
  }

  /* ---------------------------------------------------------------- */
  /* Retouche de palette                                               */
  /* ---------------------------------------------------------------- */

  /** Active ou quitte le mode retouche. */
  private togglePaletteMode(): void {
    this.paletteMode = !this.paletteMode
    if (!this.paletteMode) this.endPaletteEdit()
    this.editToggle.classList.toggle('active', this.paletteMode)
    showToast(this.paletteMode
      ? 'Retouche de palette : choisissez une pastille, le sprite suit'
      : 'Retouche de palette terminée', this.paletteMode ? 'info' : 'success')
    this.renderPalette()
  }

  /**
   * Prepare la retouche d'une entree : on releve une fois pour toutes les
   * pixels qui la portent. Les repertorier evite de les rechercher a chaque
   * mouvement du selecteur, et rend l'annulation exacte meme si la nouvelle
   * teinte existait deja dans le dessin.
   */
  private beginPaletteEdit(index: number): void {
    this.endPaletteEdit()
    const origine = this.ed.sprite.palette.colors[index]
    if (origine === undefined) return
    const cibles: { bitmap: Bitmap; idx: Uint32Array }[] = []
    for (const layer of this.ed.sprite.layers) {
      for (const cel of layer.cels) {
        if (!cel) continue
        const found: number[] = []
        const u = cel.bitmap.u32
        for (let i = 0; i < u.length; i++) if (u[i] === origine) found.push(i)
        if (found.length) cibles.push({ bitmap: cel.bitmap, idx: new Uint32Array(found) })
      }
    }
    this.paletteEdit = { index, origine, courante: origine, cibles, minuteur: 0 }
    const total = cibles.reduce((n, c) => n + c.idx.length, 0)
    this.editing = 'primary'
    this.ed.setPrimary(origine)
    showToast(total
      ? `${total} pixels suivront cette couleur`
      : 'Cette couleur n\'est pas utilisée dans le dessin', total ? 'info' : 'info')
    this.renderPalette()
  }

  /** Repeint le sprite avec la nouvelle teinte, sans passer par l'historique. */
  private applyPaletteEdit(next: RGBA): void {
    const edit = this.paletteEdit
    if (!edit || next === edit.courante) return
    edit.courante = next
    this.ed.sprite.palette.colors[edit.index] = next
    for (const cible of edit.cibles) {
      for (const i of cible.idx) cible.bitmap.u32[i] = next
    }
    this.suppress = true
    this.ed.setPrimary(next)
    this.suppress = false
    this.ed.events.emit('doc', undefined)

    // Le geste entier ne laisse qu'une entrée dans l'historique : on attend
    // que le selecteur se calme avant de la deposer.
    window.clearTimeout(edit.minuteur)
    edit.minuteur = window.setTimeout(() => this.endPaletteEdit(), 600)
  }

  /** Depose la retouche dans l'historique et referme le geste. */
  private endPaletteEdit(): void {
    const edit = this.paletteEdit
    this.paletteEdit = null
    if (!edit) return
    window.clearTimeout(edit.minuteur)
    if (edit.courante === edit.origine) { this.renderPalette(); return }

    const { index, origine, courante, cibles } = edit
    const palette = this.ed.sprite.palette
    const ecrire = (couleur: RGBA) => {
      palette.colors[index] = couleur
      for (const cible of cibles) for (const i of cible.idx) cible.bitmap.u32[i] = couleur
      this.ed.events.emit('doc', undefined)
    }
    this.ed.pushCommand({
      label: 'Retoucher la palette',
      undo: () => ecrire(origine),
      redo: () => ecrire(courante),
    })
    const total = cibles.reduce((n, c) => n + c.idx.length, 0)
    if (total) showToast(`${total} pixels recolores`, 'success')
    this.renderPalette()
  }

  private commitHsv(): void {
    this.suppress = true
    this.setColor(hsvToRgba(this.hsv))
    this.suppress = false
    this.paint()
  }

  /** Recharge l'état depuis l'editeur (changement externe de couleur). */
  private syncFromEditor(): void {
    if (this.suppress) { this.paint(); return }
    const c = this.currentColor()
    const hsv = rgbaToHsv(c)
    // Une couleur noire ou grise n'a pas de teinte : on conserve la derniere.
    this.hsv = { h: hsv.s === 0 ? this.hsv.h : hsv.h, s: hsv.s, v: hsv.v, a: getA(c) }
    this.paint()
  }

  private paint(): void {
    const c = this.currentColor()
    this.primarySwatch.classList.toggle('active', this.editing === 'primary')
    this.secondarySwatch.classList.toggle('active', this.editing === 'secondary')
    ;(this.primarySwatch.firstElementChild as HTMLElement).style.background = toCss(this.ed.primary)
    ;(this.secondarySwatch.firstElementChild as HTMLElement).style.background = toCss(this.ed.secondary)

    const ctx = this.svCanvas.getContext('2d')!
    const w = this.svCanvas.width, h = this.svCanvas.height
    ctx.fillStyle = toCss(hsvToRgba({ h: this.hsv.h, s: 1, v: 1, a: 255 }))
    ctx.fillRect(0, 0, w, h)
    const white = ctx.createLinearGradient(0, 0, w, 0)
    white.addColorStop(0, 'rgba(255,255,255,1)')
    white.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = white
    ctx.fillRect(0, 0, w, h)
    const black = ctx.createLinearGradient(0, 0, 0, h)
    black.addColorStop(0, 'rgba(0,0,0,0)')
    black.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = black
    ctx.fillRect(0, 0, w, h)

    this.svDot.style.left = `${this.hsv.s * 100}%`
    this.svDot.style.top = `${(1 - this.hsv.v) * 100}%`
    this.svDot.style.background = toCss(rgba(getR(c), getG(c), getB(c), 255))
    this.hueDot.style.left = `${(this.hsv.h / 360) * 100}%`
    this.alphaDot.style.left = `${(this.hsv.a / 255) * 100}%`
    this.alphaFill.style.background =
      `linear-gradient(to right, ${toCss(rgba(getR(c), getG(c), getB(c), 0))}, ${toCss(rgba(getR(c), getG(c), getB(c), 255))})`

    this.hexInput.value = getA(c) === 255 ? toHex(c) : toHex(c, true)
    const parts = [getR(c), getG(c), getB(c), getA(c)]
    this.channelRows.forEach((row, i) => {
      row.input.value = String(parts[i])
      row.badge.textContent = String(parts[i])
    })
    this.markPaletteSelection()
  }

  /* ---------------------------------------------------------------- */
  /* Palette                                                           */
  /* ---------------------------------------------------------------- */

  renderPalette(): void {
    const palette = this.ed.sprite.palette
    this.paletteName.textContent = `${palette.name} · ${palette.size} couleurs`
    this.paletteName.title = `${palette.name} · ${palette.size} couleurs`
    clear(this.paletteGrid)

    const transparent = el('div', {
      class: 'pal-swatch transparent',
      title: 'Transparent',
      onclick: () => { this.editing = 'primary'; this.setColor(TRANSPARENT) },
      oncontextmenu: (e: MouseEvent) => { e.preventDefault(); this.ed.setSecondary(TRANSPARENT) },
    })
    this.paletteGrid.appendChild(transparent)

    palette.colors.forEach((color, index) => {
      const sw = el('div', {
        class: 'pal-swatch',
        title: `${toHex(color)}  ·  index ${index}`,
        style: { background: toCss(color) },
        onclick: () => {
          if (this.paletteMode) { this.beginPaletteEdit(index); return }
          this.ed.setPrimary(color)
        },
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); this.ed.setSecondary(color) },
      })
      sw.dataset.index = String(index)
      // Le double-clic reste le raccourci : il pousse la couleur courante
      // dans l'entree visee, sans passer par le mode retouche.
      sw.addEventListener('dblclick', () => this.replaceColorAt(index))
      /*
       * Une pastille se GLISSE dans un groupe. C'est le geste le plus court
       * pour ranger une famille : on prend le vert, on le lache sur
       * « herbe ». Le bouton « + » de chaque groupe fait la meme chose pour
       * qui prefere viser.
       */
      sw.draggable = true
      sw.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', String(color))
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
      })
      this.paletteGrid.appendChild(sw)
    })
    this.markPaletteSelection()
    this.renderGroupes()
  }

  /**
   * Les GROUPES de la palette : des familles nommees.
   *
   * Trente-deux pastilles alignees ne disent rien de ce qu'elles sont. Le
   * pixel art travaille par familles — l'herbe, la peau, le metal — et chaque
   * famille est une rampe qu'on parcourt de l'ombre a la lumiere. Les outils
   * assistes s'en servent ensuite au lieu de deviner : voir
   * `RampIndex.fromBitmapsAndGroups`.
   */
  private renderGroupes(): void {
    const palette = this.ed.sprite.palette
    clear(this.groupesBox)

    const titre = el('div', { class: 'palette-groupes-tete' },
      el('span', null, palette.groupes.length
        ? `Groupes · ${palette.groupes.length}`
        : 'Groupes'),
      iconButton(icon('plus', 12), 'Nouveau groupe, avec la couleur courante',
        () => this.creerGroupe(), { className: 'ghost sm icon-only' }),
      iconButton(icon('magic-wand', 12), 'Deviner les familles du dessin et en faire des groupes',
        () => this.devinerGroupes(), { className: 'ghost sm icon-only' }),
    )
    this.groupesBox.appendChild(titre)

    if (!palette.groupes.length) {
      this.groupesBox.appendChild(el('p', { class: 'palette-groupes-vide' },
        'Rangez vos teintes par famille — « herbe », « peau » — et l’ombrage comme '
        + 'le détail puiseront dedans au lieu de deviner. Glissez une pastille sur un groupe.'))
      return
    }

    for (const g of palette.groupes) {
      const ligne = el('div', { class: 'palette-groupe' })
      const tete = el('div', { class: 'palette-groupe-tete' },
        el('b', { title: 'Double-clic pour renommer' }, g.nom),
        el('span', { class: 'palette-groupe-compte' }, `${g.couleurs.length}`),
        iconButton(icon('plus', 12), 'Y ranger la couleur courante', () => {
          this.ed.run(`Groupe ${g.nom}`, () => {
            palette.ajouterAuGroupe(g.nom, this.currentColor())
          })
          this.renderPalette()
        }, { className: 'ghost sm icon-only' }),
        iconButton(icon('trash', 12), 'Défaire ce groupe — les couleurs restent dans la palette', () => {
          this.ed.run(`Groupe ${g.nom} défait`, () => palette.retirerGroupe(g.nom))
          this.renderPalette()
        }, { className: 'ghost sm icon-only' }),
      )
      tete.querySelector('b')?.addEventListener('dblclick', () => {
        const voulu = window.prompt('Nom du groupe', g.nom)
        if (!voulu) return
        this.ed.run('Renommer le groupe', () => {
          if (!palette.renommerGroupe(g.nom, voulu)) showToast('Ce nom est déjà pris', 'error')
        })
        this.renderPalette()
      })
      const bande = el('div', { class: 'palette-groupe-bande' })
      for (const c of g.couleurs) {
        bande.appendChild(el('div', {
          class: 'pal-swatch',
          title: `${toHex(c)} · clic : prendre · clic droit : sortir du groupe`,
          style: { background: toCss(c) },
          onclick: () => { this.editing = 'primary'; this.setColor(c) },
          oncontextmenu: (e: MouseEvent) => {
            e.preventDefault()
            this.ed.run(`Sortir de ${g.nom}`, () => palette.retirerDuGroupe(g.nom, c))
            this.renderPalette()
          },
        }))
      }
      if (!g.couleurs.length) {
        bande.appendChild(el('span', { class: 'palette-groupes-vide' },
          'Vide — glissez une pastille ici.'))
      }
      // La LIGNE entiere recoit le glisser : viser une bande vide serait
      // impossible.
      ligne.addEventListener('dragover', (e) => {
        e.preventDefault()
        ligne.classList.add('cible')
      })
      ligne.addEventListener('dragleave', () => ligne.classList.remove('cible'))
      ligne.addEventListener('drop', (e) => {
        e.preventDefault()
        ligne.classList.remove('cible')
        const brut = e.dataTransfer?.getData('text/plain') ?? ''
        const c = Number(brut)
        if (!brut || !Number.isFinite(c)) return
        this.ed.run(`Groupe ${g.nom}`, () => palette.ajouterAuGroupe(g.nom, c))
        this.renderPalette()
      })
      ligne.append(tete, bande)
      this.groupesBox.appendChild(ligne)
    }
  }

  private creerGroupe(): void {
    const voulu = window.prompt('Nom du groupe — « herbe », « peau », « métal »…', 'herbe')
    if (!voulu?.trim()) return
    const couleur = this.currentColor()
    this.ed.run('Nouveau groupe', () => {
      this.ed.sprite.palette.creerGroupe(voulu, getA(couleur) === 0 ? [] : [couleur])
    })
    this.renderPalette()
  }

  /**
   * Devine les familles du dessin et en fait des groupes.
   *
   * Le moteur sait deja regrouper les couleurs d'un sprite par teinte — c'est
   * ce dont vivent l'ombrage et le detail. Le proposer d'un clic evite de
   * ranger trente pastilles a la main pour obtenir ce que la machine avait
   * deja devine ; ensuite, on corrige ce qu'elle a mal range.
   */
  private devinerGroupes(): void {
    const bitmaps: Bitmap[] = []
    for (const l of this.ed.sprite.layers) {
      for (const c of l.cels) if (c?.bitmap) bitmaps.push(c.bitmap)
    }
    if (!bitmaps.length) { showToast('Rien à deviner : le dessin est vide', 'error'); return }
    const rampes = extractRamps(bitmaps).filter((r) => r.colors.length > 1)
    if (!rampes.length) {
      showToast('Aucune famille trouvée : le dessin n’a pas assez de tons', 'error')
      return
    }
    const palette = this.ed.sprite.palette
    this.ed.run('Deviner les groupes', () => {
      for (const r of rampes) {
        // Le nom devine sert de depart : « verts », « peau », « gris ». On le
        // renomme en deux clics, et c'est deja mieux que rien.
        let nom = r.label
        let n = 2
        while (palette.groupes.some((g) => g.nom === nom)) nom = `${r.label} ${n++}`
        palette.creerGroupe(nom, r.colors)
      }
    })
    this.renderPalette()
    showToast(`${rampes.length} groupe(s) devinés — renommez-les d’un double-clic`, 'success')
  }

  private markPaletteSelection(): void {
    for (const node of this.paletteGrid.children) {
      const sw = node as HTMLElement
      const index = sw.dataset.index
      if (index === undefined) continue
      const color = this.ed.sprite.palette.colors[Number(index)]
      sw.classList.toggle('primary', color === this.ed.primary)
      sw.classList.toggle('secondary', color === this.ed.secondary)
      sw.classList.toggle('editing', this.paletteEdit?.index === Number(index))
    }
  }

  private addCurrent(): void {
    const color = this.currentColor()
    this.ed.run('Ajouter a la palette', () => { this.ed.sprite.palette.add(color) })
    this.renderPalette()
  }

  /** Remplace une entree de palette et repercute le changement sur les pixels. */
  private async replaceColorAt(index: number): Promise<void> {
    const palette = this.ed.sprite.palette
    const old = palette.colors[index]
    const next = this.currentColor()
    if (old === next) return
    const cels = this.ed.sprite.layers.flatMap((l) => l.cels).filter((c) => c !== null)
    this.ed.runPixels('Remplacer la couleur', cels, () => {
      for (const cel of cels) {
        const u = cel.bitmap.u32
        for (let i = 0; i < u.length; i++) if (u[i] === old) u[i] = next
      }
      palette.colors[index] = next
    })
    this.renderPalette()
    showToast('Couleur remplacee dans tout le sprite', 'success')
  }

  private paletteMenu(e: MouseEvent): void {
    const ed = this.ed
    const palette = ed.sprite.palette
    openMenu(e.currentTarget as HTMLElement, [
      { title: 'Palettes integrees' },
      ...Object.keys(PALETTE_PRESETS).map((name) => ({
        label: name,
        checked: palette.name === name,
        onClick: () => {
          ed.run(`Palette ${name}`, () => { ed.sprite.palette = Palette.preset(name) })
          this.renderPalette()
        },
      })),
      { separator: true },
      {
        label: 'Extraire du sprite',
        icon: 'palette',
        onClick: () => {
          const bitmaps = ed.sprite.layers.flatMap((l) => l.cels).filter((c) => c !== null).map((c) => c.bitmap)
          const colors = quantize(bitmaps, 64)
          if (!colors.length) { showToast('Le sprite est vide', 'error'); return }
          ed.run('Palette du sprite', () => { ed.sprite.palette = new Palette('Sprite', colors) })
          this.renderPalette()
          showToast(`${colors.length} couleurs extraites`, 'success')
        },
      },
      {
        label: 'Trier par luminosite',
        onClick: () => { ed.run('Trier la palette', () => palette.sortBy('luminance')); this.renderPalette() },
      },
      {
        label: 'Trier par teinte',
        onClick: () => { ed.run('Trier la palette', () => palette.sortBy('hue')); this.renderPalette() },
      },
      { separator: true },
      {
        label: 'Importer (.gpl / .hex)',
        icon: 'upload',
        onClick: () => this.importPalette(),
      },
      {
        label: 'Exporter en .gpl',
        icon: 'download',
        onClick: () => {
          const blob = new Blob([palette.toGPL()], { type: 'text/plain' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `${palette.name.replace(/\s+/g, '_')}.gpl`
          a.click()
        },
      },
      {
        label: 'Renommer la palette',
        onClick: async () => {
          const name = await promptDialog('Renommer la palette', 'Nom', palette.name)
          if (name) { palette.name = name; this.renderPalette() }
        },
      },
    ], 'right')
  }

  private importPalette(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.gpl,.hex,.txt,.pal'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const name = file.name.replace(/\.[^.]+$/, '')
      const palette = /GIMP Palette/i.test(text)
        ? Palette.fromGPL(text, name)
        : Palette.fromHEXFile(text, name)
      if (!palette.size) { showToast('Palette illisible', 'error'); return }
      this.ed.run('Importer la palette', () => { this.ed.sprite.palette = palette })
      this.renderPalette()
      showToast(`${palette.size} couleurs importées`, 'success')
    })
    input.click()
  }
}
