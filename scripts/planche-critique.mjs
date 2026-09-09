/**
 * Fabrique la planche qu'on donne a juger.
 *
 * Un critique qui ne voit qu'un sprite grossi douze fois juge autre chose que
 * ce que le joueur verra. Cette planche montre donc le meme dessin comme il
 * sera vraiment regarde :
 *
 * - a un, trois et six fois, pour voir la forme et les pixels ;
 * - a la moitie de sa taille, ou disparait ce qui est trop fin ;
 * - sur fond sombre, clair et moyen — un contour qui tient sur l'un se
 *   dissout souvent sur l'autre, et c'est le defaut le plus courant ;
 * - en silhouette pleine, ou l'on ne juge plus que la forme ;
 * - sa palette, rangee de la plus sombre a la plus claire, parce qu'une
 *   rampe qui ne monte pas regulierement se voit la et nulle part ailleurs.
 *
 * Elle est accompagnee du rapport du verificateur : le critique n'a pas a
 * perdre son temps sur ce qui se compte.
 *
 *     node scripts/planche-critique.mjs --art HEROS --out /tmp/heros.png
 *     node scripts/planche-critique.mjs --mascotte pixl --out /tmp/pixl.png
 *     node scripts/planche-critique.mjs --demo perso --out /tmp/perso.png
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const lire = (nom) => {
  const i = args.indexOf(`--${nom}`)
  return i >= 0 ? args[i + 1] : null
}
const sujet = {
  art: lire('art'),
  mascotte: lire('mascotte'),
  demo: lire('demo'),
}
const sortie = lire('out') ?? 'planche.png'
/**
 * Sortie facultative du sprite seul, agrandi, sans decor de planche.
 *
 * C'est ce qu'il faut pour comparer deux tours de boucle cote a cote : deux
 * planches entieres se comparent mal, deux sprites se comparent d'un coup
 * d'oeil.
 */
const nu = lire('nu')
if (!sujet.art && !sujet.mascotte && !sujet.demo) {
  console.error('Il faut --art NOM, --mascotte id ou --demo perso')
  process.exit(1)
}

const PORT = 5900 + Math.floor(Math.random() * 200)
const URL = `http://127.0.0.1:${PORT}/`

let navigateur = null
try {
  for (const d of readdirSync('/opt/pw-browsers')) {
    if (/^chromium-\d+$/.test(d)) { navigateur = `/opt/pw-browsers/${d}/chrome-linux/chrome`; break }
  }
} catch { /* installation locale */ }

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
page.on('pageerror', (e) => console.error('ERREUR', e.message))
await page.goto(URL, { waitUntil: 'networkidle' })

const donnees = await page.evaluate(async (sujet) => {
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const { getA, luminance, toHex } = await import('/src/core/color.ts')
  const { verifier, enTexte } = await import('/src/qualite/verifier.ts')

  let bm = null
  let nom = ''
  if (sujet.art) {
    const art = await import('/src/demo/art.ts')
    if (!art[sujet.art]) throw new Error(`Aucun dessin nomme ${sujet.art}`)
    bm = art.bitmapDe(art[sujet.art])
    nom = sujet.art
  } else if (sujet.mascotte) {
    const { MASCOTTES, mascotteSprite } = await import('/src/ui/mascots.ts')
    const m = MASCOTTES.find((x) => x.id === sujet.mascotte) ?? MASCOTTES[0]
    bm = mascotteSprite(m).layers[0].cels[0].bitmap
    nom = `mascotte ${m.nom}`
  } else {
    const demo = await import('/src/ui/demo-content.ts')
    bm = demo.demoCharacter().layers[0].cels[0].bitmap
    nom = 'personnage de demonstration'
  }

  const boite = bm.trimBounds()
  const rogne = bm.crop(boite)

  /** Le dessin reduit de moitie, par vote : ce qui est trop fin disparait. */
  const moitie = () => {
    const w = Math.max(1, Math.ceil(rogne.width / 2))
    const h = Math.max(1, Math.ceil(rogne.height / 2))
    const out = new Bitmap(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const compte = new Map()
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const sx = x * 2 + dx, sy = y * 2 + dy
          if (sx >= rogne.width || sy >= rogne.height) continue
          const c = rogne.u32[sy * rogne.width + sx]
          if (getA(c) === 0) continue
          compte.set(c, (compte.get(c) ?? 0) + 1)
        }
        let gagnante = 0, n = 0
        for (const [c, v] of compte) if (v > n) { n = v; gagnante = c }
        if (n >= 2) out.u32[y * w + x] = gagnante
      }
    }
    return out
  }

  /** La silhouette pleine : on ne juge plus que la forme. */
  const silhouette = () => {
    const out = new Bitmap(rogne.width, rogne.height)
    for (let i = 0; i < rogne.u32.length; i++) {
      if (getA(rogne.u32[i]) !== 0) out.u32[i] = 0xff1a1a22 >>> 0
    }
    return out
  }

  const couleurs = new Map()
  for (let i = 0; i < rogne.u32.length; i++) {
    const c = rogne.u32[i]
    if (getA(c) === 0) continue
    couleurs.set(c, (couleurs.get(c) ?? 0) + 1)
  }
  const palette = [...couleurs.entries()]
    .sort((a, b) => luminance(a[0]) - luminance(b[0]))
    .map(([c, n]) => ({ hex: toHex(c), lum: Math.round(luminance(c)), n }))

  const rapport = verifier(bm)
  return {
    nom,
    taille: `${boite.w}×${boite.h}`,
    normal: rogne.toCanvas().toDataURL(),
    petit: moitie().toCanvas().toDataURL(),
    forme: silhouette().toCanvas().toDataURL(),
    palette,
    rapport: enTexte(rapport),
    mesures: rapport.mesures,
  }
}, sujet)

const FONDS = [['#0d0f14', 'fond sombre'], ['#b9c2cf', 'fond clair'], ['#6b7280', 'fond moyen']]
const img = (src, w, fond) =>
  `<img src="${src}" style="image-rendering:pixelated;width:${w}px;background:${fond};
   border:1px solid #2a2e3a;border-radius:3px">`
const legende = (t) => `<div style="color:#8a8f9a;font:11px ui-monospace,monospace;margin-top:4px">${t}</div>`

const L = donnees.taille.split('×')[0] * 1
const html = `<body style="background:#14161c;margin:0;padding:22px;font-family:system-ui,sans-serif;color:#e6e8ee">
<div style="font:600 15px system-ui;margin-bottom:2px">${donnees.nom} — ${donnees.taille}</div>
<div style="color:#7cc47f;font:11px ui-monospace,monospace;margin-bottom:16px">planche de critique</div>

<div style="color:#9aa0aa;font:600 11px system-ui;letter-spacing:.06em;margin-bottom:6px">TAILLE REELLE, ×3, ×6 — SUR TROIS FONDS</div>
<div style="display:flex;gap:22px;margin-bottom:20px">
${FONDS.map(([f, n]) => `<div style="text-align:center">
  <div style="display:flex;gap:8px;align-items:flex-end">
    ${img(donnees.normal, L, f)}${img(donnees.normal, L * 3, f)}${img(donnees.normal, L * 6, f)}
  </div>${legende(n)}</div>`).join('')}
</div>

<div style="color:#9aa0aa;font:600 11px system-ui;letter-spacing:.06em;margin-bottom:6px">A MI-TAILLE (CE QUI EST TROP FIN DISPARAIT) ET EN SILHOUETTE</div>
<div style="display:flex;gap:22px;align-items:flex-end;margin-bottom:20px">
<div style="text-align:center">${img(donnees.petit, L * 3, '#0d0f14')}${legende('moitié, ×3')}</div>
<div style="text-align:center">${img(donnees.petit, L * 1.5, '#b9c2cf')}${legende('moitié, taille réelle')}</div>
<div style="text-align:center">${img(donnees.forme, L * 4, '#b9c2cf')}${legende('silhouette')}</div>
</div>

<div style="color:#9aa0aa;font:600 11px system-ui;letter-spacing:.06em;margin-bottom:6px">PALETTE, DE LA PLUS SOMBRE A LA PLUS CLAIRE</div>
<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:18px">
${donnees.palette.map((p) => `<div style="text-align:center">
  <div style="width:46px;height:34px;background:${p.hex};border:1px solid #2a2e3a;border-radius:3px"></div>
  <div style="color:#8a8f9a;font:9.5px ui-monospace,monospace;margin-top:3px">${p.hex}<br>lum ${p.lum}<br>${p.n}px</div>
</div>`).join('')}
</div>

<div style="color:#9aa0aa;font:600 11px system-ui;letter-spacing:.06em;margin-bottom:6px">CE QUE LES REGLES CALCULEES DISENT DEJA</div>
<pre style="color:#c8cdd8;font:11.5px ui-monospace,monospace;background:#0d0f14;border:1px solid #2a2e3a;
 border-radius:4px;padding:10px;white-space:pre-wrap;margin:0">${donnees.rapport}</pre>
</body>`

const p2 = await browser.newPage({ viewport: { width: Math.max(760, L * 12 + 160), height: 900 } })
await p2.setContent(html)
await p2.waitForTimeout(300)
await p2.screenshot({ path: sortie, fullPage: true })

if (nu) {
  const p3 = await browser.newPage({ viewport: { width: L * 8, height: L * 8 } })
  await p3.setContent(`<body style="margin:0;background:#b9c2cf;display:grid;place-items:center;
   height:100vh"><img src="${donnees.normal}" style="image-rendering:pixelated;width:${L * 6}px"></body>`)
  await p3.waitForTimeout(200)
  await p3.screenshot({ path: nu })
  await p3.close()
  console.log(`sprite  : ${nu}`)
}
writeFileSync(sortie.replace(/\.png$/, '.txt'), `${donnees.nom} — ${donnees.taille}\n${donnees.rapport}\n`)

console.log(`planche : ${sortie}`)
console.log(donnees.rapport)

await browser.close()
serveur.kill()
