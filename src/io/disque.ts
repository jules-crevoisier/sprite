/**
 * Ecriture d'un vrai fichier sur le disque, quand le navigateur le permet.
 *
 * Ctrl+S telechargeait une copie de plus dans le dossier des
 * telechargements : au dixieme enregistrement on avait dix fichiers
 * `heros (7).pixelforge` et plus aucune idee duquel etait le bon. L'API File
 * System Access change cela — la personne choisit son fichier une fois, et
 * les enregistrements suivants le reecrivent en silence, comme une
 * application de bureau.
 *
 * Elle n'existe pas partout : Chrome et Edge l'ont, Firefox et Safari non.
 * D'ou `ecritureDisqueDisponible()`, et d'ou le repli sur le telechargement
 * — qui reste le comportement de tout le monde, pas un mode degrade honteux.
 *
 * La poignee obtenue est rangee en IndexedDB : elle survit donc au
 * rechargement de la page, ce qu'aucun objet ordinaire ne fait. Le navigateur
 * redemande en revanche l'autorisation d'ecrire au premier Ctrl+S de la
 * session — c'est voulu de sa part, et une page ne peut pas s'en dispenser.
 */

/** Poignee de fichier, telle que l'API la rend. Typee au minimum utile. */
export interface PoigneeFichier {
  readonly name: string
  readonly kind: 'file'
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  isSameEntry?(autre: PoigneeFichier): Promise<boolean>
}

interface FenetreFichiers {
  showSaveFilePicker?(o: unknown): Promise<PoigneeFichier>
  showOpenFilePicker?(o: unknown): Promise<PoigneeFichier[]>
}

const api = (): FenetreFichiers => window as unknown as FenetreFichiers

export const ecritureDisqueDisponible = (): boolean =>
  typeof api().showSaveFilePicker === 'function'

export const ouvertureDisqueDisponible = (): boolean =>
  typeof api().showOpenFilePicker === 'function'

/** Erreur levee quand la personne ferme le selecteur. Ce n'est pas un echec. */
export const ESTAnnulation = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'AbortError' || e.name === 'NotAllowedError')

const TYPES = [{
  description: 'Projet PixelForge',
  accept: { 'application/json': ['.pixelforge', '.json'] },
}]

/** Ouvre le selecteur d'enregistrement. Rend null si la personne renonce. */
export async function choisirFichierEnregistrement(nom: string): Promise<PoigneeFichier | null> {
  const choisir = api().showSaveFilePicker
  if (!choisir) return null
  try {
    return await choisir({
      suggestedName: nom,
      types: TYPES,
      // Le selecteur rouvre dans le dossier du dernier projet plutot qu'a
      // la racine : sur un projet de jeu, c'est toujours le meme dossier.
      id: 'pixelforge-projets',
      startIn: 'documents',
    })
  } catch (e) {
    if (ESTAnnulation(e)) return null
    throw e
  }
}

export async function choisirFichierOuverture(): Promise<PoigneeFichier | null> {
  const choisir = api().showOpenFilePicker
  if (!choisir) return null
  try {
    const [poignee] = await choisir({
      types: TYPES,
      multiple: false,
      id: 'pixelforge-projets',
      startIn: 'documents',
    })
    return poignee ?? null
  } catch (e) {
    if (ESTAnnulation(e)) return null
    throw e
  }
}

/**
 * Verifie qu'on a toujours le droit d'ecrire, et le redemande sinon.
 *
 * Apres un rechargement de page, une poignee relue depuis IndexedDB est
 * valide mais sans permission : le navigateur exige un geste de la personne
 * avant la premiere ecriture de la session.
 */
export async function autoriserEcriture(poignee: PoigneeFichier): Promise<boolean> {
  try {
    const options = { mode: 'readwrite' as const }
    if ((await poignee.queryPermission?.(options)) === 'granted') return true
    return (await poignee.requestPermission?.(options)) === 'granted'
  } catch {
    return false
  }
}

/** Reecrit le fichier. Rend false si l'autorisation manque. */
export async function ecrireFichier(poignee: PoigneeFichier, contenu: string): Promise<boolean> {
  if (!(await autoriserEcriture(poignee))) return false
  const flux = await poignee.createWritable()
  await flux.write(contenu)
  await flux.close()
  return true
}

/* ------------------------------------------------------------------ */
/* Memoire de la poignee                                               */
/* ------------------------------------------------------------------ */

const BASE = 'pixelforge-disque'
const MAGASIN = 'poignees'
const CLE = 'projet-courant'

/**
 * Les poignees ne se serialisent pas en JSON, mais IndexedDB sait les
 * structurer-cloner : c'est le seul rangement qui les fasse survivre a un
 * rechargement.
 */
function baseDisque(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('sans stockage')); return }
    const r = indexedDB.open(BASE, 1)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(MAGASIN)) r.result.createObjectStore(MAGASIN)
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('sans stockage'))
  })
}

export async function retenirPoignee(poignee: PoigneeFichier | null): Promise<void> {
  try {
    const db = await baseDisque()
    const tx = db.transaction(MAGASIN, 'readwrite')
    const magasin = tx.objectStore(MAGASIN)
    if (poignee) magasin.put(poignee, CLE)
    else magasin.delete(CLE)
  } catch {
    // Sans memoire de la poignee, Ctrl+S redemandera le fichier : genant,
    // jamais bloquant.
  }
}

export async function poigneeRetenue(): Promise<PoigneeFichier | null> {
  try {
    const db = await baseDisque()
    return await new Promise<PoigneeFichier | null>((resolve) => {
      const r = db.transaction(MAGASIN, 'readonly').objectStore(MAGASIN).get(CLE)
      r.onsuccess = () => resolve((r.result as PoigneeFichier) ?? null)
      r.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}
