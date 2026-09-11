#!/usr/bin/env node
/**
 * Le banc du DÉTAIL : ce que « Ajouter du détail » fait d'un aplat.
 *
 * ## Le défaut qu'il garde
 *
 * L'outil décale chaque pixel d'un cran dans SA rampe de couleurs : c'est ce
 * qui garde le rendu cohérent avec le dessin. Mais une rampe d'une seule
 * couleur n'a pas de voisin — et `step` rendait alors la couleur inchangée.
 *
 * Autrement dit : sur une forme peinte d'un seul ton, l'outil ne faisait
 * RIEN, et répondait « aucun pixel touché » à quelqu'un qui regardait sa
 * forme pleine. Or c'est exactement là qu'on demande du détail ; un dessin
 * qui a déjà cinq verts n'en a pas besoin.
 *
 * Ce banc tient les deux bouts : la teinte se fabrique quand elle manque, et
 * elle ne se fabrique PAS quand le dessin en a déjà une. Le second point est
 * le plus important — sans lui, l'outil se mettrait à inventer des couleurs
 * dans un sprite qui avait sa palette, et la « cohérence » promise ne serait
 * plus qu'un commentaire.
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4300 + Math.floor(Math.random() * 400)
const URL = `http://127.0.0.1:${PORT}/`

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
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const { rgba, getA, getR, getG, getB, rgbaToHsv } = await import('/src/core/color.ts')
  const { RampIndex, teinteVoisine } = await import('/src/smart/analysis.ts')
  const { addDetail, applyPreset } = await import('/src/smart/detail.ts')

  /** Un disque plein d'une seule couleur : l'aplat qu'on veut détailler. */
  const disque = (couleurs) => {
    const bm = new Bitmap(24, 24)
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const d = Math.hypot(x - 11.5, y - 11.5)
        if (d > 10) continue
        bm.u32[y * 24 + x] = couleurs[(x + y) % couleurs.length]
      }
    }
    return bm
  }
  const compter = (bm) => {
    const vus = new Map()
    let opaques = 0
    for (const c of bm.u32) {
      if (getA(c) === 0) continue
      opaques++
      vus.set(c, (vus.get(c) ?? 0) + 1)
    }
    return { opaques, teintes: [...vus.keys()] }
  }

  const vert = rgba(74, 142, 72, 255)
  const out = {}

  /* 1. L'APLAT : une seule couleur, et on demande de l'herbe. */
  {
    const bm = disque([vert])
    const avant = compter(bm)
    const nouvelles = new Set()
    const touched = applyPreset(bm, RampIndex.fromBitmaps([bm]), 'herbe', 4242, 1, null, nouvelles)
    const apres = compter(bm)
    out.aplat = {
      touched,
      teintesAvant: avant.teintes.length,
      teintesApres: apres.teintes.length,
      nouvelles: [...nouvelles].length,
      opaquesAvant: avant.opaques,
      opaquesApres: apres.opaques,
    }
  }

  /* 2. La teinte fabriquée : déterministe, et de la même famille. */
  {
    const clair = teinteVoisine(vert, 1)
    const encore = teinteVoisine(vert, 1)
    const sombre = teinteVoisine(vert, -1)
    const hv = rgbaToHsv(vert)
    const hc = rgbaToHsv(clair)
    out.teinte = {
      stable: clair === encore,
      plusClair: getR(clair) + getG(clair) + getB(clair) > getR(vert) + getG(vert) + getB(vert),
      plusSombre: getR(sombre) + getG(sombre) + getB(sombre) < getR(vert) + getG(vert) + getB(vert),
      ecartTeinte: Math.abs(((hc.h - hv.h + 540) % 360) - 180),
      opacite: getA(clair),
    }
  }

  /* 3. Un dessin qui A DÉJÀ sa rampe : rien ne doit être inventé. */
  {
    const rampe = [
      rgba(40, 96, 40, 255), rgba(58, 124, 56, 255),
      rgba(74, 142, 72, 255), rgba(104, 178, 96, 255),
    ]
    const bm = disque(rampe)
    const nouvelles = new Set()
    const touched = applyPreset(bm, RampIndex.fromBitmaps([bm]), 'herbe', 99, 1, null, nouvelles)
    const apres = compter(bm)
    out.rampe = {
      touched,
      inventees: [...nouvelles].length,
      // Toutes les couleurs finales appartiennent-elles à la rampe de départ ?
      etrangeres: apres.teintes.filter((c) => !rampe.includes(c)).length,
    }
  }

  /* 4. Le vide reste vide : un aplat détaillé ne déborde pas de sa forme. */
  {
    const bm = disque([vert])
    const avant = compter(bm).opaques
    addDetail(bm, RampIndex.fromBitmaps([bm]), {
      mode: 'speckle', density: 1, strength: 1, seed: 7, within: null,
    })
    out.silhouette = { avant, apres: compter(bm).opaques }
  }

  /* 5. La sélection borne l'effet. */
  {
    const bm = disque([vert])
    const masque = new Uint8Array(24 * 24)
    for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) masque[y * 24 + x] = 255
    addDetail(bm, RampIndex.fromBitmaps([bm]), {
      mode: 'speckle', density: 1, strength: 1, seed: 11, within: masque,
    })
    let basChange = 0
    for (let y = 12; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const c = bm.u32[y * 24 + x]
        if (getA(c) !== 0 && c !== vert) basChange++
      }
    }
    out.selection = { basChange }
  }

  /* 6. Les cinq matières font toutes quelque chose sur un aplat. */
  {
    const { DETAIL_PRESETS } = await import('/src/smart/detail.ts')
    out.matieres = DETAIL_PRESETS.map((p) => {
      const bm = disque([vert])
      const n = applyPreset(bm, RampIndex.fromBitmaps([bm]), p.id, 5, 1, null, null)
      return { id: p.id, touched: n }
    })
  }

  return out
})

console.log('\n--- un aplat d\'une seule couleur ---')
check('« Ajouter du détail » touche des pixels sur un aplat',
  m.aplat.touched > 0,
  `${m.aplat.touched} pixels — c'est le défaut signalé : il n'en touchait AUCUN`)
check('et il fabrique les teintes qui manquaient',
  m.aplat.nouvelles >= 1 && m.aplat.teintesApres > m.aplat.teintesAvant,
  `${m.aplat.teintesAvant} teinte → ${m.aplat.teintesApres}, dont ${m.aplat.nouvelles} fabriquée(s)`)
check('sans en fabriquer trente : deux ou trois suffisent à détailler une surface',
  m.aplat.nouvelles <= 4, `${m.aplat.nouvelles} teintes`)

console.log('\n--- la teinte fabriquée ---')
check('elle est déterministe : la même couleur donne toujours la même voisine',
  m.teinte.stable, 'sinon un aplat se couvrirait de trente verts différents')
check('un cran vers le haut éclaircit, un cran vers le bas assombrit',
  m.teinte.plusClair && m.teinte.plusSombre)
check('elle reste dans la même famille de teintes',
  m.teinte.ecartTeinte < 12, `${m.teinte.ecartTeinte.toFixed(1)}° d'écart de teinte`)
check('et elle garde l\'opacité de la couleur d\'origine', m.teinte.opacite === 255)

console.log('\n--- un dessin qui a déjà sa rampe ---')
check('l\'outil y travaille aussi', m.rampe.touched > 0, `${m.rampe.touched} pixels`)
check('et n\'invente RIEN : il reprend les couleurs déjà présentes',
  m.rampe.inventees === 0 && m.rampe.etrangeres === 0,
  'c\'est le contrat annoncé par la boîte, et il tient toujours')

console.log('\n--- ce que le détail ne doit jamais faire ---')
check('la silhouette ne change pas : aucun pixel transparent ne s\'allume',
  m.silhouette.avant === m.silhouette.apres,
  `${m.silhouette.avant} pixels opaques avant et après`)
check('la sélection borne l\'effet : hors d\'elle, rien ne bouge',
  m.selection.basChange === 0, `${m.selection.basChange} pixels touchés hors sélection`)

console.log('\n--- les cinq matières ---')
for (const mat of m.matieres) {
  check(`« ${mat.id} » fait quelque chose d'un aplat`, mat.touched > 0, `${mat.touched} pixels`)
}

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
