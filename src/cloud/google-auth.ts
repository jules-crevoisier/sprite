/**
 * Connexion a un compte Google, pour ranger les projets dans Drive.
 *
 * Quatre choix a expliquer :
 *
 * - Le script Google Identity Services n'est telecharge qu'au premier usage
 *   d'une commande Drive. PixelForge est un editeur hors ligne : le charger
 *   au demarrage reviendrait a signaler chaque ouverture de l'onglet a un
 *   tiers, pour une fonction que la plupart des dessins n'utiliseront jamais.
 * - Le seul droit demande est `drive.file`, qui ne donne acces qu'aux
 *   fichiers crees ou ouverts par l'application. Le droit `drive` complet
 *   ouvrirait toute la bibliotheque de l'utilisateur pour y poser des
 *   sprites : hors de proportion, et un ecran de consentement effrayant
 *   pour un editeur de pixel art.
 * - Le jeton d'acces reste en memoire. En localStorage il trainerait une
 *   heure a la portee du premier script tiers ; sur disque on ne garde que
 *   le fait d'avoir ete connecte, ce qui suffit a redemander un jeton sans
 *   deranger l'utilisateur quand il revient.
 * - L'identifiant client se lit dans la configuration ou dans les reglages.
 *   Ecrire celui d'un deploiement dans le code obligerait chaque personne
 *   qui heberge PixelForge a modifier les sources.
 */

/** Le droit minimal qui permette d'ecrire et de relire nos propres projets. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const GSI_URL = 'https://accounts.google.com/gsi/client'
const CLIENT_ID_KEY = 'pixelforge.google.client-id'
const CONNECTED_KEY = 'pixelforge.google.connected'

/* ------------------------------------------------------------------ */
/* Interface du script Google Identity Services                        */
/* ------------------------------------------------------------------ */

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GsiOauth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    prompt?: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }): TokenClient
  revoke(token: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GsiOauth2 } }
  }
}

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

/**
 * `config` : rien n'est configure, il faut un identifiant client.
 * `reseau` : le script Google n'a pas pu etre telecharge.
 * `refus`  : l'utilisateur ou le navigateur a interrompu la connexion.
 */
export type AuthErrorKind = 'config' | 'reseau' | 'refus'

export class GoogleAuthError extends Error {
  readonly kind: AuthErrorKind

  constructor(kind: AuthErrorKind, message: string) {
    super(message)
    this.name = 'GoogleAuthError'
    this.kind = kind
  }
}

/* ------------------------------------------------------------------ */
/* Identifiant client                                                  */
/* ------------------------------------------------------------------ */

/** Une phrase, affichee partout ou l'identifiant manque. */
export const MISSING_CLIENT_ID =
  'Google Drive a besoin d\'un identifiant client OAuth, et aucun n\'est configure : ' +
  'creez-en un gratuitement dans la console Google Cloud, puis collez-le ci-dessous.'

/** Petit stockage tolerant : navigation privee, quota plein, iframe cloisonnee. */
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
    /* Sans stockage on retombe sur la configuration de construction. */
  }
}

/** Identifiant saisi dans les reglages ; il prime sur celui du build. */
export function storedClientId(): string {
  return readLocal(CLIENT_ID_KEY).trim()
}

/** Identifiant fourni a la construction, via VITE_GOOGLE_CLIENT_ID. */
export function buildClientId(): string {
  return (import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? '').trim()
}

export function clientId(): string {
  return storedClientId() || buildClientId()
}

export function isConfigured(): boolean {
  return clientId().length > 0
}

/** Enregistre l'identifiant saisi a la main ; une chaine vide l'efface. */
export function setClientId(value: string): void {
  const clean = value.trim()
  writeLocal(CLIENT_ID_KEY, clean)
  // Le client de jetons porte l'ancien identifiant : la session en cours
  // n'a plus de sens des que celui-ci change.
  reset()
  notify()
}

/** L'origine a declarer dans la console Google. */
export function authorizedOrigin(): string {
  return window.location.origin
}

/** Marche a suivre, affichee dans le dialogue de reglages. */
export function setupSteps(): string[] {
  return [
    'Ouvrez console.cloud.google.com, choisissez ou creez un projet.',
    'API et services > Ecran de consentement OAuth : type « Externe », ajoutez votre compte en utilisateur de test.',
    'API et services > Bibliotheque : activez « Google Drive API ».',
    'API et services > Identifiants > Creer des identifiants > ID client OAuth, type « Application Web ».',
    `Origines JavaScript autorisees : ${authorizedOrigin()} (aucune URI de redirection n'est necessaire).`,
    'Copiez l\'ID client (il finit par .apps.googleusercontent.com) et collez-le ci-dessous.',
  ]
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export interface GoogleAccount {
  name: string
  email: string
}

export interface GoogleSession {
  /** Un jeton valide est en main : les appels Drive passeront sans clic. */
  connected: boolean
  account: GoogleAccount | null
}

let token = ''
let tokenExpiry = 0
let account: GoogleAccount | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const cb of listeners) cb()
}

/** S'abonne aux changements de session ; retourne de quoi se desabonner. */
export function onSessionChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function session(): GoogleSession {
  return { connected: token !== '' && Date.now() < tokenExpiry, account }
}

/**
 * Le compte est renseigne par le module Drive : le scope demande ne donne
 * pas acces au profil, mais `drive/v3/about` retourne le proprietaire du
 * Drive qu'on vient d'ouvrir — un droit de plus evite.
 */
export function setAccount(value: GoogleAccount | null): void {
  account = value
  notify()
}

/** L'utilisateur a deja accorde l'acces sur ce navigateur. */
export function wasConnected(): boolean {
  return readLocal(CONNECTED_KEY) === '1'
}

/** Oublie le jeton courant : l'appel suivant en redemandera un. */
export function invalidateToken(): void {
  token = ''
  tokenExpiry = 0
  notify()
}

function reset(): void {
  token = ''
  tokenExpiry = 0
  account = null
}

/* ------------------------------------------------------------------ */
/* Chargement du script Google                                         */
/* ------------------------------------------------------------------ */

let gsiLoad: Promise<GsiOauth2> | null = null

function loadGsi(): Promise<GsiOauth2> {
  const present = window.google?.accounts?.oauth2
  if (present) return Promise.resolve(present)
  if (gsiLoad) return gsiLoad

  gsiLoad = new Promise<GsiOauth2>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GSI_URL
    script.async = true
    script.defer = true
    const echec = (message: string) => {
      // Un echec ne doit pas condamner la session : la connexion peut
      // revenir, et le prochain essai retentera le telechargement.
      gsiLoad = null
      script.remove()
      reject(new GoogleAuthError('reseau', message))
    }
    script.addEventListener('load', () => {
      const api = window.google?.accounts?.oauth2
      if (api) resolve(api)
      else echec('Le script de connexion Google s\'est charge sans repondre. Rechargez la page.')
    })
    script.addEventListener('error', () => echec(
      'Impossible de joindre accounts.google.com : verifiez votre connexion, ' +
      'un bloqueur ou la politique de securite du site. PixelForge reste utilisable hors ligne.',
    ))
    document.head.appendChild(script)
  })
  return gsiLoad
}

/* ------------------------------------------------------------------ */
/* Jetons                                                              */
/* ------------------------------------------------------------------ */

/** Delai de garde d'une reconnexion silencieuse, en millisecondes. */
const SILENT_TIMEOUT = 8_000
/** Delai de garde d'une connexion avec fenetre : le temps de choisir un compte. */
const INTERACTIVE_TIMEOUT = 180_000

function requestToken(interactive: boolean): Promise<string> {
  return loadGsi().then((oauth2) => new Promise<string>((resolve, reject) => {
    let done = false
    const finish = (action: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      action()
    }

    // Un client par demande : les rappels ferment sur cette promesse, donc
    // deux enregistrements qui se chevauchent ne se volent pas leur reponse.
    const client = oauth2.initTokenClient({
      client_id: clientId(),
      scope: DRIVE_SCOPE,
      callback: (response) => finish(() => {
        if (!response.access_token) {
          reject(new GoogleAuthError('refus',
            response.error_description || response.error || 'Google a refuse la connexion.'))
          return
        }
        token = response.access_token
        // Une marge d'une minute : mieux vaut renouveler un peu tot que
        // decouvrir l'expiration au milieu d'un envoi.
        tokenExpiry = Date.now() + Math.max(30, (response.expires_in ?? 3600) - 60) * 1000
        writeLocal(CONNECTED_KEY, '1')
        notify()
        resolve(token)
      }),
      error_callback: (error) => finish(() => reject(mapGsiError(error))),
    })

    // Sans delai de garde, une reconnexion silencieuse refusee en silence
    // (cookies tiers bloques, iframe avalee) laisserait l'enregistrement
    // suspendu pour toujours, sans un mot a l'utilisateur.
    const timer = setTimeout(
      () => finish(() => reject(new GoogleAuthError('refus',
        interactive
          ? 'La fenetre de connexion Google est restee sans reponse.'
          : 'Google n\'a pas renouvele l\'acces sans intervention.'))),
      interactive ? INTERACTIVE_TIMEOUT : SILENT_TIMEOUT,
    )

    // `prompt: ''` demande un renouvellement muet ; il n'aboutit que si le
    // consentement precedent tient toujours.
    client.requestAccessToken({ prompt: interactive ? 'select_account' : '' })
  }))
}

function mapGsiError(error: { type?: string; message?: string }): GoogleAuthError {
  switch (error.type) {
    case 'popup_failed_to_open':
      return new GoogleAuthError('refus',
        'Le navigateur a bloque la fenetre de connexion Google. Autorisez les fenetres surgissantes pour ce site, puis reessayez.')
    case 'popup_closed':
      return new GoogleAuthError('refus', 'Connexion annulee : la fenetre Google a ete fermee.')
    default:
      return new GoogleAuthError('refus', error.message || 'La connexion a Google a echoue.')
  }
}

/**
 * Retourne un jeton d'acces valide.
 *
 * Le renouvellement silencieux est toujours tente en premier : un jeton dure
 * une heure, et personne ne veut cliquer sur « autoriser » au milieu d'une
 * session de dessin.
 */
export async function accessToken(options: { interactive?: boolean } = {}): Promise<string> {
  if (!isConfigured()) throw new GoogleAuthError('config', MISSING_CLIENT_ID)
  const interactive = options.interactive ?? true
  if (token && Date.now() < tokenExpiry) return token

  if (wasConnected()) {
    try {
      return await requestToken(false)
    } catch (err) {
      // Le silence a echoue : soit on peut ouvrir une fenetre, soit
      // l'appelant voulait justement ne rien afficher.
      if (!interactive || err instanceof GoogleAuthError && err.kind === 'reseau') throw err
    }
  } else if (!interactive) {
    throw new GoogleAuthError('refus', 'Aucun compte Google connecte sur ce navigateur.')
  }

  return requestToken(true)
}

/** Connexion explicite, avec choix du compte. */
export async function connect(): Promise<string> {
  if (!isConfigured()) throw new GoogleAuthError('config', MISSING_CLIENT_ID)
  return requestToken(true)
}

/**
 * Deconnexion : on revoque le jeton cote Google plutot que de simplement
 * l'oublier, sinon l'autorisation resterait active jusqu'a son expiration.
 */
export async function disconnect(): Promise<void> {
  const previous = token
  reset()
  writeLocal(CONNECTED_KEY, '')
  notify()
  if (!previous) return
  try {
    const oauth2 = await loadGsi()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3_000)
      oauth2.revoke(previous, () => { clearTimeout(timer); resolve() })
    })
  } catch {
    /* Hors ligne : le jeton oublie ici expirera de lui-meme. */
  }
}
