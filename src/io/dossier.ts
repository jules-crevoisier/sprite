/**
 * Le dossier de travail : l'atelier de l'artiste, vu depuis l'editeur.
 *
 * Un projet de jeu n'est pas un fichier, c'est un DOSSIER — trente sprites,
 * un tileset, des palettes, rangés comme la personne l'a decide. Jusqu'ici
 * l'editeur ne savait ouvrir qu'un fichier a la fois, choisi dans une boite
 * de dialogue : pour passer du heros au slime il fallait refaire tout le
 * chemin. On ouvre donc le dossier UNE fois, et tout ce qu'il contient est la.
 *
 * ## Ce que le navigateur permet, et ce qu'il refuse
 *
 * `showDirectoryPicker` n'existe que sur Chrome et Edge. Firefox et Safari ne
 * l'ont pas, et il n'y a pas de contournement honnete : `webkitdirectory`
 * donne des copies en lecture seule, sans aucun moyen de reecrire le fichier
 * d'origine — ce qui serait pire que rien, puisqu'on croirait enregistrer.
 * L'interface le dit donc au lieu de faire semblant.
 *
 * La poignee de dossier se range en IndexedDB : elle survit au rechargement,
 * ce qu'aucun objet ordinaire ne fait. Le navigateur redemande en revanche
 * l'autorisation a la premiere lecture de chaque session — c'est voulu de sa
 * part, et une page ne peut pas s'en dispenser.
 */
import type { PoigneeFichier } from './disque'

export interface PoigneeDossier {
  readonly name: string
  readonly kind: 'directory'
  entries(): AsyncIterableIterator<[string, PoigneeFichier | PoigneeDossier]>
  getFileHandle(nom: string, o?: { create?: boolean }): Promise<PoigneeFichier>
  getDirectoryHandle(nom: string, o?: { create?: boolean }): Promise<PoigneeDossier>
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface FenetreDossiers {
  showDirectoryPicker?(o?: unknown): Promise<PoigneeDossier>
}
const api = (): FenetreDossiers => window as unknown as FenetreDossiers

export const dossierDisponible = (): boolean =>
  typeof api().showDirectoryPicker === 'function'

/** Ouvre le selecteur de dossier. Rend null si la personne renonce. */
export async function choisirDossier(): Promise<PoigneeDossier | null> {
  const choisir = api().showDirectoryPicker
  if (!choisir) return null
  try {
    return await choisir({ mode: 'readwrite', id: 'pixelforge-travail' })
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return null
    throw e
  }
}

/* ------------------------------------------------------------------ */
/* Ce qu'on sait ouvrir                                                */
/* ------------------------------------------------------------------ */

export type Genre = 'projet' | 'aseprite' | 'image' | 'palette' | 'autre'

const GENRES: [RegExp, Genre][] = [
  [/\.(pixelforge)$/i, 'projet'],
  [/\.(aseprite|ase)$/i, 'aseprite'],
  [/\.(png|gif|bmp|webp|jpe?g)$/i, 'image'],
  [/\.(gpl|pal|hex|act|ase-pal)$/i, 'palette'],
]

export function genreDe(nom: string): Genre {
  for (const [re, g] of GENRES) if (re.test(nom)) return g
  // Un `.json` n'est un projet que s'il en a l'air : beaucoup de dossiers de
  // jeu en contiennent qui ne nous regardent pas (tsconfig, package, tuiles
  // d'un autre moteur). On ne le classe donc pas sur l'extension seule.
  return 'autre'
}

export interface Entree {
  nom: string
  genre: Genre
  poignee: PoigneeFichier
  /** Taille en octets, si le navigateur la donne sans lire le fichier. */
  octets: number
  maj: number
}

/**
 * Liste ce qu'un dossier contient, trie et filtre.
 *
 * On ne descend pas dans les sous-dossiers : un dossier de projet contient
 * souvent un `node_modules` ou un `.git`, et les parcourir bloquerait
 * l'interface plusieurs secondes pour n'en rien tirer. Les sous-dossiers sont
 * listes pour qu'on puisse y entrer d'un clic, ce qui est a la fois plus
 * rapide et plus previsible.
 */
export interface Contenu {
  fichiers: Entree[]
  sousDossiers: { nom: string; poignee: PoigneeDossier }[]
}

/** Un dossier cache ou technique n'a rien a faire dans la liste. */
const IGNORES = new Set(['node_modules', '.git', '.svn', 'dist', 'build', '.cache', '__pycache__'])

export async function lireDossier(dossier: PoigneeDossier): Promise<Contenu> {
  const fichiers: Entree[] = []
  const sousDossiers: { nom: string; poignee: PoigneeDossier }[] = []

  for await (const [nom, poignee] of dossier.entries()) {
    if (nom.startsWith('.') || IGNORES.has(nom)) continue
    if (poignee.kind === 'directory') {
      sousDossiers.push({ nom, poignee: poignee as PoigneeDossier })
      continue
    }
    const genre = genreDe(nom)
    if (genre === 'autre') continue
    const f = poignee as PoigneeFichier
    let octets = 0, maj = 0
    try {
      const fichier = await f.getFile()
      octets = fichier.size
      maj = fichier.lastModified
    } catch { /* fichier disparu entre le listage et la lecture */ }
    fichiers.push({ nom, genre, poignee: f, octets, maj })
  }

  fichiers.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }))
  sousDossiers.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }))
  return { fichiers, sousDossiers }
}

/** Demande l'autorisation si elle n'est pas deja acquise. */
export async function autoriser(
  d: PoigneeDossier, mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  if (!d.queryPermission) return true
  if (await d.queryPermission({ mode }) === 'granted') return true
  if (!d.requestPermission) return false
  return await d.requestPermission({ mode }) === 'granted'
}

/* ------------------------------------------------------------------ */
/* Le dossier survit au rechargement                                   */
/* ------------------------------------------------------------------ */

const BASE = 'pixelforge-dossier'
const MAGASIN = 'poignees'
const CLE = 'travail'

function base(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1)
    r.onupgradeneeded = () => { r.result.createObjectStore(MAGASIN) }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => ko(r.error)
  })
}

export async function retenirDossier(d: PoigneeDossier | null): Promise<void> {
  try {
    const db = await base()
    await new Promise<void>((ok, ko) => {
      const t = db.transaction(MAGASIN, 'readwrite')
      const s = t.objectStore(MAGASIN)
      if (d) s.put(d, CLE); else s.delete(CLE)
      t.oncomplete = () => ok()
      t.onerror = () => ko(t.error)
    })
    db.close()
  } catch { /* navigation privee, quota : on se passe du souvenir */ }
}

export async function dossierRetenu(): Promise<PoigneeDossier | null> {
  try {
    const db = await base()
    const v = await new Promise<unknown>((ok, ko) => {
      const r = db.transaction(MAGASIN, 'readonly').objectStore(MAGASIN).get(CLE)
      r.onsuccess = () => ok(r.result)
      r.onerror = () => ko(r.error)
    })
    db.close()
    return (v ?? null) as PoigneeDossier | null
  } catch { return null }
}
