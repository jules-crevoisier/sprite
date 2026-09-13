#!/usr/bin/env node
/**
 * Le banc du TEXTE en pixel art.
 *
 * ## Ce qu'il surveille
 *
 * Une fonte bitmap est une donnée qu'on relit à l'œil et qu'un programme ne
 * peut pas juger : il ne dira jamais qu'un « M » est laid. Il peut en
 * revanche dire ce qui se compte, et c'est justement ce qu'on oublie de
 * vérifier en admirant son dessin :
 *
 * - une lettre MANQUANTE sort en rectangle plein ; le banc exige que l'alphabet
 *   entier, les chiffres et la ponctuation courante aient un vrai glyphe ;
 * - un texte doit tenir dans la boîte qu'on a annoncée, sinon le cadrage
 *   automatique coupe des lettres ;
 * - l'agrandissement DUPLIQUE les pixels — une seule interpolation et le texte
 *   n'appartient plus au dessin.
 *
 * ## Et le piège du clavier
 *
 * Dans cet éditeur, chaque lettre est déjà le raccourci d'un outil : « b » le
 * crayon, « e » la gomme. Un outil de texte qui ne retient pas la frappe est
 * donc pire qu'absent — taper « bonjour » change sept fois d'outil. Le banc
 * tape un mot dans la vraie fenêtre et vérifie qu'on est toujours sur l'outil
 * Texte, que rien n'est encore gravé, et qu'un seul Ctrl+Z retire le tout.
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4750 + Math.floor(Math.random() * 150)
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
const sleep = (ms) => page.waitForTimeout(ms)

/* ---------------------------------------------------------------- */
/* 1. Les fontes                                                     */
/* ---------------------------------------------------------------- */

const f = await page.evaluate(async () => {
  const m = await import('/src/core/fontes.ts')
  const { FONTES, glyphe, largeurGlyphe, largeurLigne, mesurerTexte, pixelsDeTexte } = m

  /**
   * Le glyphe est-il le RECTANGLE des inconnus ?
   *
   * On compare a ce que rend un caractere absent — plein, et large de la
   * largeur de reference de la fonte. Se contenter de « toutes les rangees
   * sont pleines » accusait le « I » de la 3×5, qui est une colonne d'un
   * pixel : plein, et parfaitement voulu.
   */
  const estRectangle = (f, c) => {
    const g = glyphe(f, c)
    return g.length === f.h && g.every((r) => r === '#'.repeat(f.l))
  }

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const MINUSCULES = 'abcdefghijklmnopqrstuvwxyz'
  const CHIFFRES = '0123456789'
  const PONCTUATION = " .,:;!?'-()/+=<>_\"%*"
  const ACCENTS = 'ÉÈÊÀÂÇÙÛÎÔéèêëàâçùûîïô'

  const out = { fontes: [] }
  for (const f of FONTES) {
    const manquants = []
    for (const c of ALPHABET + MINUSCULES + CHIFFRES + PONCTUATION + ACCENTS) {
      if (estRectangle(f, c)) manquants.push(c)
    }
    // Toutes les rangees d'un glyphe ont la meme largeur, et la hauteur est
    // celle de la fonte : sans cela, la ligne de base sautille.
    let malFormes = 0
    for (const [c, d] of Object.entries(f.dessins)) {
      const r = d.split('|')
      if (r.length !== f.h || new Set(r.map((q) => q.length)).size !== 1) malFormes++
      void c
    }
    out.fontes.push({
      id: f.id, l: f.l, h: f.h,
      manquants: manquants.join(''),
      malFormes,
      accentsPropres: f.id === 'cinq-sept'
        ? glyphe(f, 'É').join('|') !== glyphe(f, 'E').join('|')
        : glyphe(f, 'É').join('|') === glyphe(f, 'E').join('|'),
      inconnu: estRectangle(f, '☃'),
      largeurM: largeurGlyphe(f, 'M'),
      largeurI: largeurGlyphe(f, 'I'),
    })
  }

  const petite = FONTES.find((q) => q.id === 'trois-cinq')
  const grande = FONTES.find((q) => q.id === 'cinq-sept')
  const pose = { echelle: 1, alignement: 'gauche' }

  /* La boite annoncee contient tous les pixels — aucune lettre ne deborde. */
  const debordements = []
  for (const f of FONTES) {
    for (const texte of ['Bonjour', 'MAMAN WAGON', 'Deux\nlignes', 'Wp,;!']) {
      for (const echelle of [1, 3]) {
        const p = { echelle, alignement: 'gauche' }
        const boite = mesurerTexte(f, texte, p)
        for (const pt of pixelsDeTexte(f, texte, p)) {
          if (pt.x < 0 || pt.y < 0 || pt.x >= boite.l || pt.y >= boite.h) {
            debordements.push(`${f.id}/${texte}/${echelle}`)
            break
          }
        }
      }
    }
  }

  /* L'echelle duplique : neuf fois plus de pixels a trois, et des entiers. */
  const un = pixelsDeTexte(grande, 'Agrandi 3', { echelle: 1, alignement: 'gauche' })
  const trois = pixelsDeTexte(grande, 'Agrandi 3', { echelle: 3, alignement: 'gauche' })
  const entiers = trois.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))

  /* Deux lignes ne se touchent pas : l'interligne existe vraiment. */
  const deux = pixelsDeTexte(grande, 'haut\nbas', pose)
  const hautMax = Math.max(...deux.filter((p) => p.y < grande.h).map((p) => p.y))
  const basMin = Math.min(...deux.filter((p) => p.y >= grande.h).map((p) => p.y))

  /* Alignement : a droite, les deux lignes finissent sur la meme colonne. */
  const finDe = (texte, alignement) => {
    const pts = pixelsDeTexte(grande, texte, { echelle: 1, alignement })
    const l1 = pts.filter((p) => p.y < grande.h)
    const l2 = pts.filter((p) => p.y >= grande.h)
    return {
      finL1: Math.max(...l1.map((p) => p.x)),
      finL2: Math.max(...l2.map((p) => p.x)),
      debutL1: Math.min(...l1.map((p) => p.x)),
      debutL2: Math.min(...l2.map((p) => p.x)),
    }
  }

  return {
    ...out,
    debordements,
    echelle: { un: un.length, trois: trois.length, entiers },
    interligne: { hautMax, basMin, h: grande.h },
    // Deux lignes qui finissent et commencent par la MEME lettre : l'encre
    // se compare alors colonne a colonne. Avec « court » et « long », le « t »
    // et le « g » ne portent pas leur encre au meme endroit dans leur case, et
    // l'on mesurerait la forme des lettres au lieu de l'alignement.
    droite: finDe('AXA\nAXXXXXA', 'droite'),
    gauche: finDe('AXA\nAXXXXXA', 'gauche'),
    proportionnel: largeurLigne(petite, 'III') < largeurLigne(petite, 'MMM'),
  }
})

console.log('\n--- les fontes ---')
for (const fo of f.fontes) {
  check(`« ${fo.id} » : aucune lettre, aucun chiffre, aucun signe ne manque`,
    fo.manquants === '', fo.manquants ? `manquent : ${fo.manquants}` : `${fo.l}×${fo.h}`)
  check(`« ${fo.id} » : tous les glyphes ont la hauteur de la fonte`,
    fo.malFormes === 0, `${fo.malFormes} glyphe(s) mal formé(s)`)
  check(`« ${fo.id} » : un caractère inconnu sort en rectangle, pas en blanc`,
    fo.inconnu, 'un trou invisible se découvre trois heures plus tard')
}
check('la 5×7 dessine ses accents ; la 3×5 les replie sur la lettre nue',
  f.fontes.every((fo) => fo.accentsPropres),
  'cinq rangées ne laissent pas la place d\'un accent détaché')
check('dans la 3×5, le M est plus large que le I',
  f.fontes[1].largeurM > f.fontes[1].largeurI && f.proportionnel,
  `M ${f.fontes[1].largeurM} px, I ${f.fontes[1].largeurI} px — en trois colonnes, MAMAN se lit HAHAN`)

console.log('\n--- la mise en place ---')
check('aucun pixel ne sort de la boîte annoncée',
  f.debordements.length === 0, f.debordements.join(', '))
check('l\'échelle ×3 duplique les pixels : neuf fois plus, tous entiers',
  f.echelle.trois === f.echelle.un * 9 && f.echelle.entiers,
  `${f.echelle.un} → ${f.echelle.trois} pixels`)
check('deux lignes ne se touchent pas',
  f.interligne.basMin > f.interligne.hautMax + 1,
  `dernière rangée ${f.interligne.hautMax}, première de la ligne suivante ${f.interligne.basMin}`)
check('aligné à droite, les lignes finissent sur la même colonne',
  f.droite.finL1 === f.droite.finL2)
check('aligné à gauche, elles commencent sur la même colonne',
  f.gauche.debutL1 === f.gauche.debutL2)

/* ---------------------------------------------------------------- */
/* 2. L'outil, dans la vraie fenetre                                 */
/* ---------------------------------------------------------------- */

const opaques = () => page.evaluate(() => {
  const bm = window.pixelforge.ed.peekCel().bitmap
  let n = 0
  for (let i = 3; i < bm.data.length; i += 4) if (bm.data[i]) n++
  return n
})
const etat = () => page.evaluate(() => {
  const app = window.pixelforge
  return { outil: app.ed.settings.tool, undo: app.ed.history.canUndo }
})

const box = await page.locator('#canvas').boundingBox()
const cliquer = async (dx = -60, dy = -20) => {
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy)
  await sleep(80)
}

await page.keyboard.press('t')
await sleep(120)
check('la touche T prend l\'outil Texte', (await etat()).outil === 'text')

const avant = await opaques()
await cliquer()
await page.keyboard.type('bonjour')
await sleep(150)

const pendant = await page.evaluate(async () => {
  const { texteEnAttente } = await import('/src/tools/text-tool.ts')
  return { attente: texteEnAttente(), outil: window.pixelforge.ed.settings.tool }
})
check('taper « bonjour » ne change pas d\'outil sept fois',
  pendant.outil === 'text',
  'b = crayon, e = gomme, j = pose du squelette : sans la prise clavier, le mot pilote l\'éditeur')
check('les lettres tapées sont en attente', pendant.attente?.texte === 'bonjour',
  `en attente : « ${pendant.attente?.texte ?? '—'} »`)
check('et rien n\'est encore gravé dans le dessin',
  (await opaques()) === avant, 'le texte se relit avant d\'exister')

await page.keyboard.press('Control+Enter')
await sleep(200)
const apresGravure = await opaques()
check('Ctrl+Entrée grave le texte', apresGravure > avant, `${apresGravure - avant} pixels posés`)

await page.keyboard.press('Control+z')
await sleep(200)
check('un seul Ctrl+Z le retire en entier',
  (await opaques()) === avant, 'un geste par texte, pas un geste par lettre')

/* Echap abandonne. */
await cliquer(20, 40)
await page.keyboard.type('perdu')
await page.keyboard.press('Escape')
await sleep(150)
const apresEchap = await opaques()
check('Échap abandonne le texte en attente', apresEchap === avant)

/* Changer d'outil GRAVE, au lieu de perdre le travail. */
await cliquer(20, 60)
await page.keyboard.type('garde')
await sleep(100)
await page.evaluate(() => window.pixelforge.setTool('pencil'))
await sleep(200)
check('changer d\'outil grave le texte au lieu de le perdre',
  (await opaques()) > apresEchap,
  'rien ne le sauvegarderait ailleurs : le perdre serait une perte sèche')

/* La barre d'options propose les fontes. */
await page.keyboard.press('t')
await sleep(200)
const barre = await page.evaluate(() =>
  [...document.querySelectorAll('#optionsbar select option')].map((o) => o.textContent))
check('la barre d\'options propose les deux fontes',
  barre.some((t) => t.includes('5×7')) && barre.some((t) => t.includes('3×5')),
  barre.filter((t) => t.includes('×')).join(' / '))

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
