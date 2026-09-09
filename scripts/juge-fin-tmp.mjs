import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync, writeFileSync } from 'node:fs'
const OUT = '/tmp/claude-0/-home-user-sprite/4a039958-9770-571f-8065-ffed30477982/scratchpad/out'
const PORT = 5300 + Math.floor(Math.random() * 90)
const URL = `http://127.0.0.1:${PORT}/`
let nav = null
for (const d of readdirSync('/opt/pw-browsers')) if (/^chromium-\d+$/.test(d)) { nav = `/opt/pw-browsers/${d}/chrome-linux/chrome`; break }
const srv = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
process.on('exit', () => srv.kill())
for (let i = 0; i < 80; i++) { try { if ((await fetch(URL)).ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
const browser = await chromium.launch({ executablePath: nav })
const page = await browser.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })
const res = await page.evaluate(async () => {
  const d = await import('/src/smart/depth.ts')
  const s = await import('/src/smart/scene.ts')
  const { spritePixl } = await import('/src/ui/mascot-clips.ts')
  const T = 40, SC = 9, opts = { largeur: T, hauteur: T }
  const px = spritePixl().layers[0].cels[0].bitmap
  const b = px.trimBounds()
  const piece = { nom: 'p', sources: [{ azimut: 0, elevation: 0, bitmap: px, champ: d.champAuto(px, { hauteur: d.hauteurSuggeree(px), galbe: .5 }) }],
    pivot: { x: b.x + b.w / 2, y: b.y + b.h / 2, z: 0 }, position: { x: 0, y: 0, z: 0 }, rotation: { lacet: 0, tangage: 0, roulis: 0 } }
  const R = (g) => s.rendreScene([piece], { azimut: g * Math.PI / 180, elevation: 0, zoom: 1 }, opts).image
  const angles = [22, 26, 30, 34, 38, 42]
  const cv = document.createElement('canvas'); cv.width = angles.length * T * SC; cv.height = T * SC + 22
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#2b2b30'; ctx.fillRect(0, 0, cv.width, cv.height)
  angles.forEach((g, i) => {
    const img = R(g), c = document.createElement('canvas')
    c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img.toImageData(), 0, 0)
    const ox = i * T * SC
    ctx.fillStyle = '#3a3a42'; ctx.fillRect(ox, 0, T * SC, T * SC); ctx.imageSmoothingEnabled = false
    ctx.drawImage(c, 0, 0, img.width, img.height, ox, 0, img.width * SC, img.height * SC)
    ctx.strokeStyle = '#666'; ctx.strokeRect(ox + .5, .5, T * SC - 1, T * SC - 1)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.fillText(g + 'd', ox + 6, T * SC + 16)
  })
  return cv.toDataURL('png')
})
writeFileSync(`${OUT}/07-seuil-22-42.png`, Buffer.from(res.split(',')[1], 'base64'))
await browser.close(); srv.kill()
