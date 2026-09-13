#!/usr/bin/env node
/**
 * Le banc du ZOOM.
 *
 * ## Le défaut qu'il garde
 *
 * Le zoom multipliait par 1,15 à chaque cran de molette, **puis arrondissait**
 * à l'entier au-dessus de 1×. L'arrondi est la bonne règle — un pixel du
 * sprite doit occuper un nombre entier de pixels d'écran, sinon les colonnes
 * n'ont pas toutes la même largeur. Mais 1 × 1,15 fait 1,15, qui s'arrondit à
 * 1 : **la molette ne sortait jamais de 1×**. Ni de 2× (2,3 → 2), ni de 3×.
 *
 * Il fallait un sprite assez grand pour s'ouvrir à 1× — un 512 — et l'on se
 * retrouvait enfermé, incapable de voir un seul pixel. Sur un sprite de 32,
 * qui s'ouvre à 20×, le défaut était invisible : c'est pour cela qu'il a tenu
 * si longtemps, et c'est pour cela que ce banc travaille sur un GRAND sprite.
 *
 * Il ne teste pas une fonction : il tourne la molette dans la vraie fenêtre et
 * lit le zoom dans la barre d'état, là où l'utilisateur le lit.
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4600 + Math.floor(Math.random() * 150)
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.getByRole('button', { name: 'Plus tard' }).click().catch(() => {})
await page.waitForTimeout(300)

/**
 * Le zoom tel que la barre d'etat le montre.
 *
 * On lit la CASE, pas la ligne entiere : « 512×512 » et « 1x » se touchent
 * dans le texte concatene, et une expression cherchant des chiffres suivis
 * d'un « x » y lisait « 5121x ». Le banc mesurait alors n'importe quoi.
 */
const zoom = async () => page.evaluate(() => {
  const cases = [...document.querySelectorAll('.statusbar span')]
  const m = cases.map((e) => (e.textContent ?? '').trim())
    .find((t) => /^\d+(\.\d+)?x$/.test(t))
  return m ? Number(m.slice(0, -1)) : NaN
})

/* Un sprite de 512 : celui qui revelait le defaut. */
await page.getByRole('button', { name: 'Fichier', exact: true }).first().click()
await page.waitForTimeout(250)
await page.getByText('Nouveau sprite', { exact: false }).first().click()
await page.waitForTimeout(400)
const champs = await page.$$('dialog input[type="number"], .modal input[type="number"]')
await champs[0].fill('512')
await champs[1].fill('512')
await page.getByRole('button', { name: 'Créer' }).click()
  .catch(() => page.getByRole('button', { name: 'Nouveau' }).last().click())
await page.waitForTimeout(700)

const depart = await zoom()
check('un sprite de 512 s\'ouvre à un zoom serré', depart <= 2 && depart > 0, `${depart}x`)

const cv = await page.$('#canvas')
const boite = await cv.boundingBox()
const centre = { x: boite.x + boite.width / 2, y: boite.y + boite.height / 2 }
const cran = async (sens) => {
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.wheel(0, sens < 0 ? -120 : 120)
  await page.waitForTimeout(80)
  return zoom()
}

const apresUn = await cran(-1)
check('UN cran de molette sort de 1× — le défaut signalé',
  apresUn > depart, `${depart}x → ${apresUn}x`)

/* Chaque cran doit avancer : c'est la propriete qui manquait. */
let precedent = apresUn
let bloque = 0
const suite = [apresUn]
for (let i = 0; i < 10; i++) {
  const z = await cran(-1)
  if (z <= precedent && z < 64) bloque++
  precedent = z
  suite.push(z)
}
check('et chaque cran suivant avance aussi, jusqu\'au maximum',
  bloque === 0 && precedent === 64,
  suite.join(' → ') + 'x')
check('le zoom reste ENTIER au-dessus de 1×',
  suite.every((z) => z < 1 || Number.isInteger(z)),
  'un pixel du sprite doit occuper un nombre entier de pixels d\'écran')

/* Et dans l'autre sens. */
let descente = precedent
let coinces = 0
const bas = []
for (let i = 0; i < 16; i++) {
  const z = await cran(1)
  if (z >= descente && z > 0.25) coinces++
  descente = z
  bas.push(z)
}
check('la descente avance à chaque cran elle aussi', coinces === 0, bas.join(' → ') + 'x')
check('et s\'arrête au plancher', descente === 0.25, `${descente}x`)

/* « Zoom 100 % » doit donner 1x exactement, pas le palier le plus proche. */
await page.keyboard.press('Control+1')
await page.waitForTimeout(250)
check('« Zoom 100 % » donne exactement 1×', (await zoom()) === 1, `${await zoom()}x`)

/* Le point sous le curseur ne doit pas fuir : c'est ce qui rend le zoom
 * utilisable pour viser un detail. */
await page.keyboard.press('Control+0')
await page.waitForTimeout(250)
const viser = { x: boite.x + boite.width * 0.35, y: boite.y + boite.height * 0.4 }
const sous = async () => {
  await page.mouse.move(viser.x, viser.y)
  await page.waitForTimeout(60)
  return page.evaluate(() => {
    const b2 = document.querySelector('.statusbar b')
    return b2 ? (b2.textContent ?? '').replace(/\s/g, '') : '?'
  })
}
const avant = await sous()
await page.mouse.move(viser.x, viser.y)
await page.mouse.wheel(0, -120)
await page.waitForTimeout(120)
await page.mouse.wheel(0, -120)
await page.waitForTimeout(150)
const apres = await sous()
check('le pixel sous le curseur reste sous le curseur en zoomant',
  avant === apres && avant !== '?', `${avant} puis ${apres}`)

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
