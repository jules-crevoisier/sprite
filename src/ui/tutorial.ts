import type { App } from './app'
import { el, clear } from './dom'
import { icon } from './icons'
import { confirmDialog, openModal, showToast } from './overlay'
import { VuePixl } from './mascot-view'
import { marqueReagit } from './mascot-ui'

export interface TutorialStep {
  text: string
  /** Element a mettre en avant, resolu au moment ou l'etape commence. */
  target?: () => Element | null
  /** Execute l'etape a la place de l'utilisateur. */
  auto?: () => void | Promise<void>
  autoLabel?: string
  /** Vrai quand l'etape est reussie : l'avancement est alors automatique. */
  done?: () => boolean
  /** Preparation silencieuse a l'entree dans l'etape. */
  enter?: () => void
  /**
   * Geste a montrer sur la toile, en coordonnees sprite. Une fleche animee
   * designe le mouvement a faire : c'est plus clair qu'une phrase.
   */
  gesture?: () => { from: [number, number]; to: [number, number] } | null
}

export interface Lesson {
  id: string
  title: string
  hint: string
  icon: string
  /** Charge un document de demonstration. */
  setup?: () => void
  steps: TutorialStep[]
}

/**
 * Delai avant de proposer une sortie sur une etape qui attend un geste. Assez
 * long pour qu'on essaie vraiment, assez court pour ne pas coincer.
 */
const SKIP_AFTER_MS = 25000

/**
 * Delai avant que Pixl ne se mette a faire les cent pas sur une etape en
 * attente. Assez court pour qu'on comprenne qu'on cherche, assez long pour
 * ne pas s'agiter pendant qu'on lit la consigne.
 */
const PATIENCE_MS = 9000

const DONE_KEY = 'pixelforge.tutorials.done'
const SEEN_KEY = 'pixelforge.tutorials.seen'

function loadDone(): string[] {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[] } catch { return [] }
}
function markDone(id: string): void {
  const all = new Set(loadDone())
  all.add(id)
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...all])) } catch { /* quota */ }
}

/**
 * Visite guidee : une carte decrit l'etape, la zone concernee est mise en
 * avant, et l'etape se valide seule des que l'utilisateur a fait le geste.
 * Chaque etape peut aussi s'executer a sa place, pour voir le resultat
 * avant de refaire soi-meme.
 */
export class Tutorial {
  private app: App
  private lesson: Lesson | null = null
  private index = 0
  private card = el('div', { class: 'tutor-card', hidden: true })
  /**
   * Pixl accompagne la lecon. Elle est construite une fois et repose d'une
   * etape a l'autre : la carte est refaite a chaque etape, une mascotte
   * recreee repartirait de sa premiere image a chaque phrase lue.
   */
  private pixl = new VuePixl({ clip: 'repos', titre: 'Pixl vous accompagne' })
  private spotlight = el('div', { class: 'tutor-spotlight', hidden: true })
  private poll = 0
  private raf = 0
  /** Minuteur du filet de securite, et son etat. */
  private skipTimer = 0
  private skipOffered = false
  /** Minuteur des cent pas de la mascotte. */
  private patienceTimer = 0
  private target: Element | null = null

  constructor(app: App) {
    this.app = app
    document.body.append(this.spotlight, this.card)
  }

  get running(): boolean { return this.lesson !== null }

  /* ---------------------------------------------------------------- */
  /* Cycle de vie                                                      */
  /* ---------------------------------------------------------------- */

  async start(lesson: Lesson): Promise<void> {
    if (lesson.setup) {
      const dirty = this.app.ed.history.canUndo
      if (dirty && !(await confirmDialog(
        lesson.title,
        'Cette lecon charge un document de demonstration et remplace le travail en cours. Continuer ?',
        'Charger la demo',
      ))) return
      lesson.setup()
    }
    this.lesson = lesson
    this.index = -1
    this.card.hidden = false
    this.next()
    this.loop()
  }

  stop(completed = false): void {
    window.clearTimeout(this.skipTimer)
    window.clearTimeout(this.patienceTimer)
    this.skipOffered = false
    // La lecon finie, la carte disparait : la reaction passe donc a la
    // marque, seule presence de Pixl qui reste a l'ecran.
    if (completed) marqueReagit('attaque')
    if (completed && this.lesson) markDone(this.lesson.id)
    this.lesson = null
    this.target = null
    this.app.viewport.gesture = null
    this.app.viewport.invalidate()
    this.card.hidden = true
    this.spotlight.hidden = true
    clearInterval(this.poll)
    cancelAnimationFrame(this.raf)
  }

  /**
   * Passe a l'etape suivante.
   *
   * `force` distingue le geste accompli du bouton : une etape en attente ne
   * s'ouvre qu'au geste, et le bouton n'apparait qu'une fois le filet de
   * securite propose.
   */
  private next(force = false): void {
    if (!this.lesson) return
    const courante = this.lesson.steps[this.index]
    if (force && courante?.done && !courante.done() && !this.skipOffered) return
    window.clearTimeout(this.skipTimer)
    window.clearTimeout(this.patienceTimer)
    this.skipOffered = false
    this.pixl.jouer('repos')
    this.index++
    if (this.index >= this.lesson.steps.length) {
      const title = this.lesson.title
      this.stop(true)
      showToast(`Lecon terminee : ${title}`, 'success')
      return
    }
    const step = this.lesson.steps[this.index]
    step.enter?.()
    this.target = step.target?.() ?? null
    this.app.viewport.gesture = step.gesture?.() ?? null
    this.app.viewport.invalidate()
    this.render()

    // Un `done()` peut se reveler impossible — un panneau ferme, un document
    // remplace. On ne retient donc personne indefiniment : passe un delai,
    // une sortie discrete apparait.
    if (step.done && !step.done()) {
      this.skipTimer = window.setTimeout(() => {
        this.skipOffered = true
        if (this.lesson) this.render()
      }, SKIP_AFTER_MS)
      // Elle fait les cent pas plutot que de rester assise : c'est le signe
      // qu'on attend quelque chose de nous, sans une phrase de plus.
      this.patienceTimer = window.setTimeout(() => {
        if (this.lesson && !step.done!()) this.pixl.jouer('marche')
      }, PATIENCE_MS)
    }
  }

  private previous(): void {
    if (this.index <= 0) return
    window.clearTimeout(this.skipTimer)
    window.clearTimeout(this.patienceTimer)
    this.skipOffered = false
    this.index -= 2
    this.next(true)
  }

  /** Surveille la reussite de l'etape et suit la cible si la vue bouge. */
  private loop(): void {
    clearInterval(this.poll)
    this.poll = window.setInterval(() => {
      if (!this.lesson) return
      const step = this.lesson.steps[this.index]
      // La cible peut apparaitre apres coup, par exemple a l'ouverture d'un panneau.
      if (!this.target && step.target) this.target = step.target()
      if (step.done?.()) {
        // Le geste est fait : elle saute. La carte devient verte au meme
        // instant, la mascotte dit la meme chose plus vite que la couleur.
        this.pixl.jouer('saut', 'repos')
        window.clearTimeout(this.patienceTimer)
        this.card.classList.add('validated')
        setTimeout(() => { this.card.classList.remove('validated'); this.next() }, 420)
        clearInterval(this.poll)
        setTimeout(() => this.loop(), 500)
      }
    }, 320)

    const follow = () => {
      if (!this.lesson) return
      this.placeSpotlight()
      this.placeCard()
      this.raf = requestAnimationFrame(follow)
    }
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(follow)
  }

  /**
   * La carte reste dans la zone de dessin, jamais sur la timeline ni sur un
   * dock, et bascule a droite si elle recouvre la zone mise en avant.
   */
  private placeCard(): void {
    const area = document.getElementById('canvas-area')
    if (!area) return
    const zone = area.getBoundingClientRect()
    const card = this.card.getBoundingClientRect()
    const margin = 14
    let left = zone.left + margin
    const top = zone.bottom - card.height - margin

    if (!this.spotlight.hidden) {
      const halo = this.spotlight.getBoundingClientRect()
      const overlaps =
        halo.left < left + card.width + margin && halo.right > left &&
        halo.top < top + card.height && halo.bottom > top
      // A droite si la place y est, en haut a gauche sinon.
      if (overlaps) {
        const right = zone.right - card.width - margin
        left = right > halo.right + margin ? right : left
        if (left === zone.left + margin) {
          this.card.style.top = `${zone.top + margin}px`
          this.card.style.bottom = 'auto'
          this.card.style.left = `${left}px`
          return
        }
      }
    }
    this.card.style.top = 'auto'
    this.card.style.bottom = `${window.innerHeight - zone.bottom + margin}px`
    this.card.style.left = `${Math.max(margin, left)}px`
  }

  private placeSpotlight(): void {
    if (!this.target || !document.contains(this.target)) {
      this.spotlight.hidden = true
      return
    }
    const r = this.target.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) { this.spotlight.hidden = true; return }
    this.spotlight.hidden = false
    const pad = 5
    Object.assign(this.spotlight.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Carte                                                             */
  /* ---------------------------------------------------------------- */

  private render(): void {
    const lesson = this.lesson
    if (!lesson) return
    const step = lesson.steps[this.index]
    clear(this.card)

    this.card.append(
      el('div', { class: 'tutor-head' },
        el('span', { class: 'tutor-pixl' }, this.pixl.node),
        el('strong', null, lesson.title),
        el('span', { class: 'spacer' }),
        el('span', { class: 'tutor-count' }, `${this.index + 1}/${lesson.steps.length}`),
        el('button', { class: 'btn ghost sm icon-only', title: 'Quitter', html: icon('close', 13), onclick: () => this.stop() }),
      ),
      el('div', { class: 'tutor-progress' },
        el('i', { style: { width: `${((this.index + 1) / lesson.steps.length) * 100}%` } })),
      el('p', { class: 'tutor-text' }, step.text),
    )

    const foot = el('div', { class: 'tutor-foot' })
    foot.appendChild(el('button', {
      class: 'btn sm', disabled: this.index === 0, onclick: () => this.previous(),
    }, 'Precedent'))
    foot.appendChild(el('span', { class: 'spacer' }))

    // Une etape qui attend un geste ne se passe pas au bouton.
    //
    // C'est tout l'interet d'un tutoriel qui fait faire : tant que le geste
    // n'est pas accompli, « Suivant » reste inerte. L'etape se valide seule
    // des que c'est fait — le bouton n'est la que pour les etapes qui ne
    // demandent rien, et comme filet de securite au bout d'un moment.
    const enAttente = !!step.done && !step.done()

    if (step.auto) {
      foot.appendChild(el('button', {
        class: 'btn sm',
        title: 'Montrer le resultat — a vous de refaire le geste ensuite',
        onclick: async () => { await step.auto!() },
      }, step.autoLabel ?? 'Montrer'))
    }

    if (enAttente && !this.skipOffered) {
      foot.appendChild(el('button', {
        class: 'btn sm primary', disabled: true,
        title: 'Faites le geste decrit : l\'etape se valide toute seule',
      }, 'En attente…'))
    } else {
      if (enAttente) {
        // Filet de securite : au bout d'un moment, on ne retient personne.
        foot.appendChild(el('button', {
          class: 'btn sm',
          title: 'Passer sans faire le geste',
          onclick: () => this.next(true),
        }, 'Passer'))
      }
      foot.appendChild(el('button', {
        class: 'btn sm primary', onclick: () => this.next(true),
      }, this.index === lesson.steps.length - 1 ? 'Terminer' : 'Suivant'))
    }
    this.card.appendChild(foot)

    if (enAttente) {
      this.card.appendChild(el('p', { class: 'tutor-tip' },
        'A vous de jouer : l\'etape se valide des que c\'est fait.'))
    }
  }

  /* ---------------------------------------------------------------- */
  /* Choix d'une lecon                                                 */
  /* ---------------------------------------------------------------- */

  openPicker(lessons: Lesson[]): void {
    const done = new Set(loadDone())
    const list = el('div', { style: { display: 'grid', gap: '8px' } })
    for (const lesson of lessons) {
      list.appendChild(el('button', {
        class: 'layer-row',
        style: { padding: '10px', border: '1px solid var(--line)', alignItems: 'flex-start' },
        onclick: () => { handle.close(); void this.start(lesson) },
      },
        el('span', { html: icon(lesson.icon, 17), style: { color: 'var(--accent)', display: 'flex', marginTop: '2px' } }),
        el('span', { style: { flex: '1', textAlign: 'left' } },
          el('b', { style: { display: 'block', fontSize: '13px' } }, lesson.title),
          el('span', { class: 'form-note' }, lesson.hint)),
        done.has(lesson.id)
          ? el('span', { html: icon('check', 15), style: { color: 'var(--ok)', display: 'flex' } })
          : el('span', { class: 'form-note' }, `${lesson.steps.length} etapes`),
      ))
    }
    const handle = openModal({
      title: 'Tutoriels',
      icon: 'info',
      body: el('div', null,
        el('div', { class: 'pixl-guide' },
          el('div', { class: 'pixl-guide-scene' }, new VuePixl({ echelle: 2, clip: 'repos' }).node),
          el('p', { class: 'form-note', style: { margin: '0' } },
            'Chaque lecon charge un document de demonstration et se deroule dans l\'editeur. ',
            'Vous pouvez faire le geste vous-meme ou laisser la lecon le faire pour voir le resultat. ',
            'Pixl vous accompagne : elle saute quand une etape est reussie.'),
        ),
        el('div', { style: { height: '12px' } }),
        list,
      ),
      actions: [{ label: 'Fermer', primary: true }],
    })
  }

  /**
   * Propose la premiere lecon au tout premier lancement.
   *
   * C'est le tout premier ecran du logiciel : Pixl s'y presente elle-meme
   * plutot que de laisser un paragraphe seul dire ce qu'est l'application.
   */
  async offerFirstRun(lessons: Lesson[]): Promise<void> {
    try {
      if (localStorage.getItem(SEEN_KEY)) return
      localStorage.setItem(SEEN_KEY, '1')
    } catch { return }
    const accepte = await new Promise<boolean>((resolve) => {
      let repondu = false
      const vue = new VuePixl({ echelle: 3, clip: 'repos' })
      openModal({
        title: 'Bienvenue dans PixelForge',
        icon: 'info',
        body: el('div', { class: 'pixl-bienvenue' },
          el('div', { class: 'pixl-bienvenue-scene' }, vue.node),
          el('div', null,
            el('p', { class: 'form-note', style: { margin: '0 0 8px', fontSize: '13px' } },
              'Voici Pixl. Elle fait trente-deux pixels de cote, elle a six cycles d\'animation, ',
              'et elle a ete dessinee ici — c\'est tout ce que fait ce logiciel.'),
            el('p', { class: 'form-note', style: { margin: '0' } },
              'Une visite guidee de quelques minutes montre le dessin, l\'animation, le squelette ',
              'et l\'export vers Unity ou Godot. La lancer ?'),
          ),
        ),
        actions: [
          { label: 'Plus tard', onClick: () => { repondu = true; resolve(false) } },
          { label: 'Commencer la visite', primary: true, onClick: () => { repondu = true; resolve(true) } },
        ],
        onClose: () => { if (!repondu) resolve(false) },
      })
    })
    if (accepte) void this.start(lessons[0])
  }
}
