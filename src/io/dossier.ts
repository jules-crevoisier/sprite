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
 * l'ont pas — mais ils ont `webkitdirectory`, qui donne TOUT le contenu d'un
 * dossier en lecture. Il a longtemps ete ecrit ici qu'il n'y avait « pas de
 * contournement honnete ». C'etait deux questions confondues en une :
 *
 * - **Parcourir** un dossier : Firefox et Safari le font tres bien. Choisir
 *   son dossier une fois, voir ses trente sprites, en ouvrir un d'un clic —
 *   tout cela marche, et c'est l'essentiel de ce que le panneau apporte.
 * - **Reecrire** un fichier sur place : eux ne le font pas. Il n'y a pas de
 *   contournement, et il ne faut surtout pas en inventer un : croire qu'on
 *   enregistre alors qu'on ne le fait pas est la pire faute possible.
 *
 * On separe donc les deux. Un dossier ouvert par `webkitdirectory` est marque
 * `lectureSeule`, et cette marque voyage avec chaque fichier qu'on en tire :
 * Ctrl+S sait alors qu'il doit ranger dans « Mes projets » au lieu de tenter
 * une ecriture qui echouerait. L'interface annonce la limite AVANT qu'on
 * travaille, pas apres.
 *
 * ## Ce qui ne survit pas au rechargement, et pourquoi on ne triche pas
 *
 * La poignee native se range en IndexedDB : elle survit au rechargement, ce
 * qu'aucun objet ordinaire ne fait. Un dossier lu par `webkitdirectory`, lui,
 * n'est qu'une liste de `File` — des instantanes. IndexedDB saurait les
 * ranger, et l'on rouvrirait la page avec un dossier d'apparence intacte dont
 * le contenu daterait de la veille. On ne les retient donc pas : redemander
 * le dossier a chaque session est genant, lire de vieux octets en croyant
 * lire les bons ne l'est pas — c'est faux.
 */
import type { PoigneeFichier } from './disque'

export interface PoigneeDossier {
  readonly name: string
  readonly kind: 'directory'
  /**
   * Vrai quand ce dossier ne peut pas etre reecrit.
   *
   * Absent sur une poignee native — ce qui vaut « faux » — et vrai sur un
   * dossier lu par `webkitdirectory`. C'est un fait sur le navigateur, pas un
   * reglage : rien ne le bascule.
   */
  readonly lectureSeule?: boolean
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

/** Vrai la ou l'on peut ouvrir un dossier ET y reecrire : Chrome, Edge. */
export const dossierDisponible = (): boolean =>
  typeof api().showDirectoryPicker === 'function'

/**
 * Vrai la ou l'on peut au moins PARCOURIR un dossier.
 *
 * On teste la propriete sur un `input` reel plutot que la chaine d'agent
 * utilisateur : celle-ci ment, et elle ment de plus en plus.
 */
export const parcoursDossierDisponible = (): boolean => {
  if (dossierDisponible()) return true
  if (typeof document === 'undefined') return false
  return 'webkitdirectory' in document.createElement('input')
}

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
/* Le dossier en lecture seule, pour Firefox et Safari                 */
/* ------------------------------------------------------------------ */

/** Un fichier tire d'un `webkitdirectory` : on sait le lire, pas l'ecrire. */
function poigneeLecture(f: File): PoigneeFichier {
  return {
    name: f.name,
    kind: 'file',
    getFile: () => Promise.resolve(f),
    // `createWritable` manque VOLONTAIREMENT : la poignee ne doit pas avoir
    // l'air d'une poignee inscriptible. Un appel doit echouer tout de suite et
    // fort, pas ecrire dans le vide.
  } as unknown as PoigneeFichier
}

/**
 * Reconstruit l'arborescence a partir des chemins relatifs.
 *
 * `webkitdirectory` rend une liste PLATE, chaque fichier portant son chemin
 * depuis le dossier choisi : « heros/marche/01.png ». On rebatit donc les
 * niveaux, pour que le panneau se comporte exactement comme avec une poignee
 * native — un niveau a la fois, et l'on entre dans un sous-dossier d'un clic.
 */
export function dossierDepuisFichiers(fichiers: File[], nomSecours = 'dossier'): PoigneeDossier {
  interface Noeud { nom: string; fichiers: Map<string, File>; enfants: Map<string, Noeud> }
  const neuf = (nom: string): Noeud => ({ nom, fichiers: new Map(), enfants: new Map() })
  const racine = neuf(nomSecours)

  for (const f of fichiers) {
    const relatif = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const parts = relatif.split('/').filter(Boolean)
    // Le premier segment est le dossier choisi lui-meme : il donne son nom a
    // la racine et ne fait pas un niveau de plus.
    if (parts.length > 1) racine.nom = parts[0]!
    let ou = racine
    for (const seg of parts.slice(parts.length > 1 ? 1 : 0, -1)) {
      let suivant = ou.enfants.get(seg)
      if (!suivant) { suivant = neuf(seg); ou.enfants.set(seg, suivant) }
      ou = suivant
    }
    ou.fichiers.set(parts[parts.length - 1]!, f)
  }

  const envelopper = (n: Noeud): PoigneeDossier => ({
    name: n.nom,
    kind: 'directory',
    lectureSeule: true,
    async *entries() {
      for (const [nom, sous] of n.enfants) yield [nom, envelopper(sous)]
      for (const [nom, f] of n.fichiers) yield [nom, poigneeLecture(f)]
    },
    getFileHandle(nom: string) {
      const f = n.fichiers.get(nom)
      return f ? Promise.resolve(poigneeLecture(f))
        : Promise.reject(new DOMException(`${nom} introuvable`, 'NotFoundError'))
    },
    getDirectoryHandle(nom: string) {
      const sous = n.enfants.get(nom)
      return sous ? Promise.resolve(envelopper(sous))
        : Promise.reject(new DOMException(`${nom} introuvable`, 'NotFoundError'))
    },
  })
  return envelopper(racine)
}

/**
 * Demande un dossier par `webkitdirectory`. Rend null si la personne renonce.
 *
 * Il n'y a pas d'evenement « la personne a annule » : `change` ne part que si
 * elle a choisi. On ecoute donc aussi `cancel`, que les navigateurs recents
 * emettent, et l'on retombe sur la fermeture de la fenetre pour les autres —
 * sans quoi la promesse resterait pendante et le bouton mort.
 */
export function choisirDossierEnLecture(): Promise<PoigneeDossier | null> {
  return new Promise((resolve) => {
    const entree = document.createElement('input')
    entree.type = 'file'
    entree.style.display = 'none'
    const anonyme = entree as HTMLInputElement & { webkitdirectory: boolean }
    anonyme.webkitdirectory = true
    entree.multiple = true
    let repondu = false
    const repondre = (v: PoigneeDossier | null): void => {
      if (repondu) return
      repondu = true
      entree.remove()
      resolve(v)
    }
    entree.addEventListener('change', () => {
      const fichiers = [...(entree.files ?? [])]
      repondre(fichiers.length ? dossierDepuisFichiers(fichiers) : null)
    })
    entree.addEventListener('cancel', () => repondre(null))
    document.body.appendChild(entree)
    entree.click()
  })
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
  /**
   * Vrai si ce fichier vient d'un dossier qu'on ne sait pas reecrire.
   *
   * La marque suit le FICHIER et pas seulement le dossier : une fois ouvert
   * dans un onglet, le fichier n'a plus de dossier, et c'est pourtant la que
   * Ctrl+S a besoin de savoir.
   */
  lectureSeule: boolean
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
    fichiers.push({ nom, genre, poignee: f, octets, maj, lectureSeule: !!dossier.lectureSeule })
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
  // Un dossier en lecture seule n'est qu'une liste d'instantanes. Le ranger
  // ferait rouvrir la page sur un dossier d'apparence intacte dont le contenu
  // daterait de la veille — on efface plutot que de retenir du faux.
  if (d?.lectureSeule) { await retenirDossier(null); return }
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
