import type { Editor, ViewSettings } from './editor'
import { History } from './history'
import { Selection } from './selection'
import type { Sprite } from './document'
import type { PoigneeFichier } from '../io/disque'

/**
 * Plusieurs documents ouverts en meme temps.
 *
 * ## Pourquoi un seul editeur, et non un par document
 *
 * La tentation etait d'instancier un `Editor` par document et de basculer la
 * reference. Tout le reste de l'interface — viewport, panneaux, timeline,
 * raccourcis — tient une reference a CET editeur-la, prise une fois au
 * demarrage. Changer d'objet obligerait a recabler chaque abonnement a chaque
 * changement d'onglet, et le premier oubli laisserait un panneau qui affiche
 * l'ancien document sans que rien ne le signale.
 *
 * L'editeur reste donc unique et c'est son ETAT qui voyage : on capture les
 * champs qui appartiennent au document, on restitue ceux de la cible. Le
 * cablage ne bouge jamais, et un panneau qui n'a pas ete prevu pour les
 * onglets continue simplement de montrer le document actif.
 *
 * ## Ce qui appartient au document, et ce qui appartient a l'application
 *
 * Au document : le sprite, son historique, sa selection, le calque et l'image
 * courants, la vue (zoom et position), la symetrie, le dessin en tuile, et le
 * fichier du disque d'ou il vient.
 *
 * A l'application : l'outil courant et ses reglages, les deux couleurs, la
 * pelure d'oignon, la courbe de vitesse, le presse-papiers. Changer de
 * document ne doit pas reprendre le pinceau des mains de la personne — et le
 * presse-papiers sert justement a passer d'un document a l'autre.
 */
export interface DocumentOuvert {
  readonly id: string
  sprite: Sprite
  history: History
  selection: Selection
  activeLayer: number
  activeFrame: number
  frameSelection: Set<number>
  view: ViewSettings
  symmetry: { x: boolean; y: boolean; axisX: number; axisY: number }
  tiledDrawing: boolean
  /** Le fichier du disque d'ou il vient, s'il en a un. */
  poignee: PoigneeFichier | null
  /** Position dans l'historique au dernier enregistrement, pour l'etoile. */
  reperePropre: number
}

let compteur = 0
const nouvelId = (): string => `doc${++compteur}`

export class Documents {
  private liste: DocumentOuvert[] = []
  private actifIndex = 0

  /** Vrai le temps d'un changement d'onglet, pour ne pas s'ecouter soi-meme. */
  private enTransit = false

  constructor(private readonly ed: Editor) {
    // Le document deja ouvert par l'editeur devient le premier onglet, sans
    // rien recreer : il porte peut-etre deja du travail.
    this.liste.push(this.capturer(nouvelId(), null))

    // `loadSprite` remplace le document sous nos pieds — une demo, un projet
    // de la bibliotheque, un import. L'onglet actif tiendrait alors une
    // reference vers l'ancien sprite et afficherait un nom perime. On se
    // recale donc sur l'editeur a chaque rechargement qui ne vient pas de
    // nous.
    ed.events.on('reload', () => {
      if (this.enTransit) return
      const d = this.liste[this.actifIndex]
      if (!d || d.sprite === ed.sprite) return
      d.sprite = ed.sprite
      d.history = ed.history
      d.selection = ed.selection
      d.poignee = null
      d.reperePropre = ed.history.position
      ed.events.emit('documents', undefined)
    })
  }

  get tous(): readonly DocumentOuvert[] { return this.liste }
  get actif(): DocumentOuvert { return this.liste[this.actifIndex] }
  get nombre(): number { return this.liste.length }

  /** Vrai si le document porte des modifications non enregistrees. */
  modifie(d: DocumentOuvert): boolean {
    const pos = d === this.actif ? this.ed.history.position : d.history.position
    return pos !== d.reperePropre
  }

  /** Le nom montre sur l'onglet : celui du fichier s'il y en a un. */
  nom(d: DocumentOuvert): string {
    return d.poignee?.name ?? d.sprite.name ?? 'sans-titre'
  }

  /** Ouvre un sprite dans un nouvel onglet et bascule dessus. */
  ouvrir(sprite: Sprite, poignee: PoigneeFichier | null = null): DocumentOuvert {
    this.ranger()
    // Un historique neuf est a la position -1, pas 0 : c'est SA position qui
    // fait le repere du propre, jamais une constante. Avec un zero en dur,
    // tout document neuf naissait « modifie » — et comme l'onglet actif lit sa
    // position dans l'editeur, l'etoile s'allumait sur le voisin.
    const history = new History(300)
    const doc: DocumentOuvert = {
      id: nouvelId(),
      sprite,
      history,
      selection: new Selection(sprite.width, sprite.height),
      activeLayer: 0,
      activeFrame: 0,
      frameSelection: new Set([0]),
      view: { ...this.ed.view, panX: 0, panY: 0 },
      symmetry: { x: false, y: false, axisX: sprite.width / 2, axisY: sprite.height / 2 },
      tiledDrawing: false,
      poignee,
      reperePropre: history.position,
    }
    this.liste.push(doc)
    this.actifIndex = this.liste.length - 1
    this.restituer(doc)
    return doc
  }

  /** Un fichier deja ouvert ne s'ouvre pas deux fois : on y revient. */
  dejaOuvert(poignee: PoigneeFichier): DocumentOuvert | null {
    return this.liste.find((d) => d.poignee?.name === poignee.name) ?? null
  }

  basculer(id: string): boolean {
    const i = this.liste.findIndex((d) => d.id === id)
    if (i < 0 || i === this.actifIndex) return false
    this.ranger()
    this.actifIndex = i
    this.restituer(this.liste[i])
    return true
  }

  /** Onglet suivant ou precedent, en boucle. */
  decaler(pas: number): void {
    if (this.liste.length < 2) return
    const i = (this.actifIndex + pas + this.liste.length) % this.liste.length
    this.basculer(this.liste[i].id)
  }

  /**
   * Ferme un onglet. Rend faux si c'etait le dernier : une application sans
   * document ouvert n'a plus de viewport a montrer, et le vide se gere mal.
   * L'appelant ouvre alors un document neuf a la place.
   */
  fermer(id: string): boolean {
    if (this.liste.length < 2) return false
    const i = this.liste.findIndex((d) => d.id === id)
    if (i < 0) return false
    this.liste.splice(i, 1)
    if (this.actifIndex >= i) this.actifIndex = Math.max(0, this.actifIndex - (this.actifIndex > i ? 1 : 0))
    this.actifIndex = Math.min(this.actifIndex, this.liste.length - 1)
    this.restituer(this.liste[this.actifIndex])
    return true
  }

  /** Note l'etat courant comme enregistre : l'etoile de l'onglet s'eteint. */
  marquerPropre(d: DocumentOuvert = this.actif): void {
    d.reperePropre = d === this.actif ? this.ed.history.position : d.history.position
  }

  /** Remplace le sprite du document actif — nouveau document, import. */
  remplacer(sprite: Sprite, poignee: PoigneeFichier | null = null): void {
    const d = this.actif
    d.sprite = sprite
    d.poignee = poignee
    d.history = new History(300)
    d.selection = new Selection(sprite.width, sprite.height)
    d.activeLayer = 0
    d.activeFrame = 0
    d.frameSelection = new Set([0])
    d.reperePropre = d.history.position
    this.restituer(d)
  }

  /* ---------------------------------------------------------------- */
  /* Le va-et-vient entre l'editeur et le document                      */
  /* ---------------------------------------------------------------- */

  private capturer(id: string, poignee: PoigneeFichier | null): DocumentOuvert {
    const ed = this.ed
    return {
      id,
      sprite: ed.sprite,
      history: ed.history,
      selection: ed.selection,
      activeLayer: ed.activeLayer,
      activeFrame: ed.activeFrame,
      frameSelection: new Set(ed.frameSelection),
      view: { ...ed.view },
      symmetry: { ...ed.symmetry },
      tiledDrawing: ed.tiledDrawing,
      poignee,
      reperePropre: ed.history.position,
    }
  }

  /** Recopie l'etat de l'editeur dans l'onglet actif avant de le quitter. */
  private ranger(): void {
    const d = this.liste[this.actifIndex]
    if (!d) return
    const ed = this.ed
    d.sprite = ed.sprite
    d.history = ed.history
    d.selection = ed.selection
    d.activeLayer = ed.activeLayer
    d.activeFrame = ed.activeFrame
    d.frameSelection = new Set(ed.frameSelection)
    d.view = { ...ed.view }
    d.symmetry = { ...ed.symmetry }
    d.tiledDrawing = ed.tiledDrawing
  }

  private restituer(d: DocumentOuvert): void {
    const ed = this.ed
    ed.sprite = d.sprite
    ed.history = d.history
    ed.selection = d.selection
    ed.activeLayer = d.activeLayer
    ed.activeFrame = d.activeFrame
    ed.frameSelection = new Set(d.frameSelection)
    ed.view = { ...d.view }
    ed.symmetry = { ...d.symmetry }
    ed.tiledDrawing = d.tiledDrawing
    // `reload` dit a toute l'interface que le document a change en entier —
    // c'est l'evenement que le viewport, la timeline et les calques attendent
    // deja pour se reconstruire, et non une suite de petits changements.
    this.enTransit = true
    try { ed.events.emit('reload', undefined) } finally { this.enTransit = false }
    ed.events.emit('documents', undefined)
  }
}
