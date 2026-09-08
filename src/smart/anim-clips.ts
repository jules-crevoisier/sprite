import { capturePose, type BoneRole, type Pose, type Rig } from './rig'

/**
 * Animations preenregistrees.
 *
 * Un cycle n'est pas une suite d'images toutes faites : c'est une courbe par
 * fonction d'os. On decrit « la jambe gauche avance puis recule », et le
 * cycle s'applique a n'importe quel squelette dont les os portent ce role,
 * quels que soient leur nom, leur taille et leur nombre.
 */

/** Ce qu'un cycle fait a un os, en fonction du temps normalise [0, 1[. */
interface Channel {
  /** Rotation, en radians, ajoutee a la pose de repos. */
  angle?: (t: number) => number
  /** Deplacement horizontal, en fraction de la hauteur du squelette. */
  tx?: (t: number) => number
  /** Deplacement vertical, en fraction de la hauteur du squelette. */
  ty?: (t: number) => number
}

export interface AnimClip {
  id: string
  label: string
  hint: string
  /** Roles indispensables : sans eux le cycle n'a rien a animer. */
  needs: BoneRole[]
  /** Nombre de frames conseille. */
  frames: number
  /** Duree conseillee d'une frame, en millisecondes. */
  ms: number
  /**
   * Vrai si la derniere frame enchaine sur la premiere. Un cycle boucle
   * echantillonne t sur [0, 1[ ; un coup unique va jusqu'a 1 inclus, sinon
   * la pose finale manquerait.
   */
  loop: boolean
  channels: Partial<Record<BoneRole, Channel>>
}

const TAU = Math.PI * 2
const sin = (t: number, phase = 0) => Math.sin((t + phase) * TAU)
/** Rampe qui monte puis redescend : utile pour un coup unique. */
const bump = (t: number, at: number, width: number): number => {
  const d = Math.abs(t - at) / width
  return d >= 1 ? 0 : Math.cos(d * Math.PI / 2) ** 2
}
/**
 * Meme rampe, mais sur un cycle qui boucle : la distance est prise sur le
 * cercle, de sorte qu'une bosse posee pres de 0 deborde correctement sur la
 * fin du cycle au lieu d'etre coupee.
 */
const bumpLoop = (t: number, at: number, width: number): number => {
  let d = Math.abs(((t - at) % 1 + 1.5) % 1 - 0.5) / width
  if (d >= 1) return 0
  d = Math.max(0, d)
  return Math.cos(d * Math.PI / 2) ** 2
}

/**
 * Interpolation douce entre des poses cles reparties sur le cycle.
 *
 * Une marche n'est pas un sinus : la jambe d'appui reste tendue et balaie
 * regulierement, tandis que la jambe libre plie franchement le genou pour
 * passer le pied. Decrire les quatre poses cles — contact, bas, passage,
 * haut — donne le bon rythme la ou une seule sinusoide donne un balancement
 * de pendule.
 */
const keys = (values: number[]) => (t: number): number => {
  const n = values.length
  const p = ((t % 1) + 1) % 1 * n
  const i = Math.floor(p)
  const f = p - i
  const a = values[i % n]
  const b = values[(i + 1) % n]
  // Lissage cosinus : les poses cles sont tenues, les passages adoucis.
  return a + (b - a) * (1 - Math.cos(f * Math.PI)) / 2
}

export const ANIM_CLIPS: AnimClip[] = [
  {
    id: 'idle',
    label: 'Repos',
    hint: 'Respiration lente, le personnage reste debout',
    needs: ['torso'],
    frames: 4, ms: 180, loop: true,
    channels: {
      torso: { ty: (t) => sin(t) * 0.012, angle: (t) => sin(t) * 0.02 },
      head: { angle: (t) => sin(t, 0.12) * 0.045 },
      armL: { angle: (t) => sin(t, 0.25) * 0.05 },
      armR: { angle: (t) => -sin(t, 0.25) * 0.05 },
      forearmL: { angle: (t) => -0.06 + sin(t, 0.4) * 0.05 },
      forearmR: { angle: (t) => -0.06 - sin(t, 0.4) * 0.05 },
    },
  },
  {
    id: 'walk',
    label: 'Marche',
    hint: 'Contact, bas, passage, haut — genoux et coudes articules',
    needs: ['legL', 'legR'],
    frames: 8, ms: 110, loop: true,
    channels: {
      // Le corps est au plus bas au contact et au plus haut au passage :
      // c'est ce va-et-vient, pas le balancement des jambes, qui donne le poids.
      torso: {
        ty: keys([0.004, 0.012, -0.010, 0.002]),
        tx: (t) => sin(t, 0.25) * 0.035,
        angle: (t) => sin(t, 0.25) * 0.03,
      },
      head: { angle: (t) => -sin(t, 0.25) * 0.04 },

      // Cuisse gauche : en avant au contact, en arriere une demi-periode plus
      // tard. Le tibia reste tendu a l'appui et plie fort pour passer le pied.
      legL: { angle: keys([0.42, 0.14, -0.16, -0.40]) },
      shinL: { angle: (t) => -0.10 - bumpLoop(t, 0.66, 0.34) * 0.72 },
      legR: { angle: (t) => keys([0.42, 0.14, -0.16, -0.40])(t + 0.5) },
      shinR: { angle: (t) => -0.10 - bumpLoop(t + 0.5, 0.66, 0.34) * 0.72 },

      // Bras a contretemps des jambes, coude toujours un peu flechi.
      armL: { angle: (t) => keys([-0.34, -0.12, 0.14, 0.32])(t) },
      forearmL: { angle: (t) => -0.20 - bumpLoop(t, 0.2, 0.4) * 0.28 },
      armR: { angle: (t) => keys([-0.34, -0.12, 0.14, 0.32])(t + 0.5) },
      forearmR: { angle: (t) => -0.20 - bumpLoop(t + 0.5, 0.2, 0.4) * 0.28 },
    },
  },
  {
    id: 'run',
    label: 'Course',
    hint: 'Buste penche, grandes foulees, genoux tres flechis',
    needs: ['legL', 'legR'],
    frames: 8, ms: 70, loop: true,
    channels: {
      torso: {
        ty: keys([0.006, 0.022, -0.030, -0.004]),
        tx: (t) => sin(t, 0.25) * 0.06,
        angle: (t) => 0.2 + sin(t, 0.25) * 0.05,
      },
      head: { angle: (t) => -0.18 - sin(t, 0.25) * 0.06 },

      // La course ramene le talon haut sous la cuisse : le tibia plie bien
      // plus qu'a la marche, et la jambe arriere reste flechie a la poussee.
      legL: { angle: keys([0.85, 0.2, -0.3, -0.7]) },
      shinL: { angle: (t) => -0.25 - bumpLoop(t, 0.62, 0.42) * 1.5 },
      legR: { angle: (t) => keys([0.85, 0.2, -0.3, -0.7])(t + 0.5) },
      shinR: { angle: (t) => -0.25 - bumpLoop(t + 0.5, 0.62, 0.42) * 1.5 },

      armL: { angle: (t) => keys([-0.75, -0.2, 0.35, 0.7])(t) },
      forearmL: { angle: () => -1.1 },
      armR: { angle: (t) => keys([-0.75, -0.2, 0.35, 0.7])(t + 0.5) },
      forearmR: { angle: () => -1.1 },
    },
  },
  {
    id: 'jump',
    label: 'Saut',
    hint: 'Flexion, detente, suspension, reception — ne boucle pas',
    needs: ['torso'],
    frames: 6, ms: 90, loop: false,
    channels: {
      // Le corps s'ecrase, se detend, retombe : une seule courbe pilote tout.
      torso: { ty: (t) => (t < 0.25 ? t * 0.16 : -bump(t, 0.62, 0.5) * 0.13) },
      // Flexion des genoux a l'appel, extension a la detente, retour flechi
      // a la reception : c'est le tibia qui porte l'essentiel du geste.
      legL: { angle: (t) => (t < 0.25 ? 0.45 : -bump(t, 0.6, 0.55) * 0.35) },
      legR: { angle: (t) => (t < 0.25 ? -0.45 : bump(t, 0.6, 0.55) * 0.35) },
      shinL: { angle: (t) => (t < 0.25 ? -0.9 : -bump(t, 0.95, 0.35) * 0.7) },
      shinR: { angle: (t) => (t < 0.25 ? -0.9 : -bump(t, 0.95, 0.35) * 0.7) },
      armL: { angle: (t) => (t < 0.25 ? 0.5 : -bump(t, 0.55, 0.6) * 1.5) },
      armR: { angle: (t) => (t < 0.25 ? -0.5 : bump(t, 0.55, 0.6) * 1.5) },
      forearmL: { angle: (t) => (t < 0.25 ? -0.6 : -bump(t, 0.5, 0.6) * 0.5) },
      forearmR: { angle: (t) => (t < 0.25 ? -0.6 : -bump(t, 0.5, 0.6) * 0.5) },
      head: { angle: (t) => bump(t, 0.15, 0.4) * 0.12 },
    },
  },
  {
    id: 'attack',
    label: 'Attaque',
    hint: 'Armer, frapper, revenir — le bras droit mene le coup',
    needs: ['armR'],
    frames: 5, ms: 70, loop: false,
    channels: {
      // Armer lentement, frapper vite : l'elan se lit dans l'ecart des poses.
      // Armer le bras haut derriere, puis abattre : l'avant-bras suit avec
      // un temps de retard, ce qui donne le fouette du coup.
      armR: { angle: (t) => (t < 0.35 ? -t * 3.4 : -1.2 + (t - 0.35) * 4.6) },
      forearmR: { angle: (t) => (t < 0.4 ? -t * 2.6 : -1.05 + (t - 0.4) * 2.6) },
      armL: { angle: (t) => (t < 0.35 ? t * 0.9 : 0.3 - (t - 0.35) * 0.5) },
      forearmL: { angle: () => -0.45 },
      torso: { angle: (t) => (t < 0.35 ? -t * 0.5 : -0.18 + (t - 0.35) * 0.9), tx: (t) => bump(t, 0.7, 0.4) * 0.03 },
      head: { angle: (t) => (t < 0.35 ? t * 0.3 : 0.1 - (t - 0.35) * 0.45) },
      legL: { angle: (t) => bump(t, 0.7, 0.5) * 0.22 },
      legR: { angle: (t) => -bump(t, 0.7, 0.5) * 0.12 },
    },
  },
  {
    id: 'fly',
    label: 'Vol',
    hint: 'Ailes battantes et corps qui flotte',
    needs: ['wingL', 'wingR'],
    frames: 6, ms: 90, loop: true,
    channels: {
      wingL: { angle: (t) => sin(t) * 0.85 },
      wingR: { angle: (t) => -sin(t) * 0.85 },
      torso: { ty: (t) => sin(t, 0.25) * 0.035 },
      head: { angle: (t) => sin(t, 0.25) * 0.05 },
      tail: { angle: (t) => sin(t, 0.15) * 0.18 },
    },
  },
  {
    id: 'hurt',
    label: 'Touche',
    hint: 'Recul et sursaut, pour un degat encaisse — ne boucle pas',
    needs: ['torso'],
    frames: 4, ms: 80, loop: false,
    channels: {
      // Le choc est sur la premiere image : un coup encaisse ne se prepare
      // pas. Les suivantes se relachent, avec un sursaut au passage.
      torso: {
        angle: (t) => -bump(t, 0, 1) * 0.4 + bump(t, 0.55, 0.35) * 0.12,
        tx: (t) => -bump(t, 0, 1.1) * 0.09,
        ty: (t) => -bump(t, 0.35, 0.4) * 0.03,
      },
      head: { angle: (t) => -bump(t, 0, 0.9) * 0.5 + bump(t, 0.6, 0.4) * 0.15 },
      armL: { angle: (t) => bump(t, 0, 1) * 0.95 },
      armR: { angle: (t) => -bump(t, 0.1, 1) * 0.95 },
      forearmL: { angle: (t) => -bump(t, 0.15, 0.9) * 0.7 },
      forearmR: { angle: (t) => -bump(t, 0.15, 0.9) * 0.7 },
      legL: { angle: (t) => -bump(t, 0.2, 0.9) * 0.28 },
      legR: { angle: (t) => bump(t, 0.4, 0.9) * 0.28 },
      shinL: { angle: (t) => -bump(t, 0.3, 0.9) * 0.45 },
      shinR: { angle: (t) => -bump(t, 0.3, 0.9) * 0.3 },
    },
  },
  {
    id: 'wag',
    label: 'Queue et tete',
    hint: 'Balancement doux, pour un animal ou un decor vivant',
    needs: [],
    frames: 6, ms: 130, loop: true,
    channels: {
      tail: { angle: (t) => sin(t) * 0.35 },
      head: { angle: (t) => sin(t, 0.3) * 0.12 },
      armL: { angle: (t) => sin(t, 0.15) * 0.14 },
      armR: { angle: (t) => sin(t, 0.65) * 0.14 },
      wingL: { angle: (t) => sin(t, 0.15) * 0.2 },
      wingR: { angle: (t) => -sin(t, 0.15) * 0.2 },
      torso: { angle: (t) => sin(t, 0.5) * 0.04 },
    },
  },
]

/** Roles effectivement portes par le squelette. */
export const rolesOf = (rig: Rig): Set<BoneRole> =>
  new Set(rig.bones.map((b) => b.role).filter((r) => r !== 'none'))

/**
 * Vrai si le squelette a de quoi jouer ce cycle. Un cycle dont il manque un
 * role obligatoire n'animerait rien : autant le dire avant.
 */
export const clipFits = (clip: AnimClip, rig: Rig): boolean => {
  const roles = rolesOf(rig)
  return clip.needs.every((r) => roles.has(r))
}

/** Ce que le cycle fera bouger sur ce squelette, en clair. */
export function clipTouches(clip: AnimClip, rig: Rig): string[] {
  const roles = rolesOf(rig)
  return rig.bones
    .filter((b) => roles.has(b.role) && clip.channels[b.role])
    .map((b) => b.name)
}

/**
 * Hauteur du squelette, qui sert d'unite aux deplacements : un cycle decrit
 * un rebond en fraction de la taille du personnage, pas en pixels, donc il
 * tombe juste sur un sprite de 16 comme de 128.
 */
function rigHeight(rig: Rig): number {
  if (!rig.bones.length) return 1
  let top = Infinity, bottom = -Infinity
  for (const b of rig.bones) {
    top = Math.min(top, b.y, b.ey)
    bottom = Math.max(bottom, b.y, b.ey)
  }
  return Math.max(1, bottom - top)
}

/**
 * Pose du cycle a l'instant `t`, sur la base de la pose de repos donnee.
 * Les os que le cycle ne connait pas gardent leur pose de depart : on peut
 * donc poser une tete a la main et lui appliquer une marche par-dessus.
 */
export function poseAt(rig: Rig, clip: AnimClip, t: number, base?: Pose): Pose {
  const depart = base ?? capturePose(rig)
  const echelle = rigHeight(rig)
  const pose: Pose = {}
  for (const bone of rig.bones) {
    const de = depart[bone.id] ?? { angle: 0, tx: 0, ty: 0, scale: 1 }
    const canal = clip.channels[bone.role]
    pose[bone.id] = canal
      ? {
          angle: de.angle + (canal.angle?.(t) ?? 0),
          tx: de.tx + (canal.tx?.(t) ?? 0) * echelle,
          ty: de.ty + (canal.ty?.(t) ?? 0) * echelle,
          scale: de.scale,
        }
      : { ...de }
  }
  return pose
}

/**
 * Les poses successives d'un cycle. Un cycle boucle s'arrete avant 1 pour ne
 * pas repeter la premiere image ; un coup unique va jusqu'a 1.
 */
export function clipPoses(rig: Rig, clip: AnimClip, frames: number, base?: Pose): Pose[] {
  const n = Math.max(1, Math.round(frames))
  const depart = base ?? capturePose(rig)
  const out: Pose[] = []
  for (let i = 0; i < n; i++) {
    const t = clip.loop ? i / n : (n === 1 ? 0 : i / (n - 1))
    out.push(poseAt(rig, clip, t, depart))
  }
  return out
}
