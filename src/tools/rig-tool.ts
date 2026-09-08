import type { Cel } from '../core/document'
import type { Editor } from '../core/editor'
import { snapshotStructure, restoreStructure } from '../core/history'
import {
  applyX, applyY, bakePose, boneAngle, boneColor, createBone, deform, invert,
  partFor, touchPart, unbind, worldTransforms, type Bone, type Mat, type RigPart,
} from '../smart/rig'
import type { Bitmap } from '../core/bitmap'
import { ICONS } from '../ui/icons'
import { brushOffsets } from './algorithms'
import type { OverlayContext, PointerInfo, Tool } from './types'

export const rigState = {
  /** Os selectionne, par identifiant. */
  selected: null as number | null,
  /**
   * Recollement des jointures, de 0 (aucun) a 3 (genereux). Un seul reglage
   * pilote la recherche et son exigence : plus il monte, plus les fissures
   * se referment, mais plus la silhouette s'epaissit.
   */
  seam: 2,
  /** Taille du pinceau de ponderation. */
  weightBrush: 4,
}

/**
 * Finesse de rotation selon le moment.
 *
 * Tirer un os demande une reponse immediate : une mesure par pixel suffit a
 * juger la pose. Une frame produite, elle, sera regardee de pres : on paie
 * alors les 64 mesures par pixel de la methode RotSprite, qui redresse les
 * contours obliques.
 */
export const DRAG_QUALITY = 1 as const
export const FRAME_QUALITY = 8 as const

/** Traduit le reglage unique en parametres de deformation. */
export const seamSettings = (level: number): { seamRadius: number; seamNeighbours: number; fillPasses: number } => {
  switch (Math.max(0, Math.min(3, Math.round(level)))) {
    case 0: return { seamRadius: 0, seamNeighbours: 8, fillPasses: 0 }
    case 1: return { seamRadius: 1, seamNeighbours: 5, fillPasses: 1 }
    case 3: return { seamRadius: 2, seamNeighbours: 3, fillPasses: 3 }
    // Deux passes de comblement : la premiere referme le gros de la fissure,
    // la seconde son dernier pixel, la ou trois parties se rejoignent —
    // epaule et hanche en particulier.
    default: return { seamRadius: 1, seamNeighbours: 4, fillPasses: 2 }
  }
}

const HIT = 3
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by)

/* ------------------------------------------------------------------ */
/* Va-et-vient entre le dessin pose et le dessin de repos              */
/* ------------------------------------------------------------------ */

/**
 * Dernier rendu de pose ecrit sur la toile, avec de quoi le relire :
 * la case visee, le dessin de repos d'alors, la signature de la pose et
 * l'origine de chaque pixel. C'est ce qui permet de repasser en mode Dessin,
 * retoucher, puis revenir sans avoir a relier les pixels.
 */
interface Baked {
  cel: Cel
  part: RigPart
  rest: Bitmap
  pixels: Uint32Array
  sources: Int32Array
  owners: Uint8Array
}

/** Un rendu memorise par calque relie, plus la pose commune a tous. */
let baked: Baked[] = []
let bakedPose = ''

/** Signature de la pose : deux rendus ne sont comparables qu'a pose egale. */
const poseSignature = (ed: Editor): string =>
  ed.sprite.rig.bones.map((b) => `${b.id}:${b.angle.toFixed(5)}:${b.tx}:${b.ty}:${b.scale}`).join('|')

/** Oublie le rendu memorise : le document a change sous nos pieds. */
export function invalidateBake(): void { baked = []; bakedPose = '' }

/**
 * Reporte vers le dessin de repos les retouches faites sur la toile depuis
 * le dernier rendu de pose. Sans effet si la toile n'a pas bouge, si la case
 * ou le repos ont change, ou si la pose n'est plus celle du rendu : dans ces
 * cas la toile n'est pas comparable et on ne toucherait pas au bon pixel.
 */
export function syncRestFromCanvas(ed: Editor): boolean {
  if (!baked.length) return false
  const rig = ed.sprite.rig
  // La pose doit etre celle du rendu : sinon la toile qu'on lit vient d'une
  // autre pose et l'on reporterait la retouche sur le mauvais pixel.
  if (poseSignature(ed) !== bakedPose) { invalidateBake(); return false }

  const annuler: (() => void)[] = []
  const refaire: (() => void)[] = []

  for (const snap of baked) {
    // Le morceau doit toujours exister et porter le meme repos.
    if (!rig.parts.includes(snap.part) || snap.part.rest !== snap.rest) continue
    const cel = snap.cel
    if (cel.bitmap.u32.length !== snap.pixels.length) continue

    let retouche = false
    for (let i = 0; i < snap.pixels.length; i++) {
      if (cel.bitmap.u32[i] !== snap.pixels[i]) { retouche = true; break }
    }
    if (!retouche) continue

    const rest = snap.part.rest
    const weights = snap.part.weights
    const posed = { u32: snap.pixels, width: rest.width, height: rest.height } as Bitmap
    const restAvant = new Uint32Array(rest.u32)
    const poidsAvant = new Uint8Array(weights)
    const bilan = bakePose(rig, snap.part, posed, snap.sources, snap.owners, cel.bitmap)
    if (bilan.changed + bilan.adopted === 0) continue

    const restApres = new Uint32Array(rest.u32)
    const poidsApres = new Uint8Array(weights)
    annuler.push(() => { rest.u32.set(restAvant); weights.set(poidsAvant); touchPart(snap.part) })
    refaire.push(() => { rest.u32.set(restApres); weights.set(poidsApres); touchPart(snap.part) })
  }

  invalidateBake()
  if (!annuler.length) return false

  // La retouche entre dans l'historique : annuler le trait doit aussi
  // annuler son report vers le repos.
  ed.pushCommand({
    label: 'Retouche reprise dans le squelette',
    undo: () => { for (const f of annuler) f() },
    redo: () => { for (const f of refaire) f() },
  })
  return true
}

/**
 * Recalcule le dessin pose de chaque calque relie et l'ecrit dans sa case a
 * la frame courante. Le corps, l'arme et la cape suivent donc les memes os
 * en un seul geste.
 */
export function refreshPose(ed: Editor, quality: 1 | 2 | 4 | 8 = FRAME_QUALITY): void {
  const rig = ed.sprite.rig
  if (!rig.parts.length) return
  const rendus: Baked[] = []

  for (const part of rig.parts) {
    const index = ed.sprite.layers.findIndex((l) => l.id === part.layer)
    if (index < 0) continue
    const layer = ed.sprite.layers[index]
    if (layer.locked) continue
    const cel = ed.sprite.ensureCel(index, ed.activeFrame)
    const size = part.rest.width * part.rest.height
    const sources = new Int32Array(size)
    const owners = new Uint8Array(size).fill(255)
    const posed = deform(rig, part, { ...seamSettings(rigState.seam), sources, owners, quality })
    if (!posed) continue
    cel.bitmap.copyFrom(posed)
    rendus.push({ cel, part, rest: part.rest, pixels: new Uint32Array(posed.u32), sources, owners })
  }

  baked = rendus
  bakedPose = poseSignature(ed)
  ed.events.emit('doc', undefined)
}

/**
 * Ecrit la pose courante dans une frame donnee, pour chaque calque relie.
 * Retourne le nombre de calques effectivement dessines.
 */
export function writePoseToFrame(ed: Editor, frame: number): number {
  const rig = ed.sprite.rig
  let ecrits = 0
  for (const part of rig.parts) {
    const index = ed.sprite.layers.findIndex((l) => l.id === part.layer)
    if (index < 0) continue
    const posed = deform(rig, part, { ...seamSettings(rigState.seam), quality: FRAME_QUALITY })
    if (!posed) continue
    ed.sprite.ensureCel(index, frame).bitmap.copyFrom(posed)
    ecrits++
  }
  return ecrits
}

/** Liaison du calque actif, celui que les outils de squelette modifient. */
export function activePart(ed: Editor): RigPart | null {
  const layer = ed.sprite.layers[ed.activeLayer]
  return layer ? partFor(ed.sprite.rig, layer.id) : null
}

/** Transformation du parent d'un os, ou l'identite pour une racine. */
function parentWorld(ed: Editor, bone: Bone): Mat {
  if (bone.parent === null) return [1, 0, 0, 1, 0, 0]
  return worldTransforms(ed.sprite.rig).get(bone.parent) ?? [1, 0, 0, 1, 0, 0]
}

/** Extremites d'un os dans la pose courante, en pixels sprite. */
export function bonePoints(ed: Editor, bone: Bone): { x1: number; y1: number; x2: number; y2: number } {
  const world = worldTransforms(ed.sprite.rig).get(bone.id) ?? [1, 0, 0, 1, 0, 0]
  return {
    x1: applyX(world, bone.x, bone.y),
    y1: applyY(world, bone.x, bone.y),
    x2: applyX(world, bone.ex, bone.ey),
    y2: applyY(world, bone.ex, bone.ey),
  }
}

function pickJoint(ed: Editor, x: number, y: number): { bone: Bone; end: 'root' | 'tip' } | null {
  for (const bone of [...ed.sprite.rig.bones].reverse()) {
    const p = bonePoints(ed, bone)
    if (dist(x, y, p.x2, p.y2) <= HIT) return { bone, end: 'tip' }
    if (dist(x, y, p.x1, p.y1) <= HIT) return { bone, end: 'root' }
  }
  return null
}

function pickBone(ed: Editor, x: number, y: number): Bone | null {
  let best: Bone | null = null
  let bestD = HIT
  for (const bone of ed.sprite.rig.bones) {
    const p = bonePoints(ed, bone)
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1
    const len2 = dx * dx + dy * dy
    let t = len2 < 1e-6 ? 0 : ((x - p.x1) * dx + (y - p.y1) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const d = dist(x, y, p.x1 + t * dx, p.y1 + t * dy)
    if (d < bestD) { bestD = d; best = bone }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* Dessin commun du squelette                                          */
/* ------------------------------------------------------------------ */

function drawSkeleton(ed: Editor, o: OverlayContext, extra?: { x1: number; y1: number; x2: number; y2: number }): void {
  const { ctx, zoom } = o
  const unit = 1 / zoom
  ctx.save()

  if (extra) {
    ctx.strokeStyle = '#ffb454'
    ctx.lineWidth = 2 * unit
    ctx.setLineDash([3 * unit, 2 * unit])
    ctx.beginPath()
    ctx.moveTo(extra.x1, extra.y1)
    ctx.lineTo(extra.x2, extra.y2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Chaque os porte sa couleur : la meme que sa pastille dans la liste et que
  // la carte d'influence, pour lire d'un coup d'oeil qui commande quoi.
  const bones = [...ed.sprite.rig.bones]
    .map((bone, index) => ({ bone, index }))
    .sort((a, b) => a.bone.z - b.bone.z)

  for (const { bone, index } of bones) {
    const pt = bonePoints(ed, bone)
    const selected = bone.id === rigState.selected
    const color = boneColor(index)

    const dx = pt.x2 - pt.x1, dy = pt.y2 - pt.y1
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len
    const width = Math.max(1.2, Math.min(3, len * 0.16))

    const shape = () => {
      ctx.beginPath()
      ctx.moveTo(pt.x1, pt.y1)
      ctx.lineTo(pt.x1 + dx * 0.25 + nx * width, pt.y1 + dy * 0.25 + ny * width)
      ctx.lineTo(pt.x2, pt.y2)
      ctx.lineTo(pt.x1 + dx * 0.25 - nx * width, pt.y1 + dy * 0.25 - ny * width)
      ctx.closePath()
    }

    // Liseré sombre sous l'os : la couleur reste lisible sur un dessin clair.
    shape()
    ctx.strokeStyle = '#0d0f14cc'
    ctx.lineWidth = (selected ? 3.4 : 2.6) * unit
    ctx.lineJoin = 'round'
    ctx.stroke()

    shape()
    ctx.fillStyle = `${color}${selected ? '99' : '55'}`
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = (selected ? 1.8 : 1.1) * unit
    ctx.stroke()

    // Racine : anneau creux. Bout : disque plein, la poignee qui fait pivoter.
    ctx.beginPath()
    ctx.arc(pt.x1, pt.y1, 2 * unit + 0.6, 0, Math.PI * 2)
    ctx.fillStyle = '#0d0f14ee'
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.4 * unit
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(pt.x2, pt.y2, 1.9 * unit + 0.5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = '#0d0f14ee'
    ctx.lineWidth = 1 * unit
    ctx.stroke()

    if (selected) {
      ctx.beginPath()
      ctx.arc(pt.x2, pt.y2, 3.6 * unit + 0.8, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffffffcc'
      ctx.lineWidth = 1.2 * unit
      ctx.stroke()
    }
  }
  ctx.restore()
}

function highlightJoint(ed: Editor, o: OverlayContext, p: PointerInfo | null): void {
  if (!p) return
  const joint = pickJoint(ed, p.x, p.y)
  if (!joint) return
  const pt = bonePoints(ed, joint.bone)
  const jx = joint.end === 'tip' ? pt.x2 : pt.x1
  const jy = joint.end === 'tip' ? pt.y2 : pt.y1
  o.ctx.save()
  o.ctx.beginPath()
  o.ctx.arc(jx, jy, 3.4 / o.zoom + 0.8, 0, Math.PI * 2)
  o.ctx.strokeStyle = '#fff'
  o.ctx.lineWidth = 1.4 / o.zoom
  o.ctx.stroke()
  o.ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Outil : construire le squelette                                     */
/* ------------------------------------------------------------------ */

type BoneDrag =
  | { kind: 'create'; x: number; y: number; parent: number | null }
  | { kind: 'joint'; bone: Bone; end: 'root' | 'tip' }
  | null

let boneDrag: BoneDrag = null
let structureBefore: ReturnType<typeof snapshotStructure> | null = null

export const rigBoneTool: Tool = {
  id: 'rig-bone',
  name: 'Creer des os',
  shortcut: 'K',
  icon: ICONS.bone,
  group: 'rig',
  hint: 'Glisser pour poser un os. Repartir du bout d\'un os l\'enchaine. Alt : deplacer une extremite.',
  options: [],
  cursor: 'crosshair',

  down(ed, p) {
    syncRestFromCanvas(ed)
    structureBefore = snapshotStructure(ed.sprite)
    const joint = pickJoint(ed, p.x, p.y)
    if (joint && p.alt) {
      rigState.selected = joint.bone.id
      boneDrag = { kind: 'joint', bone: joint.bone, end: joint.end }
      return
    }
    if (joint && joint.end === 'tip') {
      const pt = bonePoints(ed, joint.bone)
      boneDrag = { kind: 'create', x: pt.x2, y: pt.y2, parent: joint.bone.id }
      return
    }
    boneDrag = { kind: 'create', x: p.x, y: p.y, parent: null }
  },

  move(ed, p) {
    if (boneDrag?.kind !== 'joint') return
    if (boneDrag.end === 'tip') { boneDrag.bone.ex = p.x; boneDrag.bone.ey = p.y }
    else { boneDrag.bone.x = p.x; boneDrag.bone.y = p.y }
    ed.events.emit('settings', undefined)
  },

  up(ed, p) {
    const drag = boneDrag
    boneDrag = null
    if (!drag || !structureBefore) return
    if (drag.kind === 'create') {
      if (dist(drag.x, drag.y, p.x, p.y) < 2) {
        // Un simple clic selectionne l'os survole plutot que d'en creer un.
        const bone = pickBone(ed, p.x, p.y)
        if (bone) rigState.selected = bone.id
        structureBefore = null
        ed.events.emit('settings', undefined)
        return
      }
      const bone = createBone(ed.sprite.rig, drag.x, drag.y, p.x, p.y, drag.parent)
      rigState.selected = bone.id
      // Les poids referencent les os par index : une nouvelle liaison s'impose.
      unbind(ed.sprite.rig)
    }
    pushRigCommand(ed, drag.kind === 'create' ? 'Nouvel os' : 'Deplacer un os')
    ed.events.emit('doc', undefined)
  },

  cancel(ed) {
    if (structureBefore) restoreStructure(ed.sprite, structureBefore)
    structureBefore = null
    boneDrag = null
  },

  overlay(ed, o, p) {
    drawSkeleton(ed, o, boneDrag?.kind === 'create' && p
      ? { x1: boneDrag.x, y1: boneDrag.y, x2: p.x, y2: p.y }
      : undefined)
    if (!boneDrag) highlightJoint(ed, o, p)
  },
}

/** Empile la modification du squelette pour qu'elle soit annulable. */
function pushRigCommand(ed: Editor, label: string): void {
  const before = structureBefore
  structureBefore = null
  if (!before) return
  const after = snapshotStructure(ed.sprite)
  ed.pushCommand({
    label,
    undo: () => { restoreStructure(ed.sprite, before); ed.events.emit('cursor', undefined) },
    redo: () => { restoreStructure(ed.sprite, after); ed.events.emit('cursor', undefined) },
  })
}

/* ------------------------------------------------------------------ */
/* Outil : poser                                                       */
/* ------------------------------------------------------------------ */

type PoseDrag =
  | { kind: 'rotate'; bone: Bone; parentInv: Mat }
  | { kind: 'translate'; bone: Bone; parentInv: Mat; startX: number; startY: number; baseTx: number; baseTy: number }
  | null

let poseDrag: PoseDrag = null

export const rigPoseTool: Tool = {
  id: 'rig-pose',
  name: 'Poser',
  shortcut: 'J',
  icon: ICONS.rig,
  group: 'rig',
  hint: 'Tirer le bout d\'un os le fait pivoter, sa racine le deplace. Les os enfants suivent.',
  options: [],
  cursor: 'grab',

  down(ed, p) {
    // Une retouche faite en mode Dessin rejoint le repos avant qu'on bouge :
    // la nouvelle pose part donc du dessin tel qu'il vient d'etre corrige.
    if (syncRestFromCanvas(ed)) ed.toast('Retouches reprises dans le squelette', 'info')
    const joint = pickJoint(ed, p.x, p.y)
    if (!joint) {
      const bone = pickBone(ed, p.x, p.y)
      if (bone) { rigState.selected = bone.id; ed.events.emit('settings', undefined) }
      return
    }
    rigState.selected = joint.bone.id
    const inv = invert(parentWorld(ed, joint.bone))
    poseDrag = joint.end === 'tip'
      ? { kind: 'rotate', bone: joint.bone, parentInv: inv }
      : {
          kind: 'translate', bone: joint.bone, parentInv: inv,
          startX: applyX(inv, p.x, p.y), startY: applyY(inv, p.x, p.y),
          baseTx: joint.bone.tx, baseTy: joint.bone.ty,
        }
    structureBefore = snapshotStructure(ed.sprite)
    ed.beginStroke('Poser')
  },

  move(ed, p) {
    if (!poseDrag) return
    const bone = poseDrag.bone
    if (poseDrag.kind === 'rotate') {
      const cx = applyX(poseDrag.parentInv, p.x, p.y)
      const cy = applyY(poseDrag.parentInv, p.x, p.y)
      bone.angle = Math.atan2(cy - bone.y, cx - bone.x) - boneAngle(bone)
    } else {
      bone.tx = poseDrag.baseTx + (applyX(poseDrag.parentInv, p.x, p.y) - poseDrag.startX)
      bone.ty = poseDrag.baseTy + (applyY(poseDrag.parentInv, p.x, p.y) - poseDrag.startY)
    }
    ed.resetStroke()
    refreshPose(ed, DRAG_QUALITY)
  },

  up(ed) {
    if (!poseDrag) return
    poseDrag = null
    // Le geste fini, on repasse le rendu en finesse : c'est cette image que
    // l'on regarde et qui partira dans une frame.
    refreshPose(ed)
    ed.commitStroke()
    pushRigCommand(ed, 'Pose')
  },

  cancel(ed) {
    if (poseDrag) ed.cancelStroke()
    if (structureBefore) restoreStructure(ed.sprite, structureBefore)
    structureBefore = null
    poseDrag = null
    refreshPose(ed)
  },

  overlay(ed, o, p) {
    drawSkeleton(ed, o)
    if (!poseDrag) highlightJoint(ed, o, p)
  },
}

/* ------------------------------------------------------------------ */
/* Outil : ponderer                                                    */
/* ------------------------------------------------------------------ */

let weightBefore: Uint8Array | null = null
let weightPart: RigPart | null = null

function paintWeights(ed: Editor, p: PointerInfo): void {
  const rig = ed.sprite.rig
  // La ponderation porte sur le calque actif : chaque morceau a ses poids.
  const part = activePart(ed)
  if (!part) return
  const index = rig.bones.findIndex((b) => b.id === rigState.selected)
  if (index < 0) return
  const value = p.alt || p.button === 2 ? 255 : index
  const offsets = brushOffsets(rigState.weightBrush, 'circle')
  const w = part.rest.width, h = part.rest.height
  for (let i = 0; i < offsets.length; i += 2) {
    const x = p.px + offsets[i], y = p.py + offsets[i + 1]
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const at = y * w + x
    // Seuls les pixels dessines portent une influence.
    if (part.rest.data[at * 4 + 3] === 0) continue
    part.weights[at] = value
  }
  touchPart(part)
  refreshPose(ed)
  ed.events.emit('settings', undefined)
}

export const rigWeightTool: Tool = {
  id: 'rig-weight',
  name: 'Ponderer',
  shortcut: 'N',
  icon: ICONS.brush,
  group: 'rig',
  hint: 'Peint l\'influence de l\'os selectionne. Alt ou clic droit : detacher les pixels.',
  options: ['weightBrush'],
  cursor: 'crosshair',

  down(ed, p) {
    syncRestFromCanvas(ed)
    const part = activePart(ed)
    if (!part) { ed.toast('Liez d\'abord ce calque au squelette', 'error'); return }
    if (rigState.selected === null) { ed.toast('Choisissez un os a ponderer', 'error'); return }
    weightBefore = new Uint8Array(part.weights)
    weightPart = part
    paintWeights(ed, p)
  },

  move(ed, p) { if (weightBefore) paintWeights(ed, p) },

  up(ed) {
    const before = weightBefore
    const part = weightPart
    weightBefore = null
    weightPart = null
    if (!before || !part) return
    const after = new Uint8Array(part.weights)
    let same = true
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) { same = false; break }
    if (same) return
    ed.pushCommand({
      label: 'Ponderation',
      undo: () => { part.weights.set(before); touchPart(part); refreshPose(ed) },
      redo: () => { part.weights.set(after); touchPart(part); refreshPose(ed) },
    })
  },

  cancel(ed) {
    if (weightBefore && weightPart) {
      weightPart.weights.set(weightBefore)
      touchPart(weightPart)
      refreshPose(ed)
    }
    weightBefore = null
    weightPart = null
  },

  overlay(ed, o, p) {
    drawSkeleton(ed, o)
    if (!p) return
    // Empreinte du pinceau, pour savoir ce qui sera repeint.
    const offsets = brushOffsets(rigState.weightBrush, 'circle')
    o.ctx.save()
    o.ctx.fillStyle = '#ffffff33'
    o.ctx.strokeStyle = '#ffffffcc'
    o.ctx.lineWidth = 1 / o.zoom
    for (let i = 0; i < offsets.length; i += 2) {
      o.ctx.fillRect(p.px + offsets[i], p.py + offsets[i + 1], 1, 1)
    }
    o.ctx.restore()
  },
}
