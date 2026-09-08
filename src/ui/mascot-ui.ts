import type { App } from './app'
import { el } from './dom'
import { icon } from './icons'
import { openModal, showToast } from './overlay'
import { CLIPS_PIXL } from './mascot-clips'
import { VuePixl, mouvementReduit, type ClipId } from './mascot-view'

/**
 * Pixl dans l'application.
 *
 * Une mascotte qui n'apparait que dans une demo est un contenu ; celle-ci
 * est l'identite du logiciel, elle tient donc la marque, accompagne les
 * lecons et occupe les endroits ou il n'y a rien a montrer. La regle qui
 * decide de chaque emplacement est toujours la meme : elle prend un espace
 * vide ou un temps d'attente, jamais la zone de dessin, et elle ne bouge
 * pas toute seule dans un coin permanent de l'ecran.
 */

/* ------------------------------------------------------------------ */
/* La marque                                                           */
/* ------------------------------------------------------------------ */

/** Clics rapproches qui reveillent la mascotte, et le delai qui les lie. */
const CLICS_SECRET = 5
const FENETRE_SECRET = 3000

let marque: HTMLElement | null = null
let vueMarque: VuePixl | null = null
let clics: number[] = []

/**
 * Pixl en guise de logo.
 *
 * La barre du haut se reconstruit a chaque changement de document ou
 * d'historique. On garde donc le meme element d'un rendu a l'autre : le
 * recreer relancerait le cycle et ferait sauter la mascotte a chaque coup
 * de crayon.
 */
export function marquePixl(app: App): HTMLElement {
  if (marque) return marque
  const vue = new VuePixl({ clip: 'repos', titre: 'Pixl, la mascotte de PixelForge' })
  // Immobile tant qu'on ne s'occupe pas d'elle : le logo est dans le champ
  // de vision en permanence, et un logo qui remue derange le dessin.
  vue.dormir()
  vueMarque = vue

  const hote = el('div', { class: 'brand-mark' }, vue.node)
  hote.addEventListener('pointerenter', () => { vue.jouer('repos'); vue.reveiller() })
  hote.addEventListener('pointerleave', () => { vue.jouer('repos'); vue.dormir() })
  hote.addEventListener('click', () => {
    const maintenant = Date.now()
    clics = clics.filter((t) => maintenant - t < FENETRE_SECRET)
    clics.push(maintenant)
    if (clics.length >= CLICS_SECRET) {
      clics = []
      traverseeDePixl(app)
      return
    }
    vue.reveiller()
    vue.jouer('saut', 'repos')
  })
  marque = hote
  return hote
}

/** Reaction de la marque a un evenement de l'application. */
export function marqueReagit(clip: ClipId): void {
  if (!vueMarque || mouvementReduit()) return
  vueMarque.reveiller()
  vueMarque.jouer(clip, 'repos')
  // Elle se rendort ensuite : la marque n'est pas un endroit ou quelque
  // chose bouge en continu.
  window.setTimeout(() => { vueMarque?.jouer('repos'); vueMarque?.dormir() }, 1400)
}

/* ------------------------------------------------------------------ */
/* Etats vides                                                         */
/* ------------------------------------------------------------------ */

/**
 * Un espace vide avec Pixl dedans.
 *
 * « Aucun resultat » sur une page blanche laisse croire a une panne. La
 * mascotte donne un point de regard, et le cycle choisi dit ce qui se
 * passe mieux qu'une phrase de plus.
 */
export function videAvecPixl(texte: string, clip: ClipId = 'repos', detail?: string): HTMLElement {
  const vue = new VuePixl({ echelle: 2, clip })
  if (clip !== 'repos') vue.jouer(clip, 'repos')
  return el('div', { class: 'pixl-vide' },
    vue.node,
    el('p', null, texte),
    detail ? el('span', null, detail) : null,
  )
}

/* ------------------------------------------------------------------ */
/* La carte d'accueil                                                  */
/* ------------------------------------------------------------------ */

/**
 * Premier ecran : le document est vierge et la toile est un carre vide au
 * milieu d'un grand fond. Pixl s'y installe le temps qu'on decide quoi
 * faire, et s'efface au premier trait — elle occupe l'attente, elle ne
 * partage pas le travail.
 */
export function carteAccueilPixl(app: App): HTMLElement {
  const vue = new VuePixl({ echelle: 2, clip: 'repos' })
  const carte = el('div', { class: 'pixl-accueil' })
  const abonnements: (() => void)[] = []
  const fermer = () => {
    for (const delier of abonnements.splice(0)) delier()
    carte.style.opacity = '0'
    window.setTimeout(() => carte.remove(), 200)
  }

  const raccourci = (touches: string, quoi: string) =>
    el('li', null, el('kbd', null, touches), el('span', null, quoi))

  carte.append(
    el('button', {
      class: 'btn ghost sm icon-only pixl-accueil-x',
      title: 'Fermer', html: icon('close', 12), onclick: fermer,
    }),
    el('div', { class: 'pixl-accueil-tete' },
      vue.node,
      el('div', null,
        el('strong', null, 'Bonjour, je suis Pixl.'),
        el('p', null, 'Trente-deux pixels de cote, six cycles, dessinee ici meme.'),
      ),
    ),
    el('ul', { class: 'pixl-accueil-liste' },
      raccourci('Ctrl+K', 'toutes les commandes'),
      raccourci('F1', 'les raccourcis'),
      raccourci('Glisser', 'importer une image'),
    ),
    el('div', { class: 'pixl-accueil-pied' },
      el('button', {
        class: 'btn sm primary',
        onclick: () => { fermer(); app.runCommand('help.tutorials') },
      }, 'Visite guidee'),
      el('button', {
        class: 'btn sm',
        title: 'Charger Pixl et ses six cycles',
        onclick: () => { fermer(); app.runCommand('file.mascotte') },
      }, 'Ouvrir Pixl'),
    ),
  )

  // Le premier trait dit que la place est prise : la carte s'en va sans
  // qu'on ait a la fermer.
  abonnements.push(
    app.ed.events.on('doc', () => { if (app.ed.history.canUndo) fermer() }),
    // Un document charge par-dessus — une demo, un projet — prend la place
    // lui aussi, sans passer par l'historique.
    app.ed.events.on('reload', fermer),
  )
  return carte
}

/* ------------------------------------------------------------------ */
/* La planche des six cycles                                           */
/* ------------------------------------------------------------------ */

/**
 * Les six cycles cote a cote, chacun a sa propre cadence.
 *
 * C'est la recompense de l'easter egg : une planche de modele qu'on ne
 * peut pas lire dans la timeline, ou les six cycles se suivent au lieu de
 * tourner ensemble.
 */
export function plancheDePixl(app: App): void {
  const grille = el('div', { class: 'pixl-planche' })
  for (const clip of CLIPS_PIXL) {
    const vue = new VuePixl({ echelle: 3, clip: clip.id as ClipId })
    // Les cycles qui ne bouclent pas repartiraient une fois pour toutes sur
    // leur derniere image : sur une planche, on veut les revoir. La pause
    // avant le passage suivant laisse voir la pose finale sans faire du
    // cycle une boucle deguisee.
    if (!clip.loop) rejouerSansFin(vue, clip.id as ClipId, clip.poses.length * clip.ms + PAUSE_PLANCHE)
    grille.appendChild(el('div', { class: 'pixl-planche-case' },
      el('div', { class: 'pixl-planche-scene' }, vue.node),
      el('b', null, clip.nom),
      el('span', null, `${clip.poses.length} images · ${clip.ms} ms`),
    ))
  }
  openModal({
    title: 'La planche de Pixl',
    icon: 'film',
    wide: true,
    body: el('div', null,
      el('p', { class: 'form-note' },
        'Six cycles, trente-deux pixels de cote, une seule palette. ',
        'Chacun tourne ici a sa cadence reelle — c\'est ce que la timeline ne montre pas, ',
        'puisqu\'elle les deroule l\'un apres l\'autre.'),
      el('div', { style: { height: '12px' } }),
      grille,
    ),
    actions: [
      { label: 'Ouvrir dans l\'editeur', onClick: () => { app.runCommand('file.mascotte') } },
      { label: 'Fermer', primary: true },
    ],
  })
}

/** Temps d'arret sur la derniere image d'un cycle joue une seule fois. */
const PAUSE_PLANCHE = 400

/** Relance un cycle sans boucle tant que sa vue est dans la page. */
function rejouerSansFin(vue: VuePixl, id: ClipId, periode: number): void {
  const timer = window.setInterval(() => {
    if (!vue.node.isConnected) { window.clearInterval(timer); return }
    vue.jouer(id)
  }, periode)
}

/* ------------------------------------------------------------------ */
/* L'easter egg                                                        */
/* ------------------------------------------------------------------ */

const DUREE_TRAVERSEE = 3400

/**
 * Pixl traverse la fenetre en courant, saute au milieu, et laisse sa
 * planche derriere elle.
 *
 * Elle passe au ras de la barre d'etat, sous la zone de dessin et sans
 * capter la souris : meme declenchee par megarde, la traversee
 * n'interrompt aucun geste en cours.
 */
export function traverseeDePixl(app: App): void {
  if (document.querySelector('.pixl-traversee')) return
  showToast('Pixl s\'echappe', 'success')

  // Mouvement refuse : on va droit a la recompense, sans la course.
  if (mouvementReduit()) { plancheDePixl(app); return }

  const vue = new VuePixl({ echelle: 2, clip: 'course' })
  const piste = el('div', { class: 'pixl-traversee' }, vue.node)
  document.body.appendChild(piste)

  const largeur = window.innerWidth
  const depart = -80
  const arrivee = largeur + 80
  const t0 = performance.now()
  let phase = 'course'

  const pas = (now: number) => {
    const p = Math.min(1, (now - t0) / DUREE_TRAVERSEE)
    const x = depart + (arrivee - depart) * p
    // Le saut occupe le tiers central. La hauteur suit une parabole plutot
    // que le cycle lui-meme : les poses disent le geste, pas la trajectoire.
    let y = 0
    if (p > 0.36 && p < 0.64) {
      const u = (p - 0.36) / 0.28
      y = -76 * Math.sin(u * Math.PI)
      if (phase !== 'saut') { phase = 'saut'; vue.jouer('saut') }
    } else if (phase !== 'course') { phase = 'course'; vue.jouer('course') }
    piste.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    if (p < 1) requestAnimationFrame(pas)
    else { piste.remove(); plancheDePixl(app) }
  }
  requestAnimationFrame(pas)
}
