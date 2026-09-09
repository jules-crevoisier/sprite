import type { Editor } from '../core/editor'
import {
  applyPose, autoBind, boneColor, canParent, capturePose, isBound, lerpPose,
  partFor, resetPose, unbind, type Bone, type BoneRole, type Pose,
} from '../smart/rig'
import { RIG_TEMPLATES, applyTemplate } from '../smart/rig-presets'
import { ANIM_CLIPS, clipFits, clipPoses, clipTouches, type AnimClip } from '../smart/anim-clips'
import { EASINGS, ease } from '../smart/easing'
import { applyFollowThrough, hasSoftBones } from '../smart/follow-through'
import { rigState, refreshPose, syncRestFromCanvas, writePoseToFrame } from '../tools'
import { el, clear, checkbox, iconButton, numberInput, slider } from './dom'
import { genId } from '../core/document'
import { icon } from './icons'
import { fromHex } from '../core/color'
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
  /** Ajout automatique du retard des os souples. */
  private followThrough = true

  constructor(editor: Editor) {
    this.ed = editor
    this.content = this.body
    this.actions = [
      iconButton(icon('group', 14), 'Modèles de squelette',
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
      rig.bones.map((b) => `${b.id}/${b.name}/${b.parent ?? '-'}/${b.z}/${b.role}/${b.depth}/${b.softness}`).join(','),
      rig.parts.map((p) => p.layer).join('+') || 'libre',
      this.ed.activeLayer,
      // Le rattachement ne s'affiche que sur l'os choisi : la selection
      // change donc bien le HTML de la liste.
      rigState.selected,
      rigState.seam,
      this.ed.easing,
      this.followThrough ? 'suivi' : '-',
      this.poseA ? 'A' : '-',
    ].join('|')
  }

  /** Rebatit si ce qui est affiche a bouge, sinon ne touche a rien. */
  private sync(): void {
    if (this.signature() !== this.drawn) this.render()
  }

  render(): void {
    this.drawn = this.signature()
    clear(this.body)
    const rig = this.rig
    const bound = isBound(rig)

    if (!rig.bones.length) {
      this.body.append(
        el('button', {
          class: 'btn primary',
          style: { width: '100%' },
          html: icon('group', 14),
          onclick: (e: MouseEvent) => this.templateMenu(e.currentTarget as HTMLElement),
        }, el('span', null, 'Partir d\'un modèle')),
        el('p', { class: 'form-note', style: { marginTop: '8px' } },
          'Ou tracez vous-même : avec l\'outil Créer des os, glissez sur la toile. ',
          'Répartir du bout d\'un os l\'enchaine au précédent.'),
      )
      return
    }

    this.body.appendChild(this.hierarchy())
    // Cinq lignes affichant « torse » se lisent comme un bug ; c'est en fait
    // la hierarchie du modele. On l'ecrit une fois pour toutes.
    const racine = rig.bones.find((b) => b.parent === null)
    if (racine && rig.bones.length > 1) {
      this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '6px' } },
        `« ${racine.name} » est la racine : les os decales en dessous en dependent et `,
        'le suivent. Bouger la racine emmene tout le corps, bouger un bras ne bouge que lui. ',
        'Selectionnez un os pour changer son rattachement.'))
    }

    // --- liaison, un calque a la fois ---
    this.body.appendChild(el('div', { class: 'form-section' }, 'Calques reliés'))
    this.body.appendChild(this.layerBindings())
    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '6px' } },
      bound
        ? 'Les calques coches suivent le squelette : corps, arme et cape bougent ensemble. '
          + 'Vous pouvez repasser en mode Dessin, retoucher, et revenir sans relier a nouveau.'
        : 'Cochez les calques a articuler : chaque pixel rejoindra l\'os le plus proche.'))

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
        showToast('Pose de depart mémorisée', 'success')
        this.render()
      },
    }, this.poseA ? 'Pose de depart mémorisée' : 'Mémoriser la pose de depart'))
    this.body.appendChild(el('div', { class: 'form-row' },
      count,
      el('button', {
        class: 'btn sm',
        disabled: !this.poseA,
        onclick: () => this.tween(Math.max(1, Number(count.value))),
      }, 'Frames intermediaires'),
    ))

    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '6px' } },
      'Memorisez une pose, deplacez le squelette, puis generez les frames. ',
      'La courbe de vitesse, qui repartit les images entre les deux poses, se ',
      `réglé dans le panneau d'animation — actuellement « ${EASINGS.find((e) => e.id === this.ed.easing)?.label}Â ».`))

    this.animationSection()
    this.followSection()
    this.turnSection()
  }

  /* ---------------------------------------------------------------- */
  /* Animations preenregistrees                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Cycles tout faits. Ils s'appliquent par le role des os, pas par leur nom :
   * un squelette d'oiseau recoit le vol, un humanoide la marche.
   */
  private animationSection(): void {
    const rig = this.rig
    this.body.appendChild(el('div', { class: 'form-section' }, 'Animations toutes faites'))

    const grid = el('div', { style: { display: 'grid', gap: '3px' } })
    for (const clip of ANIM_CLIPS) {
      const possible = clipFits(clip, rig)
      const touches = clipTouches(clip, rig)
      grid.appendChild(el('button', {
        class: 'layer-row',
        disabled: !possible || !touches.length,
        title: possible
          ? `${clip.hint}\n${clip.frames} frames a ${clip.ms} ms — bouge : ${touches.join(', ') || 'rien'}`
          : `Ce cycle demande des os marques ${clip.needs.join(', ')}`,
        style: { opacity: possible && touches.length ? '1' : '.4' },
        onclick: () => this.generateClip(clip),
      },
        el('span', { html: icon('film', 12), style: { color: 'var(--accent)', display: 'flex', flex: 'none' } }),
        el('span', { class: 'lname' }, clip.label),
        el('span', { style: { fontSize: '10.5px', color: 'var(--text-faint)', flex: 'none' } },
          `${clip.frames}f`),
      ))
    }
    this.body.appendChild(grid)
    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '6px' } },
      'Chaque cycle cherche les os par leur role — torse, tête, bras, jambes, ailes — ',
      'et produit ses frames avec un tag. Servez-vous-en comme base : la pose de ',
      'chaque frame reste modifiable.'))
  }

  /* ---------------------------------------------------------------- */
  /* Suivi et inertie                                                  */
  /* ---------------------------------------------------------------- */

  /** Reglage des os qui trainent derriere le corps. */
  private followSection(): void {
    const rig = this.rig
    this.body.appendChild(el('div', { class: 'form-section' }, 'Suivi et inertie'))
    const souples = rig.bones.filter((b) => b.softness > 0)
    this.body.appendChild(el('div', { class: 'opt' },
      checkbox('Faire trainer les os souples', this.followThrough, (v) => {
        this.followThrough = v
        this.render()
      }),
    ))
    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '4px' } },
      souples.length
        ? `${souples.map((b) => b.name).join(', ')} : ces os gardent leur orientation `
          + 'quand le corps tourne, depassent a l\'arret, puis se stabilisent. '
          + 'Reglez la souplesse sur l\'os choisi.'
        : 'Aucun os souple. Choisissez un os et montez sa souplesse : une cape, '
          + 'une queue ou une meche ne suivent pas le corps a l\'image près.'))
  }

  /** Ajoute le retard des os souples, si le reglage le demande. */
  private withFollow(poses: Pose[], loop: boolean): Pose[] {
    if (!this.followThrough || !hasSoftBones(this.rig)) return poses
    return applyFollowThrough(this.rig, poses, loop)
  }

  /** Deroule un cycle en frames, a la suite de la frame courante. */
  private generateClip(clip: AnimClip): void {
    syncRestFromCanvas(this.ed)
    const ed = this.ed
    const rig = this.rig
    const base = capturePose(rig)
    const poses = this.withFollow(clipPoses(rig, clip, clip.frames, base), clip.loop)
    const from = ed.activeFrame

    ed.run(`Animation « ${clip.label} »`, () => {
      poses.forEach((pose, i) => {
        // La premiere pose remplace la frame courante, les suivantes en
        // ajoutent : le cycle demarre donc la ou l'on se trouve.
        const at = from + i
        if (i > 0) ed.sprite.duplicateFrame(from, at)
        applyPose(rig, pose)
        writePoseToFrame(ed, at)
        ed.sprite.frameDurations[at] = clip.ms
      })
      applyPose(rig, base)
      ed.sprite.tags.push({
        id: genId(),
        name: clip.label.toLowerCase(),
        from, to: from + poses.length - 1,
        direction: 'forward',
        repeat: 0,
        color: fromHex('#6c8cff'),
      })
    })
    refreshPose(ed)
    ed.setActiveFrame(from)
    showToast(`« ${clip.label} » : ${poses.length} frames et un tag`, 'success')
  }

  /* ---------------------------------------------------------------- */
  /* Demi-tour pseudo-3D                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Fait pivoter le personnage sur lui-meme. Le dessin n'a pas de profondeur :
   * on l'écrase horizontalement et on fait passer les membres d'un cote a
   * l'autre selon la profondeur de leur os. C'est une base a retoucher, pas
   * un profil fini.
   */
  private turnSection(): void {
    const ed = this.ed
    const rig = this.rig
    this.body.appendChild(el('div', { class: 'form-section' }, 'Demi-tour (pseudo-3D)'))

    const degres = Math.round(((rig.turn?.angle ?? 0) * 180) / Math.PI)
    this.body.appendChild(el('div', { class: 'opt' },
      el('label', { style: { width: '58px' } }, 'Angle'),
      slider(-90, 90, degres, 5, (v) => {
        rig.turn = v === 0 ? null : { angle: (v * Math.PI) / 180, axis: this.turnAxis() }
        refreshPose(ed)
        ed.events.emit('settings', undefined)
      }, (v) => `${v}°`),
    ))

    const count = numberInput(8, () => {}, { min: 2, max: 24, width: '58px' })
    this.body.appendChild(el('div', { class: 'form-row', style: { marginTop: '4px' } },
      count,
      el('button', {
        class: 'btn sm',
        onclick: () => this.generateTurn(Math.max(2, Number(count.value))),
      }, 'Tour complet'),
    ))
    this.body.appendChild(el('p', { class: 'form-note', style: { marginTop: '6px' } },
      'Reglez la profondeur de chaque os (le champ « Devant / derrière » ',
      'apparait sur l\'os choisi) : c\'est elle qui fait passer un bras derrière ',
      'le corps. Le résultat est une base a reprendre, le dessin n\'ayant pas ',
      'de vraie épaisseur.'))
  }

  /** Axe de rotation : le milieu du squelette. */
  private turnAxis(): number {
    const bones = this.rig.bones
    if (!bones.length) return this.ed.sprite.width / 2
    let min = Infinity, max = -Infinity
    for (const b of bones) {
      min = Math.min(min, b.x, b.ex)
      max = Math.max(max, b.x, b.ex)
    }
    return (min + max) / 2
  }

  /** Genere un tour complet en frames, de face a face. */
  private generateTurn(steps: number): void {
    syncRestFromCanvas(this.ed)
    const ed = this.ed
    const rig = this.rig
    const axis = this.turnAxis()
    const from = ed.activeFrame
    const avant = rig.turn

    ed.run('Tour sur soi-même', () => {
      for (let i = 0; i < steps; i++) {
        const at = from + i
        if (i > 0) ed.sprite.duplicateFrame(from, at)
        const angle = (i / steps) * Math.PI * 2
        // Au-dela d'un quart de tour on repart de l'autre cote : le dessin
        // n'a pas de dos, on montre donc son miroir plutot qu'un vide.
        rig.turn = i === 0 ? null : { angle, axis }
        writePoseToFrame(ed, at)
        ed.sprite.frameDurations[at] = 100
      }
      ed.sprite.tags.push({
        id: genId(),
        name: 'tour',
        from, to: from + steps - 1,
        direction: 'forward',
        repeat: 0,
        color: fromHex('#a06cff'),
      })
    })
    rig.turn = avant
    refreshPose(ed)
    ed.setActiveFrame(from)
    showToast(`Tour en ${steps} frames — a retoucher`, 'success')
  }

  /**
   * Change l'os selectionne sans reconstruire la liste : reconstruire
   * arracherait le champ que l'on vient de toucher.
   */
  private select(id: number, focus?: 'name'): void {
    if (rigState.selected === id) return
    rigState.selected = id
    // Le rattachement ne s'affiche que sur l'os choisi : la ligne change,
    // il faut donc rebatir. On rend alors le curseur au champ d'ou venait
    // le clic, sinon renommer un os demanderait deux clics.
    this.render()
    if (focus === 'name') {
      const row = this.body.querySelector<HTMLElement>(`[data-bone="${id}"]`)
      row?.querySelector('input')?.focus()
    }
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
    const parentName = rig.bones.find((b) => b.id === bone.parent)?.name ?? 'racine'

    const name = el('input', {
      value: bone.name,
      style: {
        flex: '1', minWidth: '0', height: '22px', fontSize: '12px',
        background: 'transparent', border: '1px solid transparent', color: 'var(--text)',
      },
      onchange: () => { bone.name = name.value.trim() || bone.name; this.ed.history.touch() },
      // Le champ arrete le clic pour ne pas etre detruit : il selectionne
      // donc l'os lui-meme quand on vient y ecrire.
      onfocus: () => this.select(bone.id, 'name'),
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
          showToast('Un os ne peut pas descendre de lui-même', 'error')
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
      class: `layer-row bone-row ${selected ? 'active' : ''}`,
      style: { paddingLeft: `${6 + depth * 13}px` },
      onclick: () => { this.select(bone.id) },
    },
      // Un trait d'arborescence dit « cet os depend de celui du dessus »
      // sans qu'il faille lire six fois le meme nom de parent.
      depth > 0
        ? el('i', { class: 'bone-branch', title: `Depend de « ${parentName} »` })
        : el('i', { class: 'bone-branch is-root', title: 'Racine du squelette' }),
      el('i', {
        title: 'Couleur d\'influence sur la toile',
        style: {
          width: '10px', height: '10px', borderRadius: '3px', flex: 'none',
          background: boneColor(index), border: '1px solid #0006', display: 'block',
        },
      }),
      name,
      // Le rattachement ne s'affiche que sur l'os selectionne : sinon la liste
      // n'est qu'une colonne de menus identiques.
      ...(selected ? [el('label', { class: 'bone-parent' }, 'suit', parentSelect)] : []),
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
    if (!selected) return row

    // Reglages de l'os choisi : sa fonction dans le corps, qui commande les
    // animations toutes faites, et sa profondeur, qui commande le demi-tour.
    const wrap = el('div', { style: { display: 'grid', gap: '2px' } }, row)
    wrap.appendChild(el('div', {
      class: 'bone-extra',
      style: { paddingLeft: `${19 + depth * 13}px` },
    },
      el('label', null, 'role', this.roleSelect(bone)),
      el('label', { title: 'Positif : devant le corps. Negatif : derrière. Sert au demi-tour.' },
        'devant', numberInput(Math.round(bone.depth), (v) => {
          this.ed.run('Profondeur d\'un os', () => { bone.depth = v })
          refreshPose(this.ed)
        }, { min: -64, max: 64, width: '46px' })),
      el('label', {
        title: 'Souplesse : au-dessus de zero, l\'os traine derrière le corps, '
          + 'dépasse a l\'arret puis se stabilise. Pour une cape, une queue, une meche.',
      }, 'souple', numberInput(Math.round(bone.softness * 100), (v) => {
        this.ed.run('Souplesse d\'un os', () => { bone.softness = Math.max(0, Math.min(100, v)) / 100 })
        this.render()
      }, { min: 0, max: 100, width: '46px' })),
    ))
    wrap.dataset.bone = String(bone.id)
    return wrap
  }

  /** Fonction de l'os dans le corps : c'est la cle des cycles tout faits. */
  private roleSelect(bone: Bone): HTMLElement {
    const roles: { value: BoneRole; label: string }[] = [
      { value: 'none', label: '—' },
      { value: 'torso', label: 'torse' },
      { value: 'head', label: 'tete' },
      { value: 'armL', label: 'bras G' },
      { value: 'armR', label: 'bras D' },
      { value: 'legL', label: 'jambe G' },
      { value: 'legR', label: 'jambe D' },
      { value: 'wingL', label: 'aile G' },
      { value: 'wingR', label: 'aile D' },
      { value: 'tail', label: 'queue' },
    ]
    const select = el('select', {
      style: { height: '20px', fontSize: '11px', width: '78px' },
      onchange: () => {
        this.ed.run('Role d\'un os', () => { bone.role = select.value as BoneRole })
        this.render()
      },
    }, ...roles.map((r) => el('option', { value: r.value, selected: bone.role === r.value }, r.label)))
    select.addEventListener('mousedown', (e) => e.stopPropagation())
    select.addEventListener('click', (e) => e.stopPropagation())
    return select
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  /** Choix d'un squelette pret a l'emploi. */
  private templateMenu(anchor: HTMLElement): void {
    const ed = this.ed
    openMenu(anchor, [
      { title: 'Modèles' },
      ...RIG_TEMPLATES.map((template) => ({
        label: template.label,
        hint: template.hint,
        icon: 'rig',
        onClick: () => {
          const cel = ed.peekCel()
          ed.run(`Modèle ${template.label}`, () => {
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

  /**
   * Un interrupteur par calque : cocher relie ses pixels au squelette, tous
   * les calques coches se deforment ensemble. C'est ce qui permet d'animer un
   * personnage reparti sur plusieurs calques, arme et cape comprises.
   */
  private layerBindings(): HTMLElement {
    const ed = this.ed
    const list = el('div', { style: { display: 'grid', gap: '2px' } })
    for (let i = ed.sprite.layers.length - 1; i >= 0; i--) {
      const layer = ed.sprite.layers[i]
      const lie = !!partFor(this.rig, layer.id)
      const cel = ed.sprite.cel(i, ed.activeFrame)
      const vide = !cel || cel.bitmap.isEmpty()
      list.appendChild(el('div', {
        class: `layer-row ${i === ed.activeLayer ? 'active' : ''}`,
        onclick: () => this.toggleLayer(i),
      },
        el('span', {
          html: icon(lie ? 'bone' : 'close', 12),
          style: { color: lie ? 'var(--ok)' : 'var(--text-faint)', display: 'flex', flex: 'none' },
        }),
        el('span', { class: 'lname' }, layer.name),
        el('span', {
          style: { fontSize: '10.5px', color: 'var(--text-faint)', flex: 'none' },
        }, lie ? 'relie' : vide ? 'vide' : 'libre'),
      ))
    }
    return list
  }

  /** Relie ou detache un calque. */
  private toggleLayer(index: number): void {
    const ed = this.ed
    const layer = ed.sprite.layers[index]
    if (!layer) return
    if (partFor(this.rig, layer.id)) {
      ed.run('Detacher un calque', () => {
        this.rig.parts = this.rig.parts.filter((p) => p.layer !== layer.id)
      })
      showToast(`« ${layer.name} » ne suit plus le squelette`, 'info')
      this.render()
      return
    }
    const cel = ed.sprite.cel(index, ed.activeFrame)
    if (!cel || cel.bitmap.isEmpty()) {
      showToast(`« ${layer.name} » est vide sur cette frame`, 'error')
      return
    }
    ed.run('Lier un calque', () => {
      // Relier alors qu'une pose est en cours figerait cette pose comme
      // repos : on repart donc du dessin au repos.
      resetPose(this.rig)
      autoBind(this.rig, layer.id, cel.bitmap)
    })
    ed.updateSettings({ tool: 'rig-pose' })
    // Le dessin reprend sa place : la carte des os ne reste pas sur l'ecran.
    ed.showWeights = false
    showToast(`« ${layer.name} » relié — tirez le bout d\'un os`, 'success')
    this.render()
  }

  /** Relie le calque actif : point d'entree du tutoriel et des tests. */
  bind(): void { this.toggleLayer(this.ed.activeLayer) }

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
      unbind(rig)
    })
    if (rigState.selected === bone.id) rigState.selected = null
    showToast('Os supprime — reliez les pixels', 'info')
    this.render()
  }

  /** Fige la pose courante dans une nouvelle frame, tous calques relies. */
  private frameFromPose(): void {
    syncRestFromCanvas(this.ed)
    if (!isBound(this.rig)) { showToast('Liez d\'abord un calque', 'error'); return }
    const ed = this.ed
    const at = ed.activeFrame + 1
    ed.run('Frame depuis la pose', () => {
      ed.sprite.duplicateFrame(ed.activeFrame, at)
      writePoseToFrame(ed, at)
    })
    ed.setActiveFrame(at)
    showToast('Frame créée', 'success')
  }

  /** Genere les frames entre la pose memorisee et la pose courante. */
  private tween(steps: number): void {
    syncRestFromCanvas(this.ed)
    const rig = this.rig
    if (!this.poseA) return
    const poseB = capturePose(rig)
    const ed = this.ed
    const from = ed.activeFrame

    // La courbe de vitesse redistribue les images entre les deux poses : le
    // depart et l'arrivee ne bougent pas, seule la manière d'aller de l'une a
    // l'autre change.
    const suite = this.withFollow(
      Array.from({ length: steps }, (_, i) => lerpPose(this.poseA!, poseB, ease(this.ed.easing, (i + 1) / steps))),
      false,
    )
    ed.run('Frames intermediaires', () => {
      suite.forEach((pose, i) => {
        applyPose(rig, pose)
        const at = from + i + 1
        ed.sprite.duplicateFrame(from, at)
        writePoseToFrame(ed, at)
      })
      applyPose(rig, poseB)
    })
    ed.setActiveFrame(from + steps)
    showToast(`${steps} frames générées`, 'success')
  }
}
