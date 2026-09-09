/**
 * Banc du controle qualite.
 *
 * Un verificateur qui ne sait pas echouer ne protege rien : chaque regle est
 * donc eprouvee deux fois — sur un dessin propre, ou elle doit se taire, et
 * sur un dessin casse expres, ou elle doit parler.
 *
 * Le banc affiche aussi l'etat des dessins deja dans le depot. C'est
 * inconfortable et c'est le but : on ne repare pas ce qu'on ne mesure pas.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'

const PORT = 5700 + Math.floor(Math.random() * 200)
const URL = `http://127.0.0.1:${PORT}/`

let navigateur = null
try {
  for (const d of readdirSync('/opt/pw-browsers')) {
    if (/^chromium-\d+$/.test(d)) { navigateur = `/opt/pw-browsers/${d}/chrome-linux/chrome`; break }
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

const m = await page.evaluate(async () => {
  const { verifier, enTexte } = await import('/src/qualite/verifier.ts')
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const { rgba } = await import('/src/core/color.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { MASCOTTES, mascotteSprite } = await import('/src/ui/mascots.ts')
  const art = await import('/src/demo/art.ts')

  const perso = demoCharacter().layers[0].cels[0].bitmap
  const a = (id, r) => r.constats.find((c) => c.id === id)

  /* --- un sujet volontairement irreprochable --- */
  // Un carre a contour sombre, deux aplats, rien d'isole : il doit passer
  // toutes les regles. Sans lui, on ne saurait pas si le verificateur se
  // contente de tout accuser.
  const propre = new Bitmap(24, 24)
  for (let y = 4; y < 20; y++) {
    for (let x = 4; x < 20; x++) {
      // Trois tons : ombre, base, lumiere. C'est le minimum de ce qu'on
      // appelle un dessin modele, et le verificateur doit s'en satisfaire.
      const bord = x === 4 || x === 19 || y === 4 || y === 19
      propre.set(x, y, bord ? rgba(20, 16, 28, 255)
        : y < 10 ? rgba(122, 172, 240, 255)
          : y < 15 ? rgba(90, 140, 210, 255) : rgba(58, 96, 150, 255))
    }
  }
  const rPropre = verifier(propre)

  /* --- chaque regle, cassee expres --- */
  const casse = {}

  // doublons : une couleur a trois unites d'une autre
  const bDoublon = propre.clone()
  for (let x = 6; x < 10; x++) bDoublon.set(x, 8, rgba(92, 142, 212, 255))
  casse.doublons = verifier(bDoublon)

  // bruit : des pixels isoles au milieu de l'aplat, jamais voisins entre eux
  const bBruit = propre.clone()
  for (let i = 0; i < 16; i++) {
    bBruit.set(6 + (i % 4) * 3, 7 + Math.floor(i / 4) * 3, rgba(240, 80, 80, 255))
  }
  casse.bruit = verifier(bBruit)

  // alpha : des bords adoucis
  const bAlpha = propre.clone()
  for (let y = 4; y < 20; y++) {
    bAlpha.set(3, y, rgba(20, 16, 28, 110))
    bAlpha.set(20, y, rgba(20, 16, 28, 110))
  }
  casse.alpha = verifier(bAlpha)

  // palette : on impose une palette qui ne contient pas tout
  casse.palette = verifier(propre, { palette: [rgba(20, 16, 28, 255)] })

  // lisibilite : deux blocs relies par un pont d'un pixel. A taille reelle
  // c'est une seule forme ; a mi-taille le pont disparait et il y en a deux.
  const bFin = new Bitmap(32, 16)
  for (let y = 3; y < 13; y++) {
    for (let x = 2; x < 12; x++) bFin.set(x, y, rgba(60, 100, 160, 255))
    for (let x = 20; x < 30; x++) bFin.set(x, y, rgba(60, 100, 160, 255))
  }
  bFin.set(12, 7, rgba(60, 100, 160, 255))
  for (let x = 12; x < 20; x++) bFin.set(x, 7, rgba(60, 100, 160, 255))
  casse.lisibilite = verifier(bFin)

  // contour fade : un trait present, mais du meme ton que ce qu'il cerne
  const bContour = new Bitmap(24, 24)
  for (let y = 4; y < 20; y++) {
    for (let x = 4; x < 20; x++) {
      const bord = x === 4 || x === 19 || y === 4 || y === 19
      bContour.set(x, y, bord ? rgba(96, 146, 214, 255)
        : y < 12 ? rgba(90, 140, 210, 255) : rgba(78, 122, 184, 255))
    }
  }
  casse['contour-fade'] = verifier(bContour)

  // contour manquant : une silhouette cernee sur un seul cote
  const bNu = new Bitmap(24, 24)
  for (let y = 4; y < 20; y++) {
    for (let x = 4; x < 20; x++) {
      bNu.set(x, y, x === 4 ? rgba(20, 16, 28, 255)
        : y < 12 ? rgba(122, 172, 240, 255) : rgba(90, 140, 210, 255))
    }
  }
  casse['contour-manquant'] = verifier(bNu)

  // cadre : un petit dessin perdu dans une grande toile
  const bCadre = new Bitmap(64, 64)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bCadre.set(x, y, rgba(90, 140, 210, 255))
  casse.cadre = verifier(bCadre)

  // bouillie : du bruit partout
  const bBouillie = new Bitmap(24, 24)
  let graine = 7
  const suivant = () => (graine = (graine * 1103515245 + 12345) & 0x7fffffff)
  for (let y = 2; y < 22; y++) {
    for (let x = 2; x < 22; x++) {
      bBouillie.set(x, y, rgba(suivant() % 255, suivant() % 255, suivant() % 255, 255))
    }
  }
  casse.bouillie = verifier(bBouillie)

  // plat : une silhouette remplie au seau, contour compris
  const bPlat = new Bitmap(24, 24)
  for (let y = 2; y < 22; y++) {
    for (let x = 2; x < 22; x++) {
      const bord = x === 2 || x === 21 || y === 2 || y === 21
      bPlat.set(x, y, bord ? rgba(20, 16, 28, 255) : rgba(90, 140, 210, 255))
    }
  }
  casse.plat = verifier(bPlat)

  /* --- l'etat des dessins du depot --- */
  const depot = []
  const ajouter = (nom, bm) => {
    const r = verifier(bm)
    depot.push({
      nom,
      constats: r.constats.map((c) => `${c.gravite}:${c.id}`),
      texte: enTexte(r),
      mesures: r.mesures,
    })
  }
  ajouter('personnage', perso)
  for (const mas of MASCOTTES) ajouter(`mascotte ${mas.nom}`, mascotteSprite(mas).layers[0].cels[0].bitmap)
  for (const nom of ['HEROS', 'SLIME', 'SOL', 'MUR', 'CAISSE', 'PORTE']) {
    ajouter(`donjon ${nom.toLowerCase()}`, art.bitmapDe(art[nom]))
  }

  return {
    propre: { constats: rPropre.constats.map((c) => `${c.gravite}:${c.id}`), texte: enTexte(rPropre) },
    casse: Object.fromEntries(Object.entries(casse).map(([k, r]) => [k, {
      trouve: !!a(k, r),
      texte: a(k, r)?.quoi ?? `(rien) mesures ${JSON.stringify(r.mesures)}`,
    }])),
    depot,
  }
})

console.log('\n--- le verificateur sait se taire ---')
check('un dessin propre ne declenche aucune regle',
  m.propre.constats.length === 0, m.propre.constats.join(', ') || m.propre.texte.split('\n')[0])

console.log('\n--- le verificateur sait parler ---')
for (const [regle, r] of Object.entries(m.casse)) {
  check(`la regle « ${regle} » voit le defaut qu'on lui a fabrique`, r.trouve, r.texte)
}

console.log('\n--- etat des dessins du depot ---')
let sansDefaut = 0
for (const d of m.depot) {
  const bloquants = d.constats.filter((c) => c.startsWith('bloquant')).length
  if (!d.constats.length) sansDefaut++
  console.log(`  ${d.nom.padEnd(20)} ${(d.constats.join(' ') || '— rien a signaler').padEnd(52)}`
    + ` cerne ${String(d.mesures.cerne).padStart(3)}%`
    + ` trait ${String(d.mesures.traitFranc).padStart(3)}%`
    + ` aplats ${String(d.mesures.aplats).padStart(3)}%`)
  void bloquants
}
console.log(`  ${sansDefaut}/${m.depot.length} dessins sans aucun constat`)
// Aucun dessin livre ne doit porter de defaut bloquant : ce sont ceux qui
// rendent un sprite inexploitable, pas ceux qui le rendent perfectible.
const bloquants = m.depot.filter((d) => d.constats.some((c) => c.startsWith('bloquant')))
check('aucun dessin du depot n\'a de defaut bloquant', bloquants.length === 0,
  bloquants.map((d) => `${d.nom} (${d.constats.join(' ')})`).join(', '))

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
