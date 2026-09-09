import { Bitmap } from '../core/bitmap'
import { getA } from '../core/color'
import { champAuto, hauteurSuggeree, type ProfilRelief } from './depth'
import type { VueSource } from './scene'

/**
 * Fabrique une vue de dos a partir d'une vue de face.
 *
 * ## Pourquoi il en faut une
 *
 * Sans dessin de dos, le demi-tour montre la face vue par derriere. La
 * silhouette est juste, les proportions aussi — mais le personnage a des yeux
 * dans la nuque. C'est le detail qui trahit l'astuce, et c'est le seul : le
 * reste du dessin, cheveux, vetements, membres, est deja a peu pres bon de
 * dos, parce qu'un vetement ne change pas de couleur en tournant.
 *
 * ## Ce qu'on retire, et pourquoi c'est celui-la
 *
 * On efface les petits details enfermes du haut du dessin : les taches d'une
 * couleur a elles, de quelques pixels, entierement entourees de matiere. Ce
 * sont les yeux, les narines, la bouche. La regle ne touche ni les cheveux
 * (grande plage), ni une ceinture (elle traverse le dessin de part en part),
 * ni un bouton du bas du corps (hors de la zone du visage).
 *
 * Chaque pixel efface reprend la couleur qui l'entoure le plus : aucune
 * couleur nouvelle n'apparait, et la silhouette ne bouge pas d'un pixel. Le
 * banc verifie les trois.
 *
 * ## Ce que ca ne pretend pas etre
 *
 * Un vrai dos se dessine : un dos porte une capuche, une tresse, un sac, un
 * numero. Cette vue-la est une base honnete, et l'interface propose de la
 * reprendre au crayon — apres quoi c'est elle, et non plus la devinette, que
 * le rendu emploie.
 */

export interface OptionsDos {
  /**
   * Part de la hauteur, depuis le haut, ou l'on cherche un visage. Au-dela,
   * un petit detail enferme est un bouton ou une boucle, pas un oeil.
   */
  zoneVisage: number
  /** Taille maximale, en pixels, d'un detail tenu pour un trait de visage. */
  tailleDetail: number
}

export const DOS_DEFAUT: OptionsDos = { zoneVisage: 0.5, tailleDetail: 6 }

/** Miroir horizontal, autour du milieu de ce que le dessin occupe. */
export function retourner(src: Bitmap): Bitmap {
  const out = new Bitmap(src.width, src.height)
  const b = src.trimBounds()
  if (!b.w) return out
  // Le miroir se fait autour du dessin, pas autour du cadre : sinon un sprite
  // decentre part se coller au bord oppose.
  const axe = b.x + b.x + b.w - 1
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const sx = axe - x
      if (sx < 0 || sx >= src.width) continue
      out.u32[y * src.width + x] = src.u32[y * src.width + sx]
    }
  }
  return out
}

/**
 * Efface les petits details enfermes du haut du dessin.
 *
 * « Enferme » veut dire : aucun pixel de la tache ne touche le vide. Un oeil
 * l'est, une encoche entre deux oreilles ne l'est pas. C'est ce qui evite de
 * repeindre le contour, qui touche le vide par definition.
 */
export function effacerLesDetails(src: Bitmap, opts: OptionsDos = DOS_DEFAUT): Bitmap {
  const out = src.clone()
  const { width: w, height: h } = src
  const b = src.trimBounds()
  if (!b.w) return out
  const limiteY = b.y + b.h * opts.zoneVisage

  const vus = new Uint8Array(w * h)
  for (let depart = 0; depart < w * h; depart++) {
    if (vus[depart] || getA(src.u32[depart]) === 0) continue
    const couleur = src.u32[depart]
    const tache: number[] = []
    const aVoir = [depart]
    vus[depart] = 1
    let touche = false
    let trop = false

    while (aVoir.length) {
      const i = aVoir.pop()!
      tache.push(i)
      if (tache.length > opts.tailleDetail) trop = true
      const x = i % w, y = (i / w) | 0
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) { touche = true; continue }
        const j = yy * w + xx
        if (getA(src.u32[j]) === 0) { touche = true; continue }
        if (vus[j] || src.u32[j] !== couleur) continue
        vus[j] = 1
        aVoir.push(j)
      }
    }
    if (trop || touche) continue
    // Trop bas dans le dessin : ce n'est plus un visage.
    if (tache.every((i) => ((i / w) | 0) > limiteY)) continue

    // Couleur qui entoure le plus la tache.
    const autour = new Map<number, number>()
    for (const i of tache) {
      const x = i % w, y = (i / w) | 0
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const c = src.u32[yy * w + xx]
        if (c === couleur || getA(c) === 0) continue
        autour.set(c, (autour.get(c) ?? 0) + 1)
      }
    }
    let gagnante = 0, n = 0
    for (const [c, v] of autour) if (v > n) { n = v; gagnante = c }
    if (!gagnante) continue
    for (const i of tache) out.u32[i] = gagnante
  }
  return out
}

/** La vue de dos devinee : le dessin retourne, sans les traits du visage. */
export function vueDeDos(face: Bitmap, opts: OptionsDos = DOS_DEFAUT): Bitmap {
  return effacerLesDetails(retourner(face), opts)
}

/**
 * Les deux vues d'un dessin dont on ne possede que la face.
 *
 * C'est ce qu'on donne au rendu pour qu'un tour complet tienne debout : la
 * face sert de zero a cent-quatre-vingts degres pres, le dos prend le relais
 * de l'autre cote, et aucune direction n'est jamais a plus d'un quart de tour
 * d'un dessin.
 */
export function sourcesFaceEtDos(
  face: Bitmap, relief?: ProfilRelief, opts: OptionsDos = DOS_DEFAUT,
): VueSource[] {
  const profil = relief ?? { hauteur: hauteurSuggeree(face), galbe: 0.5 }
  const dos = vueDeDos(face, opts)
  return [
    { azimut: 0, elevation: 0, bitmap: face, champ: champAuto(face, profil) },
    { azimut: Math.PI, elevation: 0, bitmap: dos, champ: champAuto(dos, profil) },
  ]
}
