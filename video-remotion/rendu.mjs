/**
 * Rendu du film en MP4 h264.
 *
 *   node rendu.mjs [--out ../media/pixelforge-presentation.mp4] [--extrait 12,18]
 *
 * L'extrait sert au reglage : rendre huit minutes d'images pour verifier une
 * position de texte fait perdre un quart d'heure a chaque essai.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { composition, construire, trouverChromium, OPTIONS_CHROMIUM, MODE_CHROME, CONCURRENCE, DELAI_IMAGE, argOf, RACINE } from './commun.mjs'

const args = process.argv.slice(2)
const SORTIE = argOf(args, '--out', join(RACINE, 'media', 'pixelforge-presentation.mp4'))
const EXTRAIT = argOf(args, '--extrait', '')

console.log('construction du bundle...')
const serveUrl = await construire()
const comp = await composition(serveUrl)
const navigateur = trouverChromium()

let frameRange = null
if (EXTRAIT) {
  const [a, b] = EXTRAIT.split(',').map(Number)
  frameRange = [Math.round(a * comp.fps), Math.min(comp.durationInFrames - 1, Math.round(b * comp.fps))]
  console.log(`extrait ${a}s → ${b}s (images ${frameRange[0]} a ${frameRange[1]})`)
}

const total = frameRange ? frameRange[1] - frameRange[0] + 1 : comp.durationInFrames
console.log(`rendu de ${total} images vers ${SORTIE}`)
mkdirSync(dirname(SORTIE), { recursive: true })

const { renderMedia } = await import('@remotion/renderer')
const debut = Date.now()
await renderMedia({
  serveUrl,
  composition: comp,
  inputProps: comp.props,
  codec: 'h264',
  // CRF 17 : au-dessus, les aplats sombres du fond se mettent a baver et les
  // bords nets du pixel art prennent un halo que le film entier cherche a eviter.
  crf: 17,
  x264Preset: 'slow',
  pixelFormat: 'yuv420p',
  imageFormat: 'jpeg',
  jpegQuality: 100,
  outputLocation: SORTIE,
  chromiumOptions: OPTIONS_CHROMIUM,
  ...(navigateur ? { browserExecutable: navigateur, chromeMode: MODE_CHROME } : {}),
  ...(frameRange ? { frameRange } : {}),
  concurrency: CONCURRENCE,
  timeoutInMilliseconds: DELAI_IMAGE,
  logLevel: 'error',
  onProgress: ({ renderedFrames, encodedFrames }) => {
    const ecoule = (Date.now() - debut) / 1000
    if (renderedFrames % 120 !== 0) return
    const reste = renderedFrames ? (ecoule / renderedFrames) * (total - renderedFrames) : 0
    process.stdout.write(
      `\r  rendu ${renderedFrames}/${total} · encode ${encodedFrames}`
      + `  ${(renderedFrames / Math.max(ecoule, 0.001)).toFixed(1)} i/s  reste ${Math.round(reste)}s   `,
    )
  },
})
process.stdout.write('\n')
console.log(`ecrit ${SORTIE} en ${Math.round((Date.now() - debut) / 1000)}s`)
