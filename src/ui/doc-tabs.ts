import type { App } from './app'
import { el, clear } from './dom'
import { icon } from './icons'

/**
 * La barre d'onglets des documents ouverts.
 *
 * Elle ne s'affiche qu'a partir de deux documents. Une barre d'onglets qui
 * n'en montre qu'un ne renseigne sur rien et vole une bande a la zone de
 * dessin, qui est ce qu'on est venu regarder.
 *
 * Le point devant le nom dit « pas enregistre ». C'est la seule information
 * qu'un onglet doit porter en plus de son nom : sur une planche de dix
 * sprites, savoir lesquels ont ete touches est ce qu'on cherche.
 */
export class DocTabs {
  readonly root: HTMLElement

  constructor(private readonly app: App, hote: HTMLElement) {
    this.root = hote
    this.render()
    app.ed.events.on('documents', () => this.render())
    // Le point de modification suit l'historique, donc chaque geste de dessin.
    app.ed.events.on('doc', () => this.majPoints())
  }

  render(): void {
    const docs = this.app.documents
    clear(this.root)
    this.root.classList.toggle('vide', docs.nombre < 2)
    if (docs.nombre < 2) return

    for (const d of docs.tous) {
      const actif = d === docs.actif
      const onglet = el('div', {
        class: `doctab${actif ? ' actif' : ''}`,
        role: 'tab',
        'aria-selected': actif ? 'true' : 'false',
        title: docs.nom(d),
        'data-doc': d.id,
      },
        el('span', { class: 'doctab-point' }),
        el('span', { class: 'doctab-nom' }, docs.nom(d)),
      )

      const fermer = el('button', {
        class: 'doctab-fermer', title: 'Fermer (Ctrl+W)', 'aria-label': `Fermer ${docs.nom(d)}`,
        html: icon('close', 12),
      })
      fermer.addEventListener('click', (e) => { e.stopPropagation(); void this.app.fermerDocument(d.id) })
      onglet.appendChild(fermer)

      onglet.addEventListener('click', () => this.app.basculerDocument(d.id))
      // Le clic du milieu ferme : c'est le geste des navigateurs, et la main
      // est deja sur la souris.
      onglet.addEventListener('auxclick', (e) => {
        if (e.button === 1) { e.preventDefault(); void this.app.fermerDocument(d.id) }
      })
      this.root.appendChild(onglet)
    }

    const plus = el('button', { class: 'doctab-plus', title: 'Nouveau document (Ctrl+N)',
      'aria-label': 'Nouveau document', html: icon('plus', 13) })
    plus.addEventListener('click', () => void this.app.runCommand('file.new'))
    this.root.appendChild(plus)
    this.majPoints()
  }

  /** Rafraichit les seuls points de modification, sans reconstruire. */
  private majPoints(): void {
    const docs = this.app.documents
    if (docs.nombre < 2) return
    for (const d of docs.tous) {
      const n = this.root.querySelector<HTMLElement>(`[data-doc="${d.id}"]`)
      n?.classList.toggle('modifie', docs.modifie(d))
    }
  }
}
