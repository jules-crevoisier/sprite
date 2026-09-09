/**
 * Mesure du cout d'une image, sur un extrait court.
 *
 * Sert a repondre a une seule question : combien de temps coute une image, et
 * ou passe ce temps. Sans mesure, on optimise au hasard ce qu'on suppose lourd.
 *
 *   node mesure.mjs --depuis 2600 --combien 90
 */
import { composition, construire, trouverChromium, OPTIONS_CHROMIUM, MODE_CHROME, CONCURRENCE, DELAI_IMAGE, argOf } from './commun.mjs'

const args = process.argv.slice(2)
const DEPUIS = Number(argOf(args, '--depuis', '2600'))
const COMBIEN = Number(argOf(args, '--combien', '90'))
const PARALLELE = Number(argOf(args, '--parallele', String(CONCURRENCE)))

const serveUrl = await construire()
const comp = await composition(serveUrl)
const navigateur = trouverChromium()
const { renderFrames } = await import('@remotion/renderer')

const images = []
for (let i = 0; i < COMBIEN; i++) images.push(DEPUIS + i)

const debut = Date.now()
await renderFrames({
  serveUrl,
  composition: comp,
  inputProps: comp.props,
  outputDir: null,
  imageFormat: 'none',
  frames: images,
  chromiumOptions: OPTIONS_CHROMIUM,
  ...(navigateur ? { browserExecutable: navigateur, chromeMode: MODE_CHROME } : {}),
  concurrency: PARALLELE,
  timeoutInMilliseconds: DELAI_IMAGE,
  onStart: () => {},
  onFrameUpdate: () => {},
  logLevel: 'error',
})
const ecoule = (Date.now() - debut) / 1000
console.log(`${COMBIEN} images depuis ${DEPUIS}, ${PARALLELE} onglets : `
  + `${ecoule.toFixed(1)} s soit ${(COMBIEN / ecoule).toFixed(2)} i/s`)
