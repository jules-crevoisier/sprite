import { Bitmap } from '../core/bitmap'
import { getA } from '../core/color'
import { champAuto, hauteurSuggeree, type ProfilRelief } from './depth'
import type { Piece, VueSource } from './scene'
import { vueDeDos, DOS_DEFAUT, type OptionsDos } from './vues'
import { applyX, applyY, worldTransforms, type Rig, type RigPart } from './rig'

/**
 * Pont entre le squelette et la scene volumetrique.
 *
 * Le squelette pose un personnage dans le plan du dessin : c'est ainsi qu'un
 * dessinateur travaille, et il n'y a aucune raison de lui demander de manier
 * des angles d'Euler pour lever un bras. Mais une pose plate ne se regarde
 * que de face, et c'est exactement ce qui donne au rig son air de jouet : on
 * articule un personnage, puis on decouvre qu'on ne peut le montrer que sous
 * l'angle ou il a ete dessine.
 *
 * Ce module coupe le dessin en morceaux — un par os — et pose chacun d'eux
 * dans l'espace. Le decoupage ne coute rien : la carte de poids attribue deja
 * chaque pixel a son os, c'est le travail que la liaison a fait. Le morceau
 * garde les coordonnees du dessin d'origine, tourne autour de l'attache de
 * son os par la rotation que la pose lui a donnee, et se place a la
 * profondeur de cet os.
 *
 * Le resultat : un cycle de marche pose une seule fois, en deux dimensions,
 * se rend sous n'importe quelle camera — les huit directions d'un jeu vu de
 * dessus, ou une planche isometrique — sans qu'aucune image ne soit
 * redessinee.
 *
 * ## Ce que la pose 2D ne dit pas
 *
 * Un bras leve reste un bras leve vu de dos : la pose ne contient pas
 * l'information de savoir s'il est devant ou derriere le corps. C'est
 * `bone.depth` qui le dit, et il faut le renseigner — un os laisse a zero
 * vit dans le plan du dessin et traversera le torse au quart de tour. Le
 * banc mesure cette traversee plutot que de la laisser se decouvrir a
 * l'usage.
 */

/** Un morceau de dessin et l'os qui le porte. */
export interface MorceauOs {
  /** Index de l'os dans `rig.bones`, ou null pour les pixels libres. */
  os: number | null
  piece: Piece
}

export interface OptionsPieces {
  /** Relief donne a chaque morceau ; par defaut, devine sur sa silhouette. */
  relief?: ProfilRelief
  /**
   * Vues supplementaires par os, quand l'artiste a dessine un profil ou un
   * dos. La cle est l'index de l'os.
   */
  vuesSupplementaires?: Map<number, VueSource[]>
  /**
   * Ajoute a chaque morceau une vue de dos devinee : le morceau retourne,
   * sans les traits du visage. Sans elle, le demi-tour montre un personnage
   * qui a des yeux dans la nuque.
   *
   * Une vue dessinee a la main pour le meme os prime : `choisirSource` prend
   * la plus proche, et deux sources a la meme direction se departagent dans
   * l'ordre ou elles arrivent — les supplementaires sont ajoutees apres.
   */
  dosAuto?: boolean
  /** Reglage de la devinette du dos. */
  optionsDos?: OptionsDos
}

/**
 * Isole les pixels d'un os dans une bitmap de meme taille que le dessin.
 *
 * On garde la taille d'origine plutot que de recadrer : les coordonnees du
 * morceau restent celles du dessin, donc le pivot de l'os s'y lit directement
 * et aucun decalage n'a a être reporte. Le cout d'une bitmap pleine par os
 * est negligeable devant la lisibilite gagnee.
 */
function morceauDe(source: Bitmap, poids: Uint8Array, os: number | null): Bitmap | null {
  const out = new Bitmap(source.width, source.height)
  const cle = os === null ? 255 : os
  let compte = 0
  for (let i = 0; i < source.u32.length; i++) {
    if (getA(source.u32[i]) === 0) continue
    if (poids[i] !== cle) continue
    out.u32[i] = source.u32[i]
    compte++
  }
  return compte ? out : null
}

/**
 * Construit les pieces de scene d'un calque relie, dans sa pose courante.
 *
 * Le demi-tour pseudo-3D du squelette (`rig.turn`) est volontairement ignore :
 * il ecrasait le sprite horizontalement pour simuler une rotation, ce que la
 * camera fait maintenant pour de vrai. Les appliquer tous les deux ferait
 * tourner le personnage deux fois.
 */
export function piecesDuRig(
  rig: Rig,
  part: RigPart,
  opts: OptionsPieces = {},
): MorceauOs[] {
  const mondes = worldTransforms({ ...rig, turn: null })
  const out: MorceauOs[] = []

  const construire = (os: number | null): void => {
    const bitmap = morceauDe(part.rest, part.weights, os)
    if (!bitmap) return

    const relief = opts.relief ?? { hauteur: hauteurSuggeree(bitmap), galbe: 0.5 }
    const champ = champAuto(bitmap, relief)
    const sources: VueSource[] = [{ azimut: 0, elevation: 0, bitmap, champ }]
    if (opts.dosAuto) {
      const dos = vueDeDos(bitmap, opts.optionsDos ?? DOS_DEFAUT)
      sources.push({ azimut: Math.PI, elevation: 0, bitmap: dos, champ: champAuto(dos, relief) })
    }
    if (os !== null) {
      const extra = opts.vuesSupplementaires?.get(os)
      if (extra) sources.push(...extra)
    }

    if (os === null) {
      // Les pixels qu'aucun os ne porte ne bougent pas : ils restent la ou
      // ils sont dessines, dans le plan. Les perdre serait pire que de les
      // laisser rigides — le banc verifie qu'aucun pixel ne disparait.
      out.push({
        os: null,
        piece: {
          nom: 'libre',
          sources,
          pivot: { x: 0, y: 0, z: 0 },
          position: { x: 0, y: 0, z: 0 },
          rotation: { lacet: 0, tangage: 0, roulis: 0 },
        },
      })
      return
    }

    const bone = rig.bones[os]
    const m = mondes.get(bone.id)
    // Sans transformation connue, l'os est laisse au repos plutot que
    // d'envoyer son morceau a l'origine.
    const px = m ? applyX(m, bone.x, bone.y) : bone.x
    const py = m ? applyY(m, bone.x, bone.y) : bone.y
    // La pose du squelette est une rotation dans le plan du dessin : c'est
    // un roulis, pas un lacet. La confondre ferait pivoter le bras autour de
    // l'axe vertical du personnage au lieu de le lever.
    const roulis = m ? Math.atan2(m[1], m[0]) : 0

    out.push({
      os,
      piece: {
        nom: bone.name,
        sources,
        pivot: { x: bone.x, y: bone.y, z: 0 },
        position: { x: px, y: py, z: bone.depth },
        rotation: { lacet: 0, tangage: 0, roulis },
      },
    })
  }

  for (let i = 0; i < rig.bones.length; i++) construire(i)
  construire(null)
  return out
}

/** Les pieces de tous les calques relies, dans l'ordre de liaison. */
export function piecesDeLaScene(rig: Rig, opts: OptionsPieces = {}): Piece[] {
  const out: Piece[] = []
  for (const part of rig.parts) {
    for (const { piece } of piecesDuRig(rig, part, opts)) out.push(piece)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Mesures                                                             */
/* ------------------------------------------------------------------ */

/**
 * Verifie que le decoupage par os ne perd ni ne duplique aucun pixel.
 *
 * C'est l'invariant qui protege le pont tout entier : un pixel attribue a
 * aucun os disparaitrait du rendu, un pixel compte deux fois clignoterait
 * selon l'ordre du tampon de profondeur. Les deux se voient a peine sur une
 * image fixe et sautent aux yeux en mouvement.
 */
export function bilanDecoupage(part: RigPart, morceaux: MorceauOs[]): {
  origine: number
  morceaux: number
  doublons: number
} {
  let origine = 0
  for (let i = 0; i < part.rest.u32.length; i++) {
    if (getA(part.rest.u32[i]) !== 0) origine++
  }
  const vus = new Uint8Array(part.rest.u32.length)
  let total = 0
  let doublons = 0
  for (const { piece } of morceaux) {
    const b = piece.sources[0].bitmap
    for (let i = 0; i < b.u32.length; i++) {
      if (getA(b.u32[i]) === 0) continue
      total++
      if (vus[i]) doublons++
      vus[i] = 1
    }
  }
  return { origine, morceaux: total, doublons }
}
