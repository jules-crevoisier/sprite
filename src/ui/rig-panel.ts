import type { Editor } from '../core/editor'
import {
  applyPose, autoBind, boneColor, canParent, capturePose, deform, lerpPose,
  resetPose, type Bone, type Pose,
} from '../smart/rig'
import { RIG_TEMPLATES, applyTemplate } from '../smart/rig-presets'
import { rigState, refreshPose, seamSettings, syncRestFromCanvas } from '../tools'
import { el, clear, iconButton, numberInput, slider } from './dom'
import { icon } from './icons'
import { confirmDialog, openMenu, showToast } from './overlay'

/**
 * Panneau du mode Squelette : hierarchie des os, liaison des pixels, rendu
 * de la pose et fabrication des frames.
 */
export class RigPanel {
  readonly content: HTMLElement
  readonly actions: HTMLElement[]
  private ed: Editor
  private body = el('div', { class: 'panel-body' })
  /** Pose de depart memorisee, pour generer les frames intermediaires. */
  private poseA: Pose | null = null
  /** Empreinte de ce qui est affiche : on ne rebatit que si elle change. */
  private drawn = ''

  constructor(editor: Editor) {
    this.ed = editor
    this.content = this.body
    this.actions = [
      iconButton(icon('group', 14), 'Modeles de squelette',
        (e) => this.templateMenu(e.currentTarget as HTMLElement), { className: 'ghost sm icon-only' }),
      iconButton(icon('refresh', 14), 'Reinitialiser la pose', () => this.resetPose(), { className: 'ghost sm icon-only' }),
    ]
    editor.events.on('doc', () => this.sync())
    editor.events.on('settings', () => this.sync())
    editor.events.on('reload', () => { this.poseA = null; this.render() })
    this.render()
  }

  private get rig() { return this.ed.sprite.rig }

  /**
   * Empreinte de la liste : tout ce dont le HTML depend, hors selection.
   * La pose n'y figure pas : la tirer a la souris emet un evenement a chaque
   * pixel, et rebatir la liste a ce rythme arracherait le champ en cours
   * d'edition.
   */
  private signature(): string {
    const rig = this.rig
    return [
      rig.bones.map((b) => `${b.id}/${b.name}/${b.parent ?? '-'}/${b.z}`).join(','),
      rig.rest ? 'lie' : 'libre',
      rigState.seam,
      this.poseA ? 'A' : '-',
    ].join('|')
  }

  /** Rebatit si la structure a bouge, sinon met juste la selection a jour. */
  private sync(): void {
    if (this.signature() !== this.drawn) { this.render(); return }
    this.markSelection()
  }

  private markSelection(): void {
    for (const node of this.body.querySelectorAll<HTMLElement>('[data-bone]')) {
      node.classList.toggle('active', node.dataset.bone === String(rigState.selected))
    }
  }

  render(): void {
    this.drawn = this.signature()
    clear(this.body)
    const rig = this.rig
    const bound = !!rig.rest && !!rig.weights

    if (!rig.bones.length) {
      this.body.append(
        el('button', {
          class: 'btn primary',
          style: { width: '100%' },
          html: icon('group', 14),
          onclick: (e: MouseEvent) => this.templateMenu(e.currentTarget as HTMLElement),
        }, el('span', null, 'Partir d\'un modele')),
        el('p', { class: 'form-note', style: { marginTop: '8px' } },
          'Ou tracez vous-meme : avec l\'outil Creer des os, glissez sur la toile. ',
          'Repartir du bout d\'un os l\'enchaine au precedent.'),
      )
      return
    }

    this.body.appendChild(this.hierarchy())

    // --- liaison ---
    this.body.appendChild(el('div', { class: 'form-section' }, 'Liaison'))
    this.body.appendChild(el('button', {
      class: `btn ${bound ? '' : 'primary'}`,
      style: { width: '100%' },
      html: icon('bone', 14),
      onclick: () => this.bind(),
    }, el('span', null, bound ? 'Relier les pixels' : 'Lier les pixels au squelette')))
    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '6px' } },
      bound
        ? 'Les pixels suivent le squelette. Vous pouvez repasser en mode Dessin, retoucher, et revenir : '
          + 'la retouche est reprise sans reliaison. Le pinceau Ponderer montre et corrige les frontieres.'
        : 'A faire une fois les os places : chaque pixel rejoint l\'os le plus proche.'))

    if (!bound) return

    // --- rendu ---
    const seamLabels = ['aucun', 'discret', 'normal', 'genereux']
    this.body.appendChild(el('div', { class: 'form-section' }, 'Rendu de la pose'))
    this.body.appendChild(el('div', { class: 'opt' },
      el('label', { style: { width: '74px' } }, 'Jointures'),
      slider(0, 3, rigState.seam, 1,
        (v) => { rigState.seam = v; refreshPose(this.ed) },
        (v) => seamLabels[v] ?? ''),
    ))
    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '4px' } },
      'Referme les fentes de l\'articulation. Trop haut, la silhouette s\'epaissit.'))

    // --- frames ---
    this.body.appendChild(el('div', { class: 'form-section' }, 'Frames'))
    this.body.appendChild(el('button', {
      class: 'btn',
      style: { width: '100%', marginBottom: '6px' },
      html: icon('plus', 14),
      onclick: () => this.frameFromPose(),
    }, el('span', null, 'Nouvelle frame depuis la pose')))

    const count = numberInput(4, () => {}, { min: 1, max: 32, width: '58px' })
    this.body.appendChild(el('button', {
      class: `btn sm ${this.poseA ? 'active' : ''}`,
      style: { width: '100%', marginBottom: '6px' },
      onclick: () => {
        this.poseA = capturePose(this.rig)
        showToast('Pose de depart memorisee', 'success')
        this.render()
      },
    }, this.poseA ? 'Pose de depart memorisee' : 'Memoriser la pose de depart'))
    this.body.appendChild(el('div', { class: 'form-row' },
      count,
      el('button', {
        class: 'btn sm',
        disabled: !this.poseA,
        onclick: () => this.tween(Math.max(1, Number(count.value))),
      }, 'Frames intermediaires'),
    ))
    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '6px' } },
      'Memorisez une pose, deplacez le squelette, puis generez les frames : ',
      'l\'interpolation produit le mouvement complet.'))
  }

  /**
   * Change l'os selectionne sans reconstruire la liste : reconstruire
   * arracherait le champ que l'on vient de toucher.
   */
  private select(id: number): void {
    rigState.selected = id
    this.markSelection()
    this.ed.events.emit('settings', undefined)
  }

  /** Liste des os, indentee selon la hierarchie. */
  private hierarchy(): HTMLElement {
    const rig = this.rig
    const list = el('div', { style: { display: 'grid', gap: '2px' } })
    const roots = rig.bones.filter((b) => b.parent === null)
    const walk = (bones: Bone[], depth: number) => {
      for (const bone of bones) {
        list.appendChild(this.boneRow(bone, depth))
        walk(rig.bones.filter((b) => b.parent === bone.id), depth + 1)
      }
    }
    walk(roots, 0)
    // Un os dont le parent a disparu doit rester visible.
    const shown = new Set([...list.children].map((n) => (n as HTMLElement).dataset.bone))
    for (const bone of rig.bones) {
      if (!shown.has(String(bone.id))) list.appendChild(this.boneRow(bone, 0))
    }
    return list
  }

  private boneRow(bone: Bone, depth: number): HTMLElement {
    const rig = this.rig
    const index = rig.bones.indexOf(bone)
    const selected = rigState.selected === bone.id

    const name = el('input', {
      value: bone.name,
      style: {
        flex: '1', minWidth: '0', height: '22px', fontSize: '12px',
        background: 'transparent', border: '1px solid transparent', color: 'var(--text)',
      },
      onchange: () => { bone.name = name.value.trim() || bone.name; this.ed.history.touch() },
      // Le champ arrete le clic pour ne pas etre detruit : il selectionne
      // donc l'os lui-meme quand on vient y ecrire.
      onfocus: () => this.select(bone.id),
    })

    const parents = [
      { value: '', label: 'racine' },
      ...rig.bones.filter((b) => b.id !== bone.id && canParent(rig, bone.id, b.id))
        .map((b) => ({ value: String(b.id), label: b.name })),
    ]
    const parentSelect = el('select', {
      style: { height: '22px', fontSize: '11px', flex: 'none', width: '86px' },
      title: 'Os parent — l\'os suit alors son parent',
      onfocus: () => this.select(bone.id),
      onchange: () => {
        const value = parentSelect.value === '' ? null : Number(parentSelect.value)
        if (!canParent(rig, bone.id, value)) {
          showToast('Un os ne peut pas descendre de lui-meme', 'error')
          parentSelect.value = String(bone.parent ?? '')
          return
        }
        this.ed.run('Rattacher un os', () => { bone.parent = value })
        refreshPose(this.ed)
        this.render()
      },
    }, ...parents.map((o) => el('option', { value: o.value, selected: String(bone.parent ?? '') === o.value }, o.label)))

    // Le nom et le parent sont des champs : un clic dessus ne doit pas
    // remonter jusqu'a la ligne, sinon le re-rendu detruit le champ ouvert
    // et la liste deroulante du navigateur se referme aussitot.
    const keepFocus = (node: HTMLElement) => {
      node.addEventListener('mousedown', (e) => e.stopPropagation())
      node.addEventListener('click', (e) => e.stopPropagation())
      return node
    }
    keepFocus(name)
    keepFocus(parentSelect)

    const row = el('div', {
      class: `layer-row ${selected ? 'active' : ''}`,
      style: { paddingLeft: `${6 + depth * 12}px` },
      onclick: () => { this.select(bone.id) },
    },
      el('i', {
        title: 'Couleur d\'influence sur la toile',
        style: {
          width: '10px', height: '10px', borderRadius: '3px', flex: 'none',
          background: boneColor(index), border: '1px solid #0006', display: 'block',
        },
      }),
      name,
      parentSelect,
      el('button', {
        class: 'mini',
        title: 'Passer devant les autres os',
        html: icon('chevron', 12),
        onclick: (e: MouseEvent) => {
          e.stopPropagation()
          this.ed.run('Ordre des os', () => { bone.z = Math.max(...rig.bones.map((b) => b.z)) + 1 })
          refreshPose(this.ed)
        },
      }),
      el('button', {
        class: 'mini',
        title: 'Supprimer l\'os',
        html: icon('trash', 12),
        onclick: (e: MouseEvent) => { e.stopPropagation(); void this.removeBone(bone) },
      }),
    )
    row.dataset.bone = String(bone.id)
    return row
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  /** Choix d'un squelette pret a l'emploi. */
  private templateMenu(anchor: HTMLElement): void {
    const ed = this.ed
    openMenu(anchor, [
      { title: 'Modeles' },
      ...RIG_TEMPLATES.map((template) => ({
        label: template.label,
        hint: template.hint,
        icon: 'rig',
        onClick: () => {
          const cel = ed.peekCel()
          ed.run(`Modele ${template.label}`, () => {
            applyTemplate(ed.sprite.rig, template, cel?.bitmap ?? null, ed.sprite)
          })
          rigState.selected = ed.sprite.rig.bones[0]?.id ?? null
          ed.setMode('rig')
          ed.updateSettings({ tool: 'rig-bone' })
          showToast(`${template.label} : ajustez les os puis liez les pixels`, 'success')
          this.render()
        },
      })),
    ], 'right')
  }

  /** Lie les pixels de la case active au squelette. */
  bind(): void {
    const cel = this.ed.peekCel()
    if (!cel) { showToast('Aucune case active', 'error'); return }
    if (cel.bitmap.isEmpty()) { showToast('Dessinez le personnage avant de lier', 'error'); return }
    this.ed.run('Lier au squelette', () => {
      resetPose(this.rig)
      autoBind(this.rig, cel.bitmap)
    })
    this.ed.updateSettings({ tool: 'rig-pose' })
    // Le dessin reprend sa place : la carte des os ne reste pas sur l'ecran.
    this.ed.showWeights = false
    showToast('Pixels lies : tirez le bout d\'un os pour poser', 'success')
    this.render()
  }

  private resetPose(): void {
    if (!this.rig.bones.length) return
    syncRestFromCanvas(this.ed)
    this.ed.run('Reinitialiser la pose', () => resetPose(this.rig))
    refreshPose(this.ed)
    this.render()
  }

  private async removeBone(bone: Bone): Promise<void> {
    const rig = this.rig
    const children = rig.bones.filter((b) => b.parent === bone.id)
    if (children.length && !(await confirmDialog(
      'Supprimer l\'os',
      `« ${bone.name} » porte ${children.length} os enfant(s), qui deviendront des racines. Continuer ?`,
      'Supprimer',
    ))) return
    this.ed.run('Supprimer un os', () => {
      const index = rig.bones.indexOf(bone)
      for (const child of rig.bones) if (child.parent === bone.id) child.parent = bone.parent
      rig.bones.splice(index, 1)
      // Les poids referencent les os par index : ils ne valent plus rien.
      rig.weights = null
      rig.rest = null
    })
    if (rigState.selected === bone.id) rigState.selected = null
    showToast('Os supprime — reliez les pixels', 'info')
    this.render()
  }

  /** Fige la pose courante dans une nouvelle frame. */
  private frameFromPose(): void {
    syncRestFromCanvas(this.ed)
    const posed = deform(this.rig, seamSettings(rigState.seam))
    if (!posed) { showToast('Liez d\'abord les pixels', 'error'); return }
    const ed = this.ed
    const at = ed.activeFrame + 1
    ed.run('Frame depuis la pose', () => {
      ed.sprite.duplicateFrame(ed.activeFrame, at)
      const cel = ed.sprite.layers[ed.activeLayer].cels[at]
      if (cel) cel.bitmap.copyFrom(posed)
    })
    ed.setActiveFrame(at)
    showToast('Frame creee', 'success')
  }

  /** Genere les frames entre la pose memorisee et la pose courante. */
  private tween(steps: number): void {
    syncRestFromCanvas(this.ed)
    const rig = this.rig
    if (!this.poseA) return
    const poseB = capturePose(rig)
    const ed = this.ed
    const from = ed.activeFrame

    ed.run('Frames intermediaires', () => {
      for (let i = 1; i <= steps; i++) {
        applyPose(rig, lerpPose(this.poseA!, poseB, i / steps))
        const posed = deform(rig, seamSettings(rigState.seam))
        if (!posed) continue
        const at = from + i
        ed.sprite.duplicateFrame(from, at)
        const cel = ed.sprite.layers[ed.activeLayer].cels[at]
        if (cel) cel.bitmap.copyFrom(posed)
      }
      applyPose(rig, poseB)
    })
    ed.setActiveFrame(from + steps)
    showToast(`${steps} frames generees`, 'success')
  }
}
