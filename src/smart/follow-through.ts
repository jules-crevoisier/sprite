import { boneAngle, worldTransforms, type Pose, type Rig } from './rig'

/**
 * Suivi et inertie.
 *
 * Une cape, une queue ou une meche ne suivent pas le corps a l'image pres :
 * elles trainent derriere, depassent quand le mouvement s'arrete, puis se
 * stabilisent. En animation dessinee, ce retard se dessine image par image ;
 * ici on le calcule.
 *
 * Chaque os declare souple est traite comme un ressort amorti attache a la
 * pose voulue. Ce qui le met en mouvement, c'est la rotation de son parent :
 * l'os garde son orientation d'avant par inertie, donc il parait tourner en
 * sens inverse, exactement comme des cheveux qui se plaquent en arriere quand
 * la tete part en avant.
 *
 * Les ordres de grandeur suivent l'usage : une matiere legere se stabilise en
 * une a trois images, un vetement lourd en deux a quatre, une cape ou une
 * chevelure en trois a huit.
 */

export interface FollowOptions {
  /**
   * Rappel vers la pose voulue. Eleve, l'os colle au corps ; bas, il flotte
   * longtemps. C'est ce qui fixe le nombre d'images avant stabilisation.
   */
  stiffness?: number
  /** Freinage. Bas, l'os oscille ; haut, il revient sans depasser. */
  damping?: number
  /**
   * Part de la rotation du parent reprise a contresens. C'est elle qui cree
   * le retard : sans elle le ressort n'aurait aucune raison de s'ecarter.
   */
  drag?: number
  /**
   * Passages sur le cycle avant de retenir le resultat. Une animation qui
   * boucle doit partir d'un etat deja etabli, sinon la premiere image porte
   * un depart au repos que les suivantes n'ont pas.
   */
  settle?: number
}

const DEFAULTS: Required<FollowOptions> = {
  stiffness: 0.45,
  damping: 0.55,
  drag: 0.75,
  settle: 4,
}

/** Angle monde d'un os pour une pose donnee, orientation comprise. */
function worldAngles(rig: Rig, pose: Pose): Map<number, number> {
  const memoire = rig.bones.map((b) => ({ angle: b.angle, tx: b.tx, ty: b.ty, scale: b.scale }))
  for (const bone of rig.bones) {
    const p = pose[bone.id]
    if (!p) continue
    bone.angle = p.angle; bone.tx = p.tx; bone.ty = p.ty; bone.scale = p.scale
  }
  const world = worldTransforms(rig)
  const out = new Map<number, number>()
  for (const bone of rig.bones) {
    const m = world.get(bone.id)
    out.set(bone.id, m ? Math.atan2(m[1], m[0]) + boneAngle(bone) : boneAngle(bone))
  }
  rig.bones.forEach((b, i) => Object.assign(b, memoire[i]))
  return out
}

/** Difference d'angles ramenee dans [-pi, pi]. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

/** Vrai si le squelette a de quoi produire un suivi. */
export const hasSoftBones = (rig: Rig): boolean => rig.bones.some((b) => b.softness > 0)

/**
 * Ajoute le retard des os souples a une suite de poses.
 *
 * Les poses recues sont la pose « voulue » ; celles rendues y ajoutent le
 * retard. Un cycle qui boucle est parcouru plusieurs fois pour que le ressort
 * parte d'un etat etabli et que la derniere image enchaine sur la premiere.
 */
export function applyFollowThrough(
  rig: Rig,
  poses: Pose[],
  loop: boolean,
  options: FollowOptions = {},
): Pose[] {
  const o = { ...DEFAULTS, ...options }
  const souples = rig.bones.filter((b) => b.softness > 0)
  if (!souples.length || poses.length < 2) return poses

  const monde = poses.map((p) => worldAngles(rig, p))
  const parentDe = new Map(rig.bones.map((b) => [b.id, b.parent]))

  const sortie: Pose[] = poses.map((p) => {
    const copie: Pose = {}
    for (const key of Object.keys(p)) copie[Number(key)] = { ...p[Number(key)] }
    return copie
  })

  for (const bone of souples) {
    const force = Math.min(1, bone.softness)
    const raideur = o.stiffness / (0.35 + force)
    const amorti = o.damping
    let angle = poses[0][bone.id]?.angle ?? 0
    let vitesse = 0
    const passes = loop ? Math.max(1, o.settle) : 1

    for (let pass = 0; pass < passes; pass++) {
      for (let f = 0; f < poses.length; f++) {
        const cible = poses[f][bone.id]?.angle ?? 0

        // Rotation du parent depuis l'image precedente. C'est le moteur du
        // retard : l'os conserve son orientation, donc il semble tourner a
        // l'envers de ce que le corps vient de faire.
        const precedent = f === 0 ? (loop ? poses.length - 1 : 0) : f - 1
        const parent = parentDe.get(bone.id)
        let entrainement = 0
        if (parent !== null && parent !== undefined) {
          const a = monde[precedent].get(parent) ?? 0
          const b = monde[f].get(parent) ?? 0
          entrainement = -wrap(b - a) * o.drag * force
        }

        const ecart = cible + entrainement - angle
        vitesse = vitesse * (1 - amorti) + ecart * raideur
        angle += vitesse

        if (pass === passes - 1) {
          const cellule = sortie[f][bone.id]
          if (cellule) cellule.angle = angle
        }
      }
    }
  }
  return sortie
}
