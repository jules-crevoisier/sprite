import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync, writeFileSync } from 'node:fs'
const OUT = '/tmp/claude-0/-home-user-sprite/4a039958-9770-571f-8065-ffed30477982/scratchpad/out'
const PORT = 5100 + Math.floor(Math.random() * 90)
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
  const T = 48, SC = 6, opts = { largeur: T, hauteur: T }
  const sp = spritePixl()
  const cels = sp.layers[0].cels
  const face = cels[0].bitmap
  // Un "vrai" second dessin : une autre image du sprite, differente de la premiere.
  let autre = null, k = 0
  for (let i = 1; i < cels.length; i++) {
    let diff = 0
    for (let j = 0; j < face.u32.length; j++) if (face.u32[j] !== cels[i].bitmap.u32[j]) diff++
    if (diff > 40) { autre = cels[i].bitmap; k = i; break }
  }
  const champDe = (b) => d.champAuto(b, { hauteur: d.hauteurSuggeree(b), galbe: 0.5 })
  const b = face.trimBounds()
  const piece = {
    nom: 'p',
    sources: [
      { azimut: 0, elevation: 0, bitmap: face, champ: champDe(face) },
      { azimut: Math.PI / 2, elevation: 0, bitmap: autre, champ: champDe(autre) },
    ],
    pivot: { x: b.x + b.w / 2, y: b.y + b.h / 2, z: 0 },
    position: { x: 0, y: 0, z: 0 },
    rotation: { lacet: 0, tangage: 0, roulis: 0 },
  }
  const R = (az) => s.rendreScene([piece], { azimut: az, elevation: 0, zoom: 1 }, opts).image
  const D = Math.PI / 180
  const diff = (a, c) => { let n = 0; for (let i = 0; i < a.u32.length; i++) if (a.u32[i] !== c.u32[i]) n++; return n }
  const av = R(44.9 * D), ap = R(45.1 * D)
  // comparaison : deux angles voisins loin de la couture
  const c1 = R(20 * D), c2 = R(20.2 * D)
  const items = [30, 40, 44.9, 45.1, 50, 60].map(g => ({ nom: `${g}d`, img: R(g * D) }))
  const cv = document.createElement('canvas')
  cv.width = 6 * T * SC; cv.height = T * SC + 22
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#2b2b30'; ctx.fillRect(0, 0, cv.width, cv.height)
  items.forEach((it, i) => {
    const c = document.createElement('canvas'); c.width = it.img.width; c.height = it.img.height
    c.getContext('2d').putImageData(it.img.toImageData(), 0, 0)
    const ox = i * T * SC
    ctx.fillStyle = '#3a3a42'; ctx.fillRect(ox, 0, T * SC, T * SC)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(c, 0, 0, it.img.width, it.img.height, ox, 0, it.img.width * SC, it.img.height * SC)
    ctx.strokeStyle = '#666'; ctx.strokeRect(ox + .5, .5, T * SC - 1, T * SC - 1)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.fillText(it.nom, ox + 6, T * SC + 16)
  })
  return {
    celUtilisee: k, diffSources: (() => { let n = 0; for (let i = 0; i < face.u32.length; i++) if (face.u32[i] !== autre.u32[i]) n++; return n })(),
    sautCouture: diff(av, ap), masseAv: s.masse(av), masseAp: s.masse(ap),
    sautNormal: diff(c1, c2),
    png: cv.toDataURL('png'),
  }
})
writeFileSync(`${OUT}/06-couture-vraie.png`, Buffer.from(res.png.split(',')[1], 'base64'))
delete res.png
console.log(JSON.stringify(res, null, 1))
await browser.close(); srv.kill()
