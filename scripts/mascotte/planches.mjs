/**
 * Planches de controle des cycles de la mascotte.
 *
 * Une par cycle, images dans l'ordre et numerotees, plus une planche de
 * couture qui met la derniere image a cote de la premiere. C'est ce qu'on
 * donne a relire : juger une animation sur un sprite anime empeche de
 * revenir en arriere sur l'image qui cloche.
 *
 *   node scripts/mascotte/planches.mjs --out <dossier> [--port 5211]
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = argOf('--out', 'video/mascotte')
const PORT = Number(argOf('--port', '5211'))

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
  const { CLIPS_PIXL } = await import('/src/ui/mascot-clips.ts')
  const { imageDePose, TAILLE } = await import('/src/ui/mascot-anim.ts')

  const Z = 7, W = TAILLE * Z, MARGE = 8, BAS = 26
  const vers = (bm) => {
    const c = document.createElement('canvas')
    c.width = bm.width; c.height = bm.height
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bm.data), bm.width, bm.height), 0, 0)
    return c
  }
  const grille = (images, titres, titre) => {
    const cv = document.createElement('canvas')
    cv.width = images.length * (W + MARGE) + MARGE
    cv.height = W + BAS + 34
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#232630'
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = '#cfd4e2'
    ctx.font = 'bold 15px monospace'
    ctx.fillText(titre, MARGE, 22)
    images.forEach((bm, i) => {
      const x = MARGE + i * (W + MARGE), y = 30
      ctx.fillStyle = '#1a1c24'
      ctx.fillRect(x, y, W, W)
      // Ligne de sol : sans repere fixe, on ne voit pas si le personnage
      // glisse d'une image a l'autre.
      ctx.strokeStyle = '#4a5068'
      ctx.beginPath(); ctx.moveTo(x, y + 30 * Z + 0.5); ctx.lineTo(x + W, y + 30 * Z + 0.5); ctx.stroke()
      ctx.drawImage(vers(bm), x, y, W, W)
      ctx.fillStyle = '#8b90a8'
      ctx.font = '13px monospace'
      ctx.fillText(titres[i], x + 4, y + W + 18)
    })
    return cv.toDataURL()
  }

  const sortie = []
  for (const clip of CLIPS_PIXL) {
    const images = clip.poses.map(imageDePose)
    sortie.push({
      nom: `cycle-${clip.id}`,
      url: grille(images, images.map((_, i) => `${i + 1}`),
        `${clip.nom} — ${images.length} images · ${clip.ms} ms · ${clip.loop ? 'boucle' : 'coup unique'}`),
    })
    if (clip.loop && images.length > 1) {
      const derniere = images[images.length - 1]
      sortie.push({
        nom: `couture-${clip.id}`,
        url: grille([derniere, images[0], images[1]],
          [`derniere (${images.length})`, 'premiere (1)', 'deuxieme (2)'],
          `${clip.nom} — couture de la boucle : la derniere doit enchainer sur la premiere`),
      })
    }
  }
  return sortie
})

for (const p of planches) {
  writeFileSync(join(OUT, `${p.nom}.png`), Buffer.from(p.url.split(',')[1], 'base64'))
  console.log(`ecrit ${p.nom}.png`)
}
await browser.close()
server.kill()
console.log('erreurs page :', erreurs.length ? erreurs : 'aucune')
