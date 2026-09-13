import type { Editor } from '../core/editor'
import { el, clear, iconButton, slider } from './dom'
import { icon } from './icons'
import { showToast } from './overlay'
import { pickFiles } from '../export/files'
import { referenceDepuisImage, purgerImages, type Reference } from '../core/reference'

/**
 * Le panneau des RÉFÉRENCES : les images qu'on garde sous les yeux.
 *
 * ## Pourquoi un panneau a elles, et pas une ligne dans les calques
 *
 * Une reference n'est pas un calque : elle ne porte pas de pixels du sprite,
 * ne s'exporte pas, ne se peint pas, et elle a des reglages que les calques
 * n'ont pas — une position et une taille libres, en pixels du sprite,
 * fractionnaires, sans borne. La ranger parmi les calques obligerait a
 * expliquer, ligne par ligne, laquelle de leurs regles ne s'y applique pas.
 *
 * Ce qu'on manipule ici est le CHOIX et les reglages fins ; le deplacement et
 * le redimensionnement se font a la souris, sur l'image elle-meme, avec les
 * poignees que la vue dessine. Un panneau qui demanderait de taper quatre
 * nombres pour cadrer une photo serait le defaut qu'on vient de corriger.
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
    this.ed.referenceActive = ref.id
    this.render()
    showToast(`« ${ref.nom} » posée — tirez-la pour la placer, ses coins pour la dimensionner`, 'success')
  }

  private appliquer(_r: Reference, quoi: string, f: () => void): void {
    this.ed.run(quoi, f)
    this.render()
  }

  render(): void {
    const refs = this.ed.sprite.references
    clear(this.corps)
    purgerImages(refs.map((r) => r.source))

    if (!refs.length) {
      this.corps.appendChild(el('p', { class: 'refs-vide' },
        'Aucune référence. Le « + » pose une image sous le dessin — une photo, un croquis, '
        + 'une planche — qu’on déplace et redimensionne à la souris, et qui ne part jamais '
        + 'dans l’export.'))
      return
    }

    for (const r of refs) {
      const actif = this.ed.referenceActive === r.id
      const ligne = el('div', { class: `ref-ligne${actif ? ' active' : ''}` })
      const tete = el('div', { class: 'ref-tete' },
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
          title: r.dessous ? 'Passe par-dessus le dessin' : 'Repasse sous le dessin',
          html: icon(r.dessous ? 'layers' : 'layers', 14),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            this.appliquer(r, 'Référence', () => { r.dessous = !r.dessous })
          },
        }),
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
      ligne.addEventListener('click', () => {
        this.ed.referenceActive = actif ? null : r.id
        this.render()
        this.ed.events.emit('settings', undefined)
      })

      if (actif) {
        const reglages = el('div', { class: 'ref-reglages' })
        reglages.appendChild(el('label', null, 'Opacité'))
        reglages.appendChild(slider(0.05, 1, r.opacite, 0.05,
          (v) => {
            r.opacite = v
            this.ed.events.emit('doc', undefined)
          },
          (v) => `${Math.round(v * 100)}%`))
        const boutons = el('div', { class: 'ref-boutons' },
          el('button', {
            class: 'btn sm',
            title: 'Ramener l’image entière dans le cadre du sprite',
            onclick: (e: MouseEvent) => {
              e.stopPropagation()
              this.appliquer(r, 'Cadrer la référence', () => {
                const s = this.ed.sprite
                const ratio = r.l / Math.max(1e-6, r.h)
                const l = Math.min(s.width, s.height * ratio)
                const h = l / ratio
                r.l = l
                r.h = h
                r.x = (s.width - l) / 2
                r.y = (s.height - h) / 2
              })
            },
          }, 'Cadrer'),
          el('button', {
            class: 'btn sm',
            title: 'Sous le dessin, ou par-dessus',
            onclick: (e: MouseEvent) => {
              e.stopPropagation()
              this.appliquer(r, 'Référence', () => { r.dessous = !r.dessous })
            },
          }, r.dessous ? 'Sous le dessin' : 'Par-dessus'),
        )
        reglages.appendChild(el('label', null, ''))
        reglages.appendChild(boutons)
        ligne.appendChild(reglages)
        ligne.appendChild(el('p', { class: 'refs-vide' },
          'Tirez l’image pour la placer, ses coins pour la dimensionner '
          + '(Maj : sans garder les proportions).'))
      }
      this.corps.appendChild(ligne)
    }
  }
}
