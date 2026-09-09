import type { App } from './app'
import { el, clear } from './dom'
import { icon } from './icons'
import { confirmDialog, openModal } from './overlay'
import { VuePixl } from './mascot-view'
import { marqueReagit } from './mascot-ui'

export interface TutorialStep {
  text: string
  /** Element a mettre en avant, resolu au moment ou l'etape commence. */
  target?: () => Element | null
  /** Execute l'étape a la place de l'utilisateur. */
  auto?: () => void | Promise<void>
  autoLabel?: string
  /** Vrai quand l'étape est réussie : l'avancement est alors automatique. */
  done?: () => boolean
  /** Preparation silencieuse a l'entrée dans l'etape. */
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

/**
 * Ce que Pixl dit quand une etape est reussie.
 *
 * Court, et jamais la meme deux fois de suite : une felicitation qui se
 * repete mot pour mot cesse d'etre lue des la troisieme etape. Le texte de
 * la consigne, lui, ne bouge pas — c'est la mascotte qui commente, pas le
 * logiciel qui se felicite.
 */
const BRAVOS = [
  'Bien joue.', 'C\'est ca.', 'Voila.', 'Parfait.', 'Nickel.',
  'Exactement.', 'Impeccable.', 'On continue.',
]

/** Ce qu'elle dit quand elle attend depuis un moment. */
const PATIENCES = [
  'Je vous attends — le geste est juste la.',
  'Prenez votre temps, je ne bouge pas.',
  'C\'est la zone en surbrillance.',
]

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
 * avant, et l'étape se valide seule des que l'utilisateur a fait le geste.
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
  private pixl = new VuePixl({ echelle: 3, clip: 'repos', titre: 'Pixl vous accompagne' })
  /**
   * La bulle porte la consigne, et par-dessus les reactions de Pixl. Elle
   * est gardee d'une étape a l'autre pour qu'une reaction en cours ne soit
   * pas effacee par le rendu de l'etape suivante.
   */
  private bulle = el('p', { class: 'tutor-bulle' })
  private direTimer = 0
  /** Derniere felicitation dite, pour ne jamais la repeter d'affilee. */
  private dernierBravo = -1
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

  /**
   * Pixl dit une phrase, puis rend la bulle a la consigne.
   *
   * La consigne reste la reference : une reaction qui resterait affichee
   * effacerait ce qu'il y a a faire, et c'est exactement au moment ou l'on
   * felicite que la personne cherche l'etape suivante.
   */
  private parler(texte: string, ms = 1500): void {
    window.clearTimeout(this.direTimer)
    this.bulle.textContent = texte
    this.bulle.classList.add('dit')
    this.direTimer = window.setTimeout(() => {
      this.bulle.classList.remove('dit')
      const step = this.lesson?.steps[this.index]
      if (step) this.bulle.textContent = step.text
    }, ms)
  }

  /** Une felicitation, jamais la meme que la precedente. */
  private bravo(): string {
    let i = this.dernierBravo
    while (i === this.dernierBravo) i = Math.floor(Math.random() * BRAVOS.length)
    this.dernierBravo = i
    return BRAVOS[i]
  }

  /* ---------------------------------------------------------------- */
  /* Cycle de vie                                                      */
  /* ---------------------------------------------------------------- */

  async start(lesson: Lesson): Promise<void> {
    if (lesson.setup) {
      const dirty = this.app.ed.history.canUndo
      if (dirty && !(await confirmDialog(
        lesson.title,
        'Cette leçon charge un document de démonstration et remplace le travail en cours. Continuer ?',
        'Charger la démo',
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
    window.clearTimeout(this.direTimer)
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
      this.feter(this.lesson)
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
        if (!this.lesson || step.done!()) return
        this.pixl.jouer('marche')
        this.parler(PATIENCES[Math.floor(Math.random() * PATIENCES.length)], 2800)
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
      // La lecon peut avoir passe sa derniere etape pendant que la boucle
      // attendait de repartir : `this.index` sort alors du tableau, et la
      // fete est deja a l'écran. Il n'y a plus rien a surveiller.
      if (!step) { clearInterval(this.poll); return }
      // La cible peut apparaitre apres coup, par exemple a l'ouverture d'un panneau.
      if (!this.target && step.target) this.target = step.target()
      if (step.done?.()) {
        // Le geste est fait : elle saute. La carte devient verte au meme
        // instant, la mascotte dit la meme chose plus vite que la couleur.
        this.pixl.jouer('saut', 'repos')
        this.parler(this.bravo(), 1100)
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

    // Une jauge par etape plutot qu'une barre continue : sur une lecon de
    // quatorze etapes, un trait qui avance de sept pour cent ne se voit pas,
    // alors qu'un segment qui s'allume se voit toujours.
    const jauge = el('div', { class: 'tutor-jauge' })
    for (let i = 0; i < lesson.steps.length; i++) {
      jauge.appendChild(el('i', { class: i < this.index ? 'fait' : i === this.index ? 'ici' : '' }))
    }

    window.clearTimeout(this.direTimer)
    this.bulle.classList.remove('dit')
    this.bulle.textContent = step.text

    this.card.append(
      el('div', { class: 'tutor-head' },
        el('strong', null, lesson.title),
        el('span', { class: 'spacer' }),
        el('span', { class: 'tutor-count' }, `${this.index + 1}/${lesson.steps.length}`),
        el('button', { class: 'btn ghost sm icon-only', title: 'Quitter', html: icon('close', 14), onclick: () => this.stop() }),
      ),
      jauge,
      // La consigne sort de la bouche de la mascotte, elle n'est pas
      // affichee a cote d'elle : c'est ce qui fait qu'on la lit comme
      // quelqu'un qui parle plutot que comme un panneau d'aide.
      el('div', { class: 'tutor-corps' },
        el('div', { class: 'tutor-scene' }, this.pixl.node),
        this.bulle,
      ),
    )

    const foot = el('div', { class: 'tutor-foot' })
    foot.appendChild(el('button', {
      class: 'btn sm', disabled: this.index === 0, onclick: () => this.previous(),
    }, 'Précédent'))
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
        title: 'Montrer le résultat — a vous de refaire le geste ensuite',
        onclick: async () => { await step.auto!() },
      }, step.autoLabel ?? 'Montrer'))
    }

    if (enAttente && !this.skipOffered) {
      foot.appendChild(el('button', {
        class: 'btn sm primary', disabled: true,
        title: 'Faites le geste decrit : l\'étape se valide toute seule',
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
        'A vous de jouer : l\'étape se valide des que c\'est fait.'))
    }
  }

  /**
   * Fin de lecon : la carte reste, et Pixl fete.
   *
   * Un simple message qui passe se lit comme une notification de plus. Une
   * lecon qui se termine merite qu'on s'arrete dessus une seconde — c'est
   * le seul moment ou la personne a fini quelque chose.
   */
  private feter(lesson: Lesson): void {
    markDone(lesson.id)
    this.target = null
    this.spotlight.hidden = true
    this.app.viewport.gesture = null
    this.app.viewport.invalidate()
    clearInterval(this.poll)
    window.clearTimeout(this.direTimer)
    clear(this.card)
    this.card.classList.add('fete')

    this.pixl.jouer('attaque', 'repos')
    const faites = new Set(loadDone())
    // `lessons` est une methode : lire `.length` dessus donnerait le nombre
    // de parametres declares, c'est-a-dire zero, et la ligne de compte ne
    // s'afficherait jamais.
    const total = this.app.lessons().length

    this.card.append(
      el('div', { class: 'tutor-corps' },
        el('div', { class: 'tutor-scene' }, this.pixl.node),
        el('div', { class: 'tutor-bulle' },
          el('b', null, 'Leçon terminée.'),
          el('span', null, `${lesson.title} — ${lesson.steps.length} étapes.`),
          total ? el('span', { class: 'tutor-compte' },
            `${faites.size} leçon${faites.size > 1 ? 's' : ''} sur ${total}.`) : null,
        ),
      ),
      el('div', { class: 'tutor-foot' },
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'btn sm primary', onclick: () => { this.card.classList.remove('fete'); this.stop(true) },
        }, 'Continuer'),
      ),
    )
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
          ? el('span', { html: icon('check', 16), style: { color: 'var(--ok)', display: 'flex' } })
          : el('span', { class: 'form-note' }, `${lesson.steps.length} étapes`),
      ))
    }
    const handle = openModal({
      title: 'Tutoriels',
      icon: 'info',
      body: el('div', null,
        el('div', { class: 'pixl-guide' },
          el('div', { class: 'pixl-guide-scene' }, new VuePixl({ echelle: 2, clip: 'repos' }).node),
          el('div', null,
            el('b', { style: { display: 'block', fontSize: '13px', marginBottom: '3px' } },
              done.size === 0
                ? 'On commence quand vous voulez.'
                : done.size >= lessons.length
                  ? 'Vous les avez toutes faites.'
                  : `${done.size} leçon${done.size > 1 ? 's' : ''} sur ${lessons.length}.`),
            el('p', { class: 'form-note', style: { margin: '0' } },
              'Chaque leçon se deroule dans l\'éditeur, sur un document de démonstration. ',
              'Faites le geste vous-même, ou laissez la leçon le faire pour voir le résultat.'),
          ),
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
   * C'est le tout premier écran du logiciel : Pixl s'y presente elle-meme
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
              'et elle a été dessinee ici — c\'est tout ce que fait ce logiciel.'),
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
