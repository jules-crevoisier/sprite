/**
 * Test de bout en bout : lance un serveur de previsualisation, ouvre
 * l'application dans Chromium et verifie les points critiques (dessin,
 * historique, planches, metadonnees Unity/Godot, GIF, aller-retour projet).
 *
 *   npm run test:smoke
 *
 * Chromium doit etre disponible : `npx playwright install chromium`, ou bien
 * la variable PW_CHROMIUM pointant sur un binaire existant.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 4319
const URL = `http://127.0.0.1:${PORT}/`
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '  ok  ' : ' ECHEC'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// Le serveur de developpement sert les modules source : le test peut donc
// importer directement les modules d'export pour les verifier un par un.
const server = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], {
  stdio: 'ignore',
  detached: false,
})
process.on('exit', () => server.kill())

// Attend que le serveur reponde.
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(URL)
    if (res.ok) break
  } catch { /* pas encore pret */ }
  await sleep(250)
}

const browser = await chromium.launch(launchOptions)
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(URL, { waitUntil: 'networkidle' })
await sleep(400)

check('l\'application demarre', await page.evaluate(() => !!window.pixelforge))

// La visite guidee est proposee au premier lancement : on la refuse pour
// retrouver un editeur vierge.
const welcome = await page.locator('.modal-head h2').first().textContent().catch(() => null)
check('la visite guidee est proposee au premier lancement', welcome?.includes('Bienvenue') ?? false, welcome ?? 'absente')
await page.keyboard.press('Escape')
await sleep(250)

/* --- dessin au crayon --- */
const box = await page.locator('#canvas').boundingBox()
await page.mouse.move(box.x + box.width / 2 - 50, box.y + box.height / 2)
await page.mouse.down()
for (let i = 0; i < 20; i++) await page.mouse.move(box.x + box.width / 2 - 50 + i * 5, box.y + box.height / 2 + i)
await page.mouse.up()
await sleep(150)

const painted = await page.evaluate(() => {
  const bm = window.pixelforge.ed.peekCel().bitmap
  let n = 0
  for (let i = 3; i < bm.data.length; i += 4) if (bm.data[i]) n++
  return n
})
check('le crayon ecrit des pixels', painted > 0, `${painted} px`)

/* --- historique --- */
const undoOk = await page.evaluate(() => {
  const ed = window.pixelforge.ed
  const count = () => {
    const bm = ed.peekCel().bitmap
    let n = 0
    for (let i = 3; i < bm.data.length; i += 4) if (bm.data[i]) n++
    return n
  }
  const before = count()
  ed.undo()
  const undone = count()
  ed.redo()
  return undone === 0 && count() === before
})
check('annuler puis retablir restaure le trait', undoOk)

/* --- moteur d'export --- */
const report = await page.evaluate(async () => {
  const { buildSpriteSheet } = await import('/src/export/spritesheet.ts')
  const { buildAsepriteJson } = await import('/src/export/json.ts')
  const { buildUnityMeta, buildUnityAnimations, unityGuid } = await import('/src/export/unity.ts')
  const { buildGodotSpriteFrames } = await import('/src/export/godot.ts')
  const { encodeGif } = await import('/src/export/gif.ts')
  const { buildZip, textBytes } = await import('/src/export/zip.ts')
  const { compositeAll } = await import('/src/render/composite.ts')
  const { deserializeSprite, serializeSprite } = await import('/src/io/project.ts')
  const { fromHex } = await import('/src/core/color.ts')

  const app = window.pixelforge
  const ed = app.ed
  for (let i = 0; i < 3; i++) app.timeline.duplicateFrame()
  ed.sprite.frameDurations = [100, 100, 150, 80]
  ed.sprite.tags = [
    { id: 1, name: 'idle', from: 0, to: 1, direction: 'forward', repeat: 0, color: fromHex('#6c8cff') },
    { id: 2, name: 'run', from: 2, to: 3, direction: 'pingpong', repeat: 0, color: fromHex('#54d6a0') },
  ]
  const sprite = ed.sprite

  const out = {}
  out.layouts = {}
  for (const layout of ['horizontal', 'vertical', 'grid', 'by-tag', 'packed']) {
    const sheet = buildSpriteSheet(sprite, { layout, columns: 3, padding: 2, extrude: 1 })
    let bad = 0
    for (let i = 0; i < sheet.frames.length; i++) {
      const a = sheet.frames[i].frame
      if (a.x < 0 || a.y < 0 || a.x + a.w > sheet.bitmap.width || a.y + a.h > sheet.bitmap.height) bad++
      for (let j = i + 1; j < sheet.frames.length; j++) {
        const b = sheet.frames[j].frame
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad++
      }
    }
    out.layouts[layout] = bad === 0 && sheet.frames.length === sprite.frameCount
  }

  const sheet = buildSpriteSheet(sprite, { layout: 'horizontal', extrude: 2, padding: 4 })
  const src = compositeAll(sprite)
  let mismatch = 0
  sheet.frames.forEach((f, i) => {
    for (let y = 0; y < f.frame.h; y++) {
      for (let x = 0; x < f.frame.w; x++) {
        if (sheet.bitmap.get(f.frame.x + x, f.frame.y + y) !== src[i].get(x, y)) mismatch++
      }
    }
  })
  out.sheetPixels = mismatch === 0
  const f0 = sheet.frames[0].frame
  out.extrude = sheet.bitmap.get(f0.x - 1, f0.y + 3) === sheet.bitmap.get(f0.x, f0.y + 3)

  const json = JSON.parse(buildAsepriteJson(sprite, sheet, 'x.png', 'hash'))
  out.json = Object.keys(json.frames).length === sprite.frameCount && json.meta.frameTags.length === 2

  const guid = unityGuid('x.png')
  const meta = buildUnityMeta(sprite, sheet, guid, {})
  const y0 = Number(meta.split('rect:')[1].split('y: ')[1].split('\n')[0])
  out.unity =
    (meta.match(/spriteID: /g) || []).length === sprite.frameCount + 1 &&
    y0 === sheet.bitmap.height - (sheet.frames[0].frame.y + sheet.frames[0].frame.h)
  out.unityClips = buildUnityAnimations(sprite, sheet, guid, {}).length === 2

  const tres = buildGodotSpriteFrames(sprite, sheet, { resPath: 'res://x.png' })
  out.godot =
    (tres.match(/\[sub_resource type="AtlasTexture"/g) || []).length === sprite.frameCount &&
    (tres.match(/"name": &"/g) || []).length === 2 &&
    Number(tres.match(/load_steps=(\d+)/)[1]) === sprite.frameCount + 2

  const gif = encodeGif(compositeAll(sprite), sprite.frameDurations)
  const url = URL.createObjectURL(new Blob([gif], { type: 'image/gif' }))
  out.gif = await new Promise((res) => {
    const img = new Image()
    img.onload = () => res(img.naturalWidth === sprite.width && img.naturalHeight === sprite.height)
    img.onerror = () => res(false)
    img.src = url
  })

  const zip = await buildZip([{ name: 'a.txt', data: textBytes('hello') }]).arrayBuffer()
  const sig = new Uint8Array(zip, 0, 4)
  out.zip = sig[0] === 0x50 && sig[1] === 0x4b && sig[2] === 0x03 && sig[3] === 0x04

  const restored = await deserializeSprite(serializeSprite(sprite))
  out.project =
    restored.frameCount === sprite.frameCount &&
    restored.tags.length === sprite.tags.length &&
    restored.layers[0].cels[0].bitmap.get(16, 16) === sprite.layers[0].cels[0].bitmap.get(16, 16)

  return out
})

for (const [layout, ok] of Object.entries(report.layouts)) {
  check(`planche « ${layout} » sans chevauchement`, ok)
}
check('les pixels de la planche correspondent aux frames', report.sheetPixels)
check('l\'extrusion duplique les bords', report.extrude)
check('le JSON Aseprite est complet', report.json)
check('le .meta Unity decoupe et inverse Y', report.unity)
check('les AnimationClip Unity sont generes', report.unityClips)
check('la ressource SpriteFrames Godot est coherente', report.godot)
check('le GIF est decode par le navigateur', report.gif)
check('l\'archive ZIP a une signature valide', report.zip)
check('le projet fait un aller-retour sans perte', report.project)
/* --- modeles de squelette et tutoriel --- */
const guided = await page.evaluate(async () => {
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const app = window.pixelforge
  const ed = app.ed
  ed.loadSprite(demoCharacter())
  const box = ed.peekCel().bitmap.trimBounds()

  const out = { modeles: true, enfants: true }
  for (const t of RIG_TEMPLATES) {
    applyTemplate(ed.sprite.rig, t, ed.peekCel().bitmap, ed.sprite)
    const bones = ed.sprite.rig.bones
    if (bones.length !== t.bones.length) out.modeles = false
    if (!bones.some((b) => b.parent !== null)) out.enfants = false
    const dedans = bones.every((b) =>
      b.x >= box.x - 1 && b.x <= box.x + box.w + 1 && b.ey >= box.y - 1 && b.ey <= box.y + box.h + 1)
    if (!dedans) out.modeles = false
  }

  // Une lecon doit pouvoir enchainer ses etapes automatiques.
  const lesson = app.lessons().find((l) => l.id === 'rig')
  out.lecons = app.lessons().length
  await app.tutorial.start(lesson)
  out.carte = !!document.querySelector('.tutor-card:not([hidden])')
  for (const step of lesson.steps) if (step.auto) await step.auto()
  out.rigLie = !!ed.sprite.rig.rest
  out.rigPose = ed.sprite.rig.bones.some((b) => Math.abs(b.angle) > 0.05)
  app.tutorial.stop()
  out.carteFermee = !document.querySelector('.tutor-card:not([hidden])')
  return out
})

check('les modeles de squelette tiennent dans le dessin', guided.modeles)
check('les modeles enchainent bien les os', guided.enfants)
check('les lecons sont disponibles', guided.lecons === 5, `${guided.lecons} lecons`)
check('la carte du tutoriel s\'affiche', guided.carte)
check('la lecon squelette lie et pose le personnage', guided.rigLie && guided.rigPose)
check('quitter le tutoriel referme la carte', guided.carteFermee)

check('aucune erreur JavaScript', errors.length === 0, errors.join(' | '))

await browser.close()
server.kill()

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} verifications reussies`)
process.exit(failed.length ? 1 : 0)
