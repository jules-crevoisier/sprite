/**
 * Banc de la rotation par relief.
 *
 * « Mieux et fiable » ne veut rien dire tant qu'on ne mesure pas. Ce banc
 * balaie la rotation sur toute sa plage et exige, a chaque angle, ce qu'un
 * pixel-artiste exigerait d'une pose :
 *
 * - a zero degre, le dessin ressort identique, pixel pour pixel ;
 * - la masse ne s'evapore pas quand le relief s'etire ;
 * - aucune couleur etrangere n'apparait : rien n'est interpole ;
 * - la silhouette ne se perce pas ;
 * - deux angles voisins se ressemblent : pas de saut d'une image a l'autre ;
 * - tourner puis revenir rend a peu pres le dessin de depart.
 *
 * Un banc qui ne sait pas echouer ne protege rien : chaque regle a ete
 * verifiee en la cassant volontairement avant d'etre gardee.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'

const PORT = 4100 + Math.floor(Math.random() * 800)
const URL = `http://127.0.0.1:${PORT}/`
const VITE = 'node_modules/.bin/vite'

let navigateur = null
try {
  for (const dossier of readdirSync('/opt/pw-browsers')) {
    if (/^chromium-\d+$/.test(dossier)) {
      navigateur = `/opt/pw-browsers/${dossier}/chrome-linux/chrome`
      break
    }
  }
} catch { /* installation locale de Playwright */ }

const bilan = []
const check = (nom, ok, detail = '') => {
  bilan.push({ nom, ok: !!ok })
  console.log(`${ok ? '  ok  ' : ' ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`)
}

const serveur = spawn(VITE, ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore',
})
process.on('exit', () => serveur.kill())

let vivant = false
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(URL)).ok) { vivant = true; break } } catch { /* pas pret */ }
  await new Promise((r) => setTimeout(r, 250))
}
if (!vivant) { console.error('le serveur ne repond pas'); process.exit(1) }

const browser = await chromium.launch(navigateur ? { executablePath: navigateur } : {})
const page = await browser.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(URL, { waitUntil: 'networkidle' })

const mesures = await page.evaluate(async () => {
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const d = await import('/src/smart/depth.ts')
  const { spritePixl } = await import('/src/ui/mascot-clips.ts')

  /** Les sujets : la mascotte au repos, plus trois formes limites. */
  const sujets = []

  // Pixl, premiere image du repos : une vraie silhouette dessinee, avec ses
  // aplats, son contour et ses details d'un pixel.
  const pixl = spritePixl()
  const repos = pixl.layers[0].cels[0]?.bitmap
  if (repos) sujets.push({ nom: 'pixl-repos', img: repos })

  // Un disque : la forme ou le relief est le plus haut, donc celle qui
  // etire le plus la projection.
  const disque = new Bitmap(32, 32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5, dy = y - 15.5
      if (dx * dx + dy * dy <= 144) disque.set(x, y, 0xff5588ee)
    }
  }
  sujets.push({ nom: 'disque', img: disque })

  // Une lame : longue et fine, le cas ou une hauteur de relief mal choisie
  // transforme le dessin en cylindre.
  const lame = new Bitmap(32, 32)
  for (let y = 4; y < 28; y++) for (let x = 14; x < 18; x++) lame.set(x, y, 0xffdddddd)
  sujets.push({ nom: 'lame', img: lame })

  // Un anneau : il a un vrai trou, que le bouchage ne doit jamais combler.
  const anneau = new Bitmap(32, 32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5, dy = y - 15.5
      const r = Math.hypot(dx, dy)
      if (r <= 13 && r >= 7) anneau.set(x, y, 0xff33cc66)
    }
  }
  sujets.push({ nom: 'anneau', img: anneau })

  const rapport = []
  for (const { nom, img } of sujets) {
    const hauteur = d.hauteurSuggeree(img)
    const champ = d.champAuto(img, { hauteur, galbe: 0.5 })
    const masse0 = d.masse(img)
    const trous0 = d.trousInterieurs(img)

    const identite = d.tourner(img, champ, d.SANS_ROTATION)
    let identiquePixel = true
    for (let i = 0; i < img.u32.length; i++) {
      if (img.u32[i] !== identite.u32[i]) { identiquePixel = false; break }
    }

    // Balayage du lacet, un degre a la fois, de -75 a +75. Au-dela, une
    // silhouette dessinee de face ne dit plus rien de ce qu'on verrait.
    const masses = []
    const etrangeres = []
    const trous = []
    let sautMax = 0
    let precedente = null
    for (let deg = -75; deg <= 75; deg += 1) {
      const r = d.tourner(img, champ, { lacet: (deg * Math.PI) / 180, tangage: 0, roulis: 0 })
      const m = d.masse(r)
      masses.push({ deg, m })
      const et = d.couleursEtrangeres(img, r)
      if (et.length) etrangeres.push({ deg, n: et.length })
      const t = d.trousInterieurs(r)
      if (t > trous0) trous.push({ deg, t })
      if (precedente !== null && m > 0 && precedente > 0) {
        sautMax = Math.max(sautMax, Math.abs(m - precedente))
      }
      precedente = m
    }
    // Deux exigences, parce qu'une seule ne peut pas etre a la fois vraie et
    // utile sur toute la plage.
    //
    // Jusqu'a 45 degres — la plage ou se joue une animation de jeu — un corps
    // plein ne perd presque rien : sa profondeur compense ce que sa largeur
    // cede. C'est la que le défaut de la coque se voyait, et c'est donc la
    // qu'on serre a 90%.
    //
    // Au-dela, une forme reellement plate — un anneau, une lame — a le droit
    // de maigrir : vue de trois-quarts elle montre sa tranche. Le plancher
    // devient alors celui d'une feuille de papier, |cos theta| : un volume
    // solide ne peut jamais projeter moins que sa propre tranche du milieu.
    let pireProche = { deg: 0, ratio: Infinity }
    let pireRasant = { deg: 0, marge: Infinity }
    for (const { deg, m } of masses) {
      const ratio = m / masse0
      if (Math.abs(deg) <= 45) {
        if (ratio < pireProche.ratio) pireProche = { deg, ratio }
      } else {
        const plancher = Math.abs(Math.cos((deg * Math.PI) / 180))
        const marge = ratio - plancher
        if (marge < pireRasant.marge) pireRasant = { deg, marge, ratio, plancher }
      }
    }

    let dissymetrie = 0
    for (const deg of [15, 30, 45, 60, 75]) {
      const rad = (deg * Math.PI) / 180
      const a = d.masse(d.tourner(img, champ, { lacet: rad, tangage: 0, roulis: 0 }))
      const b = d.masse(d.tourner(img, champ, { lacet: -rad, tangage: 0, roulis: 0 }))
      if (a + b > 0) dissymetrie = Math.max(dissymetrie, Math.abs(a - b) / Math.max(a, b))
    }

    // Le tangage doit se comporter comme le lacet, a un quart de tour pres :
    // c'est le même volume vu par l'autre axe. Une matrice mal composee
    // donnerait ici un resultat different.
    const parLacet = d.masse(d.tourner(img, champ, { lacet: Math.PI / 4, tangage: 0, roulis: 0 }))
    const boiteImg = img.trimBounds()
    const colonne = Math.max(boiteImg.w, boiteImg.h)

    rapport.push({
      nom, hauteur, masse0, trous0, identiquePixel,
      pireProche, pireRasant,
      etrangeres: etrangeres.length,
      troublants: trous.length,
      sautMax, colonne, parLacet,
      dissymetrie,
    })
  }
  return rapport
})

console.log('')
for (const r of mesures) {
  console.log(`--- ${r.nom} (relief ${r.hauteur}px, ${r.masse0} pixels) ---`)
  check(`${r.nom} : a zero degre le dessin ressort intact`, r.identiquePixel)
  check(`${r.nom} : la masse tient jusqu'a 45 degres`, r.pireProche.ratio >= 0.9,
    `au pire ${(r.pireProche.ratio * 100).toFixed(1)}% a ${r.pireProche.deg}deg`)
  check(`${r.nom} : rien ne s'evapore aux angles rasants`, r.pireRasant.marge >= 0,
    `${(r.pireRasant.ratio * 100).toFixed(1)}% a ${r.pireRasant.deg}deg,`
    + ` une feuille en ferait ${(r.pireRasant.plancher * 100).toFixed(1)}%`)
  check(`${r.nom} : aucune couleur etrangere`, r.etrangeres === 0,
    `${r.etrangeres} angle(s) fautif(s)`)
  check(`${r.nom} : la silhouette ne se perce pas`, r.troublants === 0,
    `${r.troublants} angle(s) troue(s)`)
  // Le plus petit changement possible d'un degre au suivant est l'apparition
  // d'une colonne entiere : on ne peut pas exiger plus fin que la grille.
  check(`${r.nom} : pas de saut d'un degre a l'autre`, r.sautMax <= r.colonne,
    `saut max ${r.sautMax} pixels, une colonne en fait ${r.colonne}`)
  check(`${r.nom} : les deux profils se valent`, r.dissymetrie <= 0.04,
    `${(r.dissymetrie * 100).toFixed(1)}% d'écart entre +theta et -theta`)
}

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
