/**
 * Reglages partages par la verification et le rendu.
 *
 * Le navigateur et ffmpeg sont ceux de la machine : Remotion sait telecharger
 * les siens, mais un rendu qui va chercher un binaire sur le reseau ne se
 * rejoue pas a l'identique, et echoue la ou il n'y a pas d'acces.
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ICI = dirname(fileURLToPath(import.meta.url))
export const RACINE = join(ICI, '..')

/**
 * Playwright cherche par defaut un « headless shell » qui n'est pas installe
 * partout a cote du navigateur complet ; on prend donc le chromium present.
 */
export function trouverChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!racine || !existsSync(racine)) return null
  for (const dossier of readdirSync(racine)) {
    if (!/^chromium-\d+$/.test(dossier)) continue
    const chemin = join(racine, dossier, 'chrome-linux', 'chrome')
    if (existsSync(chemin)) return chemin
  }
  return null
}

/**
 * Options de Chromium communes : sans elles le rendu varie d'un poste a l'autre.
 *
 * Pas de backend graphique impose. Avec « swangle », le processus GPU de
 * Chromium s'est mis a tourner a trois cents pour cent sans jamais rendre la
 * main : le rendu s'est fige a la quatre mille neuf cent vingtieme image
 * pendant une demi-heure, alors que les memes images se calculent a cinq par
 * seconde quand on les demande seules. La page ne dessine rien en WebGL — il
 * n'y a donc rien a accelerer, et rien a bloquer.
 */
export const OPTIONS_CHROMIUM = {
  disableWebSecurity: false,
  headless: true,
}

/*
 * Remotion lance par defaut un « headless shell ». Le binaire installe ici est
 * un Chrome complet, qui a perdu l'ancien mode sans fenetre et refuse de
 * demarrer ainsi ; il faut donc lui annoncer que c'en est un pour qu'il soit
 * lance en headless nouvelle maniere.
 */
export const MODE_CHROME = 'chrome-for-testing'

/*
 * Reglages d'execution du rendu.
 *
 * Remotion ouvre par defaut autant d'onglets que la machine a de coeurs. Sur
 * une machine a quatre coeurs, quatre onglets qui posent chacun deux mille
 * divs pour l'ouverture se genent au point qu'une image depasse les trente
 * secondes accordees et fait echouer le rendu entier. Deux onglets et une
 * limite large : le rendu est a peine plus lent et il aboutit.
 */
export const CONCURRENCE = 2
export const DELAI_IMAGE = 180000

export const argOf = (args, nom, defaut) => {
  const i = args.indexOf(nom)
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut
}

/** Le bundle du film, construit une fois par execution. */
export async function construire() {
  const { bundle } = await import('@remotion/bundler')
  return bundle({
    entryPoint: join(ICI, 'src', 'index.ts'),
    publicDir: join(ICI, 'public'),
    onProgress: () => {},
  })
}

/** La composition du film, avec le montage passe en propriete. */
export async function composition(serveUrl) {
  const { selectComposition } = await import('@remotion/renderer')
  const navigateur = trouverChromium()
  return selectComposition({
    serveUrl,
    id: 'Film',
    chromiumOptions: OPTIONS_CHROMIUM,
    ...(navigateur ? { browserExecutable: navigateur, chromeMode: MODE_CHROME } : {}),
  })
}
