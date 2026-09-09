/**
 * Courbes de vitesse.
 *
 * Une interpolation lineaire donne un mouvement de machine : la meme distance
 * a chaque image, du depart a l'arrivee. Le metier repartit autrement — un
 * geste demarre lentement et se termine vite, un objet lourd depasse sa cible
 * avant de revenir. C'est cette répartition, et non le nombre d'images, qui
 * donne du poids.
 *
 * Chaque courbe transforme une progression de 0 a 1 en une autre progression.
 * Toutes valent 0 en 0 et 1 en 1 : la pose de depart et la pose d'arrivee
 * restent celles demandees, seule la maniere d'aller de l'une a l'autre change.
 */

export type EasingId =
  | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  | 'slow-start' | 'slow-end' | 'anticipate' | 'overshoot' | 'bounce' | 'elastic'

export interface Easing {
  id: EasingId
  label: string
  hint: string
  fn: (t: number) => number
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Rebond amorti, facon balle qui retombe. */
function bounceOut(t: number): number {
  const n = 7.5625, d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) { const u = t - 1.5 / d; return n * u * u + 0.75 }
  if (t < 2.5 / d) { const u = t - 2.25 / d; return n * u * u + 0.9375 }
  const u = t - 2.625 / d
  return n * u * u + 0.984375
}

export const EASINGS: Easing[] = [
  {
    id: 'linear',
    label: 'Lineaire',
    hint: 'Même distance a chaque image — utile pour une machine ou un defilement',
    fn: (t) => t,
  },
  {
    id: 'ease-in',
    label: 'Depart doux',
    hint: 'Démarré lentement et accéléré : une masse qui se met en marche',
    fn: (t) => t * t,
  },
  {
    id: 'ease-out',
    label: 'Arrivee douce',
    hint: 'Part vite et ralentit a l\'arrivee : un geste qui se pose',
    fn: (t) => 1 - (1 - t) * (1 - t),
  },
  {
    id: 'ease-in-out',
    label: 'Doux aux deux bouts',
    hint: 'Ralenti au depart et a l\'arrivee : le réglage le plus courant',
    fn: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  },
  {
    id: 'slow-start',
    label: 'Elan',
    hint: 'Longue mise en route puis detente franche, pour un coup',
    fn: (t) => t * t * t,
  },
  {
    id: 'slow-end',
    label: 'Amorti',
    hint: 'Arrivee très progressive, pour un objet lourd qui se pose',
    fn: (t) => 1 - (1 - t) ** 3,
  },
  {
    id: 'anticipate',
    label: 'Anticipation',
    hint: 'Recule un peu avant de partir : l\'elan se lit avant le geste',
    fn: (t) => { const c = 1.70158; return t * t * ((c + 1) * t - c) },
  },
  {
    id: 'overshoot',
    label: 'Dépassement',
    hint: 'Dépasse la cible puis revient : donne du ressort a une pose',
    fn: (t) => { const c = 1.70158; const u = t - 1; return 1 + u * u * ((c + 1) * u + c) },
  },
  {
    id: 'bounce',
    label: 'Rebond',
    hint: 'Retombe en rebondissant, pour une reception ou une chute',
    fn: bounceOut,
  },
  {
    id: 'elastic',
    label: 'Elastique',
    hint: 'Oscille autour de la cible avant de se fixer',
    fn: (t) => {
      if (t === 0 || t === 1) return t
      const p = (2 * Math.PI) / 3
      return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * p) + 1
    },
  },
]

const BY_ID = new Map(EASINGS.map((e) => [e.id, e]))

export const easingById = (id: EasingId): Easing => BY_ID.get(id) ?? EASINGS[0]

/** Applique une courbe a une progression, bornee a l'intervalle utile. */
export const ease = (id: EasingId, t: number): number => easingById(id).fn(clamp01(t))

/**
 * Points de la courbe, pour la dessiner. Le trace vaut mieux qu'un nom :
 * « depassement » ne dit rien tant qu'on n'a pas vu la courbe sortir du cadre.
 */
export function easingPath(id: EasingId, samples = 32): { x: number; y: number }[] {
  const fn = easingById(id).fn
  const out: { x: number; y: number }[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    out.push({ x: t, y: fn(t) })
  }
  return out
}
