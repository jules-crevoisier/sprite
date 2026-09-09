/**
 * Images fixes du film, a des instants choisis.
 *
 * Un montage peut se rendre sans une erreur et cadrer de travers : texte
 * coupe, panneau qui recouvre le personnage, cadre vide. Ces defauts-la ne se
 * voient qu'en regardant l'image, et il est beaucoup moins couteux d'en
 * regarder dix que de rendre le film pour s'en apercevoir.
 *
 *   node apercu.mjs --secondes 2,9,19 --dans /tmp/apercus
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { composition, construire, trouverChromium, OPTIONS_CHROMIUM, MODE_CHROME, DELAI_IMAGE, argOf } from './commun.mjs'

const args = process.argv.slice(2)
const DANS = argOf(args, '--dans', 'apercus')
const SECONDES = argOf(args, '--secondes', '')

console.log('construction du bundle...')
const serveUrl = await construire()
const comp = await composition(serveUrl)
const navigateur = trouverChromium()

const secondes = SECONDES
  ? SECONDES.split(',').map(Number)
  // Sans liste, on prend le milieu de chaque station : le tour du film en dix images.
  : comp.props.plan.stations.map((st) => (st.debut + (st.fin - st.debut) * 0.55) / comp.fps)

mkdirSync(DANS, { recursive: true })
const { renderStill } = await import('@remotion/renderer')
for (const sec of secondes) {
  const frame = Math.min(comp.durationInFrames - 1, Math.round(sec * comp.fps))
  const sortie = join(DANS, `t${String(sec).replace('.', '_')}s.png`)
  await renderStill({
    serveUrl,
    composition: comp,
    inputProps: comp.props,
    frame,
    output: sortie,
    imageFormat: 'png',
    chromiumOptions: OPTIONS_CHROMIUM,
    ...(navigateur ? { browserExecutable: navigateur, chromeMode: MODE_CHROME } : {}),
    timeoutInMilliseconds: DELAI_IMAGE,
    logLevel: 'error',
    overwrite: true,
  })
  console.log(`${sortie}  (image ${frame})`)
}
