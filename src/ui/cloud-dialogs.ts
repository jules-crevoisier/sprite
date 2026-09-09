/**
 * Interface de Google Drive : reglages, connexion, ouverture, enregistrement.
 *
 * Le fil conducteur : Drive est un supplement, jamais un passage oblige. Une
 * commande Drive sur une installation non configuree ouvre le mode d'emploi
 * plutot qu'un message d'erreur, et rien de tout cela n'empeche de dessiner
 * ni d'enregistrer sur le disque.
 */
import type { App } from './app'
import { el } from './dom'
import { openModal, showToast, type ModalHandle } from './overlay'
import { serializeSprite, deserializeSprite, PROJECT_EXT } from '../io/project'
import { safeName } from '../export/files'
import {
  MISSING_CLIENT_ID, authorizedOrigin, buildClientId, disconnect, isConfigured,
  session, setClientId, setupSteps, storedClientId, wasConnected,
} from '../cloud/google-auth'
import {
  DriveError, connectDrive, downloadProject, driveAccount, listProjects, saveProject,
  type DriveProject,
} from '../cloud/google-drive'

/* ------------------------------------------------------------------ */
/* Reglages                                                            */
/* ------------------------------------------------------------------ */

/**
 * Dialogue de l'identifiant client OAuth.
 *
 * C'est aussi la reponse aux commandes Drive quand rien n'est configure :
 * l'utilisateur voit ce qui manque, ou le creer et ou le coller, au lieu
 * d'une entree de menu grisee sans explication.
 */
export function driveSettingsDialog(onSaved?: () => void): void {
  const configured = isConfigured()
  const input = el('input', {
    type: 'text',
    value: storedClientId(),
    placeholder: '0000000000-xxxxxxxx.apps.googleusercontent.com',
    spellcheck: false,
    style: { width: '100%' },
  })

  const steps = el('ol', {
    style: { margin: '0', paddingLeft: '18px', color: 'var(--text-dim)', lineHeight: '1.8', fontSize: '12.5px' },
  })
  for (const step of setupSteps()) steps.appendChild(el('li', null, step))

  const body = el('div', null,
    el('p', {
      class: 'form-note',
      style: { margin: '0 0 4px', fontSize: '13px', lineHeight: '1.65' },
    }, configured
      ? 'Un identifiant client OAuth est en place. Vous pouvez le remplacer, ou le retirer pour revenir a celui du deploiement.'
      : MISSING_CLIENT_ID),
    el('div', { class: 'form-section' }, 'Marche a suivre, une seule fois'),
    steps,
    el('div', { class: 'form-section' }, 'Identifiant client'),
    input,
    el('p', { class: 'form-note', style: { marginTop: '8px' } },
      buildClientId()
        ? 'Un identifiant est deja fourni par la configuration du site (VITE_GOOGLE_CLIENT_ID) ; celui saisi ici le remplace sur ce navigateur.'
        : 'Il est conserve dans ce navigateur uniquement. Pour tout le monde d\'un coup, definissez plutot VITE_GOOGLE_CLIENT_ID au moment de la construction.'),
    el('p', { class: 'form-note' },
      `Un ID client de type « Application Web » n'est pas un secret : il est visible dans chaque requete. Ce qui protege le compte, c'est la liste des origines autorisees — ici ${authorizedOrigin()}.`),
    el('p', { class: 'form-note' },
      'Droit demande : drive.file. PixelForge ne voit que les fichiers qu\'il a crees ou que vous lui ouvrez, jamais le reste du Drive.'),
  )

  const actions = [
    { label: 'Annuler' },
    ...(storedClientId()
      ? [{
          label: 'Retirer',
          danger: true,
          onClick: () => {
            setClientId('')
            showToast('Identifiant client retire')
          },
        }]
      : []),
    {
      label: 'Enregistrer',
      primary: true,
      onClick: () => {
        const value = input.value.trim()
        // Un identifiant colle de travers echoue plus tard, dans une fenetre
        // Google incomprehensible : autant le dire tout de suite.
        if (value && !value.endsWith('.apps.googleusercontent.com')) {
          showToast('Un ID client Google finit par .apps.googleusercontent.com', 'error')
          return false
        }
        setClientId(value)
        showToast(value ? 'Identifiant client enregistre' : 'Identifiant client retire', 'success')
        onSaved?.()
      },
    },
  ]

  openModal({ title: 'Google Drive — identifiant client', icon: 'key', body, actions })
}

/** Verifie la configuration ; sinon ouvre le mode d'emploi et retourne false. */
function requireClientId(): boolean {
  if (isConfigured()) return true
  driveSettingsDialog()
  return false
}

/** Une phrase pour les menus, quand la commande ne peut encore rien faire. */
export function driveMenuHint(): string | undefined {
  if (!isConfigured()) return 'Identifiant client OAuth manquant — cliquez pour la marche a suivre'
  return undefined
}

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

function reportError(err: unknown): void {
  if (err instanceof DriveError && err.kind === 'config') {
    driveSettingsDialog()
    return
  }
  showToast(err instanceof Error ? err.message : 'Google Drive a echoue pour une raison inconnue.', 'error')
}

/* ------------------------------------------------------------------ */
/* Compte                                                              */
/* ------------------------------------------------------------------ */

/** Etat du compte, affiche dans la barre d'etat et dans le menu. */
export function accountLabel(): string {
  const { connected, account } = session()
  if (!connected) return wasConnected() ? 'Drive : session a rouvrir' : 'Drive : non connecte'
  return `Drive : ${account?.email || account?.name || 'connecte'}`
}

export function driveAccountDialog(): void {
  if (!requireClientId()) return
  const { connected, account } = session()

  const body = el('div', null,
    el('p', { class: 'form-note', style: { margin: '0', fontSize: '13px', lineHeight: '1.65' } },
      connected
        ? `Connecte en tant que ${account?.name ?? 'compte Google'}${account?.email ? ` (${account.email})` : ''}. Les projets sont ranges dans le dossier « PixelForge » de votre Drive.`
        : 'Aucun compte connecte. La connexion ouvre une fenetre Google et ne demande que le droit drive.file.'),
  )

  const actions = connected
    ? [
        { label: 'Fermer' },
        { label: 'Identifiant client…', onClick: () => { driveSettingsDialog() } },
        {
          label: 'Se deconnecter',
          danger: true,
          onClick: () => {
            void disconnect().then(() => showToast('Compte Google deconnecte', 'success'))
          },
        },
      ]
    : [
        { label: 'Fermer' },
        { label: 'Identifiant client…', onClick: () => { driveSettingsDialog() } },
        {
          label: 'Se connecter',
          primary: true,
          onClick: () => {
            void connectDrive()
              .then((compte) => showToast(`Connecte a Google Drive : ${compte.email || compte.name}`, 'success'))
              .catch(reportError)
          },
        },
      ]

  openModal({ title: 'Compte Google Drive', icon: 'account', body, actions })
}

/* ------------------------------------------------------------------ */
/* Enregistrer                                                         */
/* ------------------------------------------------------------------ */

/**
 * Envoie le projet courant. Sans `copy`, le fichier deja lie est ecrase :
 * enregistrer dix fois ne doit pas laisser dix projets dans le Drive.
 */
export async function saveToDrive(app: App, options: { copy?: boolean } = {}): Promise<void> {
  if (!requireClientId()) return
  const ed = app.ed
  const name = `${safeName(ed.sprite.name)}.${PROJECT_EXT}`
  const target = options.copy ? null : ed.sprite.driveFileId

  showToast(options.copy ? 'Copie vers Google Drive…' : 'Envoi vers Google Drive…')
  try {
    const content = serializeSprite(ed.sprite)
    const file = await saveProject(name, content, target)
    // Le lien vaut pour la suite de la session comme pour le fichier relu.
    ed.sprite.driveFileId = file.id
    app.status.markSaved()
    if (!session().account) await driveAccount().catch(() => null)
    showToast(
      target && file.id !== target
        ? `« ${file.name} » avait disparu du Drive : un nouveau fichier a ete cree`
        : `« ${file.name} » enregistre dans Google Drive`,
      'success',
    )
  } catch (err) {
    reportError(err)
  }
}

/* ------------------------------------------------------------------ */
/* Ouvrir                                                              */
/* ------------------------------------------------------------------ */

function formatDate(iso: string): string {
  if (!iso) return 'date inconnue'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'date inconnue'
  return date.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

/** Liste les projets du Drive et en ouvre un. */
export function openFromDriveDialog(app: App): void {
  if (!requireClientId()) return

  const body = el('div')
  let modal: ModalHandle | null = null

  const message = (text: string, action?: { label: string; run: () => void }) => {
    body.replaceChildren(el('p', { class: 'form-note', style: { fontSize: '12.5px', lineHeight: '1.65' } }, text))
    if (action) {
      body.appendChild(el('div', { class: 'form-row', style: { marginTop: '10px' } },
        el('button', { class: 'btn primary', onclick: action.run }, action.label)))
    }
  }

  const open = async (file: DriveProject) => {
    message(`Ouverture de « ${file.name} »…`)
    try {
      const content = await downloadProject(file.id)
      const sprite = await deserializeSprite(content)
      // Le fichier d'origine prime sur ce que portait le contenu : c'est
      // celui-la qu'un « Enregistrer » doit ecraser.
      sprite.driveFileId = file.id
      app.ed.loadSprite(sprite)
      modal?.close()
      showToast(`« ${sprite.name} » ouvert depuis Google Drive`, 'success')
    } catch (err) {
      if (err instanceof DriveError) {
        message(err.message, { label: 'Revenir a la liste', run: () => void load() })
        return
      }
      message(`Ce fichier n'est pas un projet PixelForge lisible : ${(err as Error).message}`,
        { label: 'Revenir a la liste', run: () => void load() })
    }
  }

  const showList = (files: DriveProject[]) => {
    body.replaceChildren()
    if (!files.length) {
      message('Aucun projet PixelForge dans ce Drive. Utilisez « Enregistrer dans Google Drive » pour y deposer le sprite en cours.')
      return
    }
    for (const file of files) {
      const label = file.name.replace(new RegExp(`\\.${PROJECT_EXT}$`), '')
      const size = formatSize(file.size)
      body.appendChild(el('div', { class: 'layer-row', style: { cursor: 'default' } },
        el('span', { class: 'lname', title: file.name },
          `${label} — ${formatDate(file.modifiedTime)}${size ? ` · ${size}` : ''}` +
          `${file.id === app.ed.sprite.driveFileId ? ' · projet en cours' : ''}`),
        el('button', { class: 'btn sm', onclick: () => void open(file) }, 'Ouvrir'),
      ))
    }
    body.appendChild(el('p', { class: 'form-note', style: { marginTop: '10px' } },
      'Seuls les projets crees par PixelForge apparaissent ici : le droit demande ne donne acces a rien d\'autre.'))
  }

  const load = async () => {
    message('Lecture de Google Drive…')
    try {
      showList(await listProjects())
    } catch (err) {
      if (err instanceof DriveError && err.kind === 'config') { modal?.close(); driveSettingsDialog(); return }
      // Une connexion demande un clic a elle : une fenetre Google ouverte
      // longtemps apres le geste de l'utilisateur se fait bloquer.
      message(err instanceof Error ? err.message : 'Google Drive est injoignable.',
        { label: 'Se connecter a Google', run: () => void connectAndLoad() })
    }
  }

  const connectAndLoad = async () => {
    message('Connexion a Google…')
    try {
      await connectDrive()
      await load()
    } catch (err) {
      message(err instanceof Error ? err.message : 'La connexion a echoue.',
        { label: 'Reessayer', run: () => void connectAndLoad() })
    }
  }

  modal = openModal({
    title: 'Ouvrir depuis Google Drive',
    icon: 'cloud-download',
    body,
    actions: [{ label: 'Fermer' }],
  })

  // Sans compte connu sur ce navigateur, on attend le clic plutot que
  // d'ouvrir une fenetre Google a l'improviste.
  if (session().connected || wasConnected()) void load()
  else message('Connectez un compte Google pour retrouver vos projets. PixelForge ne demande que le droit drive.file.',
    { label: 'Se connecter a Google', run: () => void connectAndLoad() })
}
