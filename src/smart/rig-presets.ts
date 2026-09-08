import type { Bitmap, Rect } from '../core/bitmap'
import { createBone, resetPose, unbind, type BoneRole, type Rig } from './rig'

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
  /**
   * Fonction de l'os. C'est elle que lisent les animations preenregistrees :
   * un cycle de marche cherche « la jambe gauche », pas un nom precis.
   */
  role: BoneRole
  /**
   * Position devant / derriere le plan, en fraction de la largeur de la
   * boite. Sert au demi-tour : un bras a -0.1 passe derriere le corps quand
   * le personnage pivote vers la droite.
   */
  depth?: number
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
    // Proportions d'un personnage debout, bras le long du corps : la tete
    // occupe le tiers haut, le torse s'arrete a la taille, et les os des
    // bras passent dans l'axe des bras plutot qu'en diagonale.
    bones: [
      { name: 'torse', x: 0.5, y: 0.7, ex: 0.5, ey: 0.4, parent: null, role: 'torso' },
      { name: 'tete', x: 0.5, y: 0.4, ex: 0.5, ey: 0.03, parent: 0, role: 'head' },
      // De face, les deux bras sont a la meme profondeur : c'est leur abscisse
      // qui les separe, et la rotation la transforme en profondeur. Un ecart
      // de profondeur ici les ferait converger au lieu de tourner.
      { name: 'bras G', x: 0.1, y: 0.43, ex: 0.1, ey: 0.78, parent: 0, role: 'armL', depth: 0.06 },
      { name: 'bras D', x: 0.9, y: 0.43, ex: 0.9, ey: 0.78, parent: 0, role: 'armR', depth: 0.06 },
      { name: 'jambe G', x: 0.4, y: 0.7, ex: 0.4, ey: 0.98, parent: 0, role: 'legL', depth: 0 },
      { name: 'jambe D', x: 0.6, y: 0.7, ex: 0.6, ey: 0.98, parent: 0, role: 'legR', depth: 0 },
    ],
  },
  {
    id: 'humanoid-side',
    label: 'Humanoide de profil',
    hint: 'Membres avant et arriere separes, pour une marche',
    bones: [
      { name: 'torse', x: 0.5, y: 0.7, ex: 0.48, ey: 0.4, parent: null, role: 'torso' },
      { name: 'tete', x: 0.48, y: 0.4, ex: 0.44, ey: 0.04, parent: 0, role: 'head' },
      { name: 'bras arriere', x: 0.56, y: 0.44, ex: 0.68, ey: 0.76, parent: 0, role: 'armR', depth: -0.12 },
      { name: 'bras avant', x: 0.42, y: 0.44, ex: 0.3, ey: 0.76, parent: 0, role: 'armL', depth: 0.12 },
      { name: 'jambe arriere', x: 0.54, y: 0.7, ex: 0.64, ey: 0.98, parent: 0, role: 'legR', depth: -0.08 },
      { name: 'jambe avant', x: 0.46, y: 0.7, ex: 0.36, ey: 0.98, parent: 0, role: 'legL', depth: 0.08 },
    ],
  },
  {
    id: 'quadruped',
    label: 'Quadrupede',
    hint: 'Corps, tete, queue et quatre pattes',
    bones: [
      { name: 'corps', x: 0.72, y: 0.46, ex: 0.28, ey: 0.42, parent: null, role: 'torso' },
      { name: 'tete', x: 0.28, y: 0.42, ex: 0.08, ey: 0.28, parent: 0, role: 'head' },
      { name: 'queue', x: 0.72, y: 0.46, ex: 0.95, ey: 0.3, parent: 0, role: 'tail' },
      { name: 'patte AV G', x: 0.32, y: 0.5, ex: 0.28, ey: 0.97, parent: 0, role: 'armL', depth: 0.08 },
      { name: 'patte AV D', x: 0.4, y: 0.5, ex: 0.4, ey: 0.97, parent: 0, role: 'armR', depth: -0.08 },
      { name: 'patte AR G', x: 0.64, y: 0.5, ex: 0.6, ey: 0.97, parent: 0, role: 'legL', depth: 0.08 },
      { name: 'patte AR D', x: 0.72, y: 0.5, ex: 0.74, ey: 0.97, parent: 0, role: 'legR', depth: -0.08 },
    ],
  },
  {
    id: 'bird',
    label: 'Oiseau',
    hint: 'Deux ailes battantes, tete et queue',
    bones: [
      { name: 'corps', x: 0.58, y: 0.6, ex: 0.4, ey: 0.4, parent: null, role: 'torso' },
      { name: 'tete', x: 0.4, y: 0.4, ex: 0.26, ey: 0.22, parent: 0, role: 'head' },
      { name: 'aile G', x: 0.48, y: 0.44, ex: 0.1, ey: 0.28, parent: 0, role: 'wingL', depth: 0.14 },
      { name: 'aile D', x: 0.54, y: 0.44, ex: 0.9, ey: 0.28, parent: 0, role: 'wingR', depth: -0.14 },
      { name: 'queue', x: 0.58, y: 0.6, ex: 0.88, ey: 0.72, parent: 0, role: 'tail' },
      { name: 'pattes', x: 0.52, y: 0.62, ex: 0.5, ey: 0.94, parent: 0, role: 'legL' },
    ],
  },
  {
    id: 'tree',
    label: 'Arbre',
    hint: 'Tronc et branches, pour un feuillage qui ondule',
    bones: [
      { name: 'tronc', x: 0.5, y: 0.99, ex: 0.5, ey: 0.55, parent: null, role: 'torso' },
      { name: 'cime', x: 0.5, y: 0.55, ex: 0.5, ey: 0.08, parent: 0, role: 'head' },
      { name: 'branche G', x: 0.5, y: 0.58, ex: 0.14, ey: 0.32, parent: 0, role: 'armL', depth: 0.1 },
      { name: 'branche D', x: 0.5, y: 0.58, ex: 0.86, ey: 0.32, parent: 0, role: 'armR', depth: -0.1 },
    ],
  },
  {
    id: 'arm',
    label: 'Membre simple',
    hint: 'Deux os enchaines : ideal pour essayer la pose',
    bones: [
      { name: 'haut', x: 0.5, y: 0.08, ex: 0.5, ey: 0.52, parent: null, role: 'torso' },
      { name: 'bas', x: 0.5, y: 0.52, ex: 0.5, ey: 0.95, parent: 0, role: 'armL' },
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
  unbind(rig)

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
    made.role = bone.role
    made.depth = (bone.depth ?? 0) * box.w
    created.push(made.id)
  }
  resetPose(rig)
}
