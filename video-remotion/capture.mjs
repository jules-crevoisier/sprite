/**
 * Recolte des images du film, depuis l'application reelle.
 *
 * Le film ne redessine rien : chaque sprite affiche a l'ecran sort du moteur
 * de PixelForge, execute dans un vrai navigateur sur la vraie page. On lance
 * donc le serveur de developpement, on pilote l'editeur par son API
 * (window.pixelforge) et on ecrit le resultat dans public/, la ou Remotion
 * ira le chercher avec staticFile().
 *
 *   node capture.mjs [--port 5178]
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = join(ICI, '..')
const PUBLIC = join(ICI, 'public')

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
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

for (const d of ['sprite', 'ui']) {
  rmSync(join(PUBLIC, d), { recursive: true, force: true })
  mkdirSync(join(PUBLIC, d), { recursive: true })
}

const serveur = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
  cwd: RACINE, stdio: 'ignore',
})
process.on('exit', () => serveur.kill())
let vivant = false
for (let i = 0; i < 120; i++) {
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
await sleep(800)
await page.keyboard.press('Escape')
await sleep(300)

const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64')
const ecrire = (nom, dataUrl) => writeFileSync(join(PUBLIC, nom), png(dataUrl))

/* ------------------------------------------------------------------ */
/* 1. Tout ce que le moteur sait produire                              */
/* ------------------------------------------------------------------ */
console.log('recolte du moteur...')
const moteur = await page.evaluate(async () => {
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { demoCharacter, demoGrassBlock } = await import('/src/ui/demo-content.ts')
  const { ANIM_CLIPS, clipPoses, clipFits } = await import('/src/smart/anim-clips.ts')
  const rig0 = await import('/src/smart/rig.ts')
  const { autoBind, applyPose, capturePose, deform, resetPose, boneColor } = rig0
  const { applyFollowThrough } = await import('/src/smart/follow-through.ts')
  const { autoShade, antiAlias } = await import('/src/smart/shading.ts')
  const { extractRamps, RampIndex } = await import('/src/smart/analysis.ts')
  const { addDetail, DETAIL_MODES, DETAIL_PRESETS, applyPreset } = await import('/src/smart/detail.ts')
  const { generateVariants, applyMapping, STRATEGIES } = await import('/src/smart/variants.ts')
  const { EASINGS, easingPath } = await import('/src/smart/easing.ts')
  const { EFFECT_KINDS, createEffect, renderEffects } = await import('/src/core/effects.ts')
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const { toHex } = await import('/src/core/color.ts')
  const { buildSpriteSheet } = await import('/src/export/spritesheet.ts')
  const { buildAsepriteJson } = await import('/src/export/json.ts')
  const { buildUnityMeta } = await import('/src/export/unity.ts')
  const { buildGodotSpriteFrames } = await import('/src/export/godot.ts')
  const { encodeGif } = await import('/src/export/gif.ts')
  const { TOOL_LIST } = await import('/src/tools/index.ts')

  const versPng = (bm) => {
    const cv = document.createElement('canvas')
    cv.width = bm.width; cv.height = bm.height
    const img = new ImageData(new Uint8ClampedArray(bm.data), bm.width, bm.height)
    cv.getContext('2d').putImageData(img, 0, 0)
    return cv.toDataURL()
  }
  const hex = (c) => toHex(c)

  const ed = window.pixelforge.ed
  ed.loadSprite(demoCharacter())
  const sprite = ed.sprite
  const base = ed.peekCel().bitmap
  const out = { images: {}, data: {} }
  const pousser = (nom, bm) => { out.images[nom] = versPng(bm); return nom }

  /* --- le dessin de depart, pixel par pixel ------------------------ */
  // L'ouverture allume les pixels un a un : elle a donc besoin de la grille
  // reelle, pas d'une image. On indexe les couleurs pour rester compact.
  {
    const couleurs = []
    const index = new Map()
    const cases = []
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        const c = base.u32[y * base.width + x]
        if (!(c >>> 24)) { cases.push(-1); continue }
        let i = index.get(c)
        if (i === undefined) { i = couleurs.length; index.set(c, i); couleurs.push(hex(c)) }
        cases.push(i)
      }
    }
    out.data.grille = { w: base.width, h: base.height, couleurs, cases }
  }

  /* --- palette et rampes ------------------------------------------- */
  const rampes = extractRamps([base])
  out.data.palette = sprite.palette.colors.map(hex)
  out.data.rampes = rampes.slice().sort((a, b) => b.pixels - a.pixels).slice(0, 6)
    .map((r) => ({ nom: r.label ?? '', pixels: r.pixels, couleurs: r.colors.map(hex) }))

  /* --- outils reels de la barre ------------------------------------ */
  out.data.outils = TOOL_LIST.filter((t) => t.group === 'draw' || t.group === 'rig')
    .map((t) => ({ id: t.id, nom: t.name, raccourci: t.shortcut, icone: t.icon, groupe: t.group }))

  /* --- squelette --------------------------------------------------- */
  const rig = sprite.rig
  const modele = RIG_TEMPLATES.find((t) => t.id === 'humanoid-front') ?? RIG_TEMPLATES[0]
  applyTemplate(rig, modele, base, sprite)
  rig.parts = [autoBind(rig, 0, base)]
  const part = rig.parts[0]
  const repos = capturePose(rig)
  out.data.modeleOs = { id: modele.id, label: modele.label ?? modele.id }
  out.data.os = rig.bones.map((b, i) => ({
    nom: b.name, role: b.role, parent: b.parent,
    x: b.x, y: b.y, ex: b.ex, ey: b.ey, couleur: boneColor(i),
  }))

  // Carte des poids : quel os commande quel pixel. C'est la lecture la plus
  // directe de la liaison, et elle sort telle quelle de la structure.
  {
    const w = base.width, h = base.height
    const carte = new Bitmap(w, h)
    const poids = part.weights
    for (let i = 0; i < w * h; i++) {
      if (!(base.u32[i] >>> 24)) continue
      const idx = poids && poids[i] !== undefined ? poids[i] : -1
      const couleur = boneColor(Math.max(0, idx))
      const r = parseInt(couleur.slice(1, 3), 16), g = parseInt(couleur.slice(3, 5), 16), b2 = parseInt(couleur.slice(5, 7), 16)
      carte.u32[i] = (255 << 24) | (b2 << 16) | (g << 8) | r
    }
    pousser('sprite/poids.png', carte)
  }

  pousser('sprite/repos.png', part.rest)
  out.data.sprite = { w: part.rest.width, h: part.rest.height }

  // Bornes communes a toutes les poses : sans elles, chaque cycle serait
  // cadre differemment et le personnage sauterait d'une sequence a l'autre.
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

  /* --- les cycles -------------------------------------------------- */
  out.data.clips = []
  const memoire = {}
  for (const clip of ANIM_CLIPS) {
    if (!clipFits(clip, rig)) continue
    let poses = clipPoses(rig, clip, clip.frames, repos)
    poses = applyFollowThrough(rig, poses, clip.loop) ?? poses
    const noms = []
    const bitmaps = []
    poses.forEach((pose, i) => {
      applyPose(rig, pose)
      const bm = deform(rig, part, { quality: 8, fillPasses: 2 })
      mesurer(bm)
      bitmaps.push(bm)
      noms.push(pousser(`sprite/${clip.id}-${String(i).padStart(2, '0')}.png`, bm))
    })
    applyPose(rig, repos)
    memoire[clip.id] = bitmaps
    out.data.clips.push({ id: clip.id, label: clip.label, hint: clip.hint, ms: clip.ms, loop: clip.loop, images: noms })
  }

  /* --- demi-tour pseudo-3D ----------------------------------------- */
  {
    const noms = []
    const N = 16
    for (let i = 0; i < N; i++) {
      // Un demi-tour complet : de face, de profil, de dos, et retour.
      rig.turn = { angle: (i / N) * Math.PI * 2, axis: base.width / 2 }
      const bm = deform(rig, part, { quality: 8, fillPasses: 2 })
      mesurer(bm)
      noms.push(pousser(`sprite/tour-${String(i).padStart(2, '0')}.png`, bm))
    }
    rig.turn = null
    out.data.tour = noms
  }

  /* --- courbes de vitesse ------------------------------------------ */
  out.data.courbes = EASINGS.map((e) => ({
    id: e.id, label: e.label, hint: e.hint, points: easingPath(e.id, 48),
  }))

  /* --- ombrage automatique et anti-crenelage ------------------------ */
  {
    pousser('sprite/ombre-avant.png', base)
    const copie = new Bitmap(base.width, base.height, new Uint8ClampedArray(base.data))
    // Reglage doux : a pleine force le visage se tache au lieu de prendre
    // du volume sur un sprite de cette taille.
    const bilan = autoShade(copie, rampes, { strength: 0.55, radius: 2 })
    pousser('sprite/ombre-apres.png', copie)
    const lisse = new Bitmap(copie.width, copie.height, new Uint8ClampedArray(copie.data))
    const touches = antiAlias(lisse, rampes, 0.7)
    pousser('sprite/ombre-lisse.png', lisse)
    out.data.ombrage = { touches: bilan.changed, matieres: bilan.ramps, lisses: touches }
  }

  /* --- variantes intelligentes -------------------------------------- */
  {
    const principale = rampes.slice().sort((a, b) => b.pixels - a.pixels)[0]
    out.data.strategies = STRATEGIES.map((s) => ({ id: s.id, label: s.label, hint: s.hint }))
    const variantes = generateVariants(principale, { strategy: 'hue', count: 6, saturation: 0.05, value: 0 }, sprite.palette)
    out.data.variantes = variantes.map((v, i) => {
      const copie = new Bitmap(base.width, base.height, new Uint8ClampedArray(base.data))
      applyMapping(copie, v.mapping)
      return {
        label: v.label,
        image: pousser(`sprite/variante-${i}.png`, copie),
        rampe: v.preview.map(hex),
      }
    })
  }

  /* --- generateur de detail ----------------------------------------- */
  {
    const herbe = demoGrassBlock()
    const bm = herbe.layers[0].cels[0].bitmap
    const index = new RampIndex(extractRamps([bm]))
    const etapes = [pousser('sprite/detail-0.png', bm)]
    const preset = DETAIL_PRESETS.find((p) => p.id === 'herbe') ?? DETAIL_PRESETS[0]
    const courant = new Bitmap(bm.width, bm.height, new Uint8ClampedArray(bm.data))
    preset.steps.forEach((etape, i) => {
      addDetail(courant, index, {
        mode: etape.mode ?? 'speckle', density: etape.density ?? 0.2,
        strength: etape.strength ?? 1, seed: 1234 + i * 977,
      })
      const fige = new Bitmap(courant.width, courant.height, new Uint8ClampedArray(courant.data))
      etapes.push(pousser(`sprite/detail-${i + 1}.png`, fige))
    })
    out.data.detail = {
      preset: preset.label,
      etapes,
      modes: preset.steps.map((s) => DETAIL_MODES.find((m) => m.id === s.mode)?.label ?? s.mode),
      taille: bm.width,
    }
    // Une matiere complete d'un seul geste, sur le meme bloc.
    const complet = new Bitmap(bm.width, bm.height, new Uint8ClampedArray(bm.data))
    applyPreset(complet, index, 'pierre', 77, 1)
    out.data.detail.pierre = pousser('sprite/detail-pierre.png', complet)
  }

  /* --- effets de calque non destructifs ------------------------------ */
  {
    out.data.effets = []
    for (const info of EFFECT_KINDS) {
      const effet = createEffect(info.id)
      const rendu = renderEffects(base, [effet])
      out.data.effets.push({
        id: info.id, label: info.label, hint: info.hint,
        image: pousser(`sprite/effet-${info.id}.png`, rendu),
        champs: info.fields.slice(0, 5),
      })
    }
    // Une pile : c'est la ou le caractere non destructif se voit, chaque
    // effet s'ajoutant sans jamais toucher les pixels du calque.
    const pile = ['contour', 'ombre-portee', 'lueur-externe', 'biseau', 'degrade']
      .map((k) => createEffect(k))
    const cumul = []
    for (let i = 1; i <= pile.length; i++) {
      cumul.push(pousser(`sprite/pile-${i}.png`, renderEffects(base, pile.slice(0, i))))
    }
    out.data.pile = { etapes: cumul, noms: pile.map((e) => e.kind) }
  }

  /* --- export game dev ----------------------------------------------- */
  {
    // On monte un vrai sprite anime a partir du cycle de marche, puis on le
    // fait passer par la chaine d'export : la planche, le JSON, le .meta
    // Unity et la ressource Godot sortent des memes fonctions que le bouton.
    const { Sprite, Layer } = await import('/src/core/document.ts')
    const marche = memoire['walk'] ?? memoire[Object.keys(memoire)[0]]
    const anime = new Sprite(base.width, base.height, sprite.palette)
    anime.name = 'perso_marche'
    const couche = new Layer('Personnage', marche.length)
    marche.forEach((bm, i) => { couche.cels[i] = { bitmap: bm, opacity: 255 } })
    anime.layers = [couche]
    anime.frameCount = marche.length
    anime.frameDurations = marche.map(() => 90)
    anime.tags = [{ name: 'marche', from: 0, to: marche.length - 1, direction: 'forward', color: 0 }]

    const planche = buildSpriteSheet(anime, { padding: 1, trim: false })
    pousser('sprite/planche.png', planche.bitmap)
    const json = buildAsepriteJson(anime, planche, 'perso_marche.png', 'hash')
    const unity = buildUnityMeta(anime, planche, '0123456789abcdef0123456789abcdef', {})
    const godot = buildGodotSpriteFrames(anime, planche, { resPath: 'res://perso_marche.png' })
    const gif = encodeGif(marche, anime.frameDurations)
    out.data.export = {
      planche: {
        w: planche.bitmap.width, h: planche.bitmap.height,
        cases: planche.frames.map((f) => ({ x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h })),
      },
      json: json.split('\n').slice(0, 14),
      unity: unity.split('\n').slice(0, 14),
      godot: godot.split('\n').slice(0, 14),
      gifOctets: gif.length,
      images: marche.length,
    }
  }

  resetPose(rig)
  applyPose(rig, repos)
  out.data.cadrage = {
    x: bornes.x0, y: bornes.y0,
    w: bornes.x1 - bornes.x0 + 1, h: bornes.y1 - bornes.y0 + 1,
  }
  return out
})

for (const [nom, url] of Object.entries(moteur.images)) ecrire(nom, url)
console.log(`  ${Object.keys(moteur.images).length} images du moteur`)

/* ------------------------------------------------------------------ */
/* 2. Les captures de l'interface                                      */
/* ------------------------------------------------------------------ */
console.log("recolte de l'interface...")
const capturer = async (nom, selecteur) => {
  const boite = selecteur ? await page.locator(selecteur).first().boundingBox() : null
  if (selecteur && !boite) { console.log(`  ${nom} : introuvable`); return false }
  await page.screenshot({ path: join(PUBLIC, 'ui', `${nom}.png`), clip: boite ?? undefined })
  console.log(`  ui/${nom}`)
  return true
}

// La couleur active commande la rampe montree dans le panneau : avec le
// blanc par defaut, les captures de couleur seraient grises.
await page.evaluate(async () => {
  const { fromHex } = await import('/src/core/color.ts')
  window.pixelforge.ed.setPrimary(fromHex('#3d60cf'))
})
await sleep(300)

await page.evaluate(() => window.pixelforge.setMode('draw'))
await sleep(500)
await capturer('app-dessin', null)
await capturer('outils', '.toolbar')
await capturer('options', '#optionsbar')
await capturer('couleurs', '#dock-right .panel[data-panel="color"]')
await capturer('palette', '#dock-right .panel[data-panel="palette"]')
await capturer('timeline', '.timeline')


await page.evaluate(() => window.pixelforge.setMode('rig'))
await sleep(700)
await capturer('app-squelette', null)
await capturer('panneau-os', '#dock-right .panel')

await page.evaluate(() => window.pixelforge.setMode('draw'))
await sleep(400)

// Les effets vivent dans le pied du panneau Calques : sans effet pose, ce
// pied n'affiche qu'une phrase vide, donc on en empile trois avant la photo.
await page.evaluate(async () => {
  const { createEffect } = await import('/src/core/effects.ts')
  const ed = window.pixelforge.ed
  const calque = ed.sprite.layers[ed.layerIndex ?? 0] ?? ed.sprite.layers[0]
  calque.effects = ['contour', 'ombre-portee', 'lueur-externe'].map((k) => createEffect(k))
  ed.events.emit('reload')
})
await sleep(600)
await capturer('calques', '#dock-right .panel[data-panel="layers"]')
await capturer('effets', '.fx-panel')

const dialogues = [
  ['sprite.ramp', 'dlg-rampe'], ['sprite.shade', 'dlg-ombrage'],
  ['sprite.variants', 'dlg-variantes'], ['sprite.detail', 'dlg-detail'],
  ['file.export', 'dlg-export'],
]
const dialoguesOk = []
for (const [cmd, nom] of dialogues) {
  try {
    await page.evaluate((c) => window.pixelforge.runCommand(c), cmd)
    await sleep(800)
    if (await capturer(nom, '.modal')) dialoguesOk.push(nom)
    await page.keyboard.press('Escape')
    await sleep(400)
  } catch (e) { console.log(`  dialogue ${nom} indisponible : ${e.message}`) }
}

const data = { ...moteur.data, dialogues: dialoguesOk }
writeFileSync(join(PUBLIC, 'data.json'), JSON.stringify(data, null, 1))
console.log(`ecrit public/data.json (${(JSON.stringify(data).length / 1024).toFixed(0)} ko)`)

await browser.close()
serveur.kill()
console.log('erreurs page :', erreurs.length ? erreurs : 'aucune')
