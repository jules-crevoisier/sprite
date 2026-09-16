import { centreRef, REF_MIN, type BoiteRef } from './reference'

/**
 * La TRANSFORMATION MODALE, telle que Blender la pratique.
 *
 * ## Pourquoi copier Blender ici, et quoi exactement
 *
 * On a d'abord cru que « separer la reference du dessin » voulait dire la
 * sortir du fichier et de l'historique. Blender ne fait ni l'un ni l'autre :
 * son image de reference est enregistree dans le .blend, et la deplacer entre
 * dans l'annulation globale comme le reste. Ce qu'il separe, c'est la FACON
 * D'Y TOUCHER — et c'est ce qui donne le sentiment qu'elle n'est pas dans le
 * dessin.
 *
 * Dans Blender on ne saisit pas l'image. On appuie sur G, on bouge la souris
 * sans rien tenir, et l'on clique pour poser. Consequences, toutes voulues :
 *
 * - le bouton de la souris ne sert jamais a l'attraper, donc elle ne peut plus
 *   voler un clic au dessin ;
 * - il n'y a rien a viser : pas de poignee a trouver, pas de bord a manquer,
 *   et l'image peut etre entierement hors du cadre qu'on la deplace quand meme ;
 * - Echap remet tout comme avant. Un geste rate n'est pas une annulation a
 *   faire apres coup, c'est un geste qui n'a pas eu lieu ;
 * - on peut TAPER la valeur pendant le geste, contraindre a un axe, ralentir.
 *
 * ## Les conventions reprises telles quelles
 *
 * G deplacer, R tourner, S dimensionner. X et Y contraignent a un axe. Ctrl
 * pose par crans, Maj ralentit. Les chiffres tapes donnent la valeur exacte.
 * Entree ou clic gauche valident, Echap ou clic droit annulent. Alt+G, Alt+R,
 * Alt+S remettent a zero. Les reprendre a l'identique n'est pas de la
 * paresse : quelqu'un qui vient de Blender les a dans les doigts, et les
 * changer « en mieux » ne ferait que le faire echouer plus longtemps.
 */
export type ModeTransfo = 'deplacer' | 'tourner' | 'dimensionner'

export interface EtatTransfo {
  mode: ModeTransfo
  /** La boite telle qu'elle etait au depart : Echap y revient. */
  depart: BoiteRef
  /** Ou etait le curseur quand le geste a commence, en pixels du sprite. */
  ancre: { x: number; y: number }
  /** L'axe impose par X ou Y, ou null. */
  axe: 'x' | 'y' | null
  /** Ce qui a ete tape : « », « 12 », « -3.5 ». */
  saisie: string
  /** Ctrl : par crans. Maj : au ralenti. */
  crans: boolean
  lent: boolean
}

/** Le pas des crans, sous Ctrl, pour chaque geste. */
const CRAN = { deplacer: 1, tourner: 15, dimensionner: 0.1 }
/**
 * Le ralenti de Maj.
 *
 * Blender ralentit A PARTIR DU MOMENT ou l'on presse Maj ; on divise ici le
 * deplacement entier, ce qui fait sauter l'image au moment ou l'on appuie.
 * C'est la seule simplification de cette reprise, et elle est assumee : la
 * version fidele demande de retenir la position du curseur a l'instant de
 * l'appui, pour un gain qui ne se voit que sur des ecarts d'un pixel.
 */
const LENT = 0.2

export function demarrerTransfo(
  mode: ModeTransfo, boite: BoiteRef, curseur: { x: number; y: number },
): EtatTransfo {
  return {
    mode,
    depart: { ...boite, rotation: boite.rotation ?? 0 },
    ancre: { ...curseur },
    axe: null,
    saisie: '',
    crans: false,
    lent: false,
  }
}

/** La valeur tapee, ou null si ce qui est tape n'est pas encore un nombre. */
function nombreTape(saisie: string): number | null {
  if (!saisie || saisie === '-' || saisie === '.' || saisie === '-.') return null
  const v = Number(saisie)
  return Number.isFinite(v) ? v : null
}

/**
 * La boite pendant le geste, telle qu'on la voit bouger.
 *
 * Le centre est le pivot de la rotation ET de la mise a l'echelle — c'est le
 * point median de Blender, son pivot par defaut, et c'est aussi le seul point
 * qui ne bouge pas quand on tourne : prendre un coin ferait fuir l'image.
 */
export function boiteTransformee(
  etat: EtatTransfo, curseur: { x: number; y: number },
): BoiteRef {
  const d = etat.depart
  const centre = centreRef(d)
  const tape = nombreTape(etat.saisie)

  if (etat.mode === 'deplacer') {
    let dx = curseur.x - etat.ancre.x
    let dy = curseur.y - etat.ancre.y
    if (etat.lent) { dx *= LENT; dy *= LENT }
    if (etat.axe === 'x') dy = 0
    if (etat.axe === 'y') dx = 0
    if (tape !== null) {
      // Une valeur tapee sans axe va sur X, comme dans Blender.
      dx = etat.axe === 'y' ? 0 : tape
      dy = etat.axe === 'y' ? tape : 0
    } else if (etat.crans) {
      dx = Math.round(dx / CRAN.deplacer) * CRAN.deplacer
      dy = Math.round(dy / CRAN.deplacer) * CRAN.deplacer
    }
    return { ...d, x: d.x + dx, y: d.y + dy }
  }

  if (etat.mode === 'tourner') {
    let angle: number
    if (tape !== null) angle = tape
    else {
      const a0 = Math.atan2(etat.ancre.y - centre.y, etat.ancre.x - centre.x)
      const a1 = Math.atan2(curseur.y - centre.y, curseur.x - centre.x)
      angle = ((a1 - a0) * 180) / Math.PI
      if (etat.lent) angle *= LENT
    }
    let rotation = (d.rotation ?? 0) + angle
    if (tape === null && etat.crans) rotation = Math.round(rotation / CRAN.tourner) * CRAN.tourner
    rotation = ((rotation + 180) % 360 + 360) % 360 - 180
    return { ...d, rotation }
  }

  // Dimensionner : le rapport des distances au centre, comme S dans Blender.
  const d0 = Math.hypot(etat.ancre.x - centre.x, etat.ancre.y - centre.y)
  const d1 = Math.hypot(curseur.x - centre.x, curseur.y - centre.y)
  let facteur = tape !== null ? tape : (d0 > 1e-6 ? d1 / d0 : 1)
  if (tape === null && etat.lent) facteur = 1 + (facteur - 1) * LENT
  if (tape === null && etat.crans) {
    facteur = Math.round(facteur / CRAN.dimensionner) * CRAN.dimensionner
  }
  // Un facteur nul ou negatif ferait disparaitre l'image sans retour visible.
  facteur = Math.max(0.01, Math.abs(facteur))
  const l = Math.max(REF_MIN, (etat.axe === 'y' ? d.l : d.l * facteur))
  const h = Math.max(REF_MIN, (etat.axe === 'x' ? d.h : d.h * facteur))
  return { ...d, l, h, x: centre.x - l / 2, y: centre.y - h / 2 }
}

/** Ce qu'une touche fait pendant un geste. */
export type SuiteTransfo = 'continue' | 'confirme' | 'annule' | 'ignore'

/**
 * La frappe pendant un geste modal.
 *
 * Elle passe avant tous les raccourcis : pendant un G, la touche X n'echange
 * plus les couleurs, elle contraint le deplacement a l'horizontale. C'est la
 * regle de Blender, et c'est ce qui rend la frappe utilisable — sans elle,
 * chaque lettre ferait deux choses a la fois.
 */
export function toucheTransfo(etat: EtatTransfo, e: KeyboardEvent): SuiteTransfo {
  const k = e.key
  if (k === 'Escape') return 'annule'
  if (k === 'Enter' || k === 'NumpadEnter') return 'confirme'

  if (k === 'x' || k === 'X') { etat.axe = etat.axe === 'x' ? null : 'x'; return 'continue' }
  if (k === 'y' || k === 'Y') { etat.axe = etat.axe === 'y' ? null : 'y'; return 'continue' }

  // On change de geste en cours de route, comme dans Blender : un G qui
  // devient un R sans relacher, parce qu'on s'est trompe de touche.
  if (k === 'g' || k === 'G') { etat.mode = 'deplacer'; etat.saisie = ''; return 'continue' }
  if (k === 'r' || k === 'R') { etat.mode = 'tourner'; etat.saisie = ''; return 'continue' }
  if (k === 's' || k === 'S') { etat.mode = 'dimensionner'; etat.saisie = ''; return 'continue' }

  if (k === 'Backspace') { etat.saisie = etat.saisie.slice(0, -1); return 'continue' }
  if (/^[0-9]$/.test(k)) { etat.saisie += k; return 'continue' }
  if ((k === '.' || k === ',') && !etat.saisie.includes('.')) { etat.saisie += '.'; return 'continue' }
  if (k === '-') {
    etat.saisie = etat.saisie.startsWith('-') ? etat.saisie.slice(1) : `-${etat.saisie}`
    return 'continue'
  }
  return 'ignore'
}

/** Ce que le geste affiche pendant qu'il dure, a la maniere de l'en-tete de Blender. */
export function libelleTransfo(etat: EtatTransfo, boite: BoiteRef): string {
  const axe = etat.axe ? ` ${etat.axe.toUpperCase()}` : ''
  const tape = etat.saisie ? ` [${etat.saisie}]` : ''
  if (etat.mode === 'deplacer') {
    const dx = boite.x - etat.depart.x
    const dy = boite.y - etat.depart.y
    return `Déplacer${axe} : ${arrondi(dx)}, ${arrondi(dy)}${tape}`
  }
  if (etat.mode === 'tourner') {
    return `Tourner : ${arrondi((boite.rotation ?? 0) - (etat.depart.rotation ?? 0))}°${tape}`
  }
  const f = etat.depart.l > 1e-6 ? boite.l / etat.depart.l : 1
  return `Dimensionner${axe} : ×${(Math.round(f * 100) / 100).toFixed(2)}${tape}`
}

function arrondi(v: number): string {
  return String(Math.round(v * 10) / 10)
}

/** Le nom du geste dans l'historique, une fois pose. */
export function nomTransfo(mode: ModeTransfo): string {
  return mode === 'deplacer' ? 'Déplacer la référence'
    : mode === 'tourner' ? 'Tourner la référence' : 'Dimensionner la référence'
}
