import type { App } from './app'
import { el, clear } from './dom'
import { icon } from './icons'
import { confirmDialog, openModal, showToast } from './overlay'

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
  private spotlight = el('div', { class: 'tutor-spotlight', hidden: true })
  private poll = 0
  private raf = 0
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
    if (completed && this.lesson) markDone(this.lesson.id)
    this.lesson = null
    this.target = null
    this.card.hidden = true
    this.spotlight.hidden = true
    clearInterval(this.poll)
    cancelAnimationFrame(this.raf)
  }

  private next(): void {
    if (!this.lesson) return
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
    this.render()
  }

  private previous(): void {
    if (this.index <= 0) return
    this.index -= 2
    this.next()
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
        el('span', { html: icon(lesson.icon, 15), style: { color: 'var(--accent)', display: 'flex' } }),
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
    if (step.auto) {
      foot.appendChild(el('button', {
        class: 'btn sm',
        title: 'Executer cette etape a votre place',
        onclick: async () => {
          await step.auto!()
          if (!step.done?.()) this.next()
        },
      }, step.autoLabel ?? 'Faire pour moi'))
    }
    foot.appendChild(el('button', {
      class: 'btn sm primary', onclick: () => this.next(),
    }, this.index === lesson.steps.length - 1 ? 'Terminer' : 'Suivant'))
    this.card.appendChild(foot)

    if (step.done) {
      this.card.appendChild(el('p', { class: 'tutor-tip' },
        'L\'etape se valide toute seule des que c\'est fait.'))
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
        el('p', { class: 'form-note' },
          'Chaque lecon charge un document de demonstration et se deroule dans l\'editeur. ',
          'Vous pouvez faire le geste vous-meme ou laisser la lecon le faire pour voir le resultat.'),
        el('div', { style: { height: '12px' } }),
        list,
      ),
      actions: [{ label: 'Fermer', primary: true }],
    })
  }

  /** Propose la premiere lecon au tout premier lancement. */
  async offerFirstRun(lessons: Lesson[]): Promise<void> {
    try {
      if (localStorage.getItem(SEEN_KEY)) return
      localStorage.setItem(SEEN_KEY, '1')
    } catch { return }
    if (await confirmDialog(
      'Bienvenue dans PixelForge',
      'Une visite guidee de quelques minutes montre le dessin, l\'animation, le squelette et l\'export vers Unity ou Godot. La lancer ?',
      'Commencer la visite',
    )) {
      void this.start(lessons[0])
    }
  }
}
