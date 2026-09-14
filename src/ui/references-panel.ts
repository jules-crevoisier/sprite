import type { Editor } from '../core/editor'
import { el, clear, iconButton, slider, numberInput } from './dom'
import { icon } from './icons'
import { showToast } from './overlay'
import { pickFiles } from '../export/files'
import {
  referenceDepuisImage, purgerImages, cadrerRef, imageDeReference,
  type Reference, type Cadrage, type BoiteRef,
} from '../core/reference'

/**
 * Le panneau des RÉFÉRENCES : les images qu'on garde sous les yeux.
 *
 * ## Pourquoi un panneau a elles, et pas une ligne dans les calques
 *
 * Une reference n'est pas un calque : elle ne porte pas de pixels du sprite,
 * ne s'exporte pas, ne se peint pas, et elle a des reglages que les calques
 * n'ont pas — une position, une taille et un ANGLE libres, en pixels du
 * sprite, fractionnaires, sans borne. La ranger parmi les calques obligerait a
 * expliquer, ligne par ligne, laquelle de leurs regles ne s'y applique pas.
 *
 * ## Pourquoi des nombres, alors que tout se fait a la souris
 *
 * La premiere version n'en avait pas, et le disait : « un panneau qui
 * demanderait de taper quatre nombres pour cadrer une photo serait le defaut
 * qu'on vient de corriger ». C'etait vrai du cadrage grossier et faux du
 * reste. Aligner deux references l'une sur l'autre, revenir a un angle rond,
 * reprendre demain le cadrage d'hier : rien de tout cela ne se vise a la
 * souris. Les grands logiciels donnent les deux, et ce n'est pas un hasard —
 * la souris pour chercher, les nombres pour retrouver.
 */
export class ReferencesPanel {
  readonly content: HTMLElement
  readonly actions: HTMLElement[]
  private ed: Editor
  private corps = el('div', { class: 'refs-liste' })

  constructor(editor: Editor) {
    this.ed = editor
    this.content = el('div', { class: 'panel-body tight' }, this.corps)
    this.actions = [
      iconButton(icon('plus', 14), 'Ajouter une image de référence',
        () => { void this.ajouter() }, { className: 'ghost sm icon-only' }),
    ]
    editor.events.on('doc', () => this.render())
    editor.events.on('reload', () => this.render())
    editor.events.on('references', () => this.render())
    this.render()
  }

  /**
   * Ajoute une image.
   *
   * Elle est lue en dataURL — c'est cette chaine qui part dans le fichier de
   * projet. Une reference qui ne vivrait qu'en memoire disparaitrait au
   * rechargement, et l'on rouvrirait son dessin sans le modele qui l'explique.
   */
  async ajouter(): Promise<void> {
    const fichiers = await pickFiles('image/png,image/jpeg,image/gif,image/webp,image/bmp')
    if (!fichiers.length) return
    const fichier = fichiers[0]
    const source = await new Promise<string>((resoudre, rejeter) => {
      const lecteur = new FileReader()
      lecteur.onload = () => resoudre(String(lecteur.result))
      lecteur.onerror = () => rejeter(lecteur.error)
      lecteur.readAsDataURL(fichier)
    })
    const img = new Image()
    img.src = source
    await img.decode().catch(() => {})
    const s = this.ed.sprite
    const ref = referenceDepuisImage(
      source, fichier.name.replace(/\.[^.]+$/, ''),
      img.naturalWidth || s.width, img.naturalHeight || s.height, s.width, s.height,
    )
    this.ed.run('Image de référence', () => { s.references.push(ref) })
    this.ed.choisirReference(ref.id)
    this.render()
    showToast(`« ${ref.nom} » posée — tirez-la pour la placer, sa poignée ronde pour la tourner`, 'success')
  }

  private appliquer(_r: Reference, quoi: string, f: () => void): void {
    this.ed.run(quoi, f)
    this.render()
  }

  /** Change la boite d'une reference en une seule etape annulable. */
  private poser(r: Reference, nom: string, boite: BoiteRef): void {
    const avant: BoiteRef = { x: r.x, y: r.y, l: r.l, h: r.h, rotation: r.rotation }
    r.x = boite.x; r.y = boite.y; r.l = boite.l; r.h = boite.h
    r.rotation = boite.rotation ?? 0
    this.ed.poserGesteReference(r.id, avant, boite, nom)
    this.ed.events.emit('doc', undefined)
  }

  /** La definition d'origine de l'image, quand elle est decodee. */
  private taillePropre(r: Reference): { l: number; h: number } {
    const img = imageDeReference(r.source, () => this.render())
    return { l: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0 }
  }

  private cadrer(r: Reference, cadrage: Cadrage, nom: string): void {
    const s = this.ed.sprite
    const propre = this.taillePropre(r)
    this.poser(r, nom, cadrerRef(r, cadrage, s.width, s.height, propre.l, propre.h))
    this.render()
  }

  render(): void {
    const refs = this.ed.sprite.references
    clear(this.corps)
    purgerImages(refs.map((r) => r.source))

    if (!refs.length) {
      this.corps.appendChild(el('p', { class: 'refs-vide' },
        'Aucune référence. Le « + » pose une image sous le dessin — une photo, un croquis, '
        + 'une planche — qu’on déplace, tourne et redimensionne à la souris, et qui ne part '
        + 'jamais dans l’export.'))
      return
    }

    for (const r of refs) {
      const actif = this.ed.referenceActive === r.id
      const ligne = el('div', { class: `ref-ligne${actif ? ' active' : ''}`, tabindex: 0 })
      const tete = el('div', { class: 'ref-tete' },
        // La vignette : c'est elle qu'on reconnait, pas « photo_2024_final ».
        el('span', { class: 'ref-vignette' }, el('img', { src: r.source, alt: '' })),
        el('button', {
          class: `mini ${r.visible ? 'on' : ''}`,
          title: r.visible ? 'Masquer' : 'Afficher',
          html: icon(r.visible ? 'eye' : 'eye-off', 14),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            this.appliquer(r, 'Référence', () => { r.visible = !r.visible })
          },
        }),
        el('button', {
          class: `mini ${r.verrouille ? 'on' : ''}`,
          title: r.verrouille
            ? 'Déverrouiller : elle se déplacera de nouveau'
            : 'Verrouiller : on ne la déplacera plus par mégarde',
          html: icon(r.verrouille ? 'lock' : 'unlock', 14),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            this.appliquer(r, 'Référence', () => { r.verrouille = !r.verrouille })
          },
        }),
        el('span', { class: 'ref-nom', title: r.nom }, r.nom),
        el('button', {
          class: 'mini',
          title: 'Retirer cette référence',
          html: icon('trash', 14),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            this.appliquer(r, 'Retirer la référence', () => {
              const i = this.ed.sprite.references.indexOf(r)
              if (i >= 0) this.ed.sprite.references.splice(i, 1)
              if (this.ed.referenceActive === r.id) this.ed.referenceActive = null
            })
          },
        }),
      )
      ligne.appendChild(tete)
      // Choisir : c'est ce qui fait apparaitre les poignees dans la vue.
      ligne.addEventListener('click', () => this.ed.choisirReference(actif ? null : r.id))

      /*
       * LES FLECHES DEPLACENT LA REFERENCE, quand la ligne a le focus.
       *
       * Au pixel pres, et c'est le seul moyen de l'obtenir : a la souris, un
       * pixel du sprite vaut un cheveu d'ecran des qu'on est degage. On le
       * fait ici, sur la ligne, et non au clavier global — la, les fleches
       * deplacent les pixels selectionnes, et deux sens pour une meme touche
       * dans la meme fenetre est le genre de piege qu'on ne pardonne pas.
       */
      ligne.addEventListener('keydown', (e: KeyboardEvent) => {
        const pas: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
        }
        const d = pas[e.key]
        if (!d || r.verrouille) return
        e.preventDefault()
        e.stopPropagation()
        const n = e.shiftKey ? 10 : 1
        this.ed.choisirReference(r.id)
        this.poser(r, 'Déplacer la référence',
          { x: r.x + d[0] * n, y: r.y + d[1] * n, l: r.l, h: r.h, rotation: r.rotation })
      })

      if (actif) ligne.appendChild(this.reglages(r))
      this.corps.appendChild(ligne)
    }
  }

  /** Les réglages fins de la référence choisie. */
  private reglages(r: Reference): HTMLElement {
    const reglages = el('div', { class: 'ref-reglages' })
    const propre = this.taillePropre(r)

    const champ = (
      etiquette: string, valeur: number, nom: string,
      applique: (v: number) => BoiteRef,
      opts: { min?: number; max?: number; step?: number; titre?: string } = {},
    ) => el('label', { class: 'ref-champ', title: opts.titre ?? nom },
      el('span', null, etiquette),
      numberInput(Math.round(valeur * 100) / 100, (v) => {
        if (!Number.isFinite(v)) return
        this.poser(r, nom, applique(v))
        this.render()
      }, { min: opts.min ?? -9999, max: opts.max ?? 9999, step: opts.step ?? 1, width: '58px' }),
    )

    const boite = (): BoiteRef => ({ x: r.x, y: r.y, l: r.l, h: r.h, rotation: r.rotation })

    // Position et taille : la grille de transformation qu'on trouve partout.
    reglages.appendChild(el('div', { class: 'ref-grille' },
      champ('X', r.x, 'Déplacer la référence', (v) => ({ ...boite(), x: v }),
        { titre: 'Position horizontale, en pixels du sprite' }),
      champ('Y', r.y, 'Déplacer la référence', (v) => ({ ...boite(), y: v }),
        { titre: 'Position verticale, en pixels du sprite' }),
      champ('L', r.l, 'Dimensionner la référence', (v) => {
        // Le rapport est garde : c'est la regle des coins, et une largeur
        // tapee ne doit pas dire le contraire d'une largeur tiree.
        const ratio = r.l / Math.max(1e-6, r.h)
        return { ...boite(), l: Math.max(1, v), h: Math.max(1, v) / ratio }
      }, { min: 1, titre: 'Largeur — la hauteur suit, les proportions sont gardées' }),
      champ('H', r.h, 'Dimensionner la référence', (v) => {
        const ratio = r.l / Math.max(1e-6, r.h)
        return { ...boite(), h: Math.max(1, v), l: Math.max(1, v) * ratio }
      }, { min: 1, titre: 'Hauteur — la largeur suit, les proportions sont gardées' }),
      champ('∠', r.rotation, 'Tourner la référence',
        (v) => ({ ...boite(), rotation: ((v + 180) % 360 + 360) % 360 - 180 }),
        { min: -180, max: 180, titre: 'Angle, en degrés' }),
      el('label', { class: 'ref-champ', title: 'Opacité, en pourcent' },
        el('span', null, '%'),
        numberInput(Math.round(r.opacite * 100), (v) => {
          r.opacite = Math.max(0.05, Math.min(1, v / 100))
          this.ed.events.emit('doc', undefined)
        }, { min: 5, max: 100, step: 5, width: '58px' }),
      ),
    ))

    reglages.appendChild(el('label', null, 'Opacité'))
    reglages.appendChild(slider(0.05, 1, r.opacite, 0.05,
      (v) => { r.opacite = v; this.ed.events.emit('doc', undefined) },
      (v) => `${Math.round(v * 100)}%`))

    const bouton = (texte: string, titre: string, f: () => void) => el('button', {
      class: 'btn sm',
      title: titre,
      onclick: (e: MouseEvent) => { e.stopPropagation(); f() },
    }, texte)

    reglages.appendChild(el('label', null, 'Cadrer'))
    reglages.appendChild(el('div', { class: 'ref-boutons' },
      bouton('Contenir', 'L’image entière tient dans le cadre',
        () => this.cadrer(r, 'contenir', 'Cadrer la référence')),
      bouton('Remplir', 'Le cadre est couvert ; l’image déborde',
        () => this.cadrer(r, 'remplir', 'Cadrer la référence')),
      bouton('1:1', propre.l
        ? `Taille réelle : ${propre.l} × ${propre.h} px de l’image`
        : 'Taille réelle de l’image',
      () => this.cadrer(r, 'reelle', 'Taille réelle')),
      bouton('Centrer', 'Sans changer la taille',
        () => this.cadrer(r, 'centrer', 'Centrer la référence')),
    ))

    const miroir = (axe: 'X' | 'Y', titre: string) => {
      const b = el('button', {
        class: `btn sm${(axe === 'X' ? r.miroirX : r.miroirY) ? ' active' : ''}`,
        title: titre,
        html: icon('flip', 14),
        onclick: (e: MouseEvent) => {
          e.stopPropagation()
          this.appliquer(r, 'Miroir de la référence', () => {
            if (axe === 'X') r.miroirX = !r.miroirX
            else r.miroirY = !r.miroirY
          })
        },
      })
      // La meme icone, pivotee d'un quart de tour pour l'axe vertical : deux
      // dessins differents feraient croire a deux fonctions differentes.
      if (axe === 'Y') b.style.transform = 'rotate(90deg)'
      return b
    }

    reglages.appendChild(el('label', null, 'Retourner'))
    reglages.appendChild(el('div', { class: 'ref-boutons' },
      miroir('X', 'Miroir horizontal — un profil sert à dessiner les deux'),
      miroir('Y', 'Miroir vertical'),
      bouton('∠ 0°', 'Redresser : remet l’angle à zéro',
        () => { this.poser(r, 'Redresser la référence', { x: r.x, y: r.y, l: r.l, h: r.h, rotation: 0 }); this.render() }),
      bouton(r.dessous ? 'Sous' : 'Dessus', 'Sous le dessin, ou par-dessus',
        () => this.appliquer(r, 'Référence', () => { r.dessous = !r.dessous })),
    ))

    // Court exprès : les detours sont dans les infobulles des boutons. Un
    // paragraphe de six lignes sous les reglages finit par ne plus se lire.
    reglages.appendChild(el('p', { class: 'refs-vide' },
      'Coins : dimensionner (Maj libre, Alt depuis le centre). Poignée ronde : tourner '
      + '(Maj par 15°). Ctrl coupe l’aimantation, les flèches déplacent au pixel, '
      + 'Échap lâche l’image.'))
    return reglages
  }
}
