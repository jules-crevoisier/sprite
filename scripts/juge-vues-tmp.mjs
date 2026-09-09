/** Script jetable : rend Pixl sous toutes les directions/cameras et exporte des PNG. */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync, writeFileSync } from 'node:fs'

const OUT = '/tmp/claude-0/-home-user-sprite/4a039958-9770-571f-8065-ffed30477982/scratchpad/out'
const PORT = 4900 + Math.floor(Math.random() * 90)
const URL = `http://127.0.0.1:${PORT}/`
let navigateur = null
for (const d of readdirSync('/opt/pw-browsers')) {
  if (/^chromium-\d+$/.test(d)) { navigateur = `/opt/pw-browsers/${d}/chrome-linux/chrome`; break }
}
const serveur = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
process.on('exit', () => serveur.kill())
let vivant = false
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(URL)).ok) { vivant = true; break } } catch {}
  await new Promise((r) => setTimeout(r, 250))
}
if (!vivant) { console.error('serveur muet'); process.exit(1) }

const browser = await chromium.launch(navigateur ? { executablePath: navigateur } : {})
const page = await browser.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(URL, { waitUntil: 'networkidle' })

const res = await page.evaluate(async () => {
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const col = await import('/src/core/color.ts')
  const d = await import('/src/smart/depth.ts')
  const s = await import('/src/smart/scene.ts')
  const { spritePixl } = await import('/src/ui/mascot-clips.ts')

  const T = 48, SC = 6
  const opts = { largeur: T, hauteur: T }
  const getA = col.getA

  const pixl = spritePixl().layers[0].cels[0].bitmap  // 32x32, pose de repos
  const champDe = (b) => d.champAuto(b, { hauteur: d.hauteurSuggeree(b), galbe: 0.5 })

  const pieceDe = (nom, bitmap, sourcesSupp = []) => {
    const b = bitmap.trimBounds()
    return {
      nom, sources: [{ azimut: 0, elevation: 0, bitmap, champ: champDe(bitmap) }, ...sourcesSupp],
      pivot: { x: b.x + b.w / 2, y: b.y + b.h / 2, z: 0 },
      position: { x: 0, y: 0, z: 0 },
      rotation: { lacet: 0, tangage: 0, roulis: 0 },
    }
  }
  const seule = pieceDe('pixl', pixl)

  /* ---- metriques ---- */
  const hex = (c) => '#' + [col.getR(c), col.getG(c), col.getB(c)].map(v => v.toString(16).padStart(2,'0')).join('')
  const CONTOUR = 0, YEUX = 1
  const compteParCouleur = (img) => {
    const m = new Map()
    for (let i = 0; i < img.u32.length; i++) {
      const c = img.u32[i]
      if (getA(c) === 0) continue
      m.set(hex(c), (m.get(hex(c)) || 0) + 1)
    }
    return Object.fromEntries(m)
  }
  // composantes connexes opaques (8-voisins)
  const composantes = (img) => {
    const w = img.width, h = img.height
    const vu = new Uint8Array(w * h)
    let n = 0, tailles = []
    for (let i = 0; i < w * h; i++) {
      if (vu[i] || getA(img.u32[i]) === 0) continue
      n++; let t = 0
      const p = [i]; vu[i] = 1
      while (p.length) {
        const j = p.pop(); t++
        const x = j % w, y = (j / w) | 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const k = ny * w + nx
          if (!vu[k] && getA(img.u32[k]) !== 0) { vu[k] = 1; p.push(k) }
        }
      }
      tailles.push(t)
    }
    tailles.sort((a,b)=>b-a)
    return { n, tailles: tailles.slice(0, 6) }
  }
  // pixels isoles chromatiquement : couleur differente des 4 voisins orthogonaux opaques
  const taches = (img) => {
    const w = img.width, h = img.height
    let n = 0
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, c = img.u32[i]
      if (getA(c) === 0) continue
      let diff = 0, vois = 0
      for (const v of [-1, 1, -w, w]) {
        const j = i + v
        if (getA(img.u32[j]) === 0) continue
        vois++; if (img.u32[j] !== c) diff++
      }
      if (vois >= 3 && diff === vois) n++
    }
    return n
  }
  // perimetre de la silhouette : pixels opaques ayant au moins un voisin ortho vide
  const perimetre = (img) => {
    const w = img.width, h = img.height
    let n = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (getA(img.u32[i]) === 0) continue
      for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = x+dx, ny = y+dy
        if (nx<0||ny<0||nx>=w||ny>=h||getA(img.u32[ny*w+nx])===0) { n++; break }
      }
    }
    return n
  }
  // proportion du perimetre qui est de la couleur de contour (#161020)
  const contourNoir = (img) => {
    const w = img.width, h = img.height
    let bord = 0, noir = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (getA(img.u32[i]) === 0) continue
      let estBord = false
      for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = x+dx, ny = y+dy
        if (nx<0||ny<0||nx>=w||ny>=h||getA(img.u32[ny*w+nx])===0) { estBord = true; break }
      }
      if (!estBord) continue
      bord++
      if (hex(img.u32[i]) === '#161020') noir++
    }
    return bord ? noir / bord : 0
  }
  const mesures = (img) => ({
    masse: s.masse(img),
    trous: d.trousInterieurs(img),
    comp: composantes(img),
    taches: taches(img),
    perim: perimetre(img),
    contour: +contourNoir(img).toFixed(3),
    couleurs: compteParCouleur(img),
  })

  /* ---- rendu -> dataURL ---- */
  const cvTile = document.createElement('canvas')
  const dessine = (ctx, img, ox, oy) => {
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    c.getContext('2d').putImageData(img.toImageData(), 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(c, 0, 0, img.width, img.height, ox, oy, img.width * SC, img.height * SC)
  }
  const planche = (items, cols) => {
    const rows = Math.ceil(items.length / cols)
    const cv = document.createElement('canvas')
    cv.width = cols * T * SC; cv.height = rows * (T * SC + 22)
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#2b2b30'; ctx.fillRect(0, 0, cv.width, cv.height)
    items.forEach((it, k) => {
      const cx = (k % cols) * T * SC, cy = ((k / cols) | 0) * (T * SC + 22)
      ctx.fillStyle = '#3a3a42'; ctx.fillRect(cx, cy, T*SC, T*SC)
      dessine(ctx, it.img, cx, cy)
      ctx.strokeStyle = '#666'; ctx.strokeRect(cx+0.5, cy+0.5, T*SC-1, T*SC-1)
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'
      ctx.fillText(it.nom, cx + 6, cy + T*SC + 16)
    })
    return cv.toDataURL('png')
  }

  const rendre = (piece, az, el) => s.rendreScene([piece], { azimut: az, elevation: el, zoom: 1 }, opts).image

  const rapport = { erreurs: [] }

  /* A. 8 directions, elevation 0 */
  const NOMS = ['S','SE','E','NE','N','NO','O','SO']
  const dirs0 = NOMS.map((n, i) => ({ nom: `${n} ${Math.round(i*45)}d`, img: rendre(seule, i*Math.PI/4, 0) }))
  rapport.dir0 = dirs0.map((t,i) => ({ nom: t.nom, ...mesures(t.img) }))

  /* B. 8 directions, elevation iso 2:1 (ce que fait planchesDeDirections dans le banc) */
  const dirsIso = NOMS.map((n, i) => ({ nom: `${n} ${Math.round(i*45)}d`, img: rendre(seule, i*Math.PI/4, s.ELEVATION_ISO_2_1) }))
  rapport.dirIso = dirsIso.map((t) => ({ nom: t.nom, ...mesures(t.img) }))

  /* C. chaque camera de VUES */
  const vues = s.VUES.map((v) => ({ nom: v.id, img: rendre(seule, v.camera.azimut, v.camera.elevation) }))
  rapport.vues = vues.map((t) => ({ nom: t.nom, ...mesures(t.img) }))

  /* D. balayage fin 0..90 par 10 */
  const sweep = []
  for (let deg = 0; deg <= 90; deg += 10) sweep.push({ nom: `${deg}d`, img: rendre(seule, deg*Math.PI/180, 0) })
  rapport.sweep = sweep.map((t) => ({ nom: t.nom, ...mesures(t.img) }))
  // balayage tres fin pour la note de degradation
  rapport.fin = []
  for (let deg = 0; deg <= 180; deg += 5) {
    const img = rendre(seule, deg*Math.PI/180, 0)
    const m = mesures(img)
    rapport.fin.push({ deg, masse: m.masse, comp: m.comp.n, taches: m.taches, contour: m.contour, trous: m.trous,
      yeux: m.couleurs['#ffe27a'] || 0, nez: m.couleurs['#ff8ab0'] || 0 })
  }

  /* E. deux sources : face + dos (face miroir), pour voir la couture au basculement */
  const dosArt = pixl.flipH()
  const deuxSrc = pieceDe('2src', pixl, [{ azimut: Math.PI, elevation: 0, bitmap: dosArt, champ: champDe(dosArt) }])
  const couture = []
  for (let deg = 70; deg <= 110; deg += 5) couture.push({ nom: `${deg}d`, img: rendre(deuxSrc, deg*Math.PI/180, 0) })
  rapport.couture = couture.map((t) => ({ nom: t.nom, ...mesures(t.img) }))
  // saut au basculement, en pixels differents entre 89.9 et 90.1 deg
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.u32.length; i++) if (a.u32[i] !== b.u32[i]) n++; return n }
  const av = rendre(deuxSrc, (89.9*Math.PI)/180, 0), ap = rendre(deuxSrc, (90.1*Math.PI)/180, 0)
  rapport.sautCouture = { pixelsChanges: diff(av, ap), masseAvant: s.masse(av), masseApres: s.masse(ap) }
  // meme mesure pour une source unique, comme reference
  const av1 = rendre(seule, (89.9*Math.PI)/180, 0), ap1 = rendre(seule, (90.1*Math.PI)/180, 0)
  rapport.sautUneSource = { pixelsChanges: diff(av1, ap1) }

  /* F. reference : le dessin d'origine mesure pareil */
  rapport.origine = mesures(pixl)

  const planches = {
    '01-8directions-elev0': planche(dirs0, 4),
    '02-8directions-iso': planche(dirsIso, 4),
    '03-vues-nommees': planche(vues, 4),
    '04-balayage-0-90': planche(sweep, 5),
    '05-couture-2sources': planche(couture, 5),
    '00-origine': planche([{ nom: 'dessin source 32x32', img: pixl }], 1),
  }
  return { rapport, planches }
})

for (const [nom, url] of Object.entries(res.planches)) {
  writeFileSync(`${OUT}/${nom}.png`, Buffer.from(url.split(',')[1], 'base64'))
}
writeFileSync(`${OUT}/rapport.json`, JSON.stringify(res.rapport, null, 1))
console.log('erreurs page:', erreurs)
console.log(JSON.stringify(res.rapport.origine, null, 1))
await browser.close(); serveur.kill()
