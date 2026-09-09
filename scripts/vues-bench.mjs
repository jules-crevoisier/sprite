/**
 * Banc des vues : un personnage dessine une fois, rendu sous toutes les
 * directions.
 *
 * Ce qui est mesure ici decide si la chose est utilisable dans un jeu ou si
 * c'est une demonstration :
 *
 * - la vue de face rend le dessin intact, pixel pour pixel ;
 * - l'isometrique 2:1 a exactement la pente 1/2, sinon les tuiles ne se
 *   raccordent pas ;
 * - le tour du compas se referme : la direction 360 est la direction 0 ;
 * - deux directions voisines ne sautent pas ;
 * - aucune direction ne se vide ni ne se perce ;
 * - aucune couleur etrangere : rien n'est interpole ;
 * - les pieces s'occultent vraiment, et l'ordre s'inverse au demi-tour ;
 * - avec trois vues sources, aucune direction n'est a plus de 45 degres d'un
 *   vrai dessin.
 *
 * La derniere est la plus importante. C'est elle qui separe « on fait tourner
 * un dessin plat et on croise les doigts » de « on sait toujours de combien
 * on invente ».
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'

const PORT = 4700 + Math.floor(Math.random() * 200)
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
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const d = await import('/src/smart/depth.ts')
  const s = await import('/src/smart/scene.ts')
  const { spritePixl } = await import('/src/ui/mascot-clips.ts')

  const TAILLE = 48
  const opts = { largeur: TAILLE, hauteur: TAILLE }

  /** Une piece a partir d'un dessin, centree sur lui-meme. */
  const pieceDe = (nom, bitmap, position, sourcesSupp = []) => {
    const champ = d.champAuto(bitmap, { hauteur: d.hauteurSuggeree(bitmap), galbe: 0.5 })
    const b = bitmap.trimBounds()
    return {
      nom,
      sources: [{ azimut: 0, elevation: 0, bitmap, champ }, ...sourcesSupp],
      pivot: { x: b.x + b.w / 2, y: b.y + b.h / 2, z: 0 },
      position,
      rotation: { lacet: 0, tangage: 0, roulis: 0 },
    }
  }

  const pixl = spritePixl().layers[0].cels[0].bitmap

  /* --- 1. La vue de face doit rendre le dessin intact --- */
  const seule = pieceDe('pixl', pixl, { x: 0, y: 0, z: 0 })
  const bp = pixl.trimBounds()
  const face = s.rendreScene([seule], s.CAMERA_FACE, {
    largeur: pixl.width, hauteur: pixl.height,
    centre: { x: bp.x + bp.w / 2, y: bp.y + bp.h / 2 },
  })
  let identique = true
  for (let i = 0; i < pixl.u32.length; i++) {
    if (pixl.u32[i] !== face.image.u32[i]) { identique = false; break }
  }

  /* --- 2. Les pentes des projections isometriques --- */
  const pente2x1 = s.penteIsometrique(s.vueParId('iso'))
  const penteVraie = s.penteIsometrique(s.vueParId('iso-vraie'))

  /* --- 3. Tour du compas : trente-six directions --- */
  const masses = []
  const etrangeres = []
  const trous = []
  const masse0 = d.masse(pixl)
  const trous0 = d.trousInterieurs(pixl)
  for (let i = 0; i < 36; i++) {
    const r = s.rendreScene([seule], { azimut: (i / 36) * Math.PI * 2, elevation: 0, zoom: 1 }, opts)
    masses.push(s.masse(r.image))
    if (d.couleursEtrangeres(pixl, r.image).length) etrangeres.push(i)
    if (d.trousInterieurs(r.image) > trous0) trous.push(i)
  }
  // Le tour se referme : la direction 36 est la direction 0.
  const boucle = s.masse(s.rendreScene([seule], { azimut: Math.PI * 2, elevation: 0, zoom: 1 }, opts).image)
  let sautMax = 0
  for (let i = 0; i < masses.length; i++) {
    sautMax = Math.max(sautMax, Math.abs(masses[i] - masses[(i + 1) % masses.length]))
  }

  /* --- 4. Occultation entre pieces, et son inversion au demi-tour --- */
  // Deux blocs unis superposes en profondeur : le rouge devant, le bleu
  // derriere. De face on doit voir du rouge ; de dos, du bleu.
  const bloc = (couleur) => {
    const b = new Bitmap(24, 24)
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) b.set(x, y, couleur)
    return b
  }
  // `Uint32Array` rend des entiers non signes : un litteral passe par `| 0`
  // deviendrait negatif et ne correspondrait a aucun pixel.
  const ROUGE = 0xff2233dd >>> 0, BLEU = 0xffdd6622 >>> 0
  const devant = pieceDe('devant', bloc(ROUGE), { x: 0, y: 0, z: 6 })
  const derriere = pieceDe('derriere', bloc(BLEU), { x: 0, y: 0, z: -6 })
  const compter = (img, couleur) => {
    let n = 0
    for (let i = 0; i < img.u32.length; i++) if (img.u32[i] === couleur) n++
    return n
  }
  const deFace = s.rendreScene([derriere, devant], { azimut: 0, elevation: 0, zoom: 1 }, opts)
  const deDos = s.rendreScene([derriere, devant], { azimut: Math.PI, elevation: 0, zoom: 1 }, opts)
  const occ = {
    faceRouge: compter(deFace.image, ROUGE),
    faceBleu: compter(deFace.image, BLEU),
    dosRouge: compter(deDos.image, ROUGE),
    dosBleu: compter(deDos.image, BLEU),
  }
  // L'ordre dans lequel les pieces sont passees ne doit rien changer : c'est
  // le tampon de profondeur qui decide, pas l'ordre d'appel.
  const inverse = s.rendreScene([devant, derriere], { azimut: 0, elevation: 0, zoom: 1 }, opts)
  const ordreIndifferent = compter(inverse.image, ROUGE) === occ.faceRouge
    && compter(inverse.image, BLEU) === occ.faceBleu

  /* --- 5. Plusieurs vues sources : de combien invente-t-on ? --- */
  const champDe = (b) => d.champAuto(b, { hauteur: d.hauteurSuggeree(b), galbe: 0.5 })
  const uneSeule = pieceDe('une', pixl, { x: 0, y: 0, z: 0 })
  const troisVues = pieceDe('trois', pixl, { x: 0, y: 0, z: 0 }, [
    { azimut: Math.PI / 2, elevation: 0, bitmap: pixl, champ: champDe(pixl) },
    { azimut: Math.PI, elevation: 0, bitmap: pixl, champ: champDe(pixl) },
    { azimut: -Math.PI / 2, elevation: 0, bitmap: pixl, champ: champDe(pixl) },
  ])
  let ecartUne = 0, ecartQuatre = 0
  for (let i = 0; i < 36; i++) {
    const az = (i / 36) * Math.PI * 2
    ecartUne = Math.max(ecartUne,
      s.rendreScene([uneSeule], { azimut: az, elevation: 0, zoom: 1 }, opts).ecartMax)
    ecartQuatre = Math.max(ecartQuatre,
      s.rendreScene([troisVues], { azimut: az, elevation: 0, zoom: 1 }, opts).ecartMax)
  }

  /* --- 6. Une planche de huit directions --- */
  const planche = s.planchesDeDirections([seule], 8, s.ELEVATION_ISO_2_1, opts)
  const signatures = planche.map((p) => {
    let h = 0
    for (let i = 0; i < p.rendu.image.u32.length; i++) h = (h * 31 + p.rendu.image.u32[i]) | 0
    return h
  })
  const distinctes = new Set(signatures).size

  return {
    identique,
    pente2x1, penteVraie,
    masse0, minMasse: Math.min(...masses), maxMasse: Math.max(...masses),
    boucle, masse0Rendue: masses[0],
    sautMax, etrangeres: etrangeres.length, trous: trous.length,
    occ, ordreIndifferent,
    ecartUne: (ecartUne * 180) / Math.PI,
    ecartQuatre: (ecartQuatre * 180) / Math.PI,
    directions: planche.length, distinctes,
    noms: planche.map((p) => p.nom).join(','),
  }
})

console.log('')
check('la vue de face rend le dessin intact', m.identique)

// Le « 2:1 » est une pente, pas un angle : un pas vers l'est descend d'un
// pixel pour deux vers la droite. Une elevation mal recopiee se voit ici.
check('l\'isometrique 2:1 a exactement la pente 1/2',
  Math.abs(m.pente2x1 - 0.5) < 1e-9, `pente ${m.pente2x1.toFixed(6)}`)
check('l\'isometrique vraie raccourcit les trois axes pareil',
  Math.abs(m.penteVraie - 1 / Math.sqrt(3)) < 1e-9, `pente ${m.penteVraie.toFixed(6)}`)

check('le tour du compas se referme', m.boucle === m.masse0Rendue,
  `${m.masse0Rendue} puis ${m.boucle} pixels`)
check('aucune direction ne se vide', m.minMasse >= m.masse0 * 0.7,
  `au pire ${Math.round((m.minMasse / m.masse0) * 100)}% de la masse de face`)
check('aucune direction n\'enfle', m.maxMasse <= m.masse0 * 1.6,
  `au plus ${Math.round((m.maxMasse / m.masse0) * 100)}%`)
check('pas de saut d\'une direction a la suivante', m.sautMax <= m.masse0 * 0.2,
  `saut max ${m.sautMax} pixels sur ${m.masse0}`)
check('aucune couleur etrangere', m.etrangeres === 0, `${m.etrangeres} direction(s)`)
check('aucune silhouette percee', m.trous === 0, `${m.trous} direction(s)`)

// L'occultation est ce qui distingue une composition d'un empilement : sans
// tampon partage, la piece dessinee en dernier gagne toujours, meme quand
// elle est derriere.
check('la piece de devant cache celle de derriere',
  m.occ.faceRouge > 0 && m.occ.faceBleu === 0,
  `${m.occ.faceRouge} rouge, ${m.occ.faceBleu} bleu`)
check('au demi-tour, l\'ordre s\'inverse tout seul',
  m.occ.dosBleu > 0 && m.occ.dosRouge === 0,
  `${m.occ.dosRouge} rouge, ${m.occ.dosBleu} bleu`)
check('l\'ordre d\'appel des pieces ne change rien', m.ordreIndifferent)

// La mesure qui compte : de combien le rendu invente-t-il ? Avec un seul
// dessin de face, le dos est a 180 degres — entierement devine. Avec quatre
// vues, plus rien n'est a plus de 45 degres d'un dessin reel.
check('avec un seul dessin, le banc avoue qu\'il invente le dos',
  m.ecartUne > 170, `jusqu'a ${Math.round(m.ecartUne)}deg d'ecart`)
check('avec quatre vues, aucune direction n\'invente plus de 45 degres',
  m.ecartQuatre <= 45.001, `au pire ${Math.round(m.ecartQuatre)}deg`)

check('une planche de huit directions sort huit images distinctes',
  m.directions === 8 && m.distinctes === 8, `${m.distinctes}/8 distinctes`)
check('les directions portent les noms qu\'un moteur attend',
  m.noms === 'S,SE,E,NE,N,NO,O,SO', m.noms)

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} verifications reussies`)
process.exit(rates.length ? 1 : 0)
