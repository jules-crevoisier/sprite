import type { Bitmap, Rect } from '../core/bitmap'
import { createBone, resetPose, type Rig } from './rig'

/** Un os de modele, en coordonnees normalisees dans la boite du dessin. */
interface TemplateBone {
  name: string
  /** 0 = bord gauche/haut de la boite, 1 = bord droit/bas. */
  x: number
  y: number
  ex: number
  ey: number
  /** Index du parent dans la liste, ou null pour une racine. */
  parent: number | null
}

export interface RigTemplate {
  id: string
  label: string
  hint: string
  bones: TemplateBone[]
}

/**
 * Squelettes prets a poser. Les coordonnees sont normalisees : le modele
 * s'ajuste a la boite englobante du dessin, donc il tombe juste quelle que
 * soit la taille du sprite.
 */
export const RIG_TEMPLATES: RigTemplate[] = [
  {
    id: 'humanoid-front',
    label: 'Humanoide de face',
    hint: 'Torse, tete, deux bras, deux jambes',
    bones: [
      { name: 'torse', x: 0.5, y: 0.62, ex: 0.5, ey: 0.26, parent: null },
      { name: 'tete', x: 0.5, y: 0.26, ex: 0.5, ey: 0.04, parent: 0 },
      { name: 'bras G', x: 0.3, y: 0.31, ex: 0.1, ey: 0.62, parent: 0 },
      { name: 'bras D', x: 0.7, y: 0.31, ex: 0.9, ey: 0.62, parent: 0 },
      { name: 'jambe G', x: 0.4, y: 0.62, ex: 0.38, ey: 0.98, parent: 0 },
      { name: 'jambe D', x: 0.6, y: 0.62, ex: 0.62, ey: 0.98, parent: 0 },
    ],
  },
  {
    id: 'humanoid-side',
    label: 'Humanoide de profil',
    hint: 'Membres avant et arriere separes, pour une marche',
    bones: [
      { name: 'torse', x: 0.5, y: 0.62, ex: 0.48, ey: 0.26, parent: null },
      { name: 'tete', x: 0.48, y: 0.26, ex: 0.44, ey: 0.05, parent: 0 },
      { name: 'bras arriere', x: 0.5, y: 0.31, ex: 0.66, ey: 0.6, parent: 0 },
      { name: 'bras avant', x: 0.46, y: 0.31, ex: 0.28, ey: 0.6, parent: 0 },
      { name: 'jambe arriere', x: 0.52, y: 0.62, ex: 0.64, ey: 0.98, parent: 0 },
      { name: 'jambe avant', x: 0.48, y: 0.62, ex: 0.34, ey: 0.98, parent: 0 },
    ],
  },
  {
    id: 'quadruped',
    label: 'Quadrupede',
    hint: 'Corps, tete, queue et quatre pattes',
    bones: [
      { name: 'corps', x: 0.72, y: 0.46, ex: 0.28, ey: 0.42, parent: null },
      { name: 'tete', x: 0.28, y: 0.42, ex: 0.08, ey: 0.28, parent: 0 },
      { name: 'queue', x: 0.72, y: 0.46, ex: 0.95, ey: 0.3, parent: 0 },
      { name: 'patte AV G', x: 0.32, y: 0.5, ex: 0.28, ey: 0.97, parent: 0 },
      { name: 'patte AV D', x: 0.4, y: 0.5, ex: 0.4, ey: 0.97, parent: 0 },
      { name: 'patte AR G', x: 0.64, y: 0.5, ex: 0.6, ey: 0.97, parent: 0 },
      { name: 'patte AR D', x: 0.72, y: 0.5, ex: 0.74, ey: 0.97, parent: 0 },
    ],
  },
  {
    id: 'bird',
    label: 'Oiseau',
    hint: 'Deux ailes battantes, tete et queue',
    bones: [
      { name: 'corps', x: 0.58, y: 0.6, ex: 0.4, ey: 0.4, parent: null },
      { name: 'tete', x: 0.4, y: 0.4, ex: 0.26, ey: 0.22, parent: 0 },
      { name: 'aile G', x: 0.48, y: 0.44, ex: 0.1, ey: 0.28, parent: 0 },
      { name: 'aile D', x: 0.54, y: 0.44, ex: 0.9, ey: 0.28, parent: 0 },
      { name: 'queue', x: 0.58, y: 0.6, ex: 0.88, ey: 0.72, parent: 0 },
      { name: 'pattes', x: 0.52, y: 0.62, ex: 0.5, ey: 0.94, parent: 0 },
    ],
  },
  {
    id: 'tree',
    label: 'Arbre',
    hint: 'Tronc et branches, pour un feuillage qui ondule',
    bones: [
      { name: 'tronc', x: 0.5, y: 0.99, ex: 0.5, ey: 0.55, parent: null },
      { name: 'cime', x: 0.5, y: 0.55, ex: 0.5, ey: 0.08, parent: 0 },
      { name: 'branche G', x: 0.5, y: 0.58, ex: 0.14, ey: 0.32, parent: 0 },
      { name: 'branche D', x: 0.5, y: 0.58, ex: 0.86, ey: 0.32, parent: 0 },
    ],
  },
  {
    id: 'arm',
    label: 'Membre simple',
    hint: 'Deux os enchaines : ideal pour essayer la pose',
    bones: [
      { name: 'haut', x: 0.5, y: 0.08, ex: 0.5, ey: 0.52, parent: null },
      { name: 'bas', x: 0.5, y: 0.52, ex: 0.5, ey: 0.95, parent: 0 },
    ],
  },
]

/**
 * Installe un modele sur le sprite. Le squelette est cale sur la boite des
 * pixels opaques plutot que sur la toile : un personnage dessine dans un
 * coin recoit quand meme un squelette a sa taille.
 */
export function applyTemplate(
  rig: Rig,
  template: RigTemplate,
  bitmap: Bitmap | null,
  canvas: { width: number; height: number },
): void {
  let box: Rect = { x: 0, y: 0, w: canvas.width, h: canvas.height }
  if (bitmap) {
    const trimmed = bitmap.trimBounds()
    if (trimmed.w >= 4 && trimmed.h >= 4) box = trimmed
  }

  rig.bones = []
  rig.rest = null
  rig.weights = null

  const created: number[] = []
  for (const bone of template.bones) {
    const parentId = bone.parent === null ? null : created[bone.parent] ?? null
    const made = createBone(
      rig,
      box.x + bone.x * box.w,
      box.y + bone.y * box.h,
      box.x + bone.ex * box.w,
      box.y + bone.ey * box.h,
      parentId,
      bone.name,
    )
    created.push(made.id)
  }
  resetPose(rig)
}
