/**
 * Verification du film, sans encodage.
 *
 * Le montage est parcouru image par image dans le navigateur, mais rien n'est
 * ecrit : ce qui est controle, c'est que chaque image se calcule sans erreur.
 * S'y ajoutent trois lectures du montage lui-meme — duree, trous, sequences
 * mortes — et un echantillon d'images reellement produites, parce qu'une
 * sequence peut tres bien se rendre sans erreur et ne montrer qu'un cadre
 * vide ou une image figee : c'est le defaut qu'aucune verification de code ne
 * voit et que seule une image regardee attrape.
 *
 *   node verifier.mjs [--rapide]
 */
import { composition, construire, trouverChromium, OPTIONS_CHROMIUM, MODE_CHROME, CONCURRENCE, DELAI_IMAGE, argOf } from './commun.mjs'

const args = process.argv.slice(2)
const RAPIDE = args.includes('--rapide')
const PAS = Number(argOf(args, '--pas', RAPIDE ? '10' : '1'))

const bilan = []
const noter = (nom, ok, detail = '') => {
  bilan.push({ nom, ok, detail })
  console.log(`${ok ? 'ok   ' : 'ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`)
}

console.log('construction du bundle...')
const serveUrl = await construire()
const comp = await composition(serveUrl)
const plan = comp.props.plan
const navigateur = trouverChromium()
console.log(`navigateur : ${navigateur ?? '(defaut remotion)'}`)
console.log(`film : ${comp.durationInFrames} images · ${comp.fps} i/s · ${comp.width}x${comp.height}`)

/* ------------------------------------------------------------------ */
/* 1. Lecture du montage                                               */
/* ------------------------------------------------------------------ */
const dureeSecondes = comp.durationInFrames / comp.fps
noter('duree superieure a 60 s', dureeSecondes > 60, `${dureeSecondes.toFixed(1)} s`)
noter('format 1920x1080 a 60 i/s',
  comp.width === 1920 && comp.height === 1080 && comp.fps === 60)

// Trous : chaque image du film doit tomber dans la fenetre utile d'une station.
const trous = []
for (let f = 0; f < comp.durationInFrames; f++) {
  if (!plan.stations.some((st) => f >= st.debut && f < st.fin)) trous.push(f)
}
noter('aucun trou dans le montage', trous.length === 0,
  trous.length ? `${trous.length} images sans station (${trous.slice(0, 4).join(', ')}…)` : '')

// Sequences mortes : une station montee hors du film, ou de duree nulle.
const mortes = plan.stations.filter((st) =>
  st.duree <= 0 || st.fin <= st.debut || st.from >= comp.durationInFrames)
noter('aucune sequence morte dans le plan', mortes.length === 0,
  mortes.map((m) => m.id).join(', '))

/* ------------------------------------------------------------------ */
/* 2. Parcours integral, sans encodage                                 */
/* ------------------------------------------------------------------ */
const { renderFrames } = await import('@remotion/renderer')
const erreurs = []
const commun = {
  serveUrl,
  composition: comp,
  inputProps: comp.props,
  chromiumOptions: OPTIONS_CHROMIUM,
  ...(navigateur ? { browserExecutable: navigateur, chromeMode: MODE_CHROME } : {}),
  onBrowserLog: (log) => {
    if (log.type === 'error') erreurs.push(log.text)
  },
  onStart: () => {},
  concurrency: CONCURRENCE,
  timeoutInMilliseconds: DELAI_IMAGE,
  logLevel: 'error',
}

const images = []
for (let f = 0; f < comp.durationInFrames; f += PAS) images.push(f)
console.log(`parcours de ${images.length} images (pas de ${PAS})...`)
const debut = Date.now()
let fait = 0
try {
  await renderFrames({
    ...commun,
    outputDir: null,
    imageFormat: 'none',
    frames: images,
    onFrameUpdate: () => {
      fait++
      if (fait % 300 === 0) {
        const ecoule = (Date.now() - debut) / 1000
        process.stdout.write(`\r  ${fait}/${images.length}  ${(fait / ecoule).toFixed(1)} i/s   `)
      }
    },
  })
  process.stdout.write('\n')
  noter('aucune erreur de page sur tout le parcours', erreurs.length === 0,
    [...new Set(erreurs)].slice(0, 3).join(' | '))
} catch (e) {
  process.stdout.write('\n')
  noter('aucune erreur de page sur tout le parcours', false, String(e).slice(0, 400))
}

/* ------------------------------------------------------------------ */
/* 3. Trois images reelles par station                                 */
/* ------------------------------------------------------------------ */
/*
 * Une station peut se rendre sans erreur et ne rien montrer. On produit donc
 * trois images par station : un cadre pratiquement vide se comprime en une
 * poignee d'octets, et trois images strictement identiques signalent une
 * station figee.
 */
const echantillons = new Map()
const aRendre = []
for (const st of plan.stations) {
  const l = st.fin - st.debut
  const trio = [0.22, 0.55, 0.86].map((p) => Math.min(comp.durationInFrames - 1, Math.round(st.debut + l * p)))
  echantillons.set(st.id, trio)
  aRendre.push(...trio)
}
const buffers = new Map()
console.log(`rendu de ${aRendre.length} images temoins...`)
await renderFrames({
  ...commun,
  outputDir: null,
  imageFormat: 'jpeg',
  jpegQuality: 90,
  frames: [...new Set(aRendre)].sort((a, b) => a - b),
  onFrameUpdate: () => {},
  onFrameBuffer: (buffer, frame) => { buffers.set(frame, buffer) },
})

const SEUIL_VIDE = 14000
const vides = []
const figees = []
for (const [id, trio] of echantillons) {
  const bufs = trio.map((f) => buffers.get(f)).filter(Boolean)
  if (bufs.length < 2) { vides.push(`${id} (images manquantes)`); continue }
  const petites = bufs.filter((b) => b.length < SEUIL_VIDE)
  if (petites.length === bufs.length) vides.push(`${id} (${Math.round(bufs[0].length / 1024)} ko)`)
  const distinctes = new Set(bufs.map((b) => b.length))
  if (distinctes.size === 1 && bufs.every((b) => b.equals(bufs[0]))) figees.push(id)
}
noter('aucune station vide', vides.length === 0, vides.join(', '))
noter('aucune station figee', figees.length === 0, figees.join(', '))

const echec = bilan.some((b) => !b.ok)
console.log(echec ? '\nverification en echec' : '\nverification complete')
process.exit(echec ? 1 : 0)
