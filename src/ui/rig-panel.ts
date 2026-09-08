import type { Editor } from '../core/editor'
import {
  applyPose, autoBind, canParent, capturePose, deform, lerpPose, resetPose,
  type Bone, type Pose,
} from '../smart/rig'
import { rigState, refreshPose } from '../tools'
import { el, clear, iconButton, numberInput, segmented, slider } from './dom'
import { icon } from './icons'
import { confirmDialog, showToast } from './overlay'

/**
 * Panneau du squelette : construire les os, lier les pixels, poser le
 * dessin et fabriquer des frames a partir des poses.
 */
export class RigPanel {
  readonly content: HTMLElement
  readonly actions: HTMLElement[]
  private ed: Editor
  private body = el('div', { class: 'panel-body' })
  /** Pose de depart memorisee, pour generer les frames intermediaires. */
  private poseA: Pose | null = null

  constructor(editor: Editor) {
    this.ed = editor
    this.content = this.body
    this.actions = [
      iconButton(icon('refresh', 14), 'Reinitialiser la pose', () => this.resetPose(), { className: 'ghost sm icon-only' }),
    ]
    editor.events.on('doc', () => this.render())
    editor.events.on('settings', () => this.render())
    editor.events.on('reload', () => { this.poseA = null; this.render() })
    this.render()
  }

  private get rig() { return this.ed.sprite.rig }

  render(): void {
    clear(this.body)
    const rig = this.rig
    const bound = !!rig.rest && !!rig.weights

    this.body.appendChild(segmented([
      { value: 'edit', label: 'Construction', title: 'Creer et ajuster les os' },
      { value: 'pose', label: 'Pose', title: 'Tirer les extremites pour animer' },
    ], rigState.mode, (v) => {
      rigState.mode = v
      this.ed.updateSettings({ tool: 'rig' })
    }))

    if (!rig.bones.length) {
      this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '8px' } },
        'Choisissez l\'outil Squelette puis glissez sur la toile pour tracer un premier os. ',
        'Commencer un os sur le bout d\'un autre le rattache automatiquement.'))
      return
    }

    // --- liste des os ---
    const list = el('div', { style: { display: 'grid', gap: '2px', marginTop: '8px' } })
    for (const bone of [...rig.bones].sort((a, b) => a.z - b.z).reverse()) {
      list.appendChild(this.boneRow(bone))
    }
    this.body.appendChild(list)

    // --- liaison ---
    this.body.appendChild(el('div', { class: 'form-section' }, 'Liaison'))
    this.body.appendChild(el('button', {
      class: 'btn',
      style: { width: '100%' },
      html: icon('bone', 14),
      onclick: () => this.bind(),
    }, el('span', null, bound ? 'Relier les pixels au squelette' : 'Lier les pixels au squelette')))
    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '6px' } },
      bound
        ? 'Le dessin de reference est enregistre. Passez en mode Pose et tirez une extremite.'
        : 'A faire une fois le squelette en place : chaque pixel est attribue a l\'os le plus proche.'))

    if (!bound) return

    // --- reglages de deformation ---
    this.body.appendChild(el('div', { class: 'form-section' }, 'Rendu de la pose'))
    this.body.appendChild(el('div', { class: 'opt' },
      el('label', { style: { width: '74px' } }, 'Jointures'),
      slider(0, 3, rigState.seamRadius, 1, (v) => { rigState.seamRadius = v; refreshPose(this.ed) }, (v) => `${v} px`),
    ))
    this.body.appendChild(el('div', { class: 'opt' },
      el('label', { style: { width: '74px' } }, 'Comblement'),
      slider(0, 4, rigState.fillPasses, 1, (v) => { rigState.fillPasses = v; refreshPose(this.ed) }),
    ))

    // --- frames ---
    this.body.appendChild(el('div', { class: 'form-section' }, 'Frames'))
    this.body.appendChild(el('button', {
      class: 'btn',
      style: { width: '100%', marginBottom: '6px' },
      html: icon('plus', 14),
      onclick: () => this.frameFromPose(),
    }, el('span', null, 'Nouvelle frame depuis la pose')))

    const count = numberInput(4, () => {}, { min: 1, max: 32, width: '58px' })
    this.body.appendChild(el('div', { class: 'form-row', style: { marginBottom: '6px' } },
      el('button', {
        class: `btn sm ${this.poseA ? 'active' : ''}`,
        onclick: () => {
          this.poseA = capturePose(this.rig)
          showToast('Pose de depart memorisee', 'success')
          this.render()
        },
      }, this.poseA ? 'Pose A memorisee' : 'Memoriser la pose A'),
    ))
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

  private boneRow(bone: Bone): HTMLElement {
    const rig = this.rig
    const selected = rigState.selected === bone.id
    const parents = [
      { value: '', label: '— racine —' },
      ...rig.bones.filter((b) => b.id !== bone.id && canParent(rig, bone.id, b.id))
        .map((b) => ({ value: String(b.id), label: b.name })),
    ]

    const name = el('input', {
      value: bone.name,
      style: {
        flex: '1', minWidth: '0', height: '22px', fontSize: '12px',
        background: 'transparent', border: '1px solid transparent', color: 'var(--text)',
      },
      onchange: () => { bone.name = name.value.trim() || bone.name; this.ed.history.touch() },
    })

    const parentSelect = el('select', {
      style: { height: '22px', fontSize: '11px', maxWidth: '86px' },
      title: 'Os parent',
      onchange: () => {
        const value = parentSelect.value === '' ? null : Number(parentSelect.value)
        if (canParent(rig, bone.id, value)) {
          bone.parent = value
          this.ed.history.touch()
          this.ed.events.emit('doc', undefined)
        }
      },
    }, ...parents.map((o) => el('option', { value: o.value, selected: String(bone.parent ?? '') === o.value }, o.label)))

    return el('div', {
      class: `layer-row ${selected ? 'active' : ''}`,
      onclick: () => { rigState.selected = bone.id; this.render() },
    },
      el('span', { html: icon('bone', 13), style: { color: selected ? 'var(--accent-text)' : 'var(--text-faint)', display: 'flex' } }),
      name,
      parentSelect,
      el('button', {
        class: 'mini',
        title: 'Passer devant',
        html: icon('chevron', 12),
        onclick: (e: MouseEvent) => {
          e.stopPropagation()
          bone.z = Math.max(...rig.bones.map((b) => b.z)) + 1
          this.ed.events.emit('doc', undefined)
          refreshPose(this.ed)
        },
      }),
      el('button', {
        class: 'mini',
        title: 'Supprimer l\'os',
        html: icon('trash', 12),
        onclick: (e: MouseEvent) => { e.stopPropagation(); this.removeBone(bone) },
      }),
    )
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  private bind(): void {
    const cel = this.ed.peekCel()
    if (!cel) { showToast('Aucune case active', 'error'); return }
    if (cel.bitmap.isEmpty()) { showToast('Dessinez le personnage avant de lier', 'error'); return }
    this.ed.run('Lier au squelette', () => {
      resetPose(this.rig)
      autoBind(this.rig, cel.bitmap)
    })
    rigState.mode = 'pose'
    showToast('Pixels lies : passez en mode Pose', 'success')
    this.render()
  }

  private resetPose(): void {
    if (!this.rig.bones.length) return
    this.ed.runPixels('Reinitialiser la pose', [], () => resetPose(this.rig))
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
    showToast('Os supprime — relier les pixels', 'info')
    this.render()
  }

  /** Fige la pose courante dans une nouvelle frame. */
  private frameFromPose(): void {
    const posed = deform(this.rig, { seamRadius: rigState.seamRadius, fillPasses: rigState.fillPasses })
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
    const rig = this.rig
    if (!this.poseA) return
    const poseB = capturePose(rig)
    const ed = this.ed
    const from = ed.activeFrame

    ed.run('Frames intermediaires', () => {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        applyPose(rig, lerpPose(this.poseA!, poseB, t))
        const posed = deform(rig, { seamRadius: rigState.seamRadius, fillPasses: rigState.fillPasses })
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
