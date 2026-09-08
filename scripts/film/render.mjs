/**
 * Deuxieme passe du film : rendu image par image, puis encodage.
 *
 * La page n'anime rien toute seule ; on lui demande une position dans le
 * temps, on photographie, on recommence. Le rendu peut donc etre bien plus
 * lent que le temps reel sans qu'une seule image soit sautee, ce qu'un
 * enregistrement d'ecran ne garantit jamais.
 *
 *   node scripts/film/render.mjs --assets <dossier> --out film.mp4 [--fps 60] [--jusqua 6]
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = fileURLToPath(new URL('.', import.meta.url))
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const ASSETS = argOf('--assets', 'video/assets')
const SORTIE = argOf('--out', 'pixelforge.mp4')
const FPS = Number(argOf('--fps', '60'))
const JUSQUA = Number(argOf('--jusqua', '0'))     // secondes, 0 = tout
const VERIFIER = args.includes('--verifier')
const DEPUIS = Number(argOf('--depuis', '0'))
const PORT = Number(argOf('--port', '5399'))

function trouverChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!racine || !existsSync(racine)) return null
  for (const d of readdirSync(racine)) {
    if (!/^chromium-\d+$/.test(d)) continue
    const c = join(racine, d, 'chrome-linux', 'chrome')
    if (existsSync(c)) return c
  }
  return null
}

function trouverFfmpeg() {
  for (const c of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux']) {
    if (existsSync(c)) return c
  }
  return 'ffmpeg'
}

/* Serveur minimal : la scene a la racine, les images produites sous /assets. */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css',
}
const serveur = createServer((req, res) => {
  const chemin = decodeURIComponent(req.url.split('?')[0])
  const cible = chemin.startsWith('/assets/')
    ? join(ASSETS, normalize(chemin.slice('/assets'.length)))
    : join(ICI, normalize(chemin === '/' ? '/film.html' : chemin))
  if (chemin === '/favicon.ico') { res.writeHead(204); res.end(); return }
  if (!existsSync(cible) || statSync(cible).isDirectory()) { res.writeHead(404); res.end('non'); return }
  res.writeHead(200, { 'content-type': TYPES[extname(cible)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  createReadStream(cible).pipe(res)
})
await new Promise((ok) => serveur.listen(PORT, '127.0.0.1', ok))

const executablePath = trouverChromium()
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text',
    '--hide-scrollbars', '--disable-gpu-vsync'],
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.stack ?? e.message))
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.body.dataset.pret === '1', null, { timeout: 30000 })
  .catch(() => { throw new Error(`la scene ne s'est pas initialisee : ${erreurs.join(' | ')}`) })
await page.evaluate(() => document.fonts.ready)

if (VERIFIER) {
  // Verification sans encodage : on parcourt tout le montage et on exige
  // qu'aucune image ne leve d'erreur, qu'aucune scene ne soit morte et
  // qu'aucun instant ne tombe dans un trou.
  const film = await page.evaluate(() => ({ duree: window.FILM.duree, scenes: window.FILM.scenes }))
  const PAS = 0.25
  const trous = []
  const vues = new Set()
  for (let t = 0; t < film.duree; t += PAS) {
    await page.evaluate((s) => window.FILM.seek(s), t)
    const actives = film.scenes.filter((s) => t >= s.debut && t < s.fin)
    if (!actives.length) trous.push(Number(t.toFixed(2)))
    for (const a of actives) vues.add(a.debut)
  }
  const mortes = film.scenes.filter((s) => !vues.has(s.debut))
  const bilan = [
    ['duree superieure a une minute', film.duree > 60],
    ['aucune erreur de page', erreurs.length === 0],
    ['aucune scene morte', mortes.length === 0],
    ['aucun trou dans le montage', trous.length === 0],
  ]
  for (const [nom, ok] of bilan) console.log(`${ok ? 'ok  ' : 'ECHEC'} ${nom}`)
  if (trous.length) console.log('  trous :', trous.slice(0, 8))
  if (mortes.length) console.log('  scenes mortes :', mortes)
  if (erreurs.length) console.log('  erreurs :', [...new Set(erreurs)].slice(0, 6))
  await browser.close()
  serveur.close()
  process.exit(bilan.every(([, ok]) => ok) ? 0 : 1)
}

const duree = JUSQUA > 0 ? JUSQUA : await page.evaluate(() => window.FILM.duree)
const total = Math.round((duree - DEPUIS) * FPS)
console.log(`duree ${duree.toFixed(2)}s · ${total} images · ${FPS} i/s`)

const ffmpeg = spawn(trouverFfmpeg(), [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
  '-movflags', '+faststart', SORTIE,
], { stdio: ['pipe', 'inherit', 'inherit'] })

// Une seule ecoute d'erreur pour tout le flux : en poser une par image
// sature le nombre d'ecouteurs autorises sur la socket.
let panne = null
ffmpeg.stdin.on('error', (e) => { panne = e })
const ecrire = (buf) => new Promise((ok, ko) => {
  if (panne) { ko(panne); return }
  if (ffmpeg.stdin.write(buf)) ok()
  else ffmpeg.stdin.once('drain', ok)
})

const debut = Date.now()
for (let i = 0; i < total; i++) {
  const t = DEPUIS + i / FPS
  await page.evaluate((s) => window.FILM.seek(s), t)
  // JPEG sans perte visible plutot que PNG : trois fois plus rapide a
  // encoder dans le navigateur, pour une difference invisible apres h264.
  const buf = await page.screenshot({ type: 'jpeg', quality: 100, animations: 'disabled', caret: 'hide' })
  await ecrire(buf)
  if (i % 120 === 0 || i === total - 1) {
    const ecoule = (Date.now() - debut) / 1000
    const reste = i ? (ecoule / i) * (total - i) : 0
    process.stdout.write(`\r  ${String(i + 1).padStart(5)}/${total}  ${(100 * (i + 1) / total).toFixed(1)}%  `
      + `${(i / Math.max(ecoule, 0.001)).toFixed(1)} i/s  reste ${Math.round(reste)}s   `)
  }
}
process.stdout.write('\n')

ffmpeg.stdin.end()
await new Promise((ok, ko) => ffmpeg.on('close', (c) => (c === 0 ? ok() : ko(new Error(`ffmpeg code ${c}`)))))
await browser.close()
serveur.close()
if (erreurs.length) console.log('erreurs page :', [...new Set(erreurs)].slice(0, 6))
console.log(`ecrit ${SORTIE}`)
