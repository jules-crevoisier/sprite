/**
 * Premiere passe du film : recolte des images reelles de l'application.
 *
 * Rien n'est redessine a la main ici. Les frames d'animation sortent du
 * moteur de deformation, les captures d'ecran sortent de l'editeur qui
 * tourne. Le montage (scripts/film/film.html) ne fait que les mettre en
 * scene, ce qui garantit que le film montre le vrai logiciel.
 *
 *   node scripts/film/capture.mjs --out <dossier> [--port 5178]
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = argOf('--out', 'video/assets')
const PORT = Number(argOf('--port', '5178'))
const URL = `http://127.0.0.1:${PORT}/`

/**
 * Playwright cherche par defaut un « headless shell » qui n'est pas installe
 * partout a cote du navigateur complet ; on prend donc le chromium present.
 */
function trouverChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!racine || !existsSync(racine)) return null
  for (const dossier of readdirSync(racine)) {
    if (!/^chromium-\d+$/.test(dossier)) continue
    const chemin = join(racine, dossier, 'chrome-linux', 'chrome')
    if (existsSync(chemin)) return chemin
  }
  return null
}

mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'ui'), { recursive: true })
mkdirSync(join(OUT, 'sprite'), { recursive: true })

const server = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => server.kill())
let vivant = false
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(URL)).ok) { vivant = true; break } } catch { /* pas encore pret */ }
  await sleep(250)
}
if (!vivant) { console.error('le serveur de developpement ne repond pas'); process.exit(1) }

const executablePath = trouverChromium()
console.log(`navigateur : ${executablePath ?? '(defaut playwright)'}`)
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(URL, { waitUntil: 'networkidle' })
await sleep(700)
await page.keyboard.press('Escape')
await sleep(300)

const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64')

/* ---------------------------------------------------------------- */
/* 1. Les images d'animation, produites par le moteur de rig          */
/* ---------------------------------------------------------------- */
const anim = await page.evaluate(async () => {
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { ANIM_CLIPS, clipPoses, clipFits } = await import('/src/smart/anim-clips.ts')
  const { autoBind, applyPose, capturePose, deform, resetPose } = await import('/src/smart/rig.ts')
  const { applyFollowThrough } = await import('/src/smart/follow-through.ts')
  const { boneColor } = await import('/src/smart/rig.ts')
  const { autoShade, antiAlias } = await import('/src/smart/shading.ts')
  const { extractRamps } = await import('/src/smart/analysis.ts')
  const { Bitmap } = await import('/src/core/bitmap.ts')

  const ed = window.pixelforge.ed
  ed.loadSprite(demoCharacter())
  const rig = ed.sprite.rig
  const humain = RIG_TEMPLATES.find((t) => t.id === 'humanoid-front') ?? RIG_TEMPLATES[0]
  applyTemplate(rig, humain, ed.peekCel().bitmap, ed.sprite)
  rig.parts = [autoBind(rig, 0, ed.peekCel().bitmap)]
  const part = rig.parts[0]
  const repos = capturePose(rig)

  const vers = (bm) => {
    const cv = document.createElement('canvas')
    cv.width = bm.width; cv.height = bm.height
    const img = new ImageData(new Uint8ClampedArray(bm.data), bm.width, bm.height)
    cv.getContext('2d').putImageData(img, 0, 0)
    return cv.toDataURL()
  }

  // Bornes du dessin, communes a toutes les images : elles permettent au
  // film d'afficher le personnage en grand sans que les poses se decalent.
  const bornes = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 }
  const mesurer = (bm) => {
    for (let y = 0; y < bm.height; y++) for (let x = 0; x < bm.width; x++) {
      if (!(bm.u32[y * bm.width + x] >>> 24)) continue
      if (x < bornes.x0) bornes.x0 = x
      if (y < bornes.y0) bornes.y0 = y
      if (x > bornes.x1) bornes.x1 = x
      if (y > bornes.y1) bornes.y1 = y
    }
  }
  mesurer(part.rest)

  const sortie = {
    repos: vers(part.rest), clips: [],
    largeur: part.rest.width, hauteur: part.rest.height,
    // La geometrie reelle des os : le film la redessine, il ne l'invente pas.
    os: rig.bones.map((b, i) => ({
      nom: b.name, role: b.role, parent: b.parent,
      x: b.x, y: b.y, ex: b.ex, ey: b.ey,
      couleur: boneColor(i),
    })),
  }
  for (const clip of ANIM_CLIPS) {
    if (!clipFits(clip, rig)) continue
    let poses = clipPoses(rig, clip, clip.frames, repos)
    poses = applyFollowThrough(rig, poses, clip.loop) ?? poses
    const images = []
    for (const pose of poses) {
      applyPose(rig, pose)
      const bm = deform(rig, part, { quality: 8, fillPasses: 2 })
      mesurer(bm)
      images.push(vers(bm))
    }
    applyPose(rig, repos)
    sortie.clips.push({ id: clip.id, label: clip.label, ms: clip.ms, loop: clip.loop, images })
  }
  // Ombrage automatique : le meme dessin, avant et apres. autoShade et
  // antiAlias travaillent sur place, on part donc d'une copie.
  const base = ed.peekCel().bitmap
  sortie.avant = vers(base)
  try {
    const rampes = extractRamps([base])
    const copie = new Bitmap(base.width, base.height, new Uint8ClampedArray(base.data))
    // Reglage doux : a la force par defaut, le visage se tache au lieu de
    // prendre du volume sur un sprite de cette taille.
    autoShade(copie, rampes, { strength: 0.55, radius: 2 })
    sortie.apres = vers(copie)
    antiAlias(copie, rampes, 0.7)
    sortie.lisse = vers(copie)
    const teinte = (c) => `rgb(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255})`
    sortie.rampes = rampes
      .slice().sort((a, b) => b.pixels - a.pixels).slice(0, 5)
      .map((r) => ({ nom: r.label ?? '', couleurs: r.colors.map(teinte) }))
  } catch (e) { sortie.erreurOmbre = String(e) }

  sortie.cadrage = {
    x: bornes.x0, y: bornes.y0,
    w: bornes.x1 - bornes.x0 + 1, h: bornes.y1 - bornes.y0 + 1,
  }

  resetPose(rig)
  applyPose(rig, repos)
  return sortie
}, {})

for (const clip of anim.clips) {
  clip.images.forEach((url, i) => {
    const nom = `${clip.id}-${String(i).padStart(2, '0')}.png`
    writeFileSync(join(OUT, 'sprite', nom), png(url))
  })
  console.log(`clip ${clip.id.padEnd(7)} ${clip.images.length} images`)
}
writeFileSync(join(OUT, 'sprite', 'repos.png'), png(anim.repos))
for (const [cle, nom] of [['avant', 'avant'], ['apres', 'apres'], ['lisse', 'lisse']]) {
  if (anim[cle]) writeFileSync(join(OUT, 'sprite', `${nom}.png`), png(anim[cle]))
}
if (anim.erreurOmbre) console.log('ombrage :', anim.erreurOmbre)
writeFileSync(join(OUT, 'sprite.json'), JSON.stringify({
  largeur: anim.largeur, hauteur: anim.hauteur,
  os: anim.os, rampes: anim.rampes ?? [], cadrage: anim.cadrage,
  clips: anim.clips.map((c) => ({ id: c.id, label: c.label, ms: c.ms, loop: c.loop, frames: c.images.length })),
}, null, 2))

/* ---------------------------------------------------------------- */
/* 1bis. Les cycles de la mascotte, dessines a la main                */
/* ---------------------------------------------------------------- */
// Le chapitre precedent montre ce que le moteur deforme tout seul. Celui-ci
// montre l'autre moitie du logiciel : des images posees une par une. Les
// deux sortent du meme fichier de sprite, c'est ce qui rend la comparaison
// honnete.
const mascotte = await page.evaluate(async () => {
  const { CLIPS_PIXL, imageDePose } = await import('/src/ui/mascot-clips.ts')
  const { TAILLE, PALETTE_MASCOTTE } = await import('/src/ui/mascot-anim.ts')

  const vers = (bm) => {
    const cv = document.createElement('canvas')
    cv.width = TAILLE; cv.height = TAILLE
    const img = new ImageData(new Uint8ClampedArray(bm.data), TAILLE, TAILLE)
    cv.getContext('2d').putImageData(img, 0, 0)
    return cv.toDataURL()
  }

  return {
    taille: TAILLE,
    // La palette de la mascotte est deja ecrite en hexadecimal.
    palette: Object.values(PALETTE_MASCOTTE),
    clips: CLIPS_PIXL.map((c) => ({
      id: c.id, nom: c.nom, ms: c.ms, loop: c.loop,
      images: c.poses.map((pose) => vers(imageDePose(pose))),
    })),
  }
}, {})

mkdirSync(join(OUT, 'mascotte'), { recursive: true })
for (const cycle of mascotte.clips) {
  cycle.images.forEach((url, i) => {
    writeFileSync(join(OUT, 'mascotte', `${cycle.id}-${String(i).padStart(2, '0')}.png`), png(url))
  })
  console.log(`mascotte ${cycle.id.padEnd(8)} ${cycle.images.length} images`)
}
writeFileSync(join(OUT, 'mascotte.json'), JSON.stringify({
  taille: mascotte.taille, palette: mascotte.palette,
  clips: mascotte.clips.map((c) => ({ id: c.id, nom: c.nom, ms: c.ms, loop: c.loop, frames: c.images.length })),
}, null, 2))

/* ---------------------------------------------------------------- */
/* 2. Les captures de l'interface                                     */
/* ---------------------------------------------------------------- */
const clip = async (nom, selecteur, avant) => {
  if (avant) { await page.evaluate(avant); await sleep(500) }
  const boite = selecteur ? await page.locator(selecteur).first().boundingBox() : null
  await page.screenshot({ path: join(OUT, 'ui', `${nom}.png`), clip: boite ?? undefined })
  console.log(`ui ${nom}`)
}

// La couleur active se voit dans le panneau Couleur et commande la rampe :
// avec le blanc par defaut, les deux plans seraient gris.
await page.evaluate(async () => {
  const { fromHex } = await import('/src/core/color.ts')
  window.pixelforge.ed.setPrimary(fromHex('#3d60cf'))
})
await sleep(250)

await page.evaluate(() => window.pixelforge.setMode('draw'))
await sleep(400)
await clip('app-dessin', null)
await clip('outils', '.toolbar')
await clip('options', '#optionsbar')
await clip('calques', '#dock-right .panel[data-panel="layers"]')
await clip('couleurs', '#dock-right .panel[data-panel="color"]')

await page.evaluate(() => window.pixelforge.setMode('rig'))
await sleep(600)
await clip('app-squelette', null)
const osPanel = await page.locator('#dock-right .panel').first().boundingBox()
if (osPanel) await page.screenshot({ path: join(OUT, 'ui', 'panneau-os.png'), clip: osPanel })

await page.evaluate(() => window.pixelforge.setMode('draw'))
await sleep(400)
await clip('timeline', '.timeline')

for (const [cmd, nom] of [['sprite.ramp', 'rampe'], ['sprite.shade', 'ombrage'], ['file.export', 'export'], ['sprite.variants', 'variantes']]) {
  try {
    await page.evaluate((c) => window.pixelforge.runCommand(c), cmd)
    await sleep(700)
    const m = await page.locator('.modal').first().boundingBox()
    if (m) { await page.screenshot({ path: join(OUT, 'ui', `${nom}.png`), clip: m }); console.log(`ui ${nom}`) }
    await page.keyboard.press('Escape')
    await sleep(350)
  } catch (e) { console.log(`dialogue ${nom} indisponible : ${e.message}`) }
}

await browser.close()
server.kill()
console.log('erreurs page :', erreurs.length ? erreurs : 'aucune')
