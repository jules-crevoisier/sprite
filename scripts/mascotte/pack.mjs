/**
 * Pack d'images de la mascotte, pret a ouvrir ou a poser dans un moteur.
 *
 * Les GIF servent a regarder ; ils ont un fond opaque, parce qu'un GIF a
 * transparence binaire salit les bords du pixel art. Les PNG servent a
 * jouer : une image par pose, plus une planche par cycle, en transparence
 * vraie. Les deux sortent des memes poses, il n'y a rien a resynchroniser.
 *
 *   node scripts/mascotte/pack.mjs --out <dossier> [--port 5217]
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Vite lance directement, sans passer par npx : le wrapper npx encaisse
// le kill et laisse le serveur derriere lui, un par execution.
const VITE = 'node_modules/.bin/vite'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = argOf('--out', 'video/pack')
const PORT = Number(argOf('--port', '5217'))

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

mkdirSync(OUT, { recursive: true })
const server = spawn(VITE, ['--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => server.kill())
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break } catch { /* pas pret */ }
  await sleep(250)
}

const executablePath = trouverChromium()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await sleep(600)

const pack = await page.evaluate(async () => {
  const { CLIPS_PIXL } = await import('/src/ui/mascot-clips.ts')
  const { imageDePose, TAILLE } = await import('/src/ui/mascot-anim.ts')
  const { ARMES, clipsArmes, imageDePoseArmee } = await import('/src/ui/mascot-armes.ts')

  const png = (bm) => {
    const cv = document.createElement('canvas')
    cv.width = TAILLE; cv.height = TAILLE
    cv.getContext('2d').putImageData(
      new ImageData(new Uint8ClampedArray(bm.data), TAILLE, TAILLE), 0, 0)
    return cv.toDataURL()
  }

  // La planche met les images cote a cote, dans l'ordre, sans marge : c'est
  // le format que tous les moteurs decoupent avec une seule largeur.
  const planche = (bms) => {
    const cv = document.createElement('canvas')
    cv.width = TAILLE * bms.length; cv.height = TAILLE
    const ctx = cv.getContext('2d')
    bms.forEach((bm, i) => {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(bm.data), TAILLE, TAILLE), i * TAILLE, 0)
    })
    return cv.toDataURL()
  }

  const sortie = []
  for (const clip of CLIPS_PIXL) {
    const bms = clip.poses.map(imageDePose)
    sortie.push({
      id: clip.id, nom: clip.nom, ms: clip.ms, loop: clip.loop,
      images: bms.map(png), planche: planche(bms),
    })
  }
  for (const arme of ARMES) {
    for (const clip of clipsArmes(arme, CLIPS_PIXL)) {
      const bms = clip.images.map((img) => imageDePoseArmee(img.pose, arme, img.position))
      sortie.push({
        id: clip.id, nom: clip.nom, ms: clip.ms, loop: clip.loop,
        images: bms.map(png), planche: planche(bms),
      })
    }
  }
  return { taille: TAILLE, clips: sortie }
}, {})

const octets = (url) => Buffer.from(url.split(',')[1], 'base64')
const lignes = ['cycle,images,ms,boucle,planche']
for (const clip of pack.clips) {
  const dossier = join(OUT, 'images', clip.id)
  mkdirSync(dossier, { recursive: true })
  clip.images.forEach((url, i) => {
    writeFileSync(join(dossier, `${clip.id}-${String(i).padStart(2, '0')}.png`), octets(url))
  })
  mkdirSync(join(OUT, 'planches'), { recursive: true })
  writeFileSync(join(OUT, 'planches', `${clip.id}.png`), octets(clip.planche))
  lignes.push(`${clip.id},${clip.images.length},${clip.ms},${clip.loop ? 'oui' : 'non'},${clip.images.length}x1`)
  console.log(`${clip.id.padEnd(14)} ${String(clip.images.length).padStart(2)} images · ${clip.ms} ms`)
}
writeFileSync(join(OUT, 'cycles.csv'), lignes.join('\n') + '\n')
console.log('erreurs page :', erreurs.length ? erreurs : 'aucune')

await browser.close()
server.kill()
