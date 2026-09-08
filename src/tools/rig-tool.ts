import type { Editor } from '../core/editor'
import {
  applyX, applyY, boneAngle, createBone, deform, invert,
  worldTransforms, type Bone, type Mat,
} from '../smart/rig'
import { ICONS } from '../ui/icons'
import type { OverlayContext, Tool } from './types'

/** Ce que l'outil fait au clic : construire le squelette ou poser le dessin. */
export type RigMode = 'edit' | 'pose'

export const rigState = {
  mode: 'edit' as RigMode,
  /** Os selectionne, par identifiant. */
  selected: null as number | null,
  /**
   * Recollement des jointures, de 0 (aucun) a 3 (genereux). Un seul reglage
   * pilote la recherche et son exigence : plus il monte, plus les fissures
   * se referment, mais plus la silhouette s'epaissit.
   */
  seam: 2,
}

/** Traduit le reglage unique en parametres de deformation. */
export const seamSettings = (level: number): { seamRadius: number; seamNeighbours: number; fillPasses: number } => {
  switch (Math.max(0, Math.min(3, Math.round(level)))) {
    case 0: return { seamRadius: 0, seamNeighbours: 8, fillPasses: 0 }
    case 1: return { seamRadius: 1, seamNeighbours: 5, fillPasses: 1 }
    case 3: return { seamRadius: 2, seamNeighbours: 3, fillPasses: 2 }
    default: return { seamRadius: 1, seamNeighbours: 4, fillPasses: 1 }
  }
}

type Drag =
  | { kind: 'create'; x: number; y: number; parent: number | null }
  | { kind: 'joint'; bone: Bone; end: 'root' | 'tip' }
  | { kind: 'rotate'; bone: Bone; parentInv: Mat }
  | { kind: 'translate'; bone: Bone; parentInv: Mat; startX: number; startY: number; baseTx: number; baseTy: number }
  | null

let drag: Drag = null
let hover: { x: number; y: number } | null = null

const HIT = 3

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by)

/** Transformation du parent d'un os, ou l'identite pour une racine. */
function parentWorld(ed: Editor, bone: Bone): Mat {
  const world = worldTransforms(ed.sprite.rig)
  if (bone.parent === null) return [1, 0, 0, 1, 0, 0]
  return world.get(bone.parent) ?? [1, 0, 0, 1, 0, 0]
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

/** Os dont une extremite est sous le curseur. */
function pickJoint(ed: Editor, x: number, y: number): { bone: Bone; end: 'root' | 'tip' } | null {
  for (const bone of [...ed.sprite.rig.bones].reverse()) {
    const p = bonePoints(ed, bone)
    if (dist(x, y, p.x2, p.y2) <= HIT) return { bone, end: 'tip' }
    if (dist(x, y, p.x1, p.y1) <= HIT) return { bone, end: 'root' }
  }
  return null
}

/** Os dont le corps passe sous le curseur. */
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

/** Recalcule le dessin pose et l'ecrit dans la case active. */
export function refreshPose(ed: Editor): void {
  const rig = ed.sprite.rig
  if (!rig.rest || !rig.weights) return
  const cel = ed.peekCel()
  if (!cel) return
  const posed = deform(rig, seamSettings(rigState.seam))
  if (!posed) return
  cel.bitmap.copyFrom(posed)
  ed.events.emit('doc', undefined)
}

export const rigTool: Tool = {
  id: 'rig',
  name: 'Squelette',
  shortcut: 'K',
  icon: ICONS.rig,
  group: 'select',
  hint: 'Construction : glisser pour creer un os, repartir d\'un bout pour enchainer, Alt pour deplacer une extremite. Pose : tirer un bout pour pivoter, une racine pour deplacer.',
  options: [],
  cursor: 'crosshair',

  down(ed, p) {
    const x = p.x, y = p.y

    if (rigState.mode === 'pose') {
      const joint = pickJoint(ed, x, y)
      if (joint) {
        rigState.selected = joint.bone.id
        const inv = invert(parentWorld(ed, joint.bone))
        if (joint.end === 'tip') {
          drag = { kind: 'rotate', bone: joint.bone, parentInv: inv }
        } else {
          drag = {
            kind: 'translate', bone: joint.bone, parentInv: inv,
            startX: applyX(inv, x, y), startY: applyY(inv, x, y),
            baseTx: joint.bone.tx, baseTy: joint.bone.ty,
          }
        }
        ed.beginStroke('Poser le squelette')
        return
      }
      const bone = pickBone(ed, x, y)
      if (bone) {
        rigState.selected = bone.id
        ed.events.emit('settings', undefined)
      }
      return
    }

    // Construction : un glisser cree toujours un os, sans exception, pour
    // qu'on puisse batir un squelette sans reflechir a ce qui est sous le
    // curseur. Alt sert a rattraper une extremite mal placee.
    const joint = pickJoint(ed, x, y)
    if (joint && p.alt) {
      rigState.selected = joint.bone.id
      drag = { kind: 'joint', bone: joint.bone, end: joint.end }
      return
    }
    // Partir du bout d'un os enchaine un enfant : le membre suit son parent.
    if (joint && joint.end === 'tip') {
      const pt = bonePoints(ed, joint.bone)
      drag = { kind: 'create', x: pt.x2, y: pt.y2, parent: joint.bone.id }
      return
    }
    drag = { kind: 'create', x, y, parent: null }
  },

  move(ed, p) {
    if (!drag) return
    const x = p.x, y = p.y

    switch (drag.kind) {
      case 'joint': {
        if (drag.end === 'tip') { drag.bone.ex = x; drag.bone.ey = y }
        else { drag.bone.x = x; drag.bone.y = y }
        ed.events.emit('settings', undefined)
        break
      }
      case 'rotate': {
        const bone = drag.bone
        const cx = applyX(drag.parentInv, x, y)
        const cy = applyY(drag.parentInv, x, y)
        const target = Math.atan2(cy - bone.y, cx - bone.x)
        bone.angle = target - boneAngle(bone)
        ed.resetStroke()
        refreshPose(ed)
        break
      }
      case 'translate': {
        const bone = drag.bone
        bone.tx = drag.baseTx + (applyX(drag.parentInv, x, y) - drag.startX)
        bone.ty = drag.baseTy + (applyY(drag.parentInv, x, y) - drag.startY)
        ed.resetStroke()
        refreshPose(ed)
        break
      }
      case 'create': break
    }
  },

  up(ed, p) {
    const rig = ed.sprite.rig
    if (drag?.kind === 'create') {
      const length = dist(drag.x, drag.y, p.x, p.y)
      if (length >= 2) {
        const bone = createBone(rig, drag.x, drag.y, p.x, p.y, drag.parent)
        rigState.selected = bone.id
        ed.history.touch()
        ed.events.emit('doc', undefined)
      }
    } else if (drag?.kind === 'rotate' || drag?.kind === 'translate') {
      ed.commitStroke()
    } else if (drag?.kind === 'joint') {
      ed.history.touch()
      ed.events.emit('doc', undefined)
    }
    drag = null
    ed.events.emit('settings', undefined)
  },

  hover(_ed, p) { hover = { x: p.x, y: p.y } },

  cancel(ed) {
    if (drag?.kind === 'rotate' || drag?.kind === 'translate') ed.cancelStroke()
    drag = null
  },

  overlay(ed, o: OverlayContext, p) {
    const rig = ed.sprite.rig
    const { ctx, zoom } = o
    const unit = 1 / zoom
    ctx.save()

    // Os en cours de creation.
    if (drag?.kind === 'create' && p) {
      ctx.strokeStyle = '#ffb454'
      ctx.lineWidth = 2 * unit
      ctx.setLineDash([3 * unit, 2 * unit])
      ctx.beginPath()
      ctx.moveTo(drag.x, drag.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    for (const bone of rig.bones) {
      const pt = bonePoints(ed, bone)
      const selected = bone.id === rigState.selected
      const color = selected ? '#ffb454' : '#6c8cff'

      // Corps de l'os, dessine en fuseau pour lire son sens.
      const dx = pt.x2 - pt.x1, dy = pt.y2 - pt.y1
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len, ny = dx / len
      const width = Math.max(1.2, Math.min(3, len * 0.16))
      ctx.beginPath()
      ctx.moveTo(pt.x1, pt.y1)
      ctx.lineTo(pt.x1 + dx * 0.25 + nx * width, pt.y1 + dy * 0.25 + ny * width)
      ctx.lineTo(pt.x2, pt.y2)
      ctx.lineTo(pt.x1 + dx * 0.25 - nx * width, pt.y1 + dy * 0.25 - ny * width)
      ctx.closePath()
      ctx.fillStyle = `${color}55`
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = unit
      ctx.stroke()

      // Articulations : creux a la racine, plein au bout.
      ctx.beginPath()
      ctx.arc(pt.x1, pt.y1, 2 * unit + 0.6, 0, Math.PI * 2)
      ctx.fillStyle = '#0d0f14cc'
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(pt.x2, pt.y2, 1.6 * unit + 0.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }

    // Reperage de l'extremite survolee.
    const cursor = p ?? hover
    if (cursor && !drag) {
      const joint = pickJoint(ed, cursor.x, cursor.y)
      if (joint) {
        const pt = bonePoints(ed, joint.bone)
        const jx = joint.end === 'tip' ? pt.x2 : pt.x1
        const jy = joint.end === 'tip' ? pt.y2 : pt.y1
        ctx.beginPath()
        ctx.arc(jx, jy, 3.4 * unit + 0.8, 0, Math.PI * 2)
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = unit
        ctx.stroke()
      }
    }
    ctx.restore()
  },
}
