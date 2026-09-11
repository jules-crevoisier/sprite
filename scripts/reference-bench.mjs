#!/usr/bin/env node
/**
 * Le banc du CALQUE DE RÉFÉRENCE.
 *
 * Une image qu'on garde sous les yeux pour décalquer — une photo, un croquis
 * scanné, un dessin trouvé ailleurs. Trois choses la distinguent d'un calque
 * ordinaire, et les trois comptent :
 *
 * 1. elle est **ramenée dans le cadre**, proportions gardées. Collée au coin
 *    comme le fait l'import ordinaire, on n'en voit qu'un morceau de
 *    trente-deux pixels : autant dire rien ;
 * 2. elle **ne se peint pas**. Peindre dedans, ce serait dessiner dans
 *    quelque chose que personne ne verra jamais ;
 * 3. elle **ne s'exporte pas** — ni dans le PNG, ni dans la planche, ni dans
 *    le JSON. C'est la différence entre une référence et un calque.
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4800 + Math.floor(Math.random() * 150)
const URL = `http://127.0.0.1:${PORT}/`

let navigateur = null
try {
  for (const dossier of readdirSync('/opt/pw-browsers')) {
    if (/^chromium-\d+$/.test(dossier)) {
      navigateur = `/opt/pw-browsers/${dossier}/chrome-linux/chrome`
      break
    }
  }
} catch { /* installation locale */ }

const bilan = []
const check = (nom, ok, detail = '') => {
  bilan.push({ nom, ok: !!ok })
  console.log(`${ok ? '  ok  ' : ' ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`)
}

const serveur = spawn('node_modules/.bin/vite',
  ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
process.on('exit', () => serveur.kill())
let vivant = false
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(URL)).ok) { vivant = true; break } } catch { /* pas pret */ }
  await new Promise((r) => setTimeout(r, 250))
}
if (!vivant) { console.error('le serveur ne repond pas'); process.exit(1) }

const browser = await chromium.launch(navigateur ? { executablePath: navigateur } : {})
const page = await browser.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(URL, { waitUntil: 'networkidle' })

const m = await page.evaluate(async () => {
  const { Sprite } = await import('/src/core/document.ts')
  const { Palette } = await import('/src/core/palette.ts')
  const { referenceLayerFromImage } = await import('/src/io/import.ts')
  const { compositeFrame } = await import('/src/render/composite.ts')
  const { Editor } = await import('/src/core/editor.ts')
  const { getA, rgba } = await import('/src/core/color.ts')

  /** Une image large et basse : la mise a l'echelle doit garder ses proportions. */
  const image = async (l, h) => {
    const c = document.createElement('canvas')
    c.width = l
    c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#c03030'
    ctx.fillRect(0, 0, l, h)
    const img = new Image()
    img.src = c.toDataURL('image/png')
    await img.decode()
    return img
  }

  const out = {}
  const sprite = new Sprite(32, 32, new Palette('p', []))
  sprite.addLayer('Calque 1')
  const img = await image(400, 100)
  const ref = referenceLayerFromImage(sprite, img, 'photo')

  /* 1. Ramenee dans le cadre, proportions gardees, centree. */
  {
    const bm = ref.cels[0].bitmap
    let minX = 99, maxX = -1, minY = 99, maxY = -1
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (getA(bm.u32[y * 32 + x]) === 0) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    out.cadre = {
      taille: [bm.width, bm.height],
      large: maxX - minX + 1,
      haut: maxY - minY + 1,
      // Centree : autant de vide en haut qu'en bas.
      centree: Math.abs(minY - (31 - maxY)) <= 1,
      marque: ref.reference,
      opacite: ref.opacity,
    }
  }

  /* 2. Sur TOUTES les frames : une reference qui disparait a la frame deux
   *    ne sert a rien pour animer. */
  {
    const anime = new Sprite(32, 32, new Palette('p', []))
    anime.addLayer('Calque 1')
    anime.addFrame()
    anime.addFrame()
    const r2 = referenceLayerFromImage(anime, img, 'photo')
    out.frames = {
      combien: r2.cels.filter(Boolean).length,
      total: anime.frameCount,
      // Chaque frame a SON bitmap : un seul partage ferait qu'effacer l'une
      // les effacerait toutes.
      distincts: new Set(r2.cels.filter(Boolean).map((c) => c.bitmap)).size,
    }
  }

  /* 3. Elle ne s'exporte pas, mais elle se VOIT dans l'editeur. */
  {
    sprite.layers.unshift(ref)
    const dessus = sprite.layers[1]
    dessus.cels[0] = { bitmap: dessus.cels[0]?.bitmap ?? null, opacity: 255 }
    const exporte = compositeFrame(sprite, 0)
    const vue = compositeFrame(sprite, 0, { includeReference: true })
    const compte = (bm) => bm.u32.reduce((n, c) => n + (getA(c) ? 1 : 0), 0)
    out.export = { sansRef: compte(exporte), avecRef: compte(vue) }
  }

  /* 4. Elle ne se peint pas. */
  {
    const ed = new Editor(sprite)
    ed.setActiveLayer(0)
    out.peinture = {
      cel: ed.currentCel() === null,
      trait: ed.beginStroke('essai') === null,
    }
    // Le calque d'a cote, lui, se peint toujours.
    ed.setActiveLayer(1)
    out.peinture.voisin = ed.beginStroke('essai') !== null
    ed.cancelStroke()
  }

  return out
})

console.log('\n--- l\'image entre dans le cadre ---')
check('elle est ramenée à la taille du sprite',
  m.cadre.taille[0] === 32 && m.cadre.taille[1] === 32, m.cadre.taille.join('×'))
check('ses proportions sont gardées',
  m.cadre.large === 32 && m.cadre.haut === 8,
  `${m.cadre.large}×${m.cadre.haut} pour une image 400×100 — collée telle quelle, `
  + 'on n\'en aurait vu qu\'un coin')
check('et elle est centrée', m.cadre.centree)
check('le calque est marqué « référence », à demi transparent',
  m.cadre.marque && m.cadre.opacite === 128,
  'une référence opaque cacherait le trait qu\'on est en train de poser')

console.log('\n--- sur toutes les frames ---')
check('la référence est posée sur chaque frame',
  m.frames.combien === m.frames.total, `${m.frames.combien}/${m.frames.total}`)
check('avec un bitmap par frame, pas un seul partagé',
  m.frames.distincts === m.frames.total,
  'sinon effacer l\'une les effacerait toutes')

console.log('\n--- elle se voit, et ne s\'exporte pas ---')
check('l\'export l\'ignore', m.export.sansRef === 0, `${m.export.sansRef} pixels exportés`)
check('l\'éditeur la montre', m.export.avecRef > 0, `${m.export.avecRef} pixels à l\'écran`)

console.log('\n--- elle ne se peint pas ---')
check('aucune case à peindre sur un calque de référence', m.peinture.cel)
check('et le trait est refusé', m.peinture.trait,
  'peindre dedans, ce serait dessiner dans ce que personne ne verra')
check('le calque d\'à côté se peint toujours', m.peinture.voisin,
  'un refus trop large vaudrait mieux que pas de refus, mais pas de beaucoup')

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
