import type { App } from './app'
import { el, clear, iconButton } from './dom'
import { icon } from './icons'
import { showToast } from './overlay'
import {
  choisirDossier, dossierDisponible, dossierRetenu, retenirDossier,
  lireDossier, autoriser, type PoigneeDossier, type Entree,
} from '../io/dossier'
import { ouvrirFichier } from '../io/formats'
import { compositeFrame } from '../render/composite'
import type { Bitmap } from '../core/bitmap'

/**
 * Le panneau du dossier de travail.
 *
 * ## Pourquoi les vignettes se calculent a la demande
 *
 * Un dossier de projet contient couramment cinquante sprites. Les ouvrir tous
 * au chargement du panneau pour en tirer une vignette, c'est cinquante
 * decodages et plusieurs secondes d'interface figee, pour des images dont on
 * ne regardera que trois. Elles se calculent donc quand la ligne entre dans le
 * champ — `IntersectionObserver` — et se gardent ensuite.
 *
 * ## Pourquoi on ne descend pas dans l'arborescence
 *
 * Un dossier de jeu contient souvent un `node_modules` ou un `.git`. Les
 * parcourir en entier bloquerait tout pour n'en rien tirer. On liste donc un
 * niveau, avec les sous-dossiers ou l'on entre d'un clic, et un fil d'Ariane
 * pour remonter.
 */
export class DossierPanel {
  readonly content: HTMLElement
  private corps = el('div', { class: 'dos-liste' })
  private fil = el('div', { class: 'dos-fil' })
  /** Le chemin depuis la racine, pour le fil d'Ariane. */
  private chemin: { nom: string; poignee: PoigneeDossier }[] = []
  private vignettes = new Map<string, string>()
  private observateur: IntersectionObserver | null = null

  constructor(private readonly app: App) {
    this.content = el('div', { class: 'dos-panneau' }, this.fil, this.corps)
    void this.reprendre()
  }

  /** Retrouve le dossier de la session precedente, sans rien demander. */
  private async reprendre(): Promise<void> {
    const d = await dossierRetenu()
    if (!d) { this.rendreVide(); return }
    this.chemin = [{ nom: d.name, poignee: d }]
    // On ne redemande pas l'autorisation ici : le navigateur exige un geste
    // de la personne. La liste s'affichera au premier clic sur « Reprendre ».
    this.rendreAReprendre(d.name)
  }

  async ouvrirUnDossier(): Promise<void> {
    if (!dossierDisponible()) {
      showToast('Ce navigateur ne sait pas ouvrir un dossier — Chrome ou Edge le savent', 'error')
      return
    }
    const d = await choisirDossier()
    if (!d) return
    this.chemin = [{ nom: d.name, poignee: d }]
    this.vignettes.clear()
    await retenirDossier(d)
    await this.rafraichir()
  }

  async rafraichir(): Promise<void> {
    const courant = this.chemin[this.chemin.length - 1]
    if (!courant) { this.rendreVide(); return }
    if (!await autoriser(courant.poignee)) {
      showToast('Autorisation refusee sur ce dossier', 'error')
      return
    }
    let contenu
    try {
      contenu = await lireDossier(courant.poignee)
    } catch (e) {
      showToast(`Dossier illisible : ${(e as Error).message}`, 'error')
      return
    }
    this.rendreFil()
    clear(this.corps)
    this.observateur?.disconnect()
    this.observateur = new IntersectionObserver((entrees) => {
      for (const e of entrees) {
        if (!e.isIntersecting) continue
        this.observateur?.unobserve(e.target)
        void this.poserVignette(e.target as HTMLElement)
      }
    }, { root: this.corps, rootMargin: '80px' })

    for (const sd of contenu.sousDossiers) {
      const ligne = el('button', { class: 'dos-item dos-dossier', title: sd.nom },
        el('span', { class: 'dos-ic', html: icon('layers', 14) }),
        el('span', { class: 'dos-nom' }, sd.nom),
      )
      ligne.addEventListener('click', () => {
        this.chemin.push({ nom: sd.nom, poignee: sd.poignee })
        void this.rafraichir()
      })
      this.corps.appendChild(ligne)
    }

    for (const f of contenu.fichiers) {
      this.corps.appendChild(this.ligneFichier(f))
    }

    if (!contenu.fichiers.length && !contenu.sousDossiers.length) {
      this.corps.appendChild(el('p', { class: 'dos-vide' },
        'Aucun sprite, image ou palette dans ce dossier.'))
    }
  }

  private ligneFichier(f: Entree): HTMLElement {
    const vignette = el('span', { class: 'dos-vignette' })
    const cache = this.vignettes.get(f.nom)
    if (cache) vignette.appendChild(el('img', { src: cache }))

    const ligne = el('button', {
      class: `dos-item dos-${f.genre}`,
      title: `${f.nom} — ${(f.octets / 1024).toFixed(1)} ko`,
      'data-fichier': f.nom,
    },
      vignette,
      el('span', { class: 'dos-nom' }, f.nom),
      el('span', { class: 'dos-genre' }, f.genre === 'projet' ? '' : f.genre),
    )
    ;(ligne as HTMLElement & { _entree?: Entree })._entree = f
    ligne.addEventListener('click', () => void this.ouvrirFichier(f))
    if (!cache) requestAnimationFrame(() => this.observateur?.observe(ligne))
    return ligne
  }

  /** Ouvre un fichier du dossier dans un nouvel onglet. */
  private async ouvrirFichier(f: Entree): Promise<void> {
    // Deja ouvert : on y revient au lieu d'en faire un doublon. Deux onglets
    // sur le meme fichier, ce sont deux historiques qui s'ecrasent au premier
    // enregistrement.
    const ouvert = this.app.documents.dejaOuvert(f.poignee)
    if (ouvert) { this.app.basculerDocument(ouvert.id); return }
    try {
      const res = await ouvrirFichier(await f.poignee.getFile())
      if (res.genre === 'sprite') {
        // La poignee suit le document : Ctrl+S reecrira CE fichier-la.
        this.app.ouvrirDansUnOnglet(res.sprite, f.poignee)
        showToast(`« ${f.nom} » ouvert — Ctrl+S le reecrira`, 'success')
      } else if (res.genre === 'palette') {
        const { Palette } = await import('../core/palette')
        const p = res.palette
        this.app.ed.run('Palette importée', () => {
          this.app.ed.sprite.palette = new Palette(p.nom, p.couleurs)
        })
        showToast(res.message, 'success')
      }
    } catch (e) {
      showToast(`Ouverture impossible : ${(e as Error).message}`, 'error')
    }
  }

  /** Calcule la vignette d'une ligne entree dans le champ. */
  private async poserVignette(ligne: HTMLElement): Promise<void> {
    const f = (ligne as HTMLElement & { _entree?: Entree })._entree
    if (!f) return
    try {
      const res = await ouvrirFichier(await f.poignee.getFile())
      if (res.genre !== 'sprite') return
      const bm = compositeFrame(res.sprite, 0)
      const url = versDataUrl(bm)
      this.vignettes.set(f.nom, url)
      const hote = ligne.querySelector('.dos-vignette')
      if (hote && !hote.firstChild) hote.appendChild(el('img', { src: url }))
    } catch { /* fichier illisible : la ligne reste sans vignette */ }
  }

  private rendreFil(): void {
    clear(this.fil)
    this.fil.appendChild(iconButton(icon('folder', 14), 'Choisir un dossier de travail',
      () => void this.ouvrirUnDossier(), { className: 'ghost' }))
    this.chemin.forEach((seg, i) => {
      const b = el('button', { class: `dos-seg${i === this.chemin.length - 1 ? ' actif' : ''}` }, seg.nom)
      b.addEventListener('click', () => {
        this.chemin = this.chemin.slice(0, i + 1)
        void this.rafraichir()
      })
      this.fil.appendChild(b)
    })
    this.fil.appendChild(iconButton(icon('refresh', 13), 'Relire le dossier',
      () => void this.rafraichir(), { className: 'ghost' }))
  }

  private rendreVide(): void {
    clear(this.fil); clear(this.corps)
    const dispo = dossierDisponible()
    const b = el('button', { class: 'dos-choisir' },
      el('span', { html: icon('folder', 15) }),
      el('span', null, 'Choisir un dossier de travail'))
    b.addEventListener('click', () => void this.ouvrirUnDossier())
    this.corps.appendChild(el('div', { class: 'dos-accueil' },
      b,
      el('p', { class: 'dos-vide' }, dispo
        ? 'Tous les sprites du dossier s’ouvrent alors d’un clic, et Ctrl+S les réécrit sur place.'
        : 'Ce navigateur ne sait pas ouvrir un dossier. Chrome et Edge le savent ; '
          + 'Firefox et Safari n’ont pas encore l’API.'),
    ))
  }

  private rendreAReprendre(nom: string): void {
    clear(this.fil); clear(this.corps)
    const b = el('button', { class: 'dos-choisir' },
      el('span', { html: icon('folder', 15) }),
      el('span', null, `Reprendre « ${nom} »`))
    b.addEventListener('click', () => void this.rafraichir())
    this.corps.appendChild(el('div', { class: 'dos-accueil' },
      b,
      el('p', { class: 'dos-vide' },
        'Le navigateur redemande l’autorisation a chaque session : c’est lui qui l’exige, '
        + 'une page ne peut pas s’en dispenser.'),
    ))
  }
}

/** Une vignette PNG a partir d'un bitmap, sans passer par le DOM. */
function versDataUrl(bm: Bitmap): string {
  const c = document.createElement('canvas')
  c.width = bm.width; c.height = bm.height
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(bm.toImageData(), 0, 0)
  return c.toDataURL()
}
