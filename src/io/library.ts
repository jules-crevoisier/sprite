import type { Sprite } from '../core/document'
import { serializeSprite, deserializeSprite } from './project'

/**
 * Bibliotheque de projets, dans le navigateur.
 *
 * La sauvegarde automatique tenait dans `localStorage`, a un seul
 * emplacement : un projet ecrasait le precedent, et il n'y avait aucun moyen
 * de revenir a celui d'hier. Surtout, le quota est d'environ 5 Mo pour toute
 * l'origine — mesure — quand un projet de jeu ordinaire, 64x64 sur quatre
 * calques et soixante images, en pese pres d'un. Au troisieme,
 * `localStorage.setItem` levait, `autosave()` renvoyait `false`, et personne
 * ne le voyait passer.
 *
 * IndexedDB n'a pas cette limite : le navigateur y accorde une part du disque
 * libre, en general des gigaoctets. On y range donc une vraie liste de
 * projets, chacun avec son nom, sa date et sa vignette.
 *
 * Ce que ce n'est pas : un coffre-fort. Ces donnees vivent dans le navigateur
 * de la personne. Vider les donnees du site les efface, une fenetre privee
 * repart de zero, et un navigateur a court de place peut evincer une origine
 * qui n'a rien demande. D'ou `demanderPersistance()`, et d'ou l'insistance de
 * l'interface a proposer l'export sur disque : la bibliotheque sert a ne pas
 * perdre son travail entre deux sessions, pas a le mettre a l'abri.
 */

const BASE = 'pixelforge'
const VERSION_BASE = 1
const MAGASIN = 'projets'

export interface FicheProjet {
  id: string
  nom: string
  /** Derniere ecriture, en millisecondes. */
  maj: number
  /** Taille du JSON serialise, en octets. */
  octets: number
  /** Vignette PNG en data URL, ou chaine vide. */
  vignette: string
}

interface EntreeProjet extends FicheProjet {
  /** Le projet serialise. Absent des fiches rendues par `lister`. */
  donnees: string
}

/* ------------------------------------------------------------------ */
/* Acces a la base                                                     */
/* ------------------------------------------------------------------ */

let base: Promise<IDBDatabase> | null = null

function ouvrirBase(): Promise<IDBDatabase> {
  if (base) return base
  base = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Ce navigateur ne propose pas de stockage local'))
      return
    }
    const requete = indexedDB.open(BASE, VERSION_BASE)
    requete.onupgradeneeded = () => {
      const db = requete.result
      if (!db.objectStoreNames.contains(MAGASIN)) {
        const magasin = db.createObjectStore(MAGASIN, { keyPath: 'id' })
        // Les projets se lisent du plus recent au plus ancien : c'est
        // l'ordre dans lequel on les cherche.
        magasin.createIndex('maj', 'maj')
      }
    }
    requete.onsuccess = () => resolve(requete.result)
    requete.onerror = () => reject(requete.error ?? new Error('Stockage local inaccessible'))
    // Une autre onglet garde une version plus ancienne ouverte.
    requete.onblocked = () => reject(new Error('Une autre fenetre de PixelForge bloque la mise a jour'))
  })
  // Un echec ne doit pas se figer : la tentative suivante rouvre.
  base.catch(() => { base = null })
  return base
}

function transaction<T>(
  mode: IDBTransactionMode,
  action: (magasin: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return ouvrirBase().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(MAGASIN, mode)
    const requete = action(tx.objectStore(MAGASIN))
    requete.onsuccess = () => resolve(requete.result)
    requete.onerror = () => reject(requete.error ?? new Error('Ecriture refusee'))
    tx.onabort = () => reject(tx.error ?? new Error('Ecriture interrompue'))
  }))
}

/** Vrai si le navigateur propose un stockage utilisable. */
export const bibliothequeDisponible = (): boolean => typeof indexedDB !== 'undefined'

/* ------------------------------------------------------------------ */
/* Lecture et ecriture                                                 */
/* ------------------------------------------------------------------ */

/** Les fiches, de la plus recente a la plus ancienne, sans les donnees. */
export async function listerProjets(): Promise<FicheProjet[]> {
  const tout = await transaction<EntreeProjet[]>('readonly', (m) => m.getAll())
  return tout
    .map(({ id, nom, maj, octets, vignette }) => ({ id, nom, maj, octets, vignette }))
    .sort((a, b) => b.maj - a.maj)
}

/** Relit un projet, ou null s'il a disparu. */
export async function chargerProjet(id: string): Promise<Sprite | null> {
  const entree = await transaction<EntreeProjet | undefined>('readonly', (m) => m.get(id))
  if (!entree) return null
  return deserializeSprite(entree.donnees)
}

/**
 * Vignette du sprite : la premiere image, mise a l'echelle sans lissage.
 *
 * Elle est calculee a l'enregistrement et non a l'affichage de la liste :
 * relire dix projets entiers pour dessiner dix vignettes de 64 pixels
 * couterait plusieurs secondes, et la liste doit s'ouvrir tout de suite.
 */
function vignetteDe(sprite: Sprite): string {
  try {
    const COTE = 64
    const cel = sprite.layers.find((l) => l.cels[0])?.cels[0]
    if (!cel) return ''
    const canvas = document.createElement('canvas')
    canvas.width = COTE
    canvas.height = COTE
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.imageSmoothingEnabled = false
    const source = cel.bitmap.toCanvas()
    const echelle = Math.min(COTE / source.width, COTE / source.height)
    const w = Math.max(1, Math.round(source.width * echelle))
    const h = Math.max(1, Math.round(source.height * echelle))
    ctx.drawImage(source, Math.round((COTE - w) / 2), Math.round((COTE - h) / 2), w, h)
    return canvas.toDataURL('image/png')
  } catch {
    // Une vignette ratee ne doit jamais empecher un enregistrement.
    return ''
  }
}

export const nouvelIdProjet = (): string =>
  `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * Ecrit un projet sous l'identifiant donne, en creant l'entree au besoin.
 *
 * Le nom est repris du sprite a chaque fois : renommer le document dans la
 * barre du haut renomme donc l'entree, sans passer par la liste.
 */
export async function enregistrerProjet(id: string, sprite: Sprite): Promise<FicheProjet> {
  const donnees = serializeSprite(sprite)
  const fiche: EntreeProjet = {
    id,
    nom: sprite.name || 'sans-titre',
    maj: Date.now(),
    octets: donnees.length,
    vignette: vignetteDe(sprite),
    donnees,
  }
  await transaction('readwrite', (m) => m.put(fiche))
  const { donnees: _, ...sansDonnees } = fiche
  void _
  return sansDonnees
}

export async function supprimerProjet(id: string): Promise<void> {
  await transaction('readwrite', (m) => m.delete(id))
}

/** Renomme sans relire ni reecrire les pixels. */
export async function renommerProjet(id: string, nom: string): Promise<void> {
  const entree = await transaction<EntreeProjet | undefined>('readonly', (m) => m.get(id))
  if (!entree) return
  await transaction('readwrite', (m) => m.put({ ...entree, nom, maj: Date.now() }))
}

/** Copie un projet sous un nouvel identifiant. */
export async function dupliquerProjet(id: string): Promise<FicheProjet | null> {
  const entree = await transaction<EntreeProjet | undefined>('readonly', (m) => m.get(id))
  if (!entree) return null
  const copie: EntreeProjet = {
    ...entree,
    id: nouvelIdProjet(),
    nom: `${entree.nom} (copie)`,
    maj: Date.now(),
  }
  await transaction('readwrite', (m) => m.put(copie))
  const { donnees: _, ...sansDonnees } = copie
  void _
  return sansDonnees
}

/** Le projet serialise, tel quel, pour l'exporter sans le relire en sprite. */
export async function donneesProjet(id: string): Promise<string | null> {
  const entree = await transaction<EntreeProjet | undefined>('readonly', (m) => m.get(id))
  return entree?.donnees ?? null
}

/* ------------------------------------------------------------------ */
/* Place et durabilite                                                 */
/* ------------------------------------------------------------------ */

export interface EtatStockage {
  /** Octets occupes par l'origine, ou null si le navigateur ne le dit pas. */
  utilise: number | null
  /** Octets accordes, ou null. */
  quota: number | null
  /** Vrai si le navigateur s'engage a ne pas evincer ces donnees. */
  persistant: boolean
}

/**
 * Demande au navigateur de ne pas evincer ces donnees.
 *
 * Sans cet engagement, une origine « best-effort » peut etre videe quand le
 * disque se remplit — sans prevenir, et sans que l'application soit ouverte.
 * Firefox demande a l'utilisateur, Chrome decide seul selon l'usage du site.
 * Un refus n'est pas une erreur : il n'y a rien a faire de plus, et le
 * message de la bibliotheque le dit.
 */
export async function demanderPersistance(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function etatStockage(): Promise<EtatStockage> {
  let utilise: number | null = null
  let quota: number | null = null
  let persistant = false
  try {
    const e = await navigator.storage?.estimate?.()
    utilise = e?.usage ?? null
    quota = e?.quota ?? null
    persistant = (await navigator.storage?.persisted?.()) ?? false
  } catch {
    /* Le navigateur ne dit rien : la bibliotheque marche quand meme. */
  }
  return { utilise, quota, persistant }
}

/* ------------------------------------------------------------------ */
/* Reprise de l'ancienne sauvegarde                                    */
/* ------------------------------------------------------------------ */

const ANCIENNE_CLE = 'pixelforge.autosave.v1'

/**
 * Reprend la sauvegarde automatique de l'ancienne version, une fois.
 *
 * Quelqu'un qui revient avec un travail en cours ne doit pas le perdre parce
 * qu'on a change de rangement. L'entree localStorage est effacee apres la
 * reprise : sans cela elle reviendrait a chaque ouverture, et le travail
 * d'aujourd'hui serait chasse par celui d'avant-hier.
 */
export async function reprendreAncienneSauvegarde(): Promise<FicheProjet | null> {
  let brut = ''
  let quand = 0
  try {
    brut = localStorage.getItem(ANCIENNE_CLE) ?? ''
    quand = Number(localStorage.getItem(`${ANCIENNE_CLE}.at`)) || Date.now()
  } catch {
    return null
  }
  if (!brut) return null

  try {
    const sprite = await deserializeSprite(brut)
    const fiche = await enregistrerProjet(nouvelIdProjet(), sprite)
    // On garde la date d'origine : ce projet est celui d'avant, pas celui
    // qu'on vient de creer.
    await transaction<EntreeProjet | undefined>('readonly', (m) => m.get(fiche.id))
      .then(async (e) => { if (e) await transaction('readwrite', (m) => m.put({ ...e, maj: quand })) })
    try {
      localStorage.removeItem(ANCIENNE_CLE)
      localStorage.removeItem(`${ANCIENNE_CLE}.at`)
    } catch { /* rien a nettoyer */ }
    return { ...fiche, maj: quand }
  } catch {
    // Sauvegarde illisible : on la laisse ou elle est plutot que de la
    // detruire, au cas ou une version ulterieure saurait la relire.
    return null
  }
}
