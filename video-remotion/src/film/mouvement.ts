import { Easing, interpolate, spring } from 'remotion'

/**
 * Pistes d'animation par images cles.
 *
 * Remotion fournit spring() et interpolate() image par image ; ce qui manque,
 * c'est de pouvoir decrire un deplacement en plusieurs etapes sans empiler
 * les conditions. Une piste est une suite de cles ; chaque cle dit comment on
 * arrive a elle, ce qui laisse melanger un ressort sec et une derive lente
 * dans le meme mouvement, exactement comme un montage alterne les accents et
 * les respirations.
 */
export type Mode = 'ressort' | 'fouet' | 'recul' | 'doux' | 'lineaire' | 'saut'

export interface Cle {
  /** Image a laquelle cette cle est atteinte. */
  f: number
  /** Valeurs de la cle : position, echelle, opacite... au choix de l'appelant. */
  v: number[]
  /** Comment on arrive a cette cle depuis la precedente. */
  mode?: Mode
}

/** Ressort qui depasse un peu : c'est ce depassement qui donne l'accent. */
export const RESSORT_VIF = { damping: 14, mass: 0.85, stiffness: 130 }
/** Coup de fouet de camera : depart sec, arrivee qui se pose. */
export const FOUET = { damping: 26, mass: 1.1, stiffness: 90 }
/**
 * Recul d'ouverture : long et franchement amorti.
 *
 * Sa duree naturelle vaut pres de trois secondes, ce qui laisse au dessin le
 * temps de s'allumer pendant qu'on s'eloigne. Un ressort vif ferait l'inverse :
 * il concentre presque tout le trajet dans son premier tiers et le plan large
 * arriverait avant le dessin.
 */
export const RECUL = { damping: 34, mass: 2.4, stiffness: 26 }

const progression = (frame: number, a: Cle, b: Cle, fps: number): number => {
  const duree = Math.max(1, b.f - a.f)
  const local = frame - a.f
  switch (b.mode ?? 'doux') {
    case 'saut':
      return local >= duree ? 1 : 0
    case 'lineaire':
      return interpolate(local, [0, duree], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    case 'ressort':
      return spring({ frame: local, fps, config: RESSORT_VIF, durationInFrames: duree })
    case 'fouet':
      return spring({ frame: local, fps, config: FOUET, durationInFrames: duree })
    case 'recul':
      return spring({ frame: local, fps, config: RECUL, durationInFrames: duree })
    default:
      return interpolate(local, [0, duree], [0, 1], {
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
  }
}

/** Valeurs de la piste a l'image demandee. */
export function piste(frame: number, cles: Cle[], fps: number): number[] {
  if (!cles.length) return []
  if (frame <= cles[0].f) return cles[0].v
  let i = 0
  while (i < cles.length - 1 && frame > cles[i + 1].f) i++
  const a = cles[i]
  const b = cles[i + 1]
  if (!b) return a.v
  const p = progression(frame, a, b, fps)
  return a.v.map((valeur, k) => valeur + ((b.v[k] ?? valeur) - valeur) * p)
}

/** Rampe bornee entre deux images, avec une arrivee douce. */
export const seg = (frame: number, debut: number, fin: number): number =>
  interpolate(frame, [debut, fin], [0, 1], {
    easing: Easing.bezier(0.33, 0, 0.15, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

/** Rampe brute, sans courbe : pour ce qui doit avancer a vitesse constante. */
export const lin = (frame: number, debut: number, fin: number): number =>
  interpolate(frame, [debut, fin], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

/**
 * Fenetre d'apparition puis de disparition.
 *
 * L'entree monte plus vite qu'elle ne redescend : un element qui sort aussi
 * lentement qu'il est entre donne l'impression que le plan traine.
 */
export const fenetre = (
  frame: number, entree: number, sortie: number, dEntree = 12, dSortie = 10,
): number => seg(frame, entree, entree + dEntree) * (1 - lin(frame, sortie - dSortie, sortie))

/** Numero d'image d'un cycle joue en boucle a la cadence demandee. */
export const imageDeCycle = (frame: number, total: number, ms: number, fps: number): number => {
  const parImage = Math.max(1, Math.round((ms / 1000) * fps))
  return Math.floor(frame / parImage) % total
}
