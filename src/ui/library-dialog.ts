import {
  chargerProjet, demanderPersistance, donneesProjet, dupliquerProjet, etatStockage,
  listerProjets, renommerProjet, supprimerProjet, type FicheProjet,
} from '../io/library'
import { PROJECT_EXT } from '../io/project'
import { el, clear, iconButton } from './dom'
import { icon } from './icons'
import { openModal, confirmDialog, promptDialog, showToast } from './overlay'
import type { App } from './app'

/** Nom de fichier sans caractere interdit. */
const nomSur = (nom: string): string =>
  nom.replace(/[^a-zA-Z0-9_\-. ]+/g, '-').replace(/\s+/g, '-').slice(0, 60) || 'projet'

function telecharger(texte: string, nom: string): void {
  const url = URL.createObjectURL(new Blob([texte], { type: 'application/json' }))
  const a = el('a', { href: url, download: nom })
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Le revoquer tout de suite annulerait le telechargement dans certains
  // navigateurs : on laisse passer un tour de boucle.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const poids = (octets: number): string =>
  octets >= 1024 * 1024
    ? `${(octets / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(1, Math.round(octets / 1024))} Ko`

/**
 * Date lisible : l'heure aujourd'hui, le jour au-dela. Une liste de projets
 * se lit d'un coup d'oeil, pas en dechiffrant douze fois « 09/09/2026 ».
 */
function quand(ms: number): string {
  const d = new Date(ms)
  const jour = new Date(ms).setHours(0, 0, 0, 0)
  const aujourdhui = new Date().setHours(0, 0, 0, 0)
  if (jour === aujourdhui) return `aujourd'hui ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  if (jour === aujourdhui - 86400000) return `hier ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * « Mes projets » : tout ce qui est range dans le navigateur.
 *
 * La liste dit franchement ou vivent ces fichiers. Une bibliotheque qui a
 * l'air d'un disque dur alors qu'elle est dans le stockage du site fait
 * perdre du travail le jour ou quelqu'un nettoie son navigateur — d'ou la
 * ligne de place occupee, l'état de persistance, et le bouton d'export a
 * portee de main sur chaque projet.
 */
export function bibliothequeDialog(app: App): void {
  const liste = el('div', { class: 'proj-grid' })
  const pied = el('p', { class: 'form-note' })

  const rafraichir = async (): Promise<void> => {
    clear(liste)
    let fiches: FicheProjet[] = []
    try {
      fiches = await listerProjets()
    } catch (e) {
      liste.appendChild(el('p', { class: 'form-note' },
        `Stockage local inaccessible : ${(e as Error).message}. `
        + 'Vos projets restent exportables sur le disque avec Ctrl+Maj+S.'))
      return
    }

    if (!fiches.length) {
      liste.appendChild(el('div', { class: 'proj-vide' },
        el('p', null, 'Aucun projet enregistre pour l\'instant.'),
        el('p', { class: 'form-note' },
          'Ctrl+S range le document courant ici. Le nom de la barre du haut '
          + 'devient celui du projet.'),
      ))
    }

    for (const fiche of fiches) {
      const courant = fiche.id === app.projetCourant
      const carte = el('div', { class: `proj-carte ${courant ? 'courant' : ''}` })

      const vignette = fiche.vignette
        ? el('img', { class: 'proj-vignette', src: fiche.vignette, alt: '' })
        : el('div', { class: 'proj-vignette vide', html: icon('image', 20) })

      const ouvrir = async (): Promise<void> => {
        const sprite = await chargerProjet(fiche.id)
        if (!sprite) { showToast('Projet introuvable', 'error'); return }
        app.ouvrirDeLaBibliotheque(fiche.id, sprite)
        handle.close()
      }

      carte.append(
        el('button', {
          class: 'proj-ouvrir',
          title: `Ouvrir « ${fiche.nom} »`,
          onclick: () => { void ouvrir() },
        }, vignette),
        el('div', { class: 'proj-infos' },
          el('strong', { class: 'proj-nom', title: fiche.nom }, fiche.nom),
          el('span', { class: 'proj-meta' },
            `${quand(fiche.maj)} · ${poids(fiche.octets)}${courant ? ' · ouvert' : ''}`),
        ),
        el('div', { class: 'proj-actions' },
          iconButton(icon('edit', 14), 'Renommer', async () => {
            const nom = await promptDialog('Renommer le projet', 'Nom', fiche.nom)
            if (!nom) return
            await renommerProjet(fiche.id, nom.trim())
            if (courant) app.ed.run('Renommer le sprite', () => { app.ed.sprite.name = nom.trim() })
            void rafraichir()
          }, { className: 'ghost sm icon-only' }),
          iconButton(icon('duplicate', 14), 'Dupliquer', async () => {
            await dupliquerProjet(fiche.id)
            void rafraichir()
          }, { className: 'ghost sm icon-only' }),
          iconButton(icon('download', 14), 'Exporter sur le disque', async () => {
            const donnees = await donneesProjet(fiche.id)
            if (!donnees) { showToast('Projet introuvable', 'error'); return }
            telecharger(donnees, `${nomSur(fiche.nom)}.${PROJECT_EXT}`)
          }, { className: 'ghost sm icon-only' }),
          iconButton(icon('trash', 14), 'Supprimer', async () => {
            const ok = await confirmDialog(
              'Supprimer',
              `Supprimer « ${fiche.nom} » ? Cette copie-la ne sera pas recuperable.`,
              'Supprimer',
            )
            if (!ok) return
            await supprimerProjet(fiche.id)
            if (courant) app.oublierProjetCourant()
            void rafraichir()
          }, { className: 'ghost sm icon-only danger' }),
        ),
      )
      liste.appendChild(carte)
    }

    const etat = await etatStockage()
    const place = etat.utilise !== null
      ? `${fiches.length} projet(s), ${poids(etat.utilise)} occupe(s)`
      : `${fiches.length} projet(s)`
    pied.textContent = etat.persistant
      ? `${place}. Le navigateur s'est engage a garder ces donnees.`
      : `${place}. Ces projets vivent dans ce navigateur : vider les donnees du `
        + 'site les efface. Exportez sur le disque ce que vous ne voulez pas perdre.'
  }

  const body = el('div', null,
    el('p', { class: 'form-note', style: { margin: '0 0 10px', lineHeight: '1.6' } },
      'Vos projets sont ranges dans ce navigateur — aucun compte, aucun envoi, '
      + 'et ils sont la au prochain lancement.'),
    liste,
    pied,
  )

  const handle = openModal({
    title: 'Mes projets',
    icon: 'library',
    body,
    wide: true,
    actions: [
      {
        label: 'Garder durablement',
        onClick: () => {
          void demanderPersistance().then((ok) => {
            showToast(ok
              ? 'Le navigateur gardera ces projets'
              : 'Le navigateur a refuse : exportez sur le disque ce qui compte',
            ok ? 'success' : 'error')
            void rafraichir()
          })
          return false
        },
      },
      { label: 'Fermer' },
    ],
  })

  void rafraichir()
}
