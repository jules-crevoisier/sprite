/**
 * Un GIF anime par cycle, pour juger le mouvement et non des vignettes.
 *
 * Une planche montre les images ; elle ne montre pas si la boucle accroche.
 * Le GIF est le seul rendu ou le defaut de raccord se voit.
 *
 *   node scripts/mascotte/gifs.mjs --out <dossier> [--zoom 6]
 */
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Vite lance directement, sans passer par npx : le wrapper npx encaisse
// le kill et laisse le serveur derriere lui, un par execution.
const VITE = 'node_modules/.bin/vite'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = argOf('--out', 'video/mascotte')
const ZOOM = Number(argOf('--zoom', '6'))
const PORT = Number(argOf('--port', '5230'))

const trouver = (motif, chemins) => {
  for (const c of chemins) if (existsSync(c)) return c
  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!racine || !existsSync(racine)) return null
  for (const d of readdirSync(racine)) {
    if (!motif.test(d)) continue
    const c = join(racine, d, 'chrome-linux', 'chrome')
    if (existsSync(c)) return c
  }
  return null
}
const chromiumBin = process.env.PW_CHROMIUM ?? trouver(/^chromium-\d+$/, [])
const ffmpeg = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(existsSync) ?? 'ffmpeg'

mkdirSync(OUT, { recursive: true })
const temp = join(OUT, 'images')
rmSync(temp, { recursive: true, force: true })
mkdirSync(temp, { recursive: true })

const server = spawn(VITE, [ '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => server.kill())
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break } catch { /* pas pret */ }
  await sleep(250)
}

const browser = await chromium.launch(chromiumBin ? { executablePath: chromiumBin } : {})
const page = await browser.newPage({ viewport: { width: 600, height: 400 } })
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await sleep(600)
await page.keyboard.press('Escape')
await sleep(300)

const clips = await page.evaluate(async (zoom) => {
  const { CLIPS_PIXL } = await import('/src/ui/mascot-clips.ts')
  const { imageDePose, TAILLE } = await import('/src/ui/mascot-anim.ts')
  const { ARMES, clipsArmes, imageDePoseArmee } = await import('/src/ui/mascot-armes.ts')

  const agrandir = (bm) => {
    const petit = document.createElement('canvas')
    petit.width = TAILLE; petit.height = TAILLE
    petit.getContext('2d').putImageData(
      new ImageData(new Uint8ClampedArray(bm.data), TAILLE, TAILLE), 0, 0)
    const grand = document.createElement('canvas')
    grand.width = TAILLE * zoom; grand.height = TAILLE * zoom
    const ctx = grand.getContext('2d')
    ctx.imageSmoothingEnabled = false
    // Un fond opaque : un GIF a transparence binaire salit les bords.
    ctx.fillStyle = '#232630'
    ctx.fillRect(0, 0, grand.width, grand.height)
    ctx.drawImage(petit, 0, 0, grand.width, grand.height)
    return grand.toDataURL()
  }

  const sortie = CLIPS_PIXL.map((clip) => ({
    id: clip.id, nom: clip.nom, ms: clip.ms,
    images: clip.poses.map((p) => agrandir(imageDePose(p))),
  }))

  // Les coups armes : le meme geste avec trois armes, c'est la seule facon
  // de voir que le poids vient du dessin et pas du reglage.
  for (const arme of ARMES) {
    const coup = clipsArmes(arme, CLIPS_PIXL).find((c) => c.id.startsWith('coup-'))
    if (!coup) continue
    sortie.push({
      id: coup.id, nom: coup.nom, ms: coup.ms,
      images: coup.images.map((img) => agrandir(imageDePoseArmee(img.pose, arme, img.position))),
    })
  }
  return sortie
}, ZOOM)

for (const clip of clips) {
  const dossier = join(temp, clip.id)
  mkdirSync(dossier, { recursive: true })
  clip.images.forEach((url, i) => {
    writeFileSync(join(dossier, `${String(i).padStart(3, '0')}.png`),
      Buffer.from(url.split(',')[1], 'base64'))
  })
  const sortie = join(OUT, `pixl-${clip.id}.gif`)
  // Vingt couleurs plutot que seize des qu'une arme entre dans le cadre :
  // sa palette s'ajoute a celle du personnage, et a seize la lame virait.
  const couleurs = clip.id.startsWith('coup-') ? 24 : 16
  const r = spawnSync(ffmpeg, [
    '-y', '-v', 'error',
    '-framerate', String(1000 / clip.ms),
    '-i', join(dossier, '%03d.png'),
    // Palette dediee : un GIF quantifie a la volee delave le pixel art.
    '-vf', `split[a][b];[a]palettegen=max_colors=${couleurs}[p];[b][p]paletteuse=dither=none`,
    '-loop', '0', sortie,
  ])
  console.log(`${clip.id.padEnd(8)} ${clip.images.length} images · ${clip.ms} ms · ${r.status === 0 ? 'ok' : 'ECHEC'}`)
}

await browser.close()
server.kill()
rmSync(temp, { recursive: true, force: true })
console.log(`ecrit dans ${OUT}`)
