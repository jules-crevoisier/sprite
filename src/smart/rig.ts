import { Bitmap } from '../core/bitmap'
import { type RGBA, getA } from '../core/color'

/* ------------------------------------------------------------------ */
/* Transformations affines                                             */
/* ------------------------------------------------------------------ */

/** Matrice affine [a, b, c, d, e, f] : x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-9) return IDENTITY
  const id = 1 / det
  return [
    m[3] * id, -m[1] * id, -m[2] * id, m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ]
}

export const applyX = (m: Mat, x: number, y: number): number => m[0] * x + m[2] * y + m[4]
export const applyY = (m: Mat, x: number, y: number): number => m[1] * x + m[3] * y + m[5]

/** Rotation d'angle `a` autour de (cx,cy), puis mise a l'echelle et translation. */
function poseMatrix(cx: number, cy: number, angle: number, scale: number, tx: number, ty: number): Mat {
  const cos = Math.cos(angle) * scale
  const sin = Math.sin(angle) * scale
  return [
    cos, sin, -sin, cos,
    cx - cx * cos + cy * sin + tx,
    cy - cx * sin - cy * cos + ty,
  ]
}

/* ------------------------------------------------------------------ */
/* Modele                                                              */
/* ------------------------------------------------------------------ */

export interface Bone {
  id: number
  name: string
  /** Identifiant de l'os parent, ou null pour une racine. */
  parent: number | null
  /** Extremites de l'os dans la pose de repos, en pixels sprite. */
  x: number
  y: number
  ex: number
  ey: number
  /** Ordre de dessin : un os de valeur superieure passe devant. */
  z: number
  /* --- pose courante, relative au repos --- */
  angle: number
  tx: number
  ty: number
  scale: number
}

export interface Rig {
  bones: Bone[]
  /** Dessin de reference sur lequel les pixels ont ete lies. */
  rest: Bitmap | null
  /** Pour chaque pixel du repos, l'index de l'os qui le porte ; 255 = libre. */
  weights: Uint8Array | null
}

export const emptyRig = (): Rig => ({ bones: [], rest: null, weights: null })

let nextBoneId = 1
export const newBoneId = (): number => nextBoneId++
export const seedBoneIds = (from: number): void => { nextBoneId = Math.max(nextBoneId, from + 1) }

export function createBone(
  rig: Rig,
  x: number, y: number, ex: number, ey: number,
  parent: number | null = null,
  name?: string,
): Bone {
  const bone: Bone = {
    id: newBoneId(),
    name: name ?? `os ${rig.bones.length + 1}`,
    parent,
    x, y, ex, ey,
    z: rig.bones.length,
    angle: 0, tx: 0, ty: 0, scale: 1,
  }
  rig.bones.push(bone)
  return bone
}

export const boneLength = (b: Bone): number => Math.hypot(b.ex - b.x, b.ey - b.y)
export const boneAngle = (b: Bone): number => Math.atan2(b.ey - b.y, b.ex - b.x)

/** Enfants directs d'un os. */
export function childrenOf(rig: Rig, id: number): Bone[] {
  return rig.bones.filter((b) => b.parent === id)
}

/** Empeche un cycle parent/enfant lors d'un rattachement. */
export function canParent(rig: Rig, childId: number, parentId: number | null): boolean {
  if (parentId === null) return true
  if (childId === parentId) return false
  let cursor: number | null = parentId
  const seen = new Set<number>()
  while (cursor !== null) {
    if (cursor === childId) return false
    if (seen.has(cursor)) return false
    seen.add(cursor)
    cursor = rig.bones.find((b) => b.id === cursor)?.parent ?? null
  }
  return true
}

/**
 * Transformations monde de chaque os, indexees par identifiant.
 * La pose d'un os s'applique autour de son point d'attache dans le repos,
 * puis la transformation du parent l'emmene : une rotation d'epaule entraine
 * donc tout le bras.
 */
export function worldTransforms(rig: Rig): Map<number, Mat> {
  const byId = new Map(rig.bones.map((b) => [b.id, b]))
  const cache = new Map<number, Mat>()

  const resolve = (bone: Bone, depth = 0): Mat => {
    const hit = cache.get(bone.id)
    if (hit) return hit
    const local = poseMatrix(bone.x, bone.y, bone.angle, bone.scale, bone.tx, bone.ty)
    const parent = bone.parent !== null ? byId.get(bone.parent) : undefined
    // La profondeur est bornee : une hierarchie corrompue ne doit pas boucler.
    const world = parent && depth < 32 ? mul(resolve(parent, depth + 1), local) : local
    cache.set(bone.id, world)
    return world
  }

  for (const bone of rig.bones) resolve(bone)
  return cache
}

/* ------------------------------------------------------------------ */
/* Liaison des pixels                                                  */
/* ------------------------------------------------------------------ */

/** Distance d'un point au segment d'un os. */
function distanceToBone(bone: Bone, px: number, py: number): number {
  const dx = bone.ex - bone.x
  const dy = bone.ey - bone.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return Math.hypot(px - bone.x, py - bone.y)
  let t = ((px - bone.x) * dx + (py - bone.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (bone.x + t * dx), py - (bone.y + t * dy))
}

/**
 * Attribue chaque pixel opaque a l'os le plus proche.
 * L'affectation est exclusive : en pixel art, un melange de poids brouille
 * les contours au lieu de les preserver.
 */
export function autoBind(rig: Rig, rest: Bitmap, maxDistance = Infinity): void {
  const weights = new Uint8Array(rest.width * rest.height).fill(255)
  if (rig.bones.length) {
    for (let y = 0; y < rest.height; y++) {
      for (let x = 0; x < rest.width; x++) {
        const i = y * rest.width + x
        if (getA(rest.u32[i]) === 0) continue
        let best = 255, bestD = maxDistance
        for (let b = 0; b < rig.bones.length && b < 255; b++) {
          const d = distanceToBone(rig.bones[b], x + 0.5, y + 0.5)
          if (d < bestD) { bestD = d; best = b }
        }
        weights[i] = best
      }
    }
  }
  rig.rest = rest.clone()
  rig.weights = weights
}

/** Force l'affectation des pixels d'un masque a un os donne. */
export function assignMask(rig: Rig, mask: Uint8Array, boneIndex: number): void {
  if (!rig.weights) return
  for (let i = 0; i < rig.weights.length; i++) if (mask[i]) rig.weights[i] = boneIndex
}

/* ------------------------------------------------------------------ */
/* Deformation                                                         */
/* ------------------------------------------------------------------ */

export interface DeformOptions {
  /** Recherche autour du point source pour recoller les jointures. */
  seamRadius?: number
  /** Passes de comblement des trous restants. */
  fillPasses?: number
}

/**
 * Produit le dessin pose a partir du dessin de repos.
 *
 * Le parcours est inverse : pour chaque pixel de destination on remonte a sa
 * source. Un balayage direct laisserait des trous des qu'un membre s'etire,
 * alors que le parcours inverse remplit toute la surface couverte par l'os.
 * Les jointures restantes sont recollees par une petite recherche autour du
 * point source, puis par un comblement majoritaire : c'est ce qui regenere
 * les pixels manquants quand un bras s'ecarte du corps.
 */
export function deform(rig: Rig, options: DeformOptions = {}): Bitmap | null {
  const rest = rig.rest
  const weights = rig.weights
  if (!rest || !weights || !rig.bones.length) return null

  const seamRadius = options.seamRadius ?? 1
  const fillPasses = options.fillPasses ?? 1
  const w = rest.width, h = rest.height
  const out = new Bitmap(w, h)

  const world = worldTransforms(rig)
  // Les os de z eleve sont testes en premier : ils passent devant.
  const order = rig.bones
    .map((bone, index) => ({ bone, index }))
    .sort((a, b) => b.bone.z - a.bone.z)
  const inverses = new Map<number, Mat>()
  for (const { bone } of order) inverses.set(bone.id, invert(world.get(bone.id) ?? IDENTITY))

  const sampleAt = (index: number, sx: number, sy: number): RGBA | null => {
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null
    const si = sy * w + sx
    if (weights[si] !== index) return null
    const color = rest.u32[si]
    return getA(color) === 0 ? null : color
  }

  // Passe 1 : echantillonnage exact. Elargir la recherche des ici gonflerait
  // la silhouette d'un pixel autour de chaque os.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const restIndex = y * w + x
      // Un pixel qu'aucun os ne porte ne bouge pas : on peut donc ne rigger
      // qu'une partie du dessin, le reste reste en place.
      if (weights[restIndex] === 255 && getA(rest.u32[restIndex]) !== 0) {
        out.u32[restIndex] = rest.u32[restIndex]
        continue
      }
      for (const { bone, index } of order) {
        const inv = inverses.get(bone.id)!
        const color = sampleAt(
          index,
          Math.floor(applyX(inv, x + 0.5, y + 0.5)),
          Math.floor(applyY(inv, x + 0.5, y + 0.5)),
        )
        if (color !== null) { out.u32[restIndex] = color; break }
      }
    }
  }

  // Passe 2 : les fissures d'articulation. On n'elargit la recherche que sur
  // un vide deja entoure de matiere, donc jamais sur le contour exterieur.
  if (seamRadius > 0) {
    const filled = new Uint32Array(out.u32)
    const neighbourCount = (x: number, y: number): number => {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          if (getA(filled[ny * w + nx]) !== 0) n++
        }
      }
      return n
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (getA(filled[i]) !== 0) continue
        if (neighbourCount(x, y) < 3) continue
        let color: RGBA | null = null
        for (const { bone, index } of order) {
          const inv = inverses.get(bone.id)!
          const fx = Math.floor(applyX(inv, x + 0.5, y + 0.5))
          const fy = Math.floor(applyY(inv, x + 0.5, y + 0.5))
          for (let r = 1; r <= seamRadius && color === null; r++) {
            for (let dy = -r; dy <= r && color === null; dy++) {
              for (let dx = -r; dx <= r && color === null; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
                color = sampleAt(index, fx + dx, fy + dy)
              }
            }
          }
          if (color !== null) break
        }
        if (color !== null) out.u32[i] = color
      }
    }
  }

  for (let pass = 0; pass < fillPasses; pass++) fillHoles(out)
  return out
}

/**
 * Comble les pixels vides entoures de matiere, en reprenant la couleur
 * majoritaire du voisinage. C'est ce qui referme les fentes apparues a
 * l'articulation quand un membre pivote.
 */
function fillHoles(bm: Bitmap): number {
  const w = bm.width, h = bm.height
  const source = new Uint32Array(bm.u32)
  let filled = 0
  const counts = new Map<number, number>()

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (getA(source[i]) !== 0) continue
      counts.clear()
      let neighbours = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const c = source[ny * w + nx]
          if (getA(c) === 0) continue
          neighbours++
          counts.set(c, (counts.get(c) ?? 0) + 1)
        }
      }
      // Un pixel isole n'est pas un trou : on ne comble que ce qui est cerne
      // de toutes parts, sinon la matiere deborde de la silhouette.
      if (neighbours < 6) continue
      let best = 0, bestN = 0
      for (const [color, n] of counts) if (n > bestN) { bestN = n; best = color }
      bm.u32[i] = best
      filled++
    }
  }
  return filled
}

/** Remet toutes les poses a zero. */
export function resetPose(rig: Rig): void {
  for (const bone of rig.bones) {
    bone.angle = 0
    bone.tx = 0
    bone.ty = 0
    bone.scale = 1
  }
}

/** Copie de la pose courante, pour l'enregistrer sur une frame. */
export type Pose = Record<number, { angle: number; tx: number; ty: number; scale: number }>

export function capturePose(rig: Rig): Pose {
  const pose: Pose = {}
  for (const b of rig.bones) pose[b.id] = { angle: b.angle, tx: b.tx, ty: b.ty, scale: b.scale }
  return pose
}

export function applyPose(rig: Rig, pose: Pose): void {
  for (const bone of rig.bones) {
    const p = pose[bone.id]
    if (!p) continue
    bone.angle = p.angle
    bone.tx = p.tx
    bone.ty = p.ty
    bone.scale = p.scale
  }
}

/** Interpolation de deux poses, pour generer des frames intermediaires. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {}
  for (const key of Object.keys(b)) {
    const id = Number(key)
    const pa = a[id] ?? { angle: 0, tx: 0, ty: 0, scale: 1 }
    const pb = b[id]
    out[id] = {
      angle: pa.angle + (pb.angle - pa.angle) * t,
      tx: pa.tx + (pb.tx - pa.tx) * t,
      ty: pa.ty + (pb.ty - pa.ty) * t,
      scale: pa.scale + (pb.scale - pa.scale) * t,
    }
  }
  return out
}
