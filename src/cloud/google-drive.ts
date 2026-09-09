/**
 * Lecture et ecriture des projets dans Google Drive, en REST v3.
 *
 * Aucune bibliotheque cliente : `fetch` et le jeton du module d'a cote
 * suffisent, et une dependance de plus se paierait au chargement de chaque
 * page pour une poignee de requetes.
 *
 * Le scope `drive.file` change la nature des listages : l'API ne repond que
 * les fichiers que cette application a crees ou que l'utilisateur lui a
 * explicitement ouverts. Inutile donc de filtrer par proprietaire ou par
 * dossier pour retrouver nos projets — on ne voit rien d'autre.
 */
import { PROJECT_EXT } from '../io/project'
import {
  GoogleAuthError, accessToken, connect, invalidateToken, setAccount,
  type GoogleAccount,
} from './google-auth'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_NAME = 'PixelForge'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const PROJECT_MIME = 'application/json'
const FOLDER_KEY = 'pixelforge.google.folder-id'

/**
 * `config` : aucun identifiant client.       `auth`   : session a refaire.
 * `reseau` : Drive injoignable ou en panne.  `quota`  : place ou cadence.
 * `absent` : le fichier n'existe plus.       `refus`  : droits insuffisants.
 */
export type DriveErrorKind = 'config' | 'auth' | 'reseau' | 'quota' | 'absent' | 'refus' | 'inconnu'

export class DriveError extends Error {
  readonly kind: DriveErrorKind

  constructor(kind: DriveErrorKind, message: string) {
    super(message)
    this.name = 'DriveError'
    this.kind = kind
  }
}

export interface DriveProject {
  id: string
  name: string
  /** Date ISO renvoyee par Drive. */
  modifiedTime: string
  /** Taille en octets ; 0 quand Drive ne la donne pas. */
  size: number
}

/* ------------------------------------------------------------------ */
/* Requetes                                                            */
/* ------------------------------------------------------------------ */

function fromAuthError(err: unknown): DriveError {
  if (err instanceof GoogleAuthError) {
    return new DriveError(err.kind === 'config' ? 'config' : err.kind === 'reseau' ? 'reseau' : 'auth', err.message)
  }
  return new DriveError('inconnu', err instanceof Error ? err.message : 'Erreur inconnue.')
}

/** Traduit une reponse en echec en message qui dit quoi faire. */
async function explain(res: Response): Promise<DriveError> {
  let reason = ''
  let detail = ''
  try {
    const body = await res.json() as {
      error?: { message?: string; errors?: { reason?: string }[] }
    }
    detail = body.error?.message ?? ''
    reason = body.error?.errors?.[0]?.reason ?? ''
  } catch {
    /* Certaines erreurs de passerelle repondent en HTML. */
  }

  if (res.status === 401) {
    return new DriveError('auth',
      'La session Google a expire et n\'a pas pu etre renouvelee. Reconnectez-vous depuis le menu Fichier.')
  }
  if (res.status === 403) {
    if (reason === 'storageQuotaExceeded') {
      return new DriveError('quota',
        'Votre Google Drive est plein : liberez de la place, ou enregistrez le projet sur le disque avec Ctrl+S.')
    }
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return new DriveError('quota',
        'Google limite le nombre de requetes pour l\'instant. Attendez une minute avant de reessayer.')
    }
    if (reason === 'appNotAuthorizedToFile' || reason === 'insufficientFilePermissions') {
      return new DriveError('refus',
        'Ce fichier n\'appartient pas a PixelForge : le droit demande ne couvre que les projets crees ici.')
    }
    return new DriveError('refus', detail || 'Google Drive a refuse l\'operation.')
  }
  if (res.status === 404) {
    return new DriveError('absent', 'Ce projet n\'existe plus dans Google Drive : il a ete supprime ou mis a la corbeille.')
  }
  if (res.status === 429 || res.status >= 500) {
    return new DriveError('quota', 'Google Drive ne repond pas correctement en ce moment. Reessayez dans un instant.')
  }
  return new DriveError('inconnu', detail || `Google Drive a repondu ${res.status}.`)
}

async function driveFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  let token: string
  try {
    token = await accessToken()
  } catch (err) {
    throw fromAuthError(err)
  }

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    })
  } catch {
    // `fetch` ne rejette que sur un probleme reseau : coupure, DNS, blocage.
    throw new DriveError('reseau',
      'Google Drive est injoignable : verifiez votre connexion. Le projet reste ouvert ici et peut etre enregistre sur le disque.')
  }

  // Un jeton peut expirer entre deux requetes d'un meme envoi : on en
  // redemande un sans rien afficher, puis on rejoue la requete une fois.
  if (res.status === 401 && retry) {
    invalidateToken()
    return driveFetch(url, init, false)
  }
  if (!res.ok) throw await explain(res)
  return res
}

async function readJson<T>(res: Response): Promise<T> {
  try {
    return await res.json() as T
  } catch {
    throw new DriveError('inconnu', 'Reponse illisible de Google Drive.')
  }
}

/* ------------------------------------------------------------------ */
/* Compte                                                              */
/* ------------------------------------------------------------------ */

/** Qui est connecte. `about` est accessible avec le seul droit `drive.file`. */
export async function driveAccount(): Promise<GoogleAccount> {
  const res = await driveFetch(`${API}/about?fields=user(displayName,emailAddress)`)
  const data = await readJson<{ user?: { displayName?: string; emailAddress?: string } }>(res)
  const compte: GoogleAccount = {
    name: data.user?.displayName ?? 'Compte Google',
    email: data.user?.emailAddress ?? '',
  }
  setAccount(compte)
  return compte
}

/** Connexion explicite depuis l'interface, suivie de l'identite du compte. */
export async function connectDrive(): Promise<GoogleAccount> {
  try {
    await connect()
  } catch (err) {
    throw fromAuthError(err)
  }
  return driveAccount()
}

/* ------------------------------------------------------------------ */
/* Dossier de rangement                                                */
/* ------------------------------------------------------------------ */

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeLocal(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* Sans stockage, le dossier sera simplement recherche a chaque envoi. */
  }
}

/**
 * Retourne le dossier « PixelForge », en le creant au besoin.
 *
 * Le dossier est cree a la demande, pas a la connexion : personne n'aime
 * qu'une application pose un dossier dans son Drive juste pour dire bonjour.
 */
async function ensureFolder(): Promise<string> {
  const cached = readLocal(FOLDER_KEY)
  if (cached) {
    try {
      const res = await driveFetch(`${API}/files/${encodeURIComponent(cached)}?fields=id,trashed`)
      const data = await readJson<{ trashed?: boolean }>(res)
      if (!data.trashed) return cached
    } catch (err) {
      // Dossier supprime ou vide par un autre appareil : on le refait.
      if (!(err instanceof DriveError) || (err.kind !== 'absent' && err.kind !== 'refus')) throw err
    }
    writeLocal(FOLDER_KEY, '')
  }

  const query = `mimeType = '${FOLDER_MIME}' and name = '${FOLDER_NAME}' and trashed = false`
  const params = new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '1', spaces: 'drive' })
  const found = await readJson<{ files?: { id: string }[] }>(await driveFetch(`${API}/files?${params}`))
  const existing = found.files?.[0]?.id
  if (existing) {
    writeLocal(FOLDER_KEY, existing)
    return existing
  }

  const created = await readJson<{ id: string }>(await driveFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  }))
  writeLocal(FOLDER_KEY, created.id)
  return created.id
}

/* ------------------------------------------------------------------ */
/* Projets                                                             */
/* ------------------------------------------------------------------ */

/** Les projets PixelForge visibles par l'application, les plus recents d'abord. */
export async function listProjects(): Promise<DriveProject[]> {
  const params = new URLSearchParams({
    q: `trashed = false and name contains '.${PROJECT_EXT}'`,
    fields: 'files(id,name,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
    pageSize: '100',
    spaces: 'drive',
  })
  const data = await readJson<{ files?: { id: string; name: string; modifiedTime?: string; size?: string }[] }>(
    await driveFetch(`${API}/files?${params}`),
  )
  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime ?? '',
    size: Number(f.size ?? 0),
  }))
}

export async function downloadProject(fileId: string): Promise<string> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)
  try {
    return await res.text()
  } catch {
    throw new DriveError('reseau', 'Le telechargement du projet a ete interrompu.')
  }
}

/**
 * Envoie le projet. Avec un `fileId`, le fichier existant est ecrase ; sans,
 * un nouveau fichier est cree dans le dossier PixelForge.
 */
export async function saveProject(name: string, content: string, fileId: string | null): Promise<DriveProject> {
  const filename = name.endsWith(`.${PROJECT_EXT}`) ? name : `${name}.${PROJECT_EXT}`
  if (!fileId) return upload(filename, content, null)
  try {
    return await upload(filename, content, fileId)
  } catch (err) {
    // Le fichier lie a pu etre supprime depuis Drive entre deux
    // enregistrements : recreer vaut mieux que perdre le travail.
    if (err instanceof DriveError && (err.kind === 'absent' || err.kind === 'refus')) {
      return upload(filename, content, null)
    }
    throw err
  }
}

async function upload(filename: string, content: string, fileId: string | null): Promise<DriveProject> {
  const metadata: Record<string, unknown> = { name: filename, mimeType: PROJECT_MIME }
  // Le dossier ne se renseigne qu'a la creation : un PATCH portant `parents`
  // est refuse par l'API, le deplacement se fait avec addParents.
  if (!fileId) metadata.parents = [await ensureFolder()]

  // Frontiere tiree au hasard : le corps d'un projet est du JSON compact
  // encode en base64, une collision demanderait de le viser expres.
  const boundary = `pixelforge-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${PROJECT_MIME}; charset=UTF-8`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')

  const url = `${UPLOAD}${fileId ? `/${encodeURIComponent(fileId)}` : ''}` +
    '?uploadType=multipart&fields=id,name,modifiedTime,size'
  const data = await readJson<{ id: string; name?: string; modifiedTime?: string; size?: string }>(
    await driveFetch(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }),
  )
  return {
    id: data.id,
    name: data.name ?? filename,
    modifiedTime: data.modifiedTime ?? new Date().toISOString(),
    size: Number(data.size ?? content.length),
  }
}
