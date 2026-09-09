/**
 * Planches des propositions de mascotte et des pieces du personnage.
 *
 * Trois personnages ont ete dessines, un seul a ete anime. Les deux autres
 * n'apparaissent nulle part : sans cette planche, le choix qui a ete fait
 * n'est pas relisible, et rien ne dit ce qui a ete ecarte.
 *
 * La planche des pieces montre l'autre moitie de la reponse : le
 * personnage n'est pas redessine a chaque pose, il est assemble a partir
 * de quelques morceaux deplaces par nombres entiers de pixels. C'est ce
 * qui garantit que sa masse ne change pas d'une image a l'autre.
 *
 *   node scripts/mascotte/propositions.mjs --out <dossier> [--port 5213]
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Vite lance directement, sans passer par npx : le wrapper npx encaisse
// le kill et laisse le serveur derriere lui, un par execution.
const VITE = 'node_modules/.bin/vite'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = argOf('--out', 'video/mascotte')
const PORT = Number(argOf('--port', '5213'))

function trouverChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!racine || !existsSync(racine)) return null
  for (const d of readdirSync(racine)) {
    if (!/^chromium-\d+$/.test(d)) continue
    const c = join(racine, d, 'chrome-linux', 'chrome')
    if (existsSync(c)) return c
  }
  return null
}

mkdirSync(OUT, { recursive: true })
const server = spawn(VITE, [ '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => server.kill())
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break } catch { /* pas pret */ }
  await sleep(250)
}

const executablePath = trouverChromium()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: 1400, height: 700 } })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await sleep(600)
await page.keyboard.press('Escape')
await sleep(300)

const sortie = await page.evaluate(async () => {
  const { MASCOTTES, TAILLE, peindre } = await import('/src/ui/mascots.ts')
  const { PIECES, PALETTE_MASCOTTE } = await import('/src/ui/mascot-anim.ts')
  const { Bitmap } = await import('/src/core/bitmap.ts')

  const FOND = '#232630', CASE = '#1a1c24', TEXTE = '#cfd4e2', GRIS = '#7f869c'

  const dessiner = (ctx, art, palette, x0, y0, z) => {
    art.forEach((ligne, y) => {
      [...ligne].forEach((c, x) => {
        const hex = palette[c]
        if (!hex) return
        ctx.fillStyle = hex
        ctx.fillRect(x0 + x * z, y0 + y * z, z, z)
      })
    })
  }

  /* --- les trois propositions, cote a cote --- */
  const proposition = () => {
    const Z = 9, W = TAILLE * Z, MARGE = 22, HAUT = 44
    const mesure = document.createElement('canvas').getContext('2d')
    mesure.font = '13px monospace'
    // Le pitch va a la ligne tout seul, et la hauteur de la planche se
    // deduit du plus long : une phrase coupee au bord du cadre est pire
    // que pas de phrase du tout.
    const couper = (texte) => {
      const lignes = []
      let ligne = ''
      for (const mot of texte.split(' ')) {
        const essai = ligne ? `${ligne} ${mot}` : mot
        if (mesure.measureText(essai).width > W && ligne) { lignes.push(ligne); ligne = mot }
        else ligne = essai
      }
      if (ligne) lignes.push(ligne)
      return lignes
    }
    const pitchs = MASCOTTES.map((m) => couper(m.pitch))
    const BAS = 96 + Math.max(...pitchs.map((l) => l.length)) * 18

    const cv = document.createElement('canvas')
    cv.width = MASCOTTES.length * (W + MARGE) + MARGE
    cv.height = HAUT + W + BAS
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = FOND
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = TEXTE
    ctx.font = 'bold 16px monospace'
    ctx.fillText('TROIS PROPOSITIONS — UNE SEULE A ETE ANIMEE', MARGE, 26)

    MASCOTTES.forEach((m, i) => {
      const x = MARGE + i * (W + MARGE)
      ctx.fillStyle = CASE
      ctx.fillRect(x, HAUT, W, W)
      dessiner(ctx, m.repos, m.palette, x, HAUT, Z)

      ctx.fillStyle = TEXTE
      ctx.font = 'bold 17px monospace'
      ctx.fillText(m.nom.toUpperCase(), x, HAUT + W + 28)

      // La palette d'abord : c'est elle qui fait l'identite visuelle bien
      // avant la forme, et elle tient sur une ligne.
      Object.values(m.palette).forEach((hex, k) => {
        ctx.fillStyle = hex
        ctx.fillRect(x + k * 16, HAUT + W + 40, 13, 13)
      })

      ctx.fillStyle = GRIS
      ctx.font = '13px monospace'
      pitchs[i].forEach((ligne, k) => ctx.fillText(ligne, x, HAUT + W + 76 + k * 18))
    })
    return cv.toDataURL()
  }

  /* --- les pieces du personnage anime --- */
  const pieces = () => {
    const ordre = [
      ['TETE', 'tete'], ['TETE_CLIN', 'clin'], ['TETE_MI_CLOS', 'mi-clos'],
      ['TETE_ECRASEE', 'tete ecrasee'],
      ['CORPS', 'corps'], ['CORPS_ECRASE', 'corps ecrase'], ['CORPS_ETIRE', 'corps etire'],
      ['PATTE', 'patte'],
    ]
    const queues = Object.keys(PIECES.QUEUES)
    const Z = 8, MARGE = 20, HAUT = 44
    const largeurDe = (art) => art[0].length * Z
    const hauteurDe = (art) => art.length * Z

    const blocs = ordre.map(([cle, nom]) => ({ art: PIECES[cle], nom }))
      .concat(queues.map((q) => ({ art: PIECES.QUEUES[q], nom: `queue ${q}` })))

    // Une colonne fait au moins la largeur de son intitule : les pieces
    // etroites, comme les queues, chevauchaient sinon le nom de la suivante.
    const mesure = document.createElement('canvas').getContext('2d')
    mesure.font = '12px monospace'
    for (const b of blocs) b.colonne = Math.max(largeurDe(b.art), mesure.measureText(b.nom).width)

    const cv = document.createElement('canvas')
    cv.width = blocs.reduce((n, b) => n + b.colonne + MARGE, MARGE)
    cv.height = HAUT + Math.max(...blocs.map((b) => hauteurDe(b.art))) + 40
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = FOND
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = TEXTE
    ctx.font = 'bold 16px monospace'
    ctx.fillText('LES PIECES — LE PERSONNAGE EST ASSEMBLE, PAS REDESSINE', MARGE, 26)

    let x = MARGE
    const bas = cv.height - 40
    for (const b of blocs) {
      const h = hauteurDe(b.art)
      // Alignees par le bas : c'est comme ca qu'elles se posent dans la
      // pose, et ca rend les differences de hauteur lisibles.
      dessiner(ctx, b.art, PALETTE_MASCOTTE, x, bas - h, Z)
      ctx.fillStyle = GRIS
      ctx.font = '12px monospace'
      ctx.fillText(b.nom, x, cv.height - 20)
      const masse = b.art.join('').split('').filter((c) => c !== '.').length
      ctx.fillText(`${masse} px`, x, cv.height - 6)
      x += b.colonne + MARGE
    }
    return cv.toDataURL()
  }

  return { propositions: proposition(), pieces: pieces() }
}, {})

const png = (url) => Buffer.from(url.split(',')[1], 'base64')
writeFileSync(join(OUT, 'propositions.png'), png(sortie.propositions))
writeFileSync(join(OUT, 'pieces.png'), png(sortie.pieces))
console.log('ecrit propositions.png et pieces.png')
console.log('erreurs page :', erreurs.length ? erreurs : 'aucune')

await browser.close()
server.kill()
