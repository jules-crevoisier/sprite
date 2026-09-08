import { CLIPS_PIXL, imageDePose } from './mascot-clips'
import { TAILLE, type ClipMascotte } from './mascot-anim'

/**
 * Pixl dans l'interface.
 *
 * Les cycles vivent dans `mascot-clips` et les poses dans `mascot-anim` :
 * rien n'est redessine ici. Ce module ne fait que deux choses — poser les
 * images sur un canvas a l'echelle entiere, et choisir laquelle afficher
 * selon le temps ecoule et la cadence du cycle.
 *
 * Choisir l'image par le temps, et non par un minuteur qui incremente, est
 * ce qui garde plusieurs mascottes affichees en meme temps sur la meme
 * cadence : un onglet en arriere-plan gele les rAF, et des compteurs
 * incrementes repartiraient chacun avec son propre retard.
 */

export type ClipId = 'repos' | 'marche' | 'course' | 'saut' | 'attaque' | 'degats'

const parId = new Map<string, ClipMascotte>(CLIPS_PIXL.map((c) => [c.id, c]))

function clipDe(id: ClipId): ClipMascotte {
  return parId.get(id) ?? CLIPS_PIXL[0]
}

/**
 * Les images d'un cycle, dessinees une fois pour toutes.
 *
 * Composer une pose repeint 1024 pixels un par un : refait a chaque image
 * d'un cycle a 80 ms, cela travaille pour rien puisque les poses ne
 * changent jamais en cours de session.
 */
const cache = new Map<string, HTMLCanvasElement[]>()

export function imagesDuClip(id: ClipId): HTMLCanvasElement[] {
  const existant = cache.get(id)
  if (existant) return existant
  const images = clipDe(id).poses.map((pose) => imageDePose(pose).toCanvas())
  cache.set(id, images)
  return images
}

/**
 * Image a afficher apres `secondes` de lecture.
 *
 * Un cycle qui boucle tourne indefiniment ; un cycle joue une seule fois
 * s'arrete sur sa derniere image plutot que de disparaitre.
 */
function imageAuTemps(clip: ClipMascotte, secondes: number): number {
  const n = clip.poses.length
  const k = Math.floor(secondes / (clip.ms / 1000))
  if (clip.loop) return ((k % n) + n) % n
  return Math.max(0, Math.min(n - 1, k))
}

/** Vrai quand le systeme demande qu'on limite les animations. */
export function mouvementReduit(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ------------------------------------------------------------------ */
/* Horloge partagee                                                    */
/* ------------------------------------------------------------------ */

/**
 * Une seule boucle pour toutes les mascottes affichees.
 *
 * Une boucle par vue multiplierait les reveils du navigateur alors que
 * toutes lisent la meme horloge ; et une vue retiree du document
 * laisserait derriere elle un rAF qui tourne dans le vide.
 */
const vues: VuePixl[] = []
let boucle = 0

/**
 * Une carte reconstruite arrache puis remet son contenu dans le meme tour
 * de boucle. Retirer une vue des la premiere image ou elle est detachee la
 * ferait donc mourir a chaque redessin de la barre du haut : on attend
 * qu'elle soit vraiment partie.
 */
const IMAGES_AVANT_OUBLI = 120

function tic(now: number): void {
  const reduit = mouvementReduit()
  for (let i = vues.length - 1; i >= 0; i--) {
    const vue = vues[i]
    if (!vue.node.isConnected) {
      if (++vue.absente > IMAGES_AVANT_OUBLI) vues.splice(i, 1)
      continue
    }
    vue.absente = 0
    if (reduit) vue.figer()
    else vue.avancer(now)
  }
  // Mouvement refuse : les poses sont fixes, il n'y a plus rien a calculer
  // et la boucle s'arrete. Le changement de preference la relancera.
  boucle = vues.length && !reduit ? requestAnimationFrame(tic) : 0
}

function inscrire(vue: VuePixl): void {
  vues.push(vue)
  if (!boucle) boucle = requestAnimationFrame(tic)
}

if (typeof matchMedia === 'function') {
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    if (!boucle && vues.length) boucle = requestAnimationFrame(tic)
  })
}

/* ------------------------------------------------------------------ */
/* Vue                                                                 */
/* ------------------------------------------------------------------ */

export interface OptionsVue {
  /** Facteur entier : le pixel doit rester carre. */
  echelle?: number
  clip?: ClipId
  titre?: string
}

/**
 * Pixl posee dans la page.
 *
 * Le canvas fait 32 pixels de cote et c'est le CSS qui l'agrandit d'un
 * facteur entier : c'est la meme convention que l'apercu et les vignettes
 * de la timeline, et c'est ce qui garde le bord des pixels net.
 */
export class VuePixl {
  readonly node: HTMLCanvasElement
  /** Nombre d'images consecutives passees hors du document. */
  absente = 0

  private ctx: CanvasRenderingContext2D
  private clip: ClipMascotte
  private debut = 0
  private index = -1
  /** Cycle repris quand un cycle joue une seule fois arrive au bout. */
  private suite: ClipId | null = null
  /**
   * Une mascotte posee dans un coin permanent de l'interface ne doit pas
   * bouger pendant qu'on dessine. Elle garde alors sa pose et n'avance
   * qu'a la demande — au survol, ou le temps d'une reaction.
   */
  private endormie = false

  constructor(opts: OptionsVue = {}) {
    const echelle = Math.max(1, Math.round(opts.echelle ?? 1))
    this.clip = clipDe(opts.clip ?? 'repos')
    const node = document.createElement('canvas')
    node.width = TAILLE
    node.height = TAILLE
    node.className = 'pixl'
    node.style.width = `${TAILLE * echelle}px`
    node.style.height = `${TAILLE * echelle}px`
    node.dataset.pixl = this.clip.id
    if (opts.titre) node.title = opts.titre
    this.node = node
    this.ctx = node.getContext('2d')!
    this.dessiner(0)
    inscrire(this)
  }

  /** Reprend un cycle depuis sa premiere image. */
  jouer(id: ClipId, suite: ClipId | null = null): void {
    this.clip = clipDe(id)
    this.suite = this.clip.loop ? null : suite
    this.debut = performance.now()
    this.node.dataset.pixl = this.clip.id
    this.dessiner(0)
  }

  /** Pose fixe : c'est tout ce qui reste quand le mouvement est refuse. */
  figer(): void {
    if (this.index !== 0) this.dessiner(0)
  }

  /** S'arrete sur la premiere image du cycle courant. */
  dormir(): void {
    this.endormie = true
    this.figer()
  }

  reveiller(): void {
    this.endormie = false
    this.debut = performance.now()
  }

  avancer(now: number): void {
    if (this.endormie) return
    if (!this.debut) this.debut = now
    const t = (now - this.debut) / 1000
    const k = imageAuTemps(this.clip, t)
    // Un cycle joue une fois rend la main apres sa derniere image, pas
    // pendant : sinon la pose finale n'est jamais vue.
    if (!this.clip.loop && this.suite && t >= (this.clip.poses.length * this.clip.ms) / 1000) {
      this.jouer(this.suite)
      return
    }
    if (k !== this.index) this.dessiner(k)
  }

  private dessiner(k: number): void {
    const images = imagesDuClip(this.clip.id as ClipId)
    const img = images[Math.min(k, images.length - 1)]
    this.ctx.clearRect(0, 0, TAILLE, TAILLE)
    this.ctx.drawImage(img, 0, 0)
    this.index = k
    // Lisible depuis l'exterieur : c'est ce qui permet de verifier qu'une
    // mascotte s'anime vraiment, et qu'elle ne s'anime pas quand on l'a
    // priee de rester tranquille.
    this.node.dataset.image = String(k)
  }
}

/* ------------------------------------------------------------------ */
/* Identite de l'onglet                                                */
/* ------------------------------------------------------------------ */

/**
 * Icone d'onglet dessinee depuis la pose de repos.
 *
 * Dessinee plutot que recopiee en dur : les poses sont retouchees ailleurs,
 * et une copie figee dans le HTML finirait par montrer une mascotte que
 * l'application n'a plus. Le facteur deux donne 64 pixels, que les tailles
 * usuelles d'icone (16 et 32) reduisent par un entier.
 */
function faviconPixl(): string {
  const echelle = 2
  const cote = TAILLE * echelle
  const c = document.createElement('canvas')
  c.width = cote
  c.height = cote
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(imagesDuClip('repos')[0], 0, 0, cote, cote)
  return c.toDataURL('image/png')
}

/** Pose l'icone d'onglet ; l'icone du HTML n'est qu'un pis-aller au demarrage. */
export function poserFavicon(): void {
  const lien = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
  lien.type = 'image/png'
  lien.href = faviconPixl()
}
