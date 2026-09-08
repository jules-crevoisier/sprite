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
  out.gestesExiges = lesson.steps.filter((s) => s.done && !s.auto).length
  await app.tutorial.start(lesson)
  out.carte = !!document.querySelector('.tutor-card:not([hidden])')

  const etape = () => document.querySelector('.tutor-count')?.textContent ?? ''
  const attendre = (predicat) => new Promise((resolve) => {
    const debut = Date.now()
    const timer = setInterval(() => {
      if (predicat() || Date.now() - debut > 2500) { clearInterval(timer); resolve() }
    }, 120)
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
  out.rigLie = !!ed.sprite.rig.rest

  suivant()
  await jusqua(6)
  const bras = ed.sprite.rig.bones.find((b) => b.name === 'bras G')
  bras.angle = -1
  refreshPose(ed)
  out.avance.push(await jusqua(7))
  out.rigPose = ed.sprite.rig.bones.some((b) => Math.abs(b.angle) > 0.05)

  suivant()
  out.avance.push(await jusqua(8))

  // Les deux dernieres etapes font faire l'aller-retour dessin / squelette.
  app.setMode('draw')
  out.avance.push(await jusqua(9))
  app.setMode('rig')
  out.avance.push(await jusqua(10))

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
  rigApi.autoBind(rig, rest)

  const index = (name) => rig.bones.findIndex((b) => b.name === name)
  const at = (x, y) => rig.weights[y * rest.width + x]
  // Chaque membre doit revenir a son propre os, pas a celui du voisin.
  const out = {
    brasG: at(13, 27) === index('bras G'),
    brasD: at(34, 27) === index('bras D'),
    torse: at(23, 27) === index('torse'),
    tete: at(23, 12) === index('tete'),
    jambeG: at(21, 41) === index('jambe G'),
    jambeD: at(26, 41) === index('jambe D'),
  }

  // Aucun pixel opaque ne doit rester sans os.
  out.tousLies = true
  for (let i = 0; i < rest.u32.length; i++) {
    if (getA(rest.u32[i]) !== 0 && rig.weights[i] === 255) { out.tousLies = false; break }
  }

  // Une pose franche ne doit pas ouvrir de fente dans la matiere.
  const by = (n) => rig.bones[index(n)]
  by('bras G').angle = -1.5
  by('bras D').angle = 1.5
  by('jambe G').angle = 0.4
  const posed = rigApi.deform(rig, { seamRadius: 1, seamNeighbours: 4, fillPasses: 1 })
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
  perso.brasG && perso.brasD && perso.torse && perso.tete && perso.jambeG && perso.jambeD,
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
  const arm = rig.bones.findIndex((b) => b.name === 'bras G')
  rigState.selected = rig.bones[arm].id
  app.setTool('rig-weight')
  const w = rig.rest.width
  const cible = 24 * w + 22
  const avant = rig.weights[cible]
  const tool = (await import('/src/tools/index.ts')).TOOLS['rig-weight']
  const at = (x, y) => ({ x, y, px: x, py: y, startPx: x, startPy: y, prevPx: x, prevPy: y, shift: false, alt: false, ctrl: false, button: 0, pressure: 1 })
  tool.down(ed, at(22, 24))
  tool.up(ed, at(22, 24))
  const apres = rig.weights[cible]
  ed.undo()
  const annule = rig.weights[cible]

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
check('les lecons sont disponibles', guided.lecons === 5, `${guided.lecons} lecons`)
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
  const bras = rig.bones.find((b) => b.name === 'bras G')
  bras.angle = 0.5
  refreshPose(ed)

  // Un pixel qui appartient au bras, dans la pose.
  const n = rig.rest.width * rig.rest.height
  const owners = new Uint8Array(n).fill(255)
  deform(rig, { ...seamSettings(rigState.seam), owners })
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
  for (let i = 0; i < rig.rest.u32.length; i++) {
    if (!estRouge(rig.rest.u32[i])) continue
    dansRepos++
    osPorteur = rig.bones[rig.weights[i]]?.name ?? 'libre'
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

check('aucune erreur JavaScript', errors.length === 0, errors.join(' | '))

await browser.close()
server.kill()

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} verifications reussies`)
process.exit(failed.length ? 1 : 0)
