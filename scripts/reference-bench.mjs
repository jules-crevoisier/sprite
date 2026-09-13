#!/usr/bin/env node
/**
 * Le banc des IMAGES DE RÉFÉRENCE.
 *
 * ## Le défaut qu'il garde
 *
 * La première version en faisait un calque de pixels : l'image était réduite à
 * la taille du sprite, gravée dans un bitmap, et posée là. Autant dire
 * détruite — une photo de quatre cents pixels de large ramenée dans un cadre
 * de trente-deux perd tout ce qui en faisait une référence — et surtout elle
 * ne bougeait plus. « C'est complètement moche », et c'était vrai.
 *
 * Une référence est donc une image posée DANS LA VUE, avec sa propre position
 * et sa propre échelle, comme un fond dans Blender ou un calque libre dans
 * Photoshop. Ce banc tient la géométrie de cette manipulation : les poignées,
 * le déplacement, le redimensionnement, les proportions — et le fait qu'elle
 * ne touche jamais au dessin.
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
  const { compositeFrame } = await import('/src/render/composite.ts')
  const { getA, rgba } = await import('/src/core/color.ts')
  const {
    referenceDepuisImage, poigneeRef, tirerRef, REF_MIN,
  } = await import('/src/core/reference.ts')
  const { serializeSprite, deserializeSprite } = await import('/src/io/project.ts')

  const out = {}

  /* 1. Cadrage d'entree : l'image entiere, centree, proportions gardees. */
  {
    const large = referenceDepuisImage('data:,', 'photo', 400, 100, 32, 32)
    const petite = referenceDepuisImage('data:,', 'timbre', 8, 8, 32, 32)
    out.entree = {
      large: [large.l, large.h, large.x, large.y],
      // Une image plus petite que le cadre garde sa taille : l'agrandir
      // d'office ferait croire a une image floue.
      petite: [petite.l, petite.h],
      opacite: large.opacite,
      dessous: large.dessous,
    }
  }

  /* 2. Les poignees. */
  {
    const r = { x: 10, y: 10, l: 20, h: 12 }
    const p = (x, y) => poigneeRef(r, x, y, 1)
    out.poignees = {
      hors: p(2, 2),
      corps: p(20, 16),
      no: p(10, 10), ne: p(30, 10), so: p(10, 22), se: p(30, 22),
      n: p(20, 10), s: p(20, 22), o: p(10, 16), e: p(30, 16),
    }
  }

  /* 3. Deplacer et redimensionner. */
  {
    const r = { x: 10, y: 10, l: 20, h: 10 }
    out.tirer = {
      corps: tirerRef(r, 'corps', 5, -3),
      est: tirerRef(r, 'e', 6, 0, true),
      ouest: tirerRef(r, 'o', 4, 0, true),
      // Un coin garde les proportions : 2 pour 1 au depart, 2 pour 1 apres.
      coin: tirerRef(r, 'se', 10, 0),
      // Maj : on deforme volontairement.
      libre: tirerRef(r, 'se', 10, 0, true),
      // Le coin nord-ouest ancre le coin oppose.
      ancre: tirerRef(r, 'no', -10, 0),
      // Et rien ne descend sous le minimum.
      ecrase: tirerRef(r, 'o', 1000, 0, true),
    }
  }

  /* 4. Elle ne touche pas au dessin, et ne s'exporte pas. */
  {
    const sprite = new Sprite(16, 16, new Palette('p', []))
    sprite.addLayer('Calque 1')
    const cel = sprite.ensureCel(0, 0)
    cel.bitmap.set(3, 3, rgba(255, 0, 0, 255))
    const avant = compositeFrame(sprite, 0).u32.reduce((n, c) => n + (getA(c) ? 1 : 0), 0)
    const calquesAvant = sprite.layers.length
    sprite.references.push(referenceDepuisImage('data:,', 'photo', 400, 100, 16, 16))
    const apres = compositeFrame(sprite, 0).u32.reduce((n, c) => n + (getA(c) ? 1 : 0), 0)
    out.export = { avant, apres, calquesAvant, calques: sprite.layers.length }
  }

  /* 5. L'aller-retour par le fichier de projet. */
  {
    const sprite = new Sprite(16, 16, new Palette('p', []))
    sprite.addLayer('Calque 1')
    const r = referenceDepuisImage('data:image/png;base64,AAAA', 'photo', 40, 20, 16, 16)
    r.x = 3.5
    r.opacite = 0.25
    r.dessous = false
    sprite.references.push(r)
    const relu = await deserializeSprite(serializeSprite(sprite))
    const q = relu.references[0]
    out.fichier = {
      combien: relu.references.length,
      memeSource: q?.source === r.source,
      memeX: q?.x === 3.5,
      memeOpacite: q?.opacite === 0.25,
      memeCote: q?.dessous === false,
    }
    const vieux = JSON.parse(serializeSprite(sprite))
    delete vieux.references
    out.fichier.ancien = (await deserializeSprite(JSON.stringify(vieux))).references.length
  }

  out.min = REF_MIN
  return out
})

console.log('\n--- l\'image entre dans la vue ---')
check('une image plus grande que le cadre y entre entière, centrée',
  m.entree.large[0] === 32 && m.entree.large[1] === 8
  && m.entree.large[2] === 0 && m.entree.large[3] === 12,
  `${m.entree.large[0]}×${m.entree.large[1]} en ${m.entree.large[2]},${m.entree.large[3]} `
  + 'pour une image 400×100 — proportions gardées')
check('une image plus petite garde sa taille',
  m.entree.petite[0] === 8 && m.entree.petite[1] === 8,
  'l\'agrandir d\'office ferait croire à une image floue')
check('elle arrive à demi transparente et sous le dessin',
  m.entree.opacite === 0.5 && m.entree.dessous === true,
  'on décalque par-dessus')

console.log('\n--- les poignées ---')
check('hors de l\'image, aucune poignée', m.poignees.hors === null)
check('au milieu, on déplace', m.poignees.corps === 'corps')
check('les quatre coins se distinguent',
  m.poignees.no === 'no' && m.poignees.ne === 'ne'
  && m.poignees.so === 'so' && m.poignees.se === 'se',
  [m.poignees.no, m.poignees.ne, m.poignees.so, m.poignees.se].join(' '))
check('et les quatre bords aussi',
  m.poignees.n === 'n' && m.poignees.s === 's'
  && m.poignees.o === 'o' && m.poignees.e === 'e',
  [m.poignees.n, m.poignees.s, m.poignees.o, m.poignees.e].join(' '))

console.log('\n--- déplacer, dimensionner ---')
check('tirer le corps déplace, sans redimensionner',
  m.tirer.corps.x === 15 && m.tirer.corps.y === 7
  && m.tirer.corps.l === 20 && m.tirer.corps.h === 10)
check('le bord est change la largeur, pas l\'origine',
  m.tirer.est.l === 26 && m.tirer.est.x === 10)
check('le bord ouest déplace l\'origine ET la largeur',
  m.tirer.ouest.x === 14 && m.tirer.ouest.l === 16,
  'sinon le bord gauche tiré vers la droite emmènerait toute l\'image')
check('un coin garde les proportions',
  Math.abs(m.tirer.coin.l / m.tirer.coin.h - 2) < 1e-6,
  `${m.tirer.coin.l}×${m.tirer.coin.h} — une référence déformée ne sert plus à rien`)
check('et Maj les libère, quand on le veut vraiment',
  m.tirer.libre.l === 30 && m.tirer.libre.h === 10)
check('le coin opposé reste ancré',
  Math.abs(m.tirer.ancre.x + m.tirer.ancre.l - 30) < 1e-6,
  `bord droit à ${m.tirer.ancre.x + m.tirer.ancre.l} — il était à 30`)
check('rien ne descend sous la taille minimale',
  m.tirer.ecrase.l === m.min, `${m.tirer.ecrase.l} px`)

console.log('\n--- elle ne touche pas au dessin ---')
check('l\'export ne change pas d\'un pixel',
  m.export.avant === m.export.apres && m.export.avant === 1,
  `${m.export.avant} pixel exporté avant, ${m.export.apres} après`)
check('et elle n\'ajoute aucun calque',
  m.export.calques === m.export.calquesAvant,
  `${m.export.calquesAvant} calque(s) avant et après — une référence n'est pas un calque`)

console.log('\n--- l\'aller-retour par le fichier ---')
check('la référence part dans le projet et en revient entière',
  m.fichier.combien === 1 && m.fichier.memeSource && m.fichier.memeX
  && m.fichier.memeOpacite && m.fichier.memeCote,
  'on rouvre son dessin avec le modèle qui l\'explique')
check('un projet enregistré avant qu\'elles existent se relit sans erreur',
  m.fichier.ancien === 0)

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
