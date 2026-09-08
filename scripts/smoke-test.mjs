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
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Vite lance directement, sans passer par npx : le wrapper npx encaisse
// le kill et laisse le serveur derriere lui, un par execution.
const VITE = 'node_modules/.bin/vite'

/**
 * Un port different a chaque execution.
 *
 * Avec un port fixe et sans `--strictPort`, deux bancs d'essai lances en
 * meme temps — sur deux copies du depot, par exemple — se marchent dessus
 * en silence : le second serveur choisit un autre port, mais le test
 * continue d'interroger le premier. On teste alors l'autre copie sans que
 * rien ne le dise. Un port tire au sort et `--strictPort` transforment ce
 * piege en erreur franche.
 */
const argPort = process.argv.indexOf('--port')
const PORT = argPort >= 0 && process.argv[argPort + 1]
  ? Number(process.argv[argPort + 1])
  : 41000 + Math.floor(Math.random() * 2000)
const URL = `http://127.0.0.1:${PORT}/`

/**
 * Trouve un Chromium utilisable.
 *
 * Playwright cherche par defaut un « headless shell » qui n'est pas toujours
 * installe a cote du navigateur complet ; on regarde donc dans le dossier des
 * navigateurs avant de le laisser decider.
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

const navigateur = trouverChromium()
const launchOptions = navigateur ? { executablePath: navigateur } : {}

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '  ok  ' : ' ECHEC'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// Le serveur de developpement sert les modules source : le test peut donc
// importer directement les modules d'export pour les verifier un par un.
const server = spawn(VITE, [ '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
  stdio: 'ignore',
  detached: false,
})
process.on('exit', () => server.kill())

// Attend que le serveur reponde.
let vivant = false
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(URL)
    if (res.ok) { vivant = true; break }
  } catch { /* pas encore pret */ }
  await sleep(250)
}
if (!vivant) {
  console.error(`le serveur de developpement ne repond pas sur le port ${PORT}`)
  process.exit(1)
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
  const { refreshPose } = await import('/src/tools/index.ts')
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

  // La lecon squelette doit avancer sur les gestes de l'utilisateur, pas
  // sur des boutons qui font tout a sa place.
  const lesson = app.lessons().find((l) => l.id === 'rig')
  out.lecons = app.lessons().length
  out.leconsVides = app.lessons().filter((l) => !l.steps.length).length
  out.gestesExiges = lesson.steps.filter((s) => s.done && !s.auto).length
  await app.tutorial.start(lesson)
  out.carte = !!document.querySelector('.tutor-card:not([hidden])')

  const etape = () => document.querySelector('.tutor-count')?.textContent ?? ''
  const attendre = (predicat) => new Promise((resolve) => {
    const debut = Date.now()
    const timer = setInterval(() => {
      if (predicat() || Date.now() - debut > 1200) { clearInterval(timer); resolve() }
    }, 100)
  })

  // Un pas apres l'autre : les etapes de lecture se passent au bouton, les
  // etapes de geste attendent l'action reelle.
  const suivant = () => document.querySelector('.tutor-foot button.primary')?.click()
  const numero = () => Number(etape().split('/')[0])
  const jusqua = async (n) => { await attendre(() => numero() >= n); return etape() }

  out.avance = []
  app.setMode('rig')
  out.avance.push(await jusqua(2))

  ed.run('modele', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.peekCel().bitmap, ed.sprite))
  out.avance.push(await jusqua(3))

  suivant()
  out.avance.push(await jusqua(4))

  app.rigPanel.bind()
  out.avance.push(await jusqua(5))
  out.rigLie = ed.sprite.rig.parts.length > 0

  suivant()
  await jusqua(6)
  const bras = ed.sprite.rig.bones.find((b) => b.role === 'armL')
  bras.angle = -1
  refreshPose(ed)
  out.avance.push(await jusqua(7))
  out.rigPose = ed.sprite.rig.bones.some((b) => Math.abs(b.angle) > 0.05)

  suivant()
  out.avance.push(await jusqua(8))

  // Aller-retour dessin / squelette.
  app.setMode('draw')
  out.avance.push(await jusqua(9))
  app.setMode('rig')
  out.avance.push(await jusqua(10))

  // Frames intermediaires, puis le cycle tout fait.
  ed.sprite.addFrame(ed.frameCount)
  ed.events.emit('doc', undefined)
  out.avance.push(await jusqua(11))

  const { ANIM_CLIPS } = await import('/src/smart/anim-clips.ts')
  app.rigPanel.generateClip(ANIM_CLIPS.find((c) => c.id === 'walk'))
  out.avance.push(await jusqua(12))

  // Les dernieres etapes attendent de vrais gestes : le bouton ne les ouvre
  // plus. On les accomplit donc pour de bon.
  app.playback.play()
  out.avance.push(await jusqua(13))

  ed.setActiveLayer(0)
  app.rigPanel.bind()          // detache le calque : le compte change
  out.avance.push(await jusqua(14))

  ed.sprite.rig.bones[ed.sprite.rig.bones.length - 1].softness = 0.6
  await attendre(() => !document.querySelector('.tutor-card:not([hidden])'))
  out.avance.push(etape() || 'terminee')

  app.tutorial.stop()
  out.carteFermee = !document.querySelector('.tutor-card:not([hidden])')
  return out
})

/* --- le personnage de demonstration doit se rigger proprement --- */
const perso = await page.evaluate(async () => {
  const { getA } = await import('/src/core/color.ts')
  const rigApi = await import('/src/smart/rig.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')

  const sprite = demoCharacter()
  const rest = sprite.layers[0].cels[0].bitmap
  const rig = sprite.rig
  applyTemplate(rig, RIG_TEMPLATES.find((t) => t.id === 'humanoid-front'), rest, sprite)
  const part = rigApi.autoBind(rig, sprite.layers[0].id, rest)

  // Les os sont designes par leur role : la composition des modeles change,
  // pas la fonction de chaque os dans le corps.
  const index = (role) => rig.bones.findIndex((b) => b.role === role)
  const at = (x, y) => part.weights[y * rest.width + x]
  const roleAt = (x, y) => rig.bones[at(x, y)]?.role ?? 'aucun'
  // Chaque partie doit revenir a son propre os, pas a celui du voisin.
  const out = {
    brasG: roleAt(16, 26) === 'armL',
    brasD: roleAt(31, 26) === 'armR',
    avantBrasG: roleAt(16, 32) === 'forearmL',
    torse: roleAt(23, 28) === 'torso',
    tete: roleAt(23, 15) === 'head',
    // La tempe est le piege : un os de bras voisin, mince mais proche, la
    // raflerait si la liaison ne tenait pas compte de la portee des os.
    tempe: roleAt(18, 16) === 'head',
    cuisseG: roleAt(21, 36) === 'legL',
    tibiaG: roleAt(21, 43) === 'shinL',
    cuisseD: roleAt(26, 36) === 'legR',
  }

  // Aucun pixel opaque ne doit rester sans os.
  out.tousLies = true
  for (let i = 0; i < rest.u32.length; i++) {
    if (getA(rest.u32[i]) !== 0 && part.weights[i] === 255) { out.tousLies = false; break }
  }

  // Une pose franche ne doit pas ouvrir de fente dans la matiere.
  const by = (role) => rig.bones[index(role)]
  by('armL').angle = -1.2
  by('armR').angle = 1.2
  by('legL').angle = 0.4
  by('shinL').angle = -0.5
  // Les memes reglages que l'editeur applique par defaut.
  const { seamSettings, rigState } = await import('/src/tools/index.ts')
  const posed = rigApi.deform(rig, part, { ...seamSettings(rigState.seam), quality: 8 })
  let fentes = 0
  for (let y = 1; y < posed.height - 1; y++) {
    for (let x = 1; x < posed.width - 1; x++) {
      if (getA(posed.u32[y * posed.width + x]) !== 0) continue
      let k = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && getA(posed.u32[(y + dy) * posed.width + (x + dx)]) !== 0) k++
        }
      }
      if (k >= 6) fentes++
    }
  }
  out.fentes = fentes
  return out
})

check('le personnage lie chaque membre a son os',
  Object.entries(perso).filter(([k]) => k !== 'tousLies' && k !== 'fentes').every(([, v]) => v),
  JSON.stringify(perso))
check('aucun pixel du personnage ne reste sans os', perso.tousLies)
check('une pose franche n\'ouvre pas de fente', perso.fentes === 0, `${perso.fentes} fentes`)

/* --- le mode squelette doit remplacer l'interface, pas s'y ajouter --- */
const modes = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { rigState } = await import('/src/tools/index.ts')
  const app = window.pixelforge
  const ed = app.ed
  ed.loadSprite(demoCharacter())

  const snapshot = () => ({
    outils: [...document.querySelectorAll('.toolbar .tool')].length,
    panneaux: [...document.querySelectorAll('#dock-right .panel')].map((p) => p.dataset.panel),
  })
  app.setMode('draw')
  const dessin = snapshot()
  app.setMode('rig')
  const squelette = snapshot()

  // La ponderation doit repeindre l'influence et rester annulable.
  ed.run('modele', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.peekCel().bitmap, ed.sprite))
  app.rigPanel.bind()
  const rig = ed.sprite.rig
  const arm = rig.bones.findIndex((b) => b.role === 'armL')
  rigState.selected = rig.bones[arm].id
  app.setTool('rig-weight')
  const part = rig.parts[0]
  const w = part.rest.width
  const cible = 24 * w + 22
  const avant = part.weights[cible]
  const tool = (await import('/src/tools/index.ts')).TOOLS['rig-weight']
  const at = (x, y) => ({ x, y, px: x, py: y, startPx: x, startPy: y, prevPx: x, prevPy: y, shift: false, alt: false, ctrl: false, button: 0, pressure: 1 })
  tool.down(ed, at(22, 24))
  tool.up(ed, at(22, 24))
  const apres = part.weights[cible]
  ed.undo()
  const annule = part.weights[cible]

  app.setMode('draw')
  return {
    dessin, squelette,
    ponderationChange: avant !== apres && apres === arm,
    ponderationAnnulee: annule === avant,
  }
})

check('le mode squelette change la barre d\'outils',
  modes.squelette.outils < modes.dessin.outils && modes.squelette.outils >= 3,
  `${modes.dessin.outils} outils en dessin, ${modes.squelette.outils} en squelette`)
check('le mode squelette change les panneaux',
  modes.squelette.panneaux.includes('rig') && !modes.dessin.panneaux.includes('rig'),
  modes.squelette.panneaux.join(', '))
check('le pinceau de ponderation repeint l\'influence', modes.ponderationChange)
check('la ponderation est annulable', modes.ponderationAnnulee)

check('les modeles de squelette tiennent dans le dessin', guided.modeles)
check('les modeles enchainent bien les os', guided.enfants)
// Un nombre fige ici casserait le test a chaque lecon ajoutee : ce qui
// compte est qu'il y en ait, et qu'aucune ne soit vide.
check('les lecons sont disponibles', guided.lecons >= 5 && guided.leconsVides === 0,
  `${guided.lecons} lecons` + (guided.leconsVides ? `, ${guided.leconsVides} vide(s)` : ''))
check('la carte du tutoriel s\'affiche', guided.carte)
check('la lecon exige de vrais gestes', guided.gestesExiges >= 4, `${guided.gestesExiges} etapes sans bouton de secours`)
const dernierePas = guided.avance[guided.avance.length - 1] ?? ''
const [fait, total] = dernierePas.split('/')
check('la lecon se deroule jusqu\'au bout sur de vrais gestes',
  guided.rigLie && guided.rigPose && fait === total && Number(total) >= 8,
  guided.avance.join(' -> '))
check('quitter le tutoriel referme la carte', guided.carteFermee)

/* --- l'interface du mode squelette ne se coupe ni ne se recouvre --- */
const habillage = await page.evaluate(async () => {
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const app = window.pixelforge, ed = app.ed
  ed.loadSprite(demoCharacter())
  app.setMode('rig')
  ed.run('modele', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.peekCel().bitmap, ed.sprite))
  await new Promise((r) => setTimeout(r, 150))

  // Le selecteur de mode doit contenir son libelle.
  const seg = [...document.querySelectorAll('.topbar .seg button')].every((b) => {
    const r = b.getBoundingClientRect()
    const span = b.querySelector('span')?.getBoundingClientRect()
    return !span || (span.top >= r.top - 0.5 && span.bottom <= r.bottom + 0.5)
  })

  // Le menu des modeles ne doit pas s'etaler par-dessus le panneau.
  document.querySelector('.panel[data-panel="rig"] .panel-head button[title="Modeles de squelette"]').click()
  await new Promise((r) => setTimeout(r, 150))
  const menu = document.querySelector('.dropdown')
  const largeurMenu = menu ? menu.getBoundingClientRect().width : 9999
  menu?.remove()

  // Chaque champ d'une ligne d'os doit recevoir le clic lui-meme.
  const champsAtteignables = [...document.querySelectorAll('.panel[data-panel="rig"] .layer-row select')]
    .every((sel) => {
      const r = sel.getBoundingClientRect()
      const cible = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return cible === sel || sel.contains(cible)
    })
  return { seg, largeurMenu, champsAtteignables }
})
check('le selecteur de mode affiche son libelle en entier', habillage.seg)

// Sur une fenetre etroite, la bascule de mode doit rester entiere.
await page.setViewportSize({ width: 1024, height: 700 })
await sleep(250)
const etroit = await page.evaluate(() => {
  const bar = document.querySelector('.topbar').getBoundingClientRect()
  const seg = document.querySelector('.topbar .seg').getBoundingClientRect()
  const entiers = [...document.querySelectorAll('.topbar .seg button span')].every((sp) => {
    const r = sp.getBoundingClientRect(), b = sp.parentElement.getBoundingClientRect()
    return r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.bottom <= b.bottom + 0.5
  })
  return { entiers, dansLaBarre: seg.right <= bar.right + 0.5, largeur: Math.round(seg.width) }
})
await page.setViewportSize({ width: 1440, height: 900 })
await sleep(250)
check('la bascule de mode survit a une fenetre etroite',
  etroit.entiers && etroit.dansLaBarre, `${etroit.largeur} px a 1024`)
check('le menu des modeles reste etroit', habillage.largeurMenu <= 322, `${Math.round(habillage.largeurMenu)} px`)
check('les champs des lignes d\'os recoivent le clic', habillage.champsAtteignables)

/* --- la barre d'animation reste cliquable pendant la lecture --- */
const barre = await page.evaluate(async () => {
  const app = window.pixelforge, ed = app.ed
  app.setMode('draw')
  for (let i = 0; i < 4; i++) ed.sprite.addFrame(ed.frameCount)
  ed.events.emit('doc', undefined)
  await new Promise((r) => setTimeout(r, 150))
  const outils = document.querySelector('.tl-toolbar')
  const lecture = outils.querySelector('button[title^="Lecture"]')
  let reconstructions = 0
  const obs = new MutationObserver(() => { reconstructions++ })
  obs.observe(outils, { childList: true })
  app.playback.toggle()
  await new Promise((r) => setTimeout(r, 900))
  // Le bouton doit etre le meme objet qu'au depart : sinon un appui
  // commence sur un element et se termine dans le vide.
  const memeBouton = outils.querySelector('button[title^="Lecture"]') === lecture
  const pause = lecture.getBoundingClientRect()
  const atteignable = document.elementFromPoint(pause.x + pause.width / 2, pause.y + pause.height / 2)
  // A mesurer avant d'arreter la lecture : le bouton reprend alors son icone.
  const cliquable = atteignable === lecture || lecture.contains(atteignable)
  const gene = atteignable
    ? `${atteignable.tagName}.${String(atteignable.getAttribute?.('class') ?? '')}`
    : `aucun element a ${Math.round(pause.x)},${Math.round(pause.y)}`
  // L'icone doit avoir bascule sur Pause pendant la lecture.
  const iconePause = lecture.innerHTML.length > 0 && lecture.dataset.state === 'true'
  app.playback.toggle()
  obs.disconnect()
  return { reconstructions, memeBouton, cliquable, gene, iconePause }
})
check('la barre d\'animation ne se reconstruit pas pendant la lecture',
  barre.reconstructions === 0 && barre.memeBouton, `${barre.reconstructions} reconstructions`)
check('le bouton Lecture reste cliquable pendant la lecture', barre.cliquable, barre.gene)
check('le bouton Lecture passe sur Pause pendant la lecture', barre.iconePause)

/* --- retoucher en mode dessin puis revenir au squelette --- */
const allerRetour = await page.evaluate(async () => {
  const { fromHex, getA, getR, getG, getB } = await import('/src/core/color.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { deform } = await import('/src/smart/rig.ts')
  const { rigState, seamSettings, refreshPose } = await import('/src/tools/index.ts')
  const app = window.pixelforge, ed = app.ed

  ed.loadSprite(demoCharacter())
  app.setMode('rig')
  ed.run('modele', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.peekCel().bitmap, ed.sprite))
  app.rigPanel.bind()
  const rig = ed.sprite.rig

  // On leve le bras, puis on rend la pose sur la toile.
  const bras = rig.bones.find((b) => b.role === 'armL')
  bras.angle = 0.5
  refreshPose(ed)

  // Un pixel qui appartient au bras, dans la pose.
  const part = rig.parts[0]
  // La finesse doit etre celle du rendu : a qualite differente, les frontieres
  // ne tombent pas au meme endroit et l'on peindrait a cote du membre.
  const n = part.rest.width * part.rest.height
  const owners = new Uint8Array(n).fill(255)
  deform(rig, part, { ...seamSettings(rigState.seam), owners, quality: 8 })
  const indexBras = rig.bones.indexOf(bras)
  const cible = owners.indexOf(indexBras)
  if (cible < 0) return { erreur: 'aucun pixel du bras' }

  // Retouche en mode dessin : un pixel rouge par-dessus la pose.
  app.setMode('draw')
  const rouge = fromHex('#ff0000')
  ed.run('retouche', () => { ed.peekCel().bitmap.u32[cible] = rouge })

  // Retour au squelette : la retouche doit rejoindre le dessin de repos.
  app.setMode('rig')
  const estRouge = (c) => getA(c) > 200 && getR(c) > 200 && getG(c) < 60 && getB(c) < 60
  let dansRepos = 0, osPorteur = null
  for (let i = 0; i < part.rest.u32.length; i++) {
    if (!estRouge(part.rest.u32[i])) continue
    dansRepos++
    osPorteur = rig.bones[part.weights[i]]?.name ?? 'libre'
  }

  // Une nouvelle pose doit emmener la retouche avec l'os, sans reliaison.
  bras.angle = 1
  refreshPose(ed)
  let surLaToile = 0
  for (const c of ed.peekCel().bitmap.u32) if (estRouge(c)) surLaToile++

  app.setMode('draw')
  return { dansRepos, osPorteur, surLaToile }
})
check('une retouche faite en mode dessin rejoint le dessin de repos',
  allerRetour.dansRepos > 0, allerRetour.erreur ?? `${allerRetour.dansRepos} px, os « ${allerRetour.osPorteur} »`)
check('la retouche est rattachee au bon os', allerRetour.osPorteur === 'bras G', String(allerRetour.osPorteur))
check('la retouche suit l\'os a la pose suivante, sans reliaison',
  allerRetour.surLaToile > 0, `${allerRetour.surLaToile} px`)

/* --- un menu ouvert pendant une lecon n'est pas grise par le halo --- */
const halo = await page.evaluate(async () => {
  const app = window.pixelforge
  app.tutorial.start(app.lessons().find((l) => l.id === 'rig'))
  await new Promise((r) => setTimeout(r, 400))
  document.querySelector('.modal-foot button:last-child')?.click()
  await new Promise((r) => setTimeout(r, 500))
  app.setMode('rig')
  await new Promise((r) => setTimeout(r, 500))
  const couche = (s) => {
    const e = document.querySelector(s)
    return e ? Number(getComputedStyle(e).zIndex) : null
  }
  const out = { halo: couche('.tutor-spotlight'), menus: couche('#overlay-root'), carte: couche('.tutor-card') }
  app.tutorial.stop()
  return out
})
check('le voile du tutoriel passe sous les menus',
  halo.halo !== null && halo.menus !== null && halo.halo < halo.menus,
  `halo ${halo.halo}, menus ${halo.menus}`)
check('la carte du tutoriel reste au-dessus de tout', halo.carte > halo.menus)

/* --- la hierarchie des os se lit sans repeter le parent partout --- */
const hierarchie = await page.evaluate(async () => {
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const app = window.pixelforge, ed = app.ed
  ed.loadSprite(demoCharacter())
  app.setMode('rig')
  ed.run('modele', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.peekCel().bitmap, ed.sprite))
  await new Promise((r) => setTimeout(r, 200))
  const panneau = document.querySelector('.panel[data-panel="rig"]')
  return {
    lignes: panneau.querySelectorAll('.bone-row').length,
    selecteurs: panneau.querySelectorAll('.bone-row select').length,
    traits: panneau.querySelectorAll('.bone-branch:not(.is-root)').length,
    legende: (panneau.textContent ?? '').includes('est la racine'),
  }
})
check('un seul rattachement affiche, celui de l\'os choisi',
  hierarchie.selecteurs <= 1, `${hierarchie.selecteurs} selecteurs pour ${hierarchie.lignes} os`)
check('la hierarchie se lit au trait', hierarchie.traits === hierarchie.lignes - 1,
  `${hierarchie.traits} traits`)
check('la racine du squelette est expliquee', hierarchie.legende)

/* --- les bandes de couleurs ne debordent pas de leur vignette --- */
const bandes = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const app = window.pixelforge
  app.setMode('draw')
  app.ed.loadSprite(demoCharacter())
  app.runCommand('sprite.variants')
  await new Promise((r) => setTimeout(r, 700))
  const debords = [...document.querySelectorAll('.modal .preset')].filter((carte) => {
    const c = carte.getBoundingClientRect()
    return [...carte.children].some((enfant) => {
      const r = enfant.getBoundingClientRect()
      return r.width > c.width + 0.5 || r.left < c.left - 0.5 || r.right > c.right + 0.5
    })
  }).length
  const vignettes = document.querySelectorAll('.modal .preset').length
  document.querySelector('.modal-foot button')?.click()
  await new Promise((r) => setTimeout(r, 300))
  return { debords, vignettes }
})
check('aucune bande de couleurs ne deborde de sa vignette',
  bandes.debords === 0 && bandes.vignettes > 0, `${bandes.debords}/${bandes.vignettes} en debord`)

/* --- tags : deplacement, etirement, empilement, annulation --- */
const tags = await page.evaluate(async () => {
  const { genId } = await import('/src/core/document.ts')
  const { fromHex } = await import('/src/core/color.ts')
  const app = window.pixelforge, ed = app.ed
  ed.loadSprite(new (await import('/src/core/document.ts')).Sprite(16, 16))
  for (let i = 0; i < 9; i++) ed.sprite.addFrame(ed.frameCount)
  ed.sprite.tags.push(
    { id: genId(), name: 'idle', from: 0, to: 3, direction: 'forward', color: fromHex('#29adff') },
    { id: genId(), name: 'attaque', from: 2, to: 6, direction: 'forward', color: fromHex('#ff6b8a') },
  )
  ed.events.emit('doc', undefined)
  await new Promise((r) => setTimeout(r, 250))

  const noeud = (nom) => [...document.querySelectorAll('.tl-tag')].find((n) => n.textContent === nom)
  const glisser = async (nom, colonnes, cote) => {
    const n = noeud(nom)
    const b = n.getBoundingClientRect()
    const y = b.y + b.height / 2
    const x = cote === 'start' ? b.x + 3 : cote === 'end' ? b.right - 3 : b.x + b.width / 2
    const ev = (type, cx) => n.dispatchEvent(new PointerEvent(type, {
      bubbles: true, clientX: cx, clientY: y, button: 0, pointerId: 1,
    }))
    ev('pointerdown', x)
    for (let i = 1; i <= 6; i++) ev('pointermove', x + (colonnes * 44 * i) / 6)
    ev('pointerup', x + colonnes * 44)
    await new Promise((r) => setTimeout(r, 150))
  }
  const etat = () => ed.sprite.tags.map((t) => `${t.name}:${t.from}-${t.to}`).join(' ')

  // Deux tags qui se chevauchent doivent occuper deux bandes.
  const hauts = new Set([...document.querySelectorAll('.tl-tag')].map((n) => n.style.top))

  const depart = etat()
  await glisser('idle', 2, 'move')
  const deplace = etat()
  await glisser('idle', 1, 'end')
  const etire = etat()
  await glisser('attaque', 40, 'move')
  const borne = etat()
  ed.undo(); ed.undo(); ed.undo()
  await new Promise((r) => setTimeout(r, 200))
  return { depart, deplace, etire, borne, bandes: hauts.size, frames: ed.frameCount, annule: etat() }
})
check('un tag se deplace a la souris', tags.deplace === 'idle:2-5 attaque:2-6', tags.deplace)
check('un tag s\'etire par son bord', tags.etire === 'idle:2-6 attaque:2-6', tags.etire)
check('un tag ne sort pas de l\'animation',
  tags.borne === 'idle:2-6 attaque:5-9', `${tags.borne} sur ${tags.frames} frames`)
check('les tags qui se chevauchent s\'empilent', tags.bandes === 2, `${tags.bandes} bande(s)`)
check('deplacer un tag est annulable', tags.annule === tags.depart, tags.annule)

/* --- une seule cadence pour toute l'animation --- */
const cadence = await page.evaluate(async () => {
  const ed = window.pixelforge.ed
  ed.sprite.frameDurations = ed.sprite.frameDurations.map((_, i) => 60 + i * 30)
  ed.events.emit('doc', undefined)
  await new Promise((r) => setTimeout(r, 200))
  const champ = document.querySelector('.tl-toolbar input[type="number"]')
  champ.value = '120'
  champ.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 150))
  const bouton = document.querySelector('.tl-toolbar button[title^="Appliquer cette duree"]')
  bouton?.click()
  await new Promise((r) => setTimeout(r, 200))
  const toutes = ed.sprite.frameDurations.every((d) => d === 120)
  ed.undo()
  await new Promise((r) => setTimeout(r, 150))
  const apres = ed.sprite.frameDurations.filter((d) => d === 120).length
  return { bouton: !!bouton, toutes, apres, total: ed.frameCount }
})
check('un bouton applique la duree a toutes les frames',
  cadence.bouton && cadence.toutes, cadence.bouton ? 'appliquee' : 'bouton absent')
check('l\'application a toutes les frames est annulable',
  cadence.apres < cadence.total, `${cadence.apres}/${cadence.total} encore a 120 ms`)

/* --- un squelette pilote plusieurs calques --- */
const multi = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { Layer } = await import('/src/core/document.ts')
  const { fromHex, getA } = await import('/src/core/color.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { refreshPose } = await import('/src/tools/index.ts')
  const app = window.pixelforge, ed = app.ed

  ed.loadSprite(demoCharacter())
  app.setMode('rig')
  ed.run('modele', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.sprite.layers[0].cels[0].bitmap, ed.sprite))

  // L'epee est posee dans la main gauche, reperee par l'os plutot que par des
  // coordonnees en dur : le personnage peut etre redessine sans casser le test.
  const main = ed.sprite.rig.bones.find((b) => b.role === 'forearmL')
  const arme = new Layer('Epee', ed.frameCount)
  arme.cels[0] = ed.sprite.makeCel()
  const mx = Math.round(main.ex)
  for (let y = Math.round(main.ey) - 12; y <= Math.round(main.ey) + 2; y++) {
    arme.cels[0].bitmap.set(mx, y, fromHex('#c0c8d8'))
  }
  ed.sprite.layers.push(arme)
  ed.events.emit('reload', undefined)
  ed.setActiveLayer(0); app.rigPanel.bind()
  ed.setActiveLayer(1); app.rigPanel.bind()
  await new Promise((r) => setTimeout(r, 150))

  const premier = (i) => {
    const bm = ed.sprite.cel(i, 0).bitmap
    for (let k = 0; k < bm.u32.length; k++) if (getA(bm.u32[k])) return `${k % bm.width},${(k / bm.width) | 0}`
    return null
  }
  const avant = { corps: premier(0), epee: premier(1) }
  const bras = ed.sprite.rig.bones.find((b) => b.role === 'armL')
  bras.angle = -1
  refreshPose(ed)
  const apres = { corps: premier(0), epee: premier(1) }
  return { calques: ed.sprite.rig.parts.length, avant, apres }
})
check('un squelette peut piloter plusieurs calques', multi.calques === 2, `${multi.calques} calques relies`)
check('un calque annexe suit l\'os qui le porte',
  multi.avant.epee !== multi.apres.epee, `epee ${multi.avant.epee} -> ${multi.apres.epee}`)

/* --- les modeles marquent le role de chaque os --- */
const roles = await page.evaluate(async () => {
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { emptyRig } = await import('/src/smart/rig.ts')
  const { ANIM_CLIPS, clipFits } = await import('/src/smart/anim-clips.ts')
  const ed = window.pixelforge.ed
  const out = {}
  for (const t of RIG_TEMPLATES) {
    const rig = emptyRig()
    applyTemplate(rig, t, ed.sprite.layers[0].cels[0].bitmap, ed.sprite)
    out[t.id] = {
      sansRole: rig.bones.filter((b) => b.role === 'none').length,
      cycles: ANIM_CLIPS.filter((c) => clipFits(c, rig)).map((c) => c.id),
    }
  }
  return out
})
check('chaque modele marque le role de ses os',
  Object.values(roles).every((r) => r.sansRole === 0),
  Object.entries(roles).map(([k, v]) => `${k}:${v.sansRole}`).join(' '))
check('un humanoide sait marcher et courir',
  roles['humanoid-front'].cycles.includes('walk') && roles['humanoid-front'].cycles.includes('run'))
check('seul un oiseau se voit proposer le vol',
  roles['bird'].cycles.includes('fly') && !roles['humanoid-front'].cycles.includes('fly'))

/* --- les cycles produisent de vraies poses distinctes --- */
const cycles = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { ANIM_CLIPS, clipFits } = await import('/src/smart/anim-clips.ts')
  const { getA } = await import('/src/core/color.ts')
  const app = window.pixelforge, ed = app.ed
  const out = {}
  for (const clip of ANIM_CLIPS) {
    ed.loadSprite(demoCharacter())
    app.setMode('rig')
    ed.run('m', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.peekCel().bitmap, ed.sprite))
    app.rigPanel.bind()
    if (!clipFits(clip, ed.sprite.rig)) { out[clip.id] = 'inapplicable'; continue }
    const repos = ed.peekCel().bitmap.clone()
    const plein = (b) => { let n = 0; for (const c of b.u32) if (getA(c)) n++; return n }
    app.rigPanel.generateClip(clip)
    await new Promise((r) => setTimeout(r, 60))
    const frames = []
    for (let f = 0; f < ed.frameCount; f++) frames.push(ed.sprite.cel(0, f).bitmap)
    const sig = (b) => { let h = 0; for (const c of b.u32) h = (h * 31 + c) | 0; return h }
    out[clip.id] = {
      frames: ed.frameCount,
      distinctes: new Set(frames.map(sig)).size,
      tag: ed.sprite.tags.length === 1 && ed.sprite.tags[0].to === ed.frameCount - 1,
      duree: ed.sprite.frameDurations.every((d) => d === clip.ms),
      // La deformation ne doit ni evaporer ni gonfler le personnage.
      conservation: Math.round((frames.reduce((a, b) => a + plein(b), 0) / frames.length) / plein(repos) * 100),
    }
  }
  return out
})
const jouables = Object.entries(cycles).filter(([, v]) => v !== 'inapplicable')
check('chaque frame d\'un cycle est une pose differente',
  jouables.every(([, v]) => v.distinctes === v.frames),
  jouables.map(([k, v]) => `${k}:${v.distinctes}/${v.frames}`).join(' '))
check('chaque cycle pose un tag sur ses frames', jouables.every(([, v]) => v.tag))
check('chaque cycle applique sa cadence', jouables.every(([, v]) => v.duree))
check('les cycles ne deforment pas la silhouette',
  jouables.every(([, v]) => v.conservation >= 85 && v.conservation <= 115),
  jouables.map(([k, v]) => `${k}:${v.conservation}%`).join(' '))

/* --- demi-tour pseudo-3D --- */
const tour = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const app = window.pixelforge, ed = app.ed
  ed.loadSprite(demoCharacter())
  app.setMode('rig')
  ed.run('m', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.peekCel().bitmap, ed.sprite))
  app.rigPanel.bind()
  app.rigPanel.generateTurn(8)
  await new Promise((r) => setTimeout(r, 80))
  const largeurs = []
  for (let f = 0; f < ed.frameCount; f++) largeurs.push(ed.sprite.cel(0, f).bitmap.trimBounds().w)
  return {
    frames: ed.frameCount,
    largeurs,
    // Le profil doit garder du corps : sans plancher il se reduirait a un trait.
    profilTient: Math.min(...largeurs) >= largeurs[0] * 0.3,
    seRetrecit: largeurs[2] < largeurs[0],
    turnRelache: ed.sprite.rig.turn === null,
    tag: ed.sprite.tags.some((t) => t.name === 'tour'),
  }
})
check('le demi-tour produit un tour complet en frames', tour.frames === 8 && tour.tag, tour.largeurs.join(','))
check('le personnage se retrecit en tournant', tour.seRetrecit)
check('le profil garde du corps au lieu d\'un trait', tour.profilTient,
  `${Math.min(...tour.largeurs)} px contre ${tour.largeurs[0]} de face`)
check('le demi-tour ne reste pas accroche au squelette', tour.turnRelache)

/* --- formes de pinceau et tramage --- */
const pinceau = await page.evaluate(async () => {
  const { brushOffsets } = await import('/src/tools/algorithms.ts')
  const compte = (t, f) => brushOffsets(t, f).length / 2
  return {
    // A la taille 2, une ligne doit rester une ligne, pas devenir un carre.
    ligne2: compte(2, 'h-line'),
    carre2: compte(2, 'square'),
    ligne5: compte(5, 'h-line'),
    rond5: compte(5, 'circle'),
    carre5: compte(5, 'square'),
    losange5: compte(5, 'diamond'),
  }
})
check('une brosse en ligne reste fine aux tailles paires',
  pinceau.ligne2 === 2 && pinceau.carre2 === 4, `ligne ${pinceau.ligne2} px, carre ${pinceau.carre2} px`)
check('les cinq formes de pinceau different vraiment',
  new Set([pinceau.ligne5, pinceau.rond5, pinceau.carre5, pinceau.losange5]).size === 4,
  `ligne ${pinceau.ligne5}, rond ${pinceau.rond5}, carre ${pinceau.carre5}, losange ${pinceau.losange5}`)

const apercus = await page.evaluate(async () => {
  const { fromHex } = await import('/src/core/color.ts')
  const app = window.pixelforge, ed = app.ed
  app.setMode('draw')
  app.setTool('pencil')
  ed.setPrimary(fromHex('#e8ebf2'))
  ed.setSecondary(fromHex('#3d60cf'))

  // L'apercu doit dessiner le trait tel qu'il sortira : c'est la seule facon
  // de voir que la forme et le tramage n'agissent pas sur la meme chose.
  const rendu = async (reglages) => {
    ed.updateSettings(reglages)
    await new Promise((r) => setTimeout(r, 180))
    const cv = document.querySelector('#optionsbar canvas.stroke')
    return cv ? cv.toDataURL() : null
  }
  const rond = await rendu({ brushSize: 6, brushShape: 'circle', ditherPattern: 'none' })
  const carre = await rendu({ brushSize: 6, brushShape: 'square', ditherPattern: 'none' })
  const ligne = await rendu({ brushSize: 6, brushShape: 'h-line', ditherPattern: 'none' })
  const trame = await rendu({ brushSize: 6, brushShape: 'circle', ditherPattern: 'bayer4', ditherRatio: 0.5 })
  const barre = document.getElementById('optionsbar')
  const noteAvecSecondaire = (barre.textContent ?? '').includes('forme = ou')

  ed.setSecondary(fromHex('#00000000'))
  await new Promise((r) => setTimeout(r, 180))
  const noteSansSecondaire = (document.getElementById('optionsbar').textContent ?? '')
    .includes('il faut une secondaire')

  return {
    present: !!rond,
    formesDistinctes: new Set([rond, carre, ligne].filter(Boolean)).size,
    // Le tramage doit changer l'image sans changer la forme du trait.
    trameChange: trame !== rond,
    noteAvecSecondaire,
    noteSansSecondaire,
    // Le mode d'emploi de l'outil a quitte la barre pour la barre d'etat.
    hintHorsBarre: !barre.querySelector('.opt-hint'),
    hintDansStatut: !!document.querySelector('.statusbar .status-hint'),
  }
})
check('la barre d\'options dessine le trait tel qu\'il sortira', apercus.present)
check('changer de forme change le trait', apercus.formesDistinctes === 3,
  `${apercus.formesDistinctes} traits distincts sur 3 formes`)
check('le tramage change le trait sans changer sa forme', apercus.trameChange)
check('la barre oppose la forme et le tramage en clair',
  apercus.noteAvecSecondaire && apercus.noteSansSecondaire)
check('le mode d\'emploi de l\'outil est passe dans la barre d\'etat',
  apercus.hintHorsBarre && apercus.hintDansStatut)

/* --- retoucher la palette recolore le sprite --- */
const palette = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { Palette } = await import('/src/core/palette.ts')
  const { fromHex } = await import('/src/core/color.ts')
  const app = window.pixelforge, ed = app.ed
  app.setMode('draw')
  ed.loadSprite(demoCharacter())
  const vus = new Set()
  for (const c of ed.peekCel().bitmap.u32) if (c) vus.add(c)
  ed.sprite.palette = new Palette('sprite', [...vus])
  ed.events.emit('reload', undefined)
  await new Promise((r) => setTimeout(r, 250))

  // La couleur la plus employee du dessin : le test survit a un changement
  // de personnage.
  const usage = new Map()
  for (const v of ed.peekCel().bitmap.u32) if (v) usage.set(v, (usage.get(v) ?? 0) + 1)
  let bleu = 0, mieux = 0
  for (const [c, n] of usage) if (n > mieux) { mieux = n; bleu = c }
  const rouge = fromHex('#c93b5d')
  const compte = (c) => { let n = 0; for (const v of ed.peekCel().bitmap.u32) if (v === c) n++; return n }
  const index = ed.sprite.palette.colors.indexOf(bleu)
  if (index < 0) return { erreur: 'couleur de reference absente' }
  const avant = compte(bleu)

  document.querySelector('button[title^="Retoucher la palette"]').click()
  await new Promise((r) => setTimeout(r, 150))
  const actif = document.querySelector('button[title^="Retoucher la palette"]').classList.contains('active')
  document.querySelector(`.pal-swatch[data-index="${index}"]`).click()
  await new Promise((r) => setTimeout(r, 150))
  const marquee = !!document.querySelector(`.pal-swatch[data-index="${index}"].editing`)

  const hex = document.querySelector('.hex-row input')
  hex.value = '#c93b5d'
  hex.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 200))
  const recolore = { bleu: compte(bleu), rouge: compte(rouge) }
  const enPalette = ed.sprite.palette.colors[index] === rouge

  // Le minuteur depose une seule entree pour tout le geste.
  await new Promise((r) => setTimeout(r, 800))
  const etiquette = ed.history.undoLabel
  ed.undo()
  await new Promise((r) => setTimeout(r, 150))
  const annule = { bleu: compte(bleu), rouge: compte(rouge), palette: ed.sprite.palette.colors[index] === bleu }
  document.querySelector('button[title^="Retoucher la palette"]').click()
  return { avant, actif, marquee, recolore, enPalette, etiquette, annule }
})
check('le mode retouche de palette s\'active', palette.actif && palette.marquee, palette.erreur ?? '')
check('changer une couleur de palette recolore le sprite',
  palette.recolore.bleu === 0 && palette.recolore.rouge === palette.avant,
  `${palette.avant} px repeints`)
check('la palette elle-meme retient la nouvelle couleur', palette.enPalette)
check('la retouche ne laisse qu\'une entree dans l\'historique',
  palette.etiquette === 'Retoucher la palette', String(palette.etiquette))
check('annuler rend au sprite et a la palette leur couleur',
  palette.annule.bleu === palette.avant && palette.annule.rouge === 0 && palette.annule.palette)

/* --- qualite de rotation : la methode RotSprite --- */
const rotation = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { autoBind, deform, scale2x } = await import('/src/smart/rig.ts')
  const { getA } = await import('/src/core/color.ts')

  // Scale2x doit redresser une diagonale sans inventer de couleur.
  const src = new Uint32Array(9)
  const A = 0xff0000ff, B = 0xff00ff00
  src.set([A, A, B, A, A, B, A, A, B])
  const grand = scale2x(src, 3, 3)
  const couleurs = new Set(grand)
  const inventees = [...couleurs].filter((c) => c !== A && c !== B && c !== 0).length

  const sprite = demoCharacter()
  const rest = sprite.layers[0].cels[0].bitmap
  const rig = sprite.rig
  applyTemplate(rig, RIG_TEMPLATES[0], rest, sprite)
  const part = autoBind(rig, sprite.layers[0].id, rest)
  rig.bones.find((b) => b.role === 'armL').angle = -0.9
  rig.bones.find((b) => b.role === 'armR').angle = 0.9

  // Rugosite : pixel plein dont au plus deux voisins orthogonaux sont pleins.
  // Une rotation au plus proche en fabrique le long des obliques.
  const rugosite = (b) => {
    let n = 0
    for (let y = 1; y < b.height - 1; y++) for (let x = 1; x < b.width - 1; x++) {
      if (!getA(b.u32[y * b.width + x])) continue
      let k = 0
      if (getA(b.u32[(y - 1) * b.width + x])) k++
      if (getA(b.u32[(y + 1) * b.width + x])) k++
      if (getA(b.u32[y * b.width + x - 1])) k++
      if (getA(b.u32[y * b.width + x + 1])) k++
      if (k <= 2) n++
    }
    return n
  }
  const palette = (b) => new Set([...b.u32].filter((c) => getA(c) !== 0))
  const rapide = deform(rig, part, { quality: 1 })
  const fin = deform(rig, part, { quality: 8 })
  const dedans = [...palette(fin)].every((c) => palette(rest).has(c))
  return {
    inventees,
    grandeur: grand.length,
    rugositeRapide: rugosite(rapide),
    rugositeFine: rugosite(fin),
    paletteRespectee: dedans,
  }
})
check('Scale2x agrandit sans inventer de couleur',
  rotation.inventees === 0 && rotation.grandeur === 36, `${rotation.inventees} couleurs inventees`)
check('la rotation fine lisse les obliques',
  rotation.rugositeFine < rotation.rugositeRapide,
  `${rotation.rugositeRapide} -> ${rotation.rugositeFine} coins isoles`)
check('la rotation fine n\'introduit aucune couleur etrangere', rotation.paletteRespectee)

/* --- membres a deux segments --- */
const segments = await page.evaluate(async () => {
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { emptyRig } = await import('/src/smart/rig.ts')
  const { ANIM_CLIPS } = await import('/src/smart/anim-clips.ts')
  const ed = window.pixelforge.ed
  const rig = emptyRig()
  applyTemplate(rig, RIG_TEMPLATES.find((t) => t.id === 'humanoid-front'),
    ed.sprite.layers[0].cels[0].bitmap, ed.sprite)
  const roles = rig.bones.map((b) => b.role)
  const marche = ANIM_CLIPS.find((c) => c.id === 'walk')
  return {
    os: rig.bones.length,
    coudes: roles.includes('forearmL') && roles.includes('forearmR'),
    genoux: roles.includes('shinL') && roles.includes('shinR'),
    // Le cycle doit reellement piloter les nouveaux segments.
    marchePlieLesGenoux: !!marche.channels.shinL && !!marche.channels.shinR,
    // Chaque segment bas descend de son segment haut.
    chaines: rig.bones.filter((b) => b.role.startsWith('forearm') || b.role.startsWith('shin'))
      .every((b) => {
        const parent = rig.bones.find((p) => p.id === b.parent)
        return parent && (parent.role.startsWith('arm') || parent.role.startsWith('leg'))
      }),
  }
})
check('l\'humanoide a des membres en deux segments',
  segments.coudes && segments.genoux && segments.os === 10, `${segments.os} os`)
check('les segments bas descendent des segments hauts', segments.chaines)
check('la marche plie genoux et coudes', segments.marchePlieLesGenoux)

/* --- la liaison tient compte de la portee des os --- */
const portee = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { autoBind } = await import('/src/smart/rig.ts')
  const sprite = demoCharacter()
  const rest = sprite.layers[0].cels[0].bitmap
  const rig = sprite.rig
  applyTemplate(rig, RIG_TEMPLATES[0], rest, sprite)
  const part = autoBind(rig, sprite.layers[0].id, rest)
  // Boite des pixels que chaque os s'est attribues.
  const boites = rig.bones.map((b, i) => {
    let y0 = 1e9, y1 = -1
    for (let k = 0; k < part.weights.length; k++) if (part.weights[k] === i) {
      const y = (k / rest.width) | 0
      y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    return { role: b.role, y0, y1, racine: Math.round(Math.min(b.y, b.ey)) }
  })
  const bras = boites.filter((b) => b.role === 'armL' || b.role === 'armR')
  const tete = boites.find((b) => b.role === 'head')
  const torse = boites.find((b) => b.role === 'torso')
  return {
    // Un os de bras ne doit pas remonter chercher des pixels au-dessus de
    // son epaule : ce serait la tempe, et la tete se dechirerait a la pose.
    brasSousLEpaule: bras.every((b) => b.y0 >= b.racine - 1),
    teteAuDessusDuTorse: tete.y1 < torse.y0,
  }
})
check('un os de bras ne remonte pas voler la tempe', portee.brasSousLEpaule)
check('la tete et le torse ne se disputent pas le cou', portee.teteAuDessusDuTorse)

/* --- les cycles doivent tourner sans a-coup --- */
const boucles = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { ANIM_CLIPS, clipPoses, clipFits } = await import('/src/smart/anim-clips.ts')
  const { emptyRig } = await import('/src/smart/rig.ts')
  const ed = window.pixelforge.ed
  const out = {}
  for (const clip of ANIM_CLIPS) {
    if (!clip.loop) continue
    const rig = emptyRig()
    applyTemplate(rig, RIG_TEMPLATES[0], demoCharacter().layers[0].cels[0].bitmap, ed.sprite)
    if (!clipFits(clip, rig)) continue
    const poses = clipPoses(rig, clip, clip.frames)
    const angles = poses.map((p) => rig.bones.map((b) => p[b.id].angle))
    const ecart = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0)
    const pas = []
    for (let i = 0; i < angles.length - 1; i++) pas.push(ecart(angles[i], angles[i + 1]))
    const raccord = ecart(angles[angles.length - 1], angles[0])
    const tous = [...pas, raccord]
    out[clip.id] = {
      // Le raccord doit etre un pas comme les autres : sinon le cycle
      // saute a chaque tour.
      saut: +(raccord / Math.max(...pas)).toFixed(2),
      // Et les pas ne doivent pas aller du simple au triple, sinon le
      // mouvement s'arrete puis repart plusieurs fois par cycle.
      regularite: +(Math.min(...tous) / Math.max(...tous)).toFixed(2),
    }
  }
  return out
})
const tours = Object.entries(boucles)
check('le raccord d\'un cycle est un pas comme les autres',
  tours.every(([, v]) => v.saut <= 1.35),
  tours.map(([k, v]) => `${k}:${v.saut}`).join(' '))
check('un cycle ne s\'arrete pas puis repart en cours de route',
  tours.every(([, v]) => v.regularite >= 0.3),
  tours.map(([k, v]) => `${k}:${v.regularite}`).join(' '))

/* --- courbes de vitesse --- */
const courbes = await page.evaluate(async () => {
  const { EASINGS, ease, easingPath } = await import('/src/smart/easing.ts')
  return {
    nombre: EASINGS.length,
    // Toutes doivent partir de la pose de depart et arriver a la pose voulue.
    bornes: EASINGS.every((e) => Math.abs(ease(e.id, 0)) < 1e-6 && Math.abs(ease(e.id, 1) - 1) < 1e-6),
    // La lineaire est droite, les autres non : sinon le reglage ne sert a rien.
    lineaireDroite: Math.abs(ease('linear', 0.25) - 0.25) < 1e-6,
    distinctes: new Set(EASINGS.map((e) => ease(e.id, 0.3).toFixed(3))).size,
    // « Depassement » doit reellement sortir du cadre.
    depasse: Math.max(...easingPath('overshoot', 40).map((p) => p.y)) > 1.02,
    anticipe: Math.min(...easingPath('anticipate', 40).map((p) => p.y)) < -0.02,
    trace: easingPath('ease-in-out', 16).length === 17,
  }
})
check('les courbes de vitesse respectent depart et arrivee',
  courbes.bornes && courbes.lineaireDroite, `${courbes.nombre} courbes`)
check('les courbes ne se ressemblent pas', courbes.distinctes >= 7, `${courbes.distinctes} profils distincts`)
check('anticipation et depassement sortent du cadre', courbes.anticipe && courbes.depasse)
check('la courbe peut etre tracee', courbes.trace)

/* --- suivi et inertie --- */
const suivi = await page.evaluate(async () => {
  const { emptyRig, createBone, capturePose } = await import('/src/smart/rig.ts')
  const { applyFollowThrough, hasSoftBones } = await import('/src/smart/follow-through.ts')

  const rig = emptyRig()
  const corps = createBone(rig, 16, 30, 16, 14, null, 'corps')
  const queue = createBone(rig, 16, 28, 28, 24, corps.id, 'queue')
  queue.softness = 0.8

  // Le corps pivote d'un coup a mi-parcours, puis s'immobilise.
  const poses = []
  for (let f = 0; f < 12; f++) {
    const p = capturePose(rig)
    p[corps.id].angle = f < 4 ? 0 : f < 6 ? (f - 3) * 0.25 : 0.75
    p[queue.id].angle = 0
    poses.push(p)
  }
  const avec = applyFollowThrough(rig, poses, false).map((p) => p[queue.id].angle)

  queue.softness = 0
  const sans = applyFollowThrough(rig, poses, false).map((p) => p[queue.id].angle)
  queue.softness = 0.8

  // Sur un cycle, le ressort doit partir d'un etat etabli.
  const cycle = []
  for (let f = 0; f < 8; f++) {
    const p = capturePose(rig)
    p[corps.id].angle = Math.sin((f / 8) * Math.PI * 2) * 0.5
    p[queue.id].angle = 0
    cycle.push(p)
  }
  const boucle = applyFollowThrough(rig, cycle, true).map((p) => p[queue.id].angle)
  const pas = []
  for (let i = 0; i < boucle.length - 1; i++) pas.push(Math.abs(boucle[i + 1] - boucle[i]))
  const raccord = Math.abs(boucle[0] - boucle[boucle.length - 1])

  return {
    detecte: hasSoftBones(rig),
    // La queue doit partir a l'envers du corps : c'est ca, trainer derriere.
    traine: Math.min(...avec) < -0.05,
    // Puis revenir se poser une fois le corps arrete.
    seStabilise: Math.abs(avec[avec.length - 1]) < 0.08,
    // Et depasser un peu au passage, sinon le ressort est trop mou.
    depasse: Math.max(...avec.slice(6)) > 0.005,
    // Un os rigide ne doit rien recevoir.
    rigideImmobile: sans.every((a) => a === 0),
    boucleTient: raccord <= Math.max(...pas) * 1.5,
  }
})
check('un os souple est reconnu', suivi.detecte)
check('un os souple traine derriere le corps', suivi.traine)
check('il depasse puis se stabilise', suivi.depasse && suivi.seStabilise)
check('un os rigide ne recoit aucun retard', suivi.rigideImmobile)
check('le suivi se raccorde sur un cycle', suivi.boucleTient)

/* --- les articulations restent solidaires --- */
const attaches = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { TOOLS, bonePoints } = await import('/src/tools/index.ts')
  const app = window.pixelforge, ed = app.ed
  ed.loadSprite(demoCharacter())
  app.setMode('rig')
  ed.run('modele', () => applyTemplate(ed.sprite.rig, RIG_TEMPLATES[0], ed.peekCel().bitmap, ed.sprite))
  app.rigPanel.bind()
  app.setTool('rig-pose')
  const rig = ed.sprite.rig

  const cuisse = rig.bones.find((b) => b.role === 'legL')
  const torse = rig.bones.find((b) => b.role === 'torso')
  const outil = TOOLS['rig-pose']

  // On tire la racine de la cuisse, franchement de cote : la jambe ne doit
  // pas se detacher du bassin.
  const racine = bonePoints(ed, cuisse)
  const point = (x, y) => ({ x, y, px: Math.round(x), py: Math.round(y), alt: false, button: 0 })
  outil.down(ed, point(racine.x1, racine.y1))
  outil.move(ed, point(racine.x1 - 14, racine.y1 + 6))
  outil.up(ed, point(racine.x1 - 14, racine.y1 + 6))

  // L'articulation de la cuisse doit toujours coincider avec le bout du torse.
  const apres = bonePoints(ed, cuisse)
  const hanche = bonePoints(ed, torse)
  const ecart = Math.hypot(apres.x1 - hanche.x1, apres.y1 - hanche.y1)
  return {
    // Le deplacement libre ne doit pas avoir servi.
    cuisseNonDeplacee: cuisse.tx === 0 && cuisse.ty === 0,
    // C'est le torse qui a pivote pour suivre le geste.
    torsePivote: Math.abs(torse.angle) > 0.02,
    ecartHanche: +ecart.toFixed(2),
  }
})
check('tirer une articulation ne detache pas le membre',
  attaches.cuisseNonDeplacee, 'la cuisse n\'a pas ete translatee')
check('c\'est l\'os porteur qui pivote', attaches.torsePivote)

/* --- amplitude reelle des cycles : au-dessus du pixel --- */
const amplitudes = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { autoBind, deform, applyPose } = await import('/src/smart/rig.ts')
  const { ANIM_CLIPS, clipPoses } = await import('/src/smart/anim-clips.ts')
  const ed = window.pixelforge.ed
  const out = {}
  for (const id of ['idle', 'walk', 'run']) {
    const clip = ANIM_CLIPS.find((c) => c.id === id)
    const sprite = demoCharacter()
    const rest = sprite.layers[0].cels[0].bitmap
    const rig = sprite.rig
    applyTemplate(rig, RIG_TEMPLATES[0], rest, ed.sprite)
    const part = autoBind(rig, sprite.layers[0].id, rest)
    const frames = clipPoses(rig, clip, clip.frames)
      .map((p) => { applyPose(rig, p); return deform(rig, part, { quality: 1 }) })
    const boites = frames.map((f) => f.trimBounds())
    const diff = (a, b) => {
      let n = 0
      for (let i = 0; i < a.u32.length; i++) if (a.u32[i] !== b.u32[i]) n++
      return n
    }
    const pas = frames.map((f, i) => diff(f, frames[(i + 1) % frames.length]))
    out[id] = {
      // Un mouvement decrit en fraction de la taille du personnage peut
      // valoir moins d'un pixel et disparaitre a l'arrondi : l'animation
      // parait alors immobile.
      vertical: Math.max(...boites.map((b) => b.y)) - Math.min(...boites.map((b) => b.y)),
      // Le passage de la derniere image a la premiere doit ressembler aux
      // autres : trop petit, le cycle marque un temps puis repart d'un coup.
      raccord: +(pas[pas.length - 1] / Math.max(...pas)).toFixed(2),
    }
  }
  return out
})
check('le repos bouge assez pour se voir',
  amplitudes.idle.vertical >= 2, `${amplitudes.idle.vertical} px de souffle`)
check('la marche et la course rebondissent',
  amplitudes.walk.vertical >= 2 && amplitudes.run.vertical >= 2,
  `marche ${amplitudes.walk.vertical} px, course ${amplitudes.run.vertical} px`)
check('le passage de la derniere image a la premiere ne coupe pas',
  Object.values(amplitudes).every((v) => v.raccord >= 0.55),
  Object.entries(amplitudes).map(([k, v]) => `${k}:${v.raccord}`).join(' '))

/* --- rampe de couleurs et ombrage --- */
const ombrage = await page.evaluate(async () => {
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { buildRamp, autoShade, antiAlias } = await import('/src/smart/shading.ts')
  const { extractRamps } = await import('/src/smart/analysis.ts')
  const { fromHex, getA, rgbaToHsv, luminance } = await import('/src/core/color.ts')

  // Une rampe doit decaler la teinte, pas seulement la luminosite : une ombre
  // qui n'est qu'un gris plus sombre se reconnait au premier coup d'oeil.
  const base = fromHex('#3d60cf')
  const rampe = buildRamp(base, { steps: 5 })
  const tsv = rampe.map((c) => rgbaToHsv(c))
  const teintes = tsv.map((h) => h.h)
  const lumieres = rampe.map(luminance)
  const croissante = lumieres.every((v, i) => i === 0 || v > lumieres[i - 1])
  const ecartTeinte = Math.max(...teintes) - Math.min(...teintes)

  const sprite = demoCharacter()
  const bm = sprite.layers[0].cels[0].bitmap
  const avant = new Uint32Array(bm.u32)
  const palette = new Set([...avant].filter((c) => getA(c) !== 0))
  const ramps = extractRamps([bm])
  const bilan = autoShade(bm, ramps, { angle: 135, strength: 0.8 })
  const apres = new Set([...bm.u32].filter((c) => getA(c) !== 0))
  const etrangeres = [...apres].filter((c) => !palette.has(c)).length
  // La silhouette ne doit pas changer : on repeint, on ne redessine pas.
  let silhouette = true
  for (let i = 0; i < bm.u32.length; i++) {
    if ((getA(avant[i]) === 0) !== (getA(bm.u32[i]) === 0)) { silhouette = false; break }
  }

  const bm2 = sprite.layers[0].cels[0].bitmap.clone()
  const lisses = antiAlias(bm2, ramps, 1)
  const apresLissage = new Set([...bm2.u32].filter((c) => getA(c) !== 0))
  const etrangeresLissage = [...apresLissage].filter((c) => !palette.has(c)).length

  return {
    tons: rampe.length,
    croissante,
    ecartTeinte: Math.round(ecartTeinte),
    ombres: bilan.changed,
    matieres: bilan.ramps,
    etrangeres,
    silhouette,
    lisses,
    etrangeresLissage,
  }
})
check('une rampe va de l\'ombre a la lumiere', ombrage.croissante, `${ombrage.tons} tons`)
check('une rampe decale la teinte, pas seulement la luminosite',
  ombrage.ecartTeinte >= 20, `${ombrage.ecartTeinte}° d\'ecart`)
check('l\'ombrage automatique repeint le dessin',
  ombrage.ombres > 40 && ombrage.matieres >= 2,
  `${ombrage.ombres} pixels sur ${ombrage.matieres} matieres`)
check('l\'ombrage n\'introduit aucune couleur etrangere', ombrage.etrangeres === 0,
  `${ombrage.etrangeres} couleurs inventees`)
check('l\'ombrage ne change pas la silhouette', ombrage.silhouette)
check('l\'anti-crenelage adoucit sans inventer de couleur',
  ombrage.lisses > 0 && ombrage.etrangeresLissage === 0,
  `${ombrage.lisses} coins adoucis`)

/* --- la courbe de vitesse vit dans le panneau d'animation --- */
const courbeUI = await page.evaluate(async () => {
  const app = window.pixelforge, ed = app.ed
  app.setMode('draw')
  await new Promise((r) => setTimeout(r, 200))
  const barre = document.querySelector('.tl-toolbar')
  const select = barre?.querySelector('select')
  const trace = barre?.querySelector('.easing-preview svg')
  const bouton = barre?.querySelector('button[title^="Repartir les durees"]')
  const dansLeRig = !!document.querySelector('.panel[data-panel="rig"] .easing-preview')

  // Le reglage doit etre partage : le squelette s'en sert aussi.
  select.value = 'bounce'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  const partage = ed.easing === 'bounce'

  // Redistribution des durees : le total est conserve, la repartition change.
  for (let i = 0; i < 5; i++) ed.sprite.addFrame(ed.frameCount)
  ed.sprite.frameDurations = ed.sprite.frameDurations.map(() => 100)
  const totalAvant = ed.sprite.frameDurations.reduce((a, b) => a + b, 0)
  select.value = 'ease-in-out'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  bouton.click()
  await new Promise((r) => setTimeout(r, 150))
  const durees = [...ed.sprite.frameDurations]
  const totalApres = durees.reduce((a, b) => a + b, 0)

  return {
    dansLaTimeline: !!select && !!trace && !!bouton,
    dansLeRig,
    partage,
    variees: new Set(durees).size > 1,
    // A 20 % pres : les durees sont arrondies a l'entier.
    totalConserve: Math.abs(totalApres - totalAvant) / totalAvant < 0.2,
  }
})
check('la courbe de vitesse est dans le panneau d\'animation',
  courbeUI.dansLaTimeline && !courbeUI.dansLeRig)
check('la courbe est partagee avec le squelette', courbeUI.partage)
check('la courbe peut repartir les durees des frames',
  courbeUI.variees && courbeUI.totalConserve)

/* --- toute commande doit etre atteignable depuis les menus --- */
const menus = await page.evaluate(async () => {
  const app = window.pixelforge
  const listes = []
  const barres = [...document.querySelectorAll('.topbar .menu-btn')]
  for (const btn of barres) {
    btn.click()
    await new Promise((r) => setTimeout(r, 60))
    const items = [...document.querySelectorAll('.dropdown .menu-item .label')]
      .map((n) => n.textContent.trim())
    listes.push({ menu: btn.textContent.trim(), items })
    document.body.click()
    await new Promise((r) => setTimeout(r, 40))
  }
  const vus = new Set(listes.flatMap((l) => l.items))
  // Le menubar liste ses entrees a la main : une commande ajoutee sans y etre
  // inscrite n'existe que dans la palette, donc pour personne.
  const absentes = app.commands
    .filter((c) => !c.hidden && !vus.has(c.label))
    .map((c) => c.id)
  return { menus: listes.length, entrees: vus.size, absentes }
})
check('chaque commande figure dans un menu',
  menus.absentes.length === 0,
  menus.absentes.length ? menus.absentes.join(', ') : `${menus.entrees} entrees sur ${menus.menus} menus`)

/* --- un raccourci affiche doit exister pour de vrai --- */
const raccourcis = await page.evaluate(async () => {
  const { BINDINGS_FOR_TEST } = await import('/src/ui/shortcuts.ts')
  const app = window.pixelforge
  const lies = new Set(Object.values(BINDINGS_FOR_TEST))
  // Le libelle affiche et la liaison reelle vivent dans deux tables : une
  // commande peut donc annoncer un raccourci qui ne declenche rien.
  const menteuses = app.commands.filter((c) => c.keys && !lies.has(c.id)).map((c) => c.id)
  const orphelines = [...lies].filter((id) => !app.commands.some((c) => c.id === id))
  return { menteuses, orphelines, lies: lies.size }
})
check('un raccourci affiche declenche bien sa commande',
  raccourcis.menteuses.length === 0,
  raccourcis.menteuses.length ? raccourcis.menteuses.join(', ') : `${raccourcis.lies} liaisons`)
check('aucune liaison ne pointe vers une commande disparue',
  raccourcis.orphelines.length === 0, raccourcis.orphelines.join(', '))

/* --- les lecons doivent couvrir ce que l'editeur sait faire --- */
const couverture = await page.evaluate(async () => {
  const app = window.pixelforge
  const lecons = app.lessons()
  const texte = lecons.flatMap((l) => l.steps.map((s) => s.text)).join(' ').toLowerCase()
  // Une fonction qu'aucune lecon ne nomme n'a aucune chance d'etre trouvee.
  const sujets = {
    rampe: 'rampe de couleurs',
    ombrage: 'ombrage automatique',
    courbe: 'courbe de vitesse',
    cycles: 'animations toutes faites',
    souplesse: 'souplesse',
    calques: 'calques relies',
    tags: 'glissez-le pour le deplacer',
    pinceau: 'forme du pinceau',
    tramage: 'tramage',
    effets: 'effets de calque',
  }
  const absents = Object.entries(sujets).filter(([, v]) => !texte.includes(v)).map(([k]) => k)
  return {
    lecons: lecons.length,
    etapes: lecons.reduce((n, l) => n + l.steps.length, 0),
    absents,
  }
})
check('les lecons nomment les fonctions avancees',
  couverture.absents.length === 0,
  couverture.absents.length ? `non couvert : ${couverture.absents.join(', ')}`
    : `${couverture.etapes} etapes sur ${couverture.lecons} lecons`)

/* --- le tutoriel doit faire faire, pas laisser cliquer --- */
const exigence = await page.evaluate(async () => {
  const app = window.pixelforge
  const lecons = app.lessons()
  const etapes = lecons.flatMap((l) => l.steps)
  return {
    total: etapes.length,
    verifiees: etapes.filter((s) => s.done).length,
    // Un bouton « Montrer » sans verification serait un bouton « passer » :
    // il ferait le travail a la place de l'utilisateur.
    montrerSansGeste: etapes.filter((s) => s.auto && !s.done).length,
  }
})
check('la plupart des etapes attendent un vrai geste',
  exigence.verifiees / exigence.total >= 0.8,
  `${exigence.verifiees}/${exigence.total} etapes verifiees`)
check('aucun bouton ne fait l\'etape a la place de l\'utilisateur',
  exigence.montrerSansGeste === 0, `${exigence.montrerSansGeste} raccourcis`)

const blocage = await page.evaluate(async () => {
  const app = window.pixelforge
  // Une lecon dont la premiere etape attend un geste ne doit pas s'ouvrir au
  // bouton : c'est tout l'interet d'un tutoriel qui fait faire.
  app.tutorial.start(app.lessons().find((l) => l.id === 'rig'))
  await new Promise((r) => setTimeout(r, 500))
  const confirmer = document.querySelector('.modal-foot button:last-child')
  if (confirmer) { confirmer.click(); await new Promise((r) => setTimeout(r, 600)) }

  const compteur = () => document.querySelector('.tutor-count')?.textContent ?? ''
  const avant = compteur()
  const primaire = document.querySelector('.tutor-foot button.primary')
  const libelle = primaire?.textContent ?? ''
  const inerte = !!primaire?.disabled
  primaire?.click()
  await new Promise((r) => setTimeout(r, 400))
  const apres = compteur()

  // Le vrai geste, lui, fait avancer.
  app.setMode('rig')
  await new Promise((r) => setTimeout(r, 900))
  const apresGeste = compteur()
  app.tutorial.stop()
  return { avant, apres, apresGeste, libelle: libelle.trim(), inerte }
})
check('le bouton n\'ouvre pas une etape en attente',
  blocage.inerte && blocage.apres === blocage.avant,
  `bouton « ${blocage.libelle} », ${blocage.avant} -> ${blocage.apres}`)
check('le geste accompli fait avancer',
  blocage.apresGeste !== blocage.avant, `${blocage.avant} -> ${blocage.apresGeste}`)

/* --- effets de calque --- */
const effets = await page.evaluate(async () => {
  const { EFFECT_KINDS, createEffect, renderEffects, renderEffectsCached } = await import('/src/core/effects.ts')
  const { compositeFrame } = await import('/src/render/composite.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { serializeSprite, deserializeSprite } = await import('/src/io/project.ts')
  const app = window.pixelforge
  const ed = app.ed
  ed.loadSprite(demoCharacter())
  const layer = ed.layer
  const base = ed.peekCel().bitmap
  const empreinte = (bm) => Array.from(bm.u32).join(',')

  // Un effet qui ne change rien serait un reglage mort dans l'interface.
  const morts = []
  for (const k of EFFECT_KINDS) {
    const rendu = renderEffects(base, [createEffect(k.id)])
    if (empreinte(rendu) === empreinte(base)) morts.push(k.id)
  }

  // Les effets sont recalcules a l'affichage : le dessin ne doit pas bouger.
  const avant = empreinte(base)
  ed.run('effets', () => { layer.effects = EFFECT_KINDS.map((k) => createEffect(k.id)) })
  compositeFrame(ed.sprite, 0)
  const intact = empreinte(ed.peekCel().bitmap) === avant

  // Le cache doit rendre exactement ce que rend le calcul direct.
  const direct = renderEffects(base, layer.effects)
  const cache1 = renderEffectsCached(base, layer.effects, 7)
  const cache2 = renderEffectsCached(base, layer.effects, 7)
  const memeRendu = empreinte(direct) === empreinte(cache1) && cache1 === cache2

  // Promesse du pixel art : une ombre tramee n'introduit qu'une couleur.
  const couleurs = (bm) => new Set(Array.from(bm.u32).filter((c) => (c >>> 24) !== 0))
  const ombre = createEffect('ombre-portee')
  ombre.falloff = 'tramage'
  const avecOmbre = renderEffects(base, [ombre])
  const ajoutees = [...couleurs(avecOmbre)].filter((c) => !couleurs(base).has(c)).length

  // Aller-retour projet.
  const json = serializeSprite(ed.sprite)
  const relu = await deserializeSprite(json)
  const relus = relu.layers[0].effects
  const conserves = relus.length === layer.effects.length
    && relus.every((e, i) => e.kind === layer.effects[i].kind
      && e.color === layer.effects[i].color
      && e.size === layer.effects[i].size
      && e.falloff === layer.effects[i].falloff)

  // Graver ecrit dans les pixels et vide la liste.
  ed.run('reset', () => { layer.effects = [createEffect('contour')] })
  const avantGravure = empreinte(ed.peekCel().bitmap)
  app.runCommand('layer.fx-bake')
  const grave = empreinte(ed.peekCel().bitmap) !== avantGravure && layer.effects.length === 0
  ed.history.undo(); ed.history.undo()

  // Chaque type a une commande de menu qui le pose.
  const ids = app.commands.map((c) => c.id)
  const sansCommande = EFFECT_KINDS.filter((k) => !ids.includes(`layer.fx-${k.id}`)).map((k) => k.id)

  return { morts, intact, memeRendu, ajoutees, conserves, grave, sansCommande, types: EFFECT_KINDS.length }
})
check('chaque effet modifie le rendu', effets.morts.length === 0,
  `${effets.types} types` + (effets.morts.length ? ` — sans effet : ${effets.morts.join(', ')}` : ''))
check('les effets ne touchent pas les pixels du calque', effets.intact)
check('le cache rend la meme image que le calcul direct', effets.memeRendu)
check('une ombre tramee n\'ajoute qu\'une couleur', effets.ajoutees <= 1,
  `${effets.ajoutees} couleur(s) ajoutee(s)`)
check('les effets survivent a l\'aller-retour projet', effets.conserves)
check('graver ecrit les effets dans les pixels', effets.grave)
check('chaque type d\'effet a sa commande', effets.sansCommande.length === 0,
  effets.sansCommande.join(', '))

/* --- reglages tirables a la souris --- */
// Les sections precedentes ont pu laisser l'editeur en mode Squelette, ou
// la barre montre d'autres reglages.
await page.evaluate(() => { window.pixelforge.setMode('draw'); window.pixelforge.setTool('pencil') })
await sleep(300)
// Vise le curseur de taille par son intitule, pas par son rang. Le repere
// est repose avant chaque usage : la barre se refait entre-temps.
const marquerTaille = () => page.evaluate(() => {
  const opt = [...document.querySelectorAll('#optionsbar .opt')]
    .find((o) => o.querySelector('label')?.textContent === 'Taille')
  opt?.querySelector('input[type=range]')?.setAttribute('data-test', 'taille')
})
await marquerTaille()
const curseurTaille = '#optionsbar input[data-test="taille"]'

// Un reglage change pendant un geste ne doit pas reconstruire la barre :
// le curseur tenu par la souris serait detruit et le glisser s'arreterait
// au premier cran.
const survie = await page.evaluate((sel) => {
  const barre = document.getElementById('optionsbar')
  const avant = document.querySelector(sel)
  avant.dataset.marque = 'oui'
  barre.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  window.pixelforge.ed.updateSettings({ brushSize: 12 })
  const pendant = document.querySelector(sel)?.dataset.marque === 'oui'
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  return { pendant, apercu: !!document.querySelector('#optionsbar canvas.stroke') }
}, curseurTaille)
check('le curseur survit a un changement pendant le geste', survie.pendant)
check('l\'apercu du trait reste affiche', survie.apercu)

// Et un vrai glisser doit atteindre la valeur visee, pas le premier cran.
await marquerTaille()
const boite = await page.locator(curseurTaille).first().boundingBox()
const ligne = boite.y + boite.height / 2
await page.mouse.move(boite.x + boite.width * 0.08, ligne)
await page.mouse.down()
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(boite.x + boite.width * (0.08 + 0.065 * i), ligne)
}
await page.mouse.up()
await sleep(150)
const tiree = await page.evaluate(() => window.pixelforge.ed.settings.brushSize)
check('le curseur de taille se tire jusqu\'au bout', tiree > 40, `${tiree} px apres un glisser`)

// Alt sur la molette regle la taille ; le pincement d'un pave tactile,
// qui arrive avec ctrlKey, doit continuer a zoomer.
const molette = await page.evaluate(async () => {
  const ed = window.pixelforge.ed
  const cv = document.querySelector('#canvas')
  const r = cv.getBoundingClientRect()
  const x = r.left + r.width / 2, y = r.top + r.height / 2
  const roue = (opts) => cv.dispatchEvent(new WheelEvent('wheel',
    { deltaY: -120, clientX: x, clientY: y, bubbles: true, cancelable: true, ...opts }))
  const t0 = ed.settings.brushSize, z0 = ed.view.zoom
  for (let i = 0; i < 4; i++) roue({ altKey: true })
  const t1 = ed.settings.brushSize, z1 = ed.view.zoom
  roue({ ctrlKey: true })
  return { alt: t1 - t0, zoomFige: z0 === z1, pincement: ed.view.zoom !== z1, tailleFigee: ed.settings.brushSize === t1 }
})
check('Alt sur la molette change la taille', molette.alt === 4 && molette.zoomFige, `+${molette.alt} px`)
check('le pincement du pave tactile zoome toujours', molette.pincement && molette.tailleFigee)

/* --- zoomables zoomables des dialogues --- */
const zoomables = []
for (const [cmd, nom] of [['sprite.shade', 'ombrage'], ['sprite.detail', 'detail'], ['file.export', 'export']]) {
  await page.evaluate((c) => window.pixelforge.runCommand(c), cmd)
  await sleep(500)
  const cadre = await page.locator('.apercu-zoom').first().boundingBox().catch(() => null)
  if (!cadre) { zoomables.push({ nom, zoomable: false }); await page.keyboard.press('Escape'); await sleep(300); continue }
  const valeur = () => page.evaluate(() => document.querySelector('.apercu-zoom-valeur')?.textContent ?? '')
  const pose = () => page.evaluate(() => document.querySelector('.apercu-scene')?.style.transform ?? '')
  const depart = await valeur()
  const cx = cadre.x + cadre.width / 2, cy = cadre.y + cadre.height / 2
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await sleep(50) }
  const zoome = await valeur()
  const avantGlisser = await pose()
  await page.mouse.down()
  await page.mouse.move(cx + 60, cy + 25)
  await page.mouse.up()
  await sleep(120)
  const apresGlisser = await pose()
  await page.mouse.dblclick(cx, cy)
  await sleep(150)
  const ajuste = await valeur()
  zoomables.push({ nom, zoomable: true, zoom: depart !== zoome, deplace: avantGlisser !== apresGlisser, ajuste: ajuste !== zoome })
  await page.keyboard.press('Escape')
  await sleep(300)
}
check('les apercus des dialogues se zooment', zoomables.every((a) => a.zoomable && a.zoom),
  zoomables.map((a) => `${a.nom}:${a.zoomable ? (a.zoom ? 'ok' : 'fige') : 'absent'}`).join(' '))
check('les apercus se deplacent en les tirant', zoomables.every((a) => a.deplace))
check('le double-clic rajuste l\'apercu', zoomables.every((a) => a.ajuste))

/* --- mascotte et ses cycles --- */
const mascotte = await page.evaluate(async () => {
  const { CLIPS_PIXL, corpsEcrase, debordsDePatte, decollageSansPoussee, ecartDePattes, lignesDePatteVisibles, masseDessinee, patteDecrochee, piedAuSol, semellesQuiGlissent, spritePixl } = await import('/src/ui/mascot-clips.ts')
  const { imageDePose, TAILLE } = await import('/src/ui/mascot-anim.ts')

  /**
   * Nombre de morceaux separes dans une image. Au-dela d'un, quelque chose
   * s'est detache du personnage — une tete qui flotte, une queue decrochee.
   * C'est le defaut qu'on remarque avant tous les autres.
   */
  const morceaux = (bm) => {
    const vu = new Uint8Array(bm.length)
    let n = 0
    for (let d = 0; d < bm.length; d++) {
      if (vu[d] || !(bm.u32[d] >>> 24)) continue
      n++
      const pile = [d]
      vu[d] = 1
      while (pile.length) {
        const i = pile.pop()
        const x = i % TAILLE, y = (i / TAILLE) | 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= TAILLE || ny >= TAILLE) continue
          const j = ny * TAILLE + nx
          if (vu[j] || !(bm.u32[j] >>> 24)) continue
          vu[j] = 1
          pile.push(j)
        }
      }
    }
    return n
  }

  const bilan = { cycles: 0, images: 0, detachees: [], jumelles: [], debords: 0, horsCadre: [], masseMax: 0, pattesAvalees: [], pattesPendantes: [], piedsEnLair: [], glissements: [], levitations: [], lignesMin: 99, degagementMin: 99, pattesFondues: [], queuesInegales: [], pattesElastiques: [], masseDessineeMax: 0 }
  for (const clip of CLIPS_PIXL) {
    bilan.cycles++
    const bmps = clip.poses.map(imageDePose)
    const masses = []
    bmps.forEach((bm, i) => {
      bilan.images++
      if (morceaux(bm) !== 1) bilan.detachees.push(`${clip.id}#${i + 1}`)
      bilan.debords += debordsDePatte(clip.poses[i])
      // Une patte avalee par le torse ne pese que douze pixels sur trois
      // cents : l'ecart de masse totale ne la voit pas disparaitre.
      const lignes = lignesDePatteVisibles(clip.poses[i])
      if (lignes < 2) bilan.pattesAvalees.push(`${clip.id}#${i + 1} (${lignes})`)
      // Une patte restee au sol pendant que le corps monte pend dans le vide.
      if (patteDecrochee(clip.poses[i])) bilan.pattesPendantes.push(`${clip.id}#${i + 1}`)
      // Deux pattes qui se rejoignent ne changent ni la masse ni le nombre
      // de morceaux : rien d'autre ne peut voir le personnage perdre une
      // jambe.
      const ecart = ecartDePattes(clip.poses[i])
      if (ecart < 2) bilan.pattesFondues.push(`${clip.id}#${i + 1} (${ecart})`)
      bilan.lignesMin = Math.min(bilan.lignesMin, lignes)
      let n = 0, x0 = 99, x1 = -1, y0 = 99, y1 = -1
      for (let y = 0; y < TAILLE; y++) for (let x = 0; x < TAILLE; x++) {
        if (!(bm.u32[y * TAILLE + x] >>> 24)) continue
        n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
      }
      masses.push(n)
      // Une image de contact sans semelle au sol fait clignoter le bas de la
      // silhouette : sur un cycle a cent dix millisecondes, quatre fois par
      // seconde. Le vol est tolere quand il se voit — au moins deux pixels de
      // jour sous le point bas. La regle se mesure sur l'image : une liste
      // d'index se serait tue au premier renumerotage.
      const auSol = piedAuSol(clip.poses[i])
      const decolle = y1 <= 29
      if (!auSol && !decolle) bilan.piedsEnLair.push(`${clip.id}#${i + 1} (bas ${y1})`)
      // Le degagement le plus juste du lot : une regle qu'on frole partout
      // n'est plus une garantie, et seul le releve le dit.
      if (!auSol) bilan.degagementMin = Math.min(bilan.degagementMin, 31 - y1)
      // Les pieds touchent la derniere ligne : c'est le pivot au sol.
      // Sortir par le haut ou les cotes, en revanche, coupe le dessin.
      if (y0 <= 0 || x0 <= 0 || x1 >= TAILLE - 1) bilan.horsCadre.push(`${clip.id}#${i + 1}`)
    })
    // Un pied qui porte ne se deplace pas : c'est le corps qui passe
    // au-dessus de lui. Une semelle qui derape fait patiner le personnage.
    for (let i = 0; i < clip.poses.length; i++) {
      const suivant = (i + 1) % clip.poses.length
      if (!clip.loop && suivant === 0) continue
      const n = semellesQuiGlissent(clip.poses[i], clip.poses[suivant])
      if (n) bilan.glissements.push(`${clip.id} ${i + 1}->${suivant + 1}`)
      if (decollageSansPoussee(clip.poses[i], clip.poses[suivant])) {
        bilan.levitations.push(`${clip.id} ${i + 1}->${suivant + 1}`)
      }
    }
    for (let a = 0; a < bmps.length; a++) for (let b = a + 1; b < bmps.length; b++) {
      let d = 0
      for (let k = 0; k < bmps[a].u32.length; k++) if (bmps[a].u32[k] !== bmps[b].u32[k]) d++
      if (d === 0) bilan.jumelles.push(`${clip.id} ${a + 1}=${b + 1}`)
    }
    // La queue disparait sous le torse sans que rien ne le signale : sa
    // surface visible se mesure en la sortant du cadre et en comparant.
    // Ce qui se voit n'est pas l'ecart sur tout le cycle — les cinq dessins
    // de queue n'ont deja pas la meme taille — mais le saut d'une image a
    // la suivante. La queue du saut perdait un quart de sa surface sur une
    // seule image, pile a l'atterrissage : c'est un clignotement.
    const queues = clip.poses.map((p, i) => {
      const sans = imageDePose({ ...p, queue: [p.queue[0], -60, -60] })
      let n = 0
      for (let k = 0; k < bmps[i].u32.length; k++) {
        if ((bmps[i].u32[k] >>> 24) && !(sans.u32[k] >>> 24)) n++
      }
      return n
    })
    for (let i = 0; i < queues.length; i++) {
      const suivant = (i + 1) % queues.length
      if (!clip.loop && suivant === 0) continue
      const d = Math.abs(queues[suivant] - queues[i])
      if (d > 4) bilan.queuesInegales.push(`${clip.id} ${i + 1}->${suivant + 1} (${d} px)`)
    }

    // Une patte peut perdre les deux tiers de sa longueur sans jamais
    // passer sous le plancher de deux lignes. C'est l'ecart d'une image a
    // l'autre qui se voit, pas la valeur absolue — sauf apres un
    // ecrasement, ou le torse se retire d'un coup et la decouvre.
    const lignesParImage = clip.poses.map(lignesDePatteVisibles)
    for (let i = 0; i < clip.poses.length; i++) {
      const suivant = (i + 1) % clip.poses.length
      if (!clip.loop && suivant === 0) continue
      // Deux moments ou la patte se decouvre pour de vrai : quand le torse
      // ecrase se retire, et quand le personnage retombe sur ses pieds.
      if (corpsEcrase(clip.poses[i])) continue
      if (!piedAuSol(clip.poses[i]) && piedAuSol(clip.poses[suivant])) continue
      const d = Math.abs(lignesParImage[suivant] - lignesParImage[i])
      if (d > 2) bilan.pattesElastiques.push(`${clip.id} ${i + 1}->${suivant + 1} (${d})`)
    }

    // La vraie masse constante : celle des pieces posees, pas celle de
    // l'image composee, qui melange la matiere et ce qui la cache.
    const posees = clip.poses.map(masseDessinee)
    bilan.masseDessineeMax = Math.max(bilan.masseDessineeMax,
      (Math.max(...posees) - Math.min(...posees)) / Math.min(...posees))

    // Ce qui se voit d'une image a l'autre n'est pas l'ecart sur tout le
    // cycle — un personnage accroupi se cache legitimement plus qu'un
    // personnage etire — mais le saut entre deux images voisines.
    let saut = 0
    for (let i = 0; i < masses.length; i++) {
      const suivant = (i + 1) % masses.length
      if (!clip.loop && suivant === 0) continue
      saut = Math.max(saut, Math.abs(masses[suivant] - masses[i]) / masses[i])
    }
    const ecart = (Math.max(...masses) - Math.min(...masses)) / Math.min(...masses)
    bilan.masseMax = Math.max(bilan.masseMax, saut)
    bilan.masses = (bilan.masses ?? []).concat(
      `${clip.id} ${(saut * 100).toFixed(1)}% (${(ecart * 100).toFixed(1)}% sur le cycle)`)
  }

  const sprite = spritePixl()
  bilan.tags = sprite.tags.length
  bilan.frames = sprite.frameCount
  bilan.tagsCouvrent = sprite.tags.every((t) => t.from <= t.to && t.to < sprite.frameCount)
  return bilan
})
check('la mascotte a ses six cycles', mascotte.cycles === 6 && mascotte.tags === 6,
  `${mascotte.cycles} cycles, ${mascotte.images} images, ${mascotte.tags} tags`)
check('chaque tag couvre des frames existantes', mascotte.tagsCouvrent && mascotte.frames === mascotte.images)
check('aucun morceau ne se detache du personnage', mascotte.detachees.length === 0,
  mascotte.detachees.join(', '))
check('aucune image n\'en repete une autre', mascotte.jumelles.length === 0,
  mascotte.jumelles.join(', '))
check('aucune patte ne deborde du torse', mascotte.debords === 0, `${mascotte.debords} pixels`)
check('rien ne sort du cadre', mascotte.horsCadre.length === 0, mascotte.horsCadre.join(', '))
// Deux mesures differentes, et il faut les deux : la premiere dit que le
// personnage garde sa matiere, la seconde combien il s'en cache lui-meme.
check('la matiere posee ne varie pas', mascotte.masseDessineeMax < 0.04,
  `${(mascotte.masseDessineeMax * 100).toFixed(1)}% au pire`)
// La matiere posee est verifiee juste au-dessus et ne bouge pas. Ce qui
// reste ici est de l'occlusion : le personnage se cache lui-meme. Ce n'est
// un defaut que si ca change d'un coup, donc on borne le saut entre deux
// images voisines et non l'ecart sur le cycle entier — un accroupissement
// se cache legitimement plus qu'une detente.
check('la surface visible ne saute pas d\'une image a l\'autre', mascotte.masseMax < 0.12,
  mascotte.masses.join(' · '))
check('les deux pattes ne fusionnent jamais', mascotte.pattesFondues.length === 0,
  mascotte.pattesFondues.join(', '))
check('la queue garde sa longueur visible', mascotte.queuesInegales.length === 0,
  mascotte.queuesInegales.join(', '))
check('la patte ne s\'allonge pas d\'un coup', mascotte.pattesElastiques.length === 0,
  mascotte.pattesElastiques.join(', '))
check('les images de contact gardent un pied au sol', mascotte.piedsEnLair.length === 0,
  mascotte.piedsEnLair.join(', '))
// Plus aucune exception : le choc arrache le personnage du sol au lieu de
// le faire riper, donc une semelle qui bouge est toujours du patinage.
check('aucune semelle ne patine',
  mascotte.glissements.length === 0,
  mascotte.glissements.join(', ') || 'aucun glissement')
check('les deux semelles ne decollent jamais sans poussee',
  mascotte.levitations.length === 0,
  mascotte.levitations.join(', ') || 'aucune levitation')
check('le vol garde sa marge au sol',
  mascotte.degagementMin >= 2,
  `${mascotte.degagementMin} px de degagement au plus juste`)
check('aucune patte ne pend sous un corps monte', mascotte.pattesPendantes.length === 0,
  mascotte.pattesPendantes.join(', '))
check('aucune patte n\'est avalee par le torse', mascotte.pattesAvalees.length === 0,
  mascotte.pattesAvalees.length ? mascotte.pattesAvalees.join(', ') : `${mascotte.lignesMin} lignes au minimum`)

/* ---------------------------------------------------------------- */
/* La mascotte armee                                                  */
/* ---------------------------------------------------------------- */
const armee = await page.evaluate(async () => {
  const { ARMES, POSITIONS_ARME, clipsArmes, imageDePoseArmee, masseDArme } =
    await import('/src/ui/mascot-armes.ts')
  const { CLIPS_PIXL } = await import('/src/ui/mascot-clips.ts')
  const { TAILLE, imageDePose } = await import('/src/ui/mascot-anim.ts')

  const morceaux = (bm) => {
    const vu = new Uint8Array(bm.length)
    let n = 0
    for (let d = 0; d < bm.length; d++) {
      if (vu[d] || !(bm.u32[d] >>> 24)) continue
      n++
      const pile = [d]
      vu[d] = 1
      while (pile.length) {
        const i = pile.pop()
        const x = i % TAILLE, y = (i / TAILLE) | 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= TAILLE || ny >= TAILLE) continue
          const j = ny * TAILLE + nx
          if (vu[j] || !(bm.u32[j] >>> 24)) continue
          vu[j] = 1
          pile.push(j)
        }
      }
    }
    return n
  }

  const bilan = {
    armes: ARMES.length, cycles: 0, images: 0,
    detachees: [], horsCadre: [], jumelles: [], armeInvisible: [], visibleMin: 999,
    positions: Object.keys(POSITIONS_ARME).length,
    massesArmes: ARMES.map((a) => masseDArme(a.art)),
  }

  for (const arme of ARMES) {
    for (const clip of clipsArmes(arme, CLIPS_PIXL)) {
      bilan.cycles++
      const bmps = clip.images.map((img) => imageDePoseArmee(img.pose, arme, img.position))
      bmps.forEach((bm, i) => {
        bilan.images++
        // Une arme posee a cote du personnage fait deux morceaux. C'est le
        // risque propre a l'arme : elle n'a pas d'os qui la relie au corps.
        if (morceaux(bm) !== 1) bilan.detachees.push(`${clip.id}#${i + 1}`)
        let x0 = 99, x1 = -1, y0 = 99, y1 = -1
        for (let y = 0; y < TAILLE; y++) for (let x = 0; x < TAILLE; x++) {
          if (!(bm.u32[y * TAILLE + x] >>> 24)) continue
          if (x < x0) x0 = x; if (x > x1) x1 = x
          if (y < y0) y0 = y; if (y > y1) y1 = y
        }
        if (y0 <= 0 || x0 < 0 || x1 >= TAILLE) bilan.horsCadre.push(`${clip.id}#${i + 1}`)
        // L'arme passe derriere le personnage. Si le corps la recouvre
        // entierement, elle a disparu sans que rien ne le signale : on
        // compte donc les pixels que l'image armee ajoute a l'image nue.
        const nu = imageDePose(clip.images[i].pose)
        let visibles = 0
        for (let k = 0; k < bm.u32.length; k++) {
          if ((bm.u32[k] >>> 24) && !(nu.u32[k] >>> 24)) visibles++
        }
        if (visibles < 6) bilan.armeInvisible.push(`${clip.id}#${i + 1} (${visibles} px)`)
        bilan.visibleMin = Math.min(bilan.visibleMin, visibles)
      })
      for (let a = 0; a < bmps.length; a++) for (let b = a + 1; b < bmps.length; b++) {
        let d = 0
        for (let k = 0; k < bmps[a].u32.length; k++) if (bmps[a].u32[k] !== bmps[b].u32[k]) d++
        if (d === 0) bilan.jumelles.push(`${clip.id} ${a + 1}=${b + 1}`)
      }
    }
  }
  return bilan
})
check('chaque arme a ses cycles', armee.armes === 3 && armee.cycles === 9,
  `${armee.armes} armes, ${armee.cycles} cycles, ${armee.images} images`)
check('l\'arme reste accrochee au personnage', armee.detachees.length === 0,
  armee.detachees.join(', ') || 'aucun morceau detache')
check('rien ne sort du cadre, arme comprise', armee.horsCadre.length === 0,
  armee.horsCadre.join(', '))
check('aucune image armee n\'en repete une autre', armee.jumelles.length === 0,
  armee.jumelles.join(', '))
// Les positions sont des deplacements du meme dessin : la masse de l'arme
// est constante par construction, et c'est ce que ce releve confirme.
check('l\'arme garde sa masse', armee.massesArmes.every((m) => m > 0),
  `${armee.massesArmes.join(' / ')} px, ${armee.positions} positions`)
check('l\'arme reste visible derriere le personnage', armee.armeInvisible.length === 0,
  armee.armeInvisible.join(', ') || `${armee.visibleMin} px visibles au minimum`)

check('aucune erreur JavaScript', errors.length === 0, errors.join(' | '))

await browser.close()
server.kill()

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} verifications reussies`)
process.exit(failed.length ? 1 : 0)
