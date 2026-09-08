/**
 * Planches des cycles armes.
 *
 * Une planche par arme : le coup porte, image par image, sur une ligne de
 * sol fixe. Sans repere, on ne voit ni si le personnage glisse ni si
 * l'arme se decroche du flanc — et c'est justement ce que l'arme risque
 * de faire a chaque changement de pose.
 *
 *   node scripts/mascotte/armes.mjs --out <dossier> [--port 5215]
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = argOf('--out', 'video/mascotte')
const PORT = Number(argOf('--port', '5215'))

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
const server = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => server.kill())
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break } catch { /* pas pret */ }
  await sleep(250)
}

const executablePath = trouverChromium()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: 1400, height: 700 } })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await sleep(600)
await page.keyboard.press('Escape')
await sleep(300)

const planches = await page.evaluate(async () => {
  const { ARMES, clipsArmes, imageDePoseArmee } = await import('/src/ui/mascot-armes.ts')
  const { CLIPS_PIXL } = await import('/src/ui/mascot-clips.ts')
  const { TAILLE } = await import('/src/ui/mascot-anim.ts')

  const Z = 7, W = TAILLE * Z, MARGE = 8, HAUT = 30, BAS = 30
  const sortie = []
  for (const arme of ARMES) {
    const clips = clipsArmes(arme, CLIPS_PIXL)
    const coup = clips.find((c) => c.id.startsWith('coup-'))
    if (!coup) continue
    const cv = document.createElement('canvas')
    cv.width = coup.images.length * (W + MARGE) + MARGE
    cv.height = HAUT + W + BAS
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#232630'
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = '#cfd4e2'
    ctx.font = 'bold 15px monospace'
    ctx.fillText(`${coup.nom.toUpperCase()} — ${coup.images.length} images a ${coup.ms} ms`, MARGE, 21)

    coup.images.forEach((img, i) => {
      const x = MARGE + i * (W + MARGE)
      ctx.fillStyle = '#1a1c24'
      ctx.fillRect(x, HAUT, W, W)
      // La ligne de sol est la meme partout : c'est le seul repere qui
      // dit si le personnage flotte d'une image a l'autre.
      ctx.strokeStyle = '#4a5068'
      ctx.beginPath()
      ctx.moveTo(x, HAUT + W - 0.5)
      ctx.lineTo(x + W, HAUT + W - 0.5)
      ctx.stroke()

      const bm = imageDePoseArmee(img.pose, arme, img.position)
      const tampon = document.createElement('canvas')
      tampon.width = TAILLE; tampon.height = TAILLE
      tampon.getContext('2d').putImageData(
        new ImageData(new Uint8ClampedArray(bm.data), TAILLE, TAILLE), 0, 0)
      ctx.drawImage(tampon, x, HAUT, W, W)

      ctx.fillStyle = '#7f869c'
      ctx.font = '12px monospace'
      ctx.fillText(`${i + 1} ${img.position}`, x + 2, HAUT + W + 18)
    })
    sortie.push({ id: arme.id, url: cv.toDataURL() })
  }
  return sortie
}, {})

const png = (url) => Buffer.from(url.split(',')[1], 'base64')
for (const p of planches) {
  writeFileSync(join(OUT, `arme-${p.id}.png`), png(p.url))
  console.log(`ecrit arme-${p.id}.png`)
}
console.log('erreurs page :', erreurs.length ? erreurs : 'aucune')

await browser.close()
server.kill()
