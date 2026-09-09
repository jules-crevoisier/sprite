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

  /* --- Mesures qui regardent l'image, pas seulement son poids --- */

  /** Pixels opaques ayant au moins un voisin orthogonal vide ou hors cadre. */
  const bordDe = (img) => {
    const w = img.width, h = img.height
    const out = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if ((img.u32[i] >>> 24) === 0) continue
        const vide = (xx, yy) => xx < 0 || yy < 0 || xx >= w || yy >= h
          || (img.u32[yy * w + xx] >>> 24) === 0
        if (vide(x - 1, y) || vide(x + 1, y) || vide(x, y - 1) || vide(x, y + 1)) out.push(i)
      }
    }
    return out
  }

  /**
   * Couleurs qui font le contour du dessin : celles qui couvrent au moins
   * 60% de ses pixels de bord.
   */
  const couleursDeTrait = (img) => {
    const bord = bordDe(img)
    const compte = new Map()
    for (const i of bord) compte.set(img.u32[i], (compte.get(img.u32[i]) ?? 0) + 1)
    const tri = [...compte].sort((a, b) => b[1] - a[1])
    const cle = new Set()
    let cumul = 0
    for (const [c, n] of tri) {
      cle.add(c)
      cumul += n
      if (cumul >= bord.length * 0.6) break
    }
    return cle
  }

  /**
   * Part du contour encore tenue par les couleurs de trait.
   *
   * C'est la mesure qui dit si la silhouette se lit encore. Un flanc repeint
   * par le remplissage, un trait rompu, un bandeau qui deborde : tout cela
   * fait chuter ce taux, la ou la masse ne bouge pas d'un pixel.
   */
  const tauxDeTrait = (img, cle) => {
    const bord = bordDe(img)
    if (!bord.length) return 0
    let n = 0
    for (const i of bord) if (cle.has(img.u32[i])) n++
    return n / bord.length
  }

  /** Effectif de chaque couleur. */
  const effectifs = (img) => {
    const m = new Map()
    for (let i = 0; i < img.u32.length; i++) {
      const c = img.u32[i]
      if ((c >>> 24) === 0) continue
      m.set(c, (m.get(c) ?? 0) + 1)
    }
    return m
  }

  /** Pixels dont la couleur differe de tous leurs voisins orthogonaux. */
  const mouchetures = (img) => {
    const w = img.width, h = img.height
    let n = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const c = img.u32[i]
        if ((c >>> 24) === 0) continue
        let voisins = 0, pareils = 0
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const v = img.u32[yy * w + xx]
          if ((v >>> 24) === 0) continue
          voisins++
          if (v === c) pareils++
        }
        if (voisins > 0 && pareils === 0) n++
      }
    }
    return n
  }

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
  const cle = couleursDeTrait(pixl)
  const traitSource = tauxDeTrait(pixl, cle)
  const effSource = effectifs(pixl)
  const mouchSource = mouchetures(pixl)
  // Les « accents » : les couleurs rares, celles qui portent les yeux, le nez,
  // un reflet. Elles pesent trop peu pour que la masse les voie disparaitre.
  const accents = [...effSource].filter(([, n]) => n <= s.masse(pixl) * 0.05)
  const pivotUn = s.pivotDesPieces([seule])
  const cadreUn = { ...opts, pivotMonde: pivotUn }
  /** Le plus grand azimut, en degres, ou tout tient encore. */
  let domaine = 0
  const trait = []
  let accentsPerdus = null
  let mouchMax = mouchSource
  // Ce que la compression prevoit a chaque direction : c'est contre elle que
  // se juge la masse, et non contre un pourcentage fixe. Comprimer un dessin,
  // c'est justement lui retirer de la largeur.
  const profilPixl = d.profilDe(pixl, seule.sources[0].champ)
  let pireMasse = { deg: 0, marge: Infinity, ratio: 1, prevu: 1 }
  for (let i = 0; i < 36; i++) {
    const deg = (i / 36) * 360
    const r = s.rendreScene([seule], { azimut: (deg * Math.PI) / 180, elevation: 0, zoom: 1 }, cadreUn)
    masses.push(s.masse(r.image))
    {
      const ratio = s.masse(r.image) / masse0
      const prevu = Math.abs(d.compression(profilPixl, (deg * Math.PI) / 180))
      if (ratio - prevu < pireMasse.marge) {
        pireMasse = { deg: Math.round(deg), marge: ratio - prevu, ratio, prevu }
      }
    }
    if (d.couleursEtrangeres(pixl, r.image).length) etrangeres.push(i)
    if (d.trousInterieurs(r.image) > trous0) trous.push(i)

    const t = tauxDeTrait(r.image, cle)
    trait.push({ deg: Math.round(deg), t })
    const eff = effectifs(r.image)
    let accentOk = true
    for (const [c, n] of accents) {
      const vu = eff.get(c) ?? 0
      if (Math.abs(vu - n) > Math.max(1, n * 0.25)) { accentOk = false; break }
    }
    mouchMax = Math.max(mouchMax, mouchetures(r.image))
    const angle = deg > 180 ? 360 - deg : deg
    if (t >= traitSource * 0.9 && accentOk && angle >= domaine) domaine = angle
    if (!accentOk && accentsPerdus === null) accentsPerdus = Math.round(angle)
  }
  // Le domaine honnete : le plus grand angle tel que le trait tienne a TOUS
  // les angles inferieurs. Prendre le maximum des angles ou il tient donnait
  // 180 degres — parce que le dos, etant le miroir exact de la face, a un
  // contour parfait. La mesure annoncait donc un domaine complet en
  // s'appuyant sur l'artefact meme qu'elle devait denoncer.
  const parAngle = new Map()
  for (const { deg, t } of trait) {
    const angle = deg > 180 ? 360 - deg : deg
    parAngle.set(angle, Math.min(parAngle.get(angle) ?? 1, t))
  }
  const angles = [...parAngle.keys()].sort((a, b) => a - b)
  let domaineHonnete = 0
  for (const a of angles) {
    if (parAngle.get(a) < traitSource * 0.9) break
    domaineHonnete = a
  }
  // Le tour se referme : la direction 36 est la direction 0.
  const boucle = s.masse(s.rendreScene([seule], { azimut: Math.PI * 2, elevation: 0, zoom: 1 }, opts).image)
  let sautMax = 0
  for (let i = 0; i < masses.length; i++) {
    sautMax = Math.max(sautMax, Math.abs(masses[i] - masses[(i + 1) % masses.length]))
  }

  /* --- 3bis. La vue de dos devinee --- */
  const vues = await import('/src/smart/vues.ts')
  const perso0 = (await import('/src/ui/demo-content.ts')).demoCharacter()
    .layers[0].cels[0].bitmap
  const dosDe = (img) => {
    const retourne = vues.retourner(img)
    const efface = vues.effacerLesDetails(retourne)
    const palette = (b) => {
      const set = new Set()
      for (let i = 0; i < b.u32.length; i++) if ((b.u32[i] >>> 24) !== 0) set.add(b.u32[i])
      return set
    }
    const silhouette = (b) => {
      let n = 0
      for (let i = 0; i < b.u32.length; i++) if ((b.u32[i] >>> 24) !== 0) n++
      return n
    }
    const source = palette(img)
    let etrangeres = 0
    for (const c of palette(efface)) if (!source.has(c)) etrangeres++
    // Ce que l'effacement a change : les pixels du visage.
    let changes = 0
    for (let i = 0; i < efface.u32.length; i++) {
      if (efface.u32[i] !== retourne.u32[i]) changes++
    }
    return {
      masseSource: silhouette(img),
      masseDos: silhouette(efface),
      etrangeres,
      changes,
      bordIdentique: JSON.stringify(efface.trimBounds()) === JSON.stringify(retourne.trimBounds()),
    }
  }
  const dos = { perso: dosDe(perso0), pixl: dosDe(pixl) }

  // Avec une vue de dos, aucune direction n'est a plus d'un quart de tour
  // d'un dessin. Sans elle, le demi-tour invente tout.
  const avecDos = pieceDe('pixl', pixl, { x: 0, y: 0, z: 0 },
    [(() => {
      const bitmap = vues.vueDeDos(pixl)
      return {
        azimut: Math.PI, elevation: 0, bitmap,
        champ: d.champAuto(bitmap, { hauteur: d.hauteurSuggeree(bitmap), galbe: 0.5 }),
      }
    })()])
  let ecartAvecDos = 0, ecartSansDos = 0
  for (let i = 0; i < 36; i++) {
    const az = (i / 36) * Math.PI * 2
    ecartAvecDos = Math.max(ecartAvecDos,
      s.rendreScene([avecDos], { azimut: az, elevation: 0, zoom: 1 }, cadreUn).ecartMax)
    ecartSansDos = Math.max(ecartSansDos,
      s.rendreScene([seule], { azimut: az, elevation: 0, zoom: 1 }, cadreUn).ecartMax)
  }
  dos.ecartAvecDos = Math.round((ecartAvecDos * 180) / Math.PI)
  dos.ecartSansDos = Math.round((ecartSansDos * 180) / Math.PI)

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
  // Quatre vues REELLEMENT differentes. Les passer toutes identiques ne
  // mesurait que l'arithmetique d'angles de `choisirSource` : le rendu
  // n'etait jamais regarde, et la couture entre deux sources — l'endroit ou
  // l'image saute — restait invisible par construction.
  const clips = await import('/src/ui/mascot-clips.ts')
  const spr = clips.spritePixl()
  const autreVue = (n) => spr.layers[0].cels[n]?.bitmap ?? pixl
  const vueE = autreVue(10), vueN = autreVue(20), vueO = autreVue(30)
  const troisVues = pieceDe('trois', pixl, { x: 0, y: 0, z: 0 }, [
    { azimut: Math.PI / 2, elevation: 0, bitmap: vueE, champ: champDe(vueE) },
    { azimut: Math.PI, elevation: 0, bitmap: vueN, champ: champDe(vueN) },
    { azimut: -Math.PI / 2, elevation: 0, bitmap: vueO, champ: champDe(vueO) },
  ])

  // I3 : la couture. Les azimuts de bascule sont les bissectrices des
  // directions sources — ici 45, 135, 225, 315 degres. De part et d'autre,
  // a un dixieme de degre, l'image ne doit pas sauter.
  // Ecart intrinseque entre deux dessins sources voisins : la borne sous
  // laquelle aucun rendu ne peut descendre.
  let ecartSources = 0
  for (const [a, b] of [[pixl, vueE], [vueE, vueN], [vueN, vueO], [vueO, pixl]]) {
    let diff = 0, plein = 0
    for (let i = 0; i < a.u32.length; i++) {
      if (a.u32[i] !== b.u32[i]) diff++
      if ((a.u32[i] >>> 24) !== 0) plein++
    }
    ecartSources = Math.max(ecartSources, diff / Math.max(1, plein))
  }


  let coutureMax = 0
  for (const bascule of [45, 135, 225, 315]) {
    const rendu = (deg) => s.rendreScene([troisVues],
      { azimut: (deg * Math.PI) / 180, elevation: 0, zoom: 1 }, opts).image
    const a = rendu(bascule - 0.1), b = rendu(bascule + 0.1)
    let diff = 0
    for (let i = 0; i < a.u32.length; i++) if (a.u32[i] !== b.u32[i]) diff++
    const m = Math.max(1, s.masse(a))
    coutureMax = Math.max(coutureMax, diff / m)
  }
  let ecartUne = 0, ecartQuatre = 0
  for (let i = 0; i < 36; i++) {
    const az = (i / 36) * Math.PI * 2
    ecartUne = Math.max(ecartUne,
      s.rendreScene([uneSeule], { azimut: az, elevation: 0, zoom: 1 }, opts).ecartMax)
    ecartQuatre = Math.max(ecartQuatre,
      s.rendreScene([troisVues], { azimut: az, elevation: 0, zoom: 1 }, opts).ecartMax)
  }

  /* --- 6. Le pont avec le squelette --- */
  const rs = await import('/src/smart/rig-scene.ts')
  const rig = await import('/src/smart/rig.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')

  const perso = demoCharacter()
  const dessinPerso = perso.layers[0].cels[0].bitmap
  applyTemplate(perso.rig, RIG_TEMPLATES[0], dessinPerso,
    { width: perso.width, height: perso.height })
  const partie = rig.autoBind(perso.rig, perso.layers[0].id, dessinPerso)
  perso.rig.parts = [partie]

  const morceaux = rs.piecesDuRig(perso.rig, partie)
  const bilan = rs.bilanDecoupage(partie, morceaux)
  const piecesRepos = morceaux.map((x) => x.piece)

  // Un sujet ou des pixels restent volontairement libres : sans lui, la
  // regle « rien ne se perd » ne prouve rien, puisque la liaison ordinaire
  // attribue tout. Une portee courte laisse les extremites sans os.
  const court = rig.autoBind(perso.rig, perso.layers[0].id, dessinPerso, 3)
  const morceauxCourt = rs.piecesDuRig(perso.rig, court)
  const bilanCourt = rs.bilanDecoupage(court, morceauxCourt)
  let libres = 0
  for (let i = 0; i < court.weights.length; i++) {
    if (court.weights[i] === 255 && (dessinPerso.u32[i] >>> 24) !== 0) libres++
  }

  // Au repos et de face, la scene doit rendre le dessin d'origine.
  const reposRendu = s.rendreScene(piecesRepos, s.CAMERA_FACE, {
    largeur: perso.width, hauteur: perso.height, centre: { x: 0, y: 0 },
  })
  const dessin = dessinPerso
  let reposIdentique = true
  for (let i = 0; i < dessin.u32.length; i++) {
    if (dessin.u32[i] !== reposRendu.image.u32[i]) { reposIdentique = false; break }
  }

  // Une pose : on leve un bras, puis on regarde sous huit directions.
  const bras = perso.rig.bones.find((b) => b.role === 'armL') ?? perso.rig.bones[1]
  const iBras = perso.rig.bones.indexOf(bras)
  const cadre = { largeur: perso.width, hauteur: perso.height, centre: { x: 0, y: 0 } }
  /** Centre du morceau d'un os, rendu seul et de face. */
  const centreDuMorceau = (liste) => {
    const seul = liste.find((x) => x.os === iBras)
    if (!seul) return null
    const b = s.rendreScene([seul.piece], s.CAMERA_FACE, cadre).image.trimBounds()
    return b.w ? { x: b.x + b.w / 2, y: b.y + b.h / 2, w: b.w, h: b.h } : null
  }
  const brasAvant = centreDuMorceau(morceaux)
  const ANGLE = -0.9
  // Ou le centre du bras DOIT atterrir : le point d'avant, tourne de l'angle
  // pose, autour de l'attache de l'os. C'est de la geometrie, pas une
  // opinion — et une rotation autour du mauvais axe n'y tombe pas.
  const attendu = brasAvant ? {
    x: bras.x + (brasAvant.x - bras.x) * Math.cos(ANGLE) - (brasAvant.y - bras.y) * Math.sin(ANGLE),
    y: bras.y + (brasAvant.x - bras.x) * Math.sin(ANGLE) + (brasAvant.y - bras.y) * Math.cos(ANGLE),
  } : null
  bras.angle = ANGLE
  const morceauxPose = rs.piecesDuRig(perso.rig, partie)
  const brasApres = centreDuMorceau(morceauxPose)
  const piecesPose = morceauxPose.map((x) => x.piece)
  const posee = s.rendreScene(piecesPose, s.CAMERA_FACE, {
    largeur: perso.width, hauteur: perso.height, centre: { x: 0, y: 0 },
  })
  let bougePose = 0
  for (let i = 0; i < dessin.u32.length; i++) {
    if (dessin.u32[i] !== posee.image.u32[i]) bougePose++
  }

  // La profondeur d'un os est ce qui fait passer un bras DEVANT le torse.
  // A quatre-vingt-dix degres d'azimut, la profondeur devient l'abscisse a
  // l'écran : un os pose a +6 doit se retrouver six pixels plus loin qu'un
  // os laisse dans le plan. Si le pont ignore `bone.depth`, les deux se
  // superposent et les membres traversent le corps au quart de tour.
  const profil = { azimut: Math.PI / 2, elevation: 0, zoom: 1 }
  const centreProfil = () => {
    const seul = rs.piecesDuRig(perso.rig, partie).find((x) => x.os === iBras)
    if (!seul) return null
    const b = s.rendreScene([seul.piece], profil, cadre).image.trimBounds()
    return b.w ? b.x + b.w / 2 : null
  }
  const profondeurAvant = bras.depth
  bras.depth = 0
  const xSansProfondeur = centreProfil()
  bras.depth = 6
  const xAvecProfondeur = centreProfil()
  bras.depth = profondeurAvant

  // Le cadre natif, pas un cadre double : c'est justement en doublant que le
  // banc masquait la derive du personnage.
  const dirsPose = s.planchesDeDirections(piecesPose, 8, s.ELEVATION_ISO_2_1, {
    largeur: perso.width, hauteur: perso.height,
  })
  // I4 : le personnage doit tourner sur lui-meme, pas orbiter. On suit le
  // centre de sa boite englobante d'une direction a l'autre.
  const centres = dirsPose.map((p) => {
    const b = p.rendu.image.trimBounds()
    return b.w ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null
  })
  const videsPose = centres.filter((c) => !c).length
  const xs = centres.filter(Boolean).map((c) => c.x)
  const ys = centres.filter(Boolean).map((c) => c.y)
  const deriveX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
  const deriveY = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
  const sigPose = dirsPose.map((p) => {
    let h = 0
    for (let i = 0; i < p.rendu.image.u32.length; i++) h = (h * 31 + p.rendu.image.u32[i]) | 0
    return h
  })
  const massesPose = dirsPose.map((p) => s.masse(p.rendu.image))

  /* --- 7. Une planche de huit directions --- */
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
    coutureMax, ecartSources,
    ecartUne: (ecartUne * 180) / Math.PI,
    ecartQuatre: (ecartQuatre * 180) / Math.PI,
    directions: planche.length, distinctes,
    noms: planche.map((p) => p.nom).join(','),
    traitSource, trait, domaineHonnete, accentsPerdus,
    mouchSource, mouchMax, nbAccents: accents.length,
    bilan, reposIdentique, bougePose,
    bilanCourt, libres,
    brasAvant, brasApres, attendu,
    xSansProfondeur, xAvecProfondeur,
    ecartPose: brasApres && attendu
      ? Math.hypot(brasApres.x - attendu.x, brasApres.y - attendu.y) : null,
    osUtilises: morceaux.filter((x) => x.os !== null).length,
    posesDistinctes: new Set(sigPose).size,
    videsPose, deriveX, deriveY, pireMasse, dos,
    minPose: Math.min(...massesPose), maxPose: Math.max(...massesPose),
  }
})

console.log('')
check('la vue de face rend le dessin intact', m.identique)

// Le « 2:1 » est une pente, pas un angle : un pas vers l'est descend d'un
// pixel pour deux vers la droite. Une elevation mal recopiee se voit ici.
check('l\'isométrique 2:1 a exactement la pente 1/2',
  Math.abs(m.pente2x1 - 0.5) < 1e-9, `pente ${m.pente2x1.toFixed(6)}`)
check('l\'isométrique vraie raccourcit les trois axes pareil',
  Math.abs(m.penteVraie - 1 / Math.sqrt(3)) < 1e-9, `pente ${m.penteVraie.toFixed(6)}`)

check('le tour du compas se referme', m.boucle === m.masse0Rendue,
  `${m.masse0Rendue} puis ${m.boucle} pixels`)
check('la masse de chaque direction suit la compression annoncee',
  m.pireMasse.marge >= -0.08,
  `au pire ${(m.pireMasse.ratio * 100).toFixed(0)}% a ${m.pireMasse.deg}deg,`
  + ` la compression en prevoit ${(m.pireMasse.prevu * 100).toFixed(0)}%`)
check('aucune direction ne se vide', m.minMasse >= m.masse0 * 0.4,
  `au pire ${Math.round((m.minMasse / m.masse0) * 100)}% de la masse de face`)
check('aucune direction n\'enfle', m.maxMasse <= m.masse0 * 1.6,
  `au plus ${Math.round((m.maxMasse / m.masse0) * 100)}%`)
check('pas de saut d\'une direction a la suivante', m.sautMax <= m.masse0 * 0.2,
  `saut max ${m.sautMax} pixels sur ${m.masse0}`)
check('aucune couleur etrangere', m.etrangeres === 0, `${m.etrangeres} direction(s)`)

/* --- ce que la masse ne voit pas --- */

// La masse d'un personnage repeint en noir par son propre trait de contour
// ne bouge pas d'un pixel. Le taux de trait, lui, s'effondre : c'est la
// mesure qui dit si la silhouette se lit encore.
check('le contour tient sur le domaine annonce',
  m.domaineHonnete >= 20,   // DEFAUT CONNU : vaut 0 aujourd'hui, voir scene.ts
  `le trait tient jusqu'a ${m.domaineHonnete}deg `
  + `(${m.trait.filter((x) => x.deg <= 90).map((x) => `${x.deg}:${x.t.toFixed(2)}`).join(' ')})`)

// Les yeux, le nez : quelques pixels chacun, invisibles pour la masse.
check('les accents survivent au domaine annonce',
  m.accentsPerdus === null || m.accentsPerdus >= 20,
  m.accentsPerdus === null
    ? `${m.nbAccents} accent(s) tiennent partout`
    : `${m.nbAccents} accent(s), le premier lache a ${m.accentsPerdus}deg`)

check('les aplats ne se mouchettent pas',
  m.mouchMax <= m.mouchSource + 2,
  `${m.mouchSource} pixel(s) isole(s) a la source, ${m.mouchMax} au pire`)

// La couture entre deux vues sources : c'est la que l'image saute, et
// aucune mesure de masse ne peut le voir.
// On ne peut pas faire mieux que l'ecart entre les deux dessins : si le
// profil et la face different de 70%, la bascule les fait forcement sauter
// d'autant. Ce qu'on exige, c'est que le rendu n'AJOUTE pas de saut — et
// qu'avec deux sources identiques il n'y en ait aucun.
// Une regle a ete ecrite ici puis retiree : « deux vues sources identiques
// ne doivent faire aucun saut ». Elle est fausse. Declarer le meme dessin
// comme vue de face ET de profil, c'est affirmer que le personnage a la meme
// apparence des deux cotes ; a la bascule, l'un est rendu tourne de +45
// degres et l'autre de -45, et le saut est la consequence honnete d'une
// donnee contradictoire, pas un defaut du rendu.
check('le saut de bascule ne dépasse pas l\'écart entre les deux dessins',
  m.coutureMax <= m.ecartSources * 1.1 + 0.02,
  `saut ${Math.round(m.coutureMax * 100)}%, les dessins different de `
  + `${Math.round(m.ecartSources * 100)}%`)
check('aucune silhouette percee', m.trous === 0, `${m.trous} direction(s)`)

// L'occultation est ce qui distingue une composition d'un empilement : sans
// tampon partage, la piece dessinee en dernier gagne toujours, meme quand
// elle est derriere.
check('la piece de devant cache celle de derrière',
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
  m.ecartUne > 170, `jusqu'a ${Math.round(m.ecartUne)}deg d'écart`)
check('avec quatre vues, aucune direction n\'invente plus de 45 degres',
  m.ecartQuatre <= 45.001, `au pire ${Math.round(m.ecartQuatre)}deg`)

check('une planche de huit directions sort huit images distinctes',
  m.directions === 8 && m.distinctes === 8, `${m.distinctes}/8 distinctes`)
check('les directions portent les noms qu\'un moteur attend',
  m.noms === 'S,SE,E,NE,N,NO,O,SO', m.noms)

/* --- le pont avec le squelette --- */

// Un pixel attribue a aucun os disparaitrait du rendu ; un pixel compte deux
// fois clignoterait selon l'ordre du tampon. Les deux se voient a peine sur
// une image fixe et sautent aux yeux en mouvement.
check('le découpage par os ne perd ni ne duplique aucun pixel',
  m.bilan.morceaux === m.bilan.origine && m.bilan.doublons === 0,
  `${m.bilan.origine} pixels -> ${m.bilan.morceaux}, ${m.bilan.doublons} doublon(s), `
  + `${m.osUtilises} os porteurs`)
check('les pixels qu\'aucun os ne porte sont gardes',
  m.libres > 0 && m.bilanCourt.morceaux === m.bilanCourt.origine && m.bilanCourt.doublons === 0,
  `${m.libres} pixel(s) libre(s), ${m.bilanCourt.morceaux}/${m.bilanCourt.origine} gardes`)
check('la pose de repos rendue de face redonne le dessin', m.reposIdentique)

// La regle qui distingue une pose juste d'une pose seulement differente : le
// bras doit atterrir la ou la geometrie le dit, pas ailleurs. Une rotation
// autour du mauvais axe deplace autant de pixels et passerait tous les
// comptages ; ici elle rate la cible de plusieurs pixels.
check('le bras pose atterrit ou la géométrie le dit',
  m.ecartPose !== null && m.ecartPose <= 1.5,
  m.attendu && m.brasApres
    ? `attendu (${m.attendu.x.toFixed(1)}, ${m.attendu.y.toFixed(1)}), `
      + `obtenu (${m.brasApres.x.toFixed(1)}, ${m.brasApres.y.toFixed(1)}) — `
      + `${m.ecartPose.toFixed(2)} px d'écart`
    : 'morceau introuvable')
check('la profondeur d\'un os le place vraiment devant le corps',
  m.xSansProfondeur !== null && m.xAvecProfondeur !== null
  && Math.abs(m.xAvecProfondeur - m.xSansProfondeur - 6) <= 1,
  m.xSansProfondeur !== null
    ? `x ${m.xSansProfondeur} sans profondeur, ${m.xAvecProfondeur} a +6`
    : 'morceau introuvable')
check('poser un os change vraiment le rendu', m.bougePose > 20,
  `${m.bougePose} pixels differents`)
// Le personnage doit tourner sur lui-meme. Sans pivot, la camera le fait
// orbiter autour du coin du cadre : il en sort.
check('le personnage tourne sur lui-même et reste dans son cadre',
  m.videsPose === 0 && m.deriveX <= 4 && m.deriveY <= 4,
  `${m.videsPose} direction(s) vide(s), derive ${m.deriveX.toFixed(1)} x ${m.deriveY.toFixed(1)} px`)
check('une pose se rend sous huit directions distinctes',
  m.posesDistinctes === 8, `${m.posesDistinctes}/8`)
check('aucune direction d\'une pose ne se vide',
  m.minPose > 0 && m.minPose >= m.maxPose * 0.55,
  `de ${m.minPose} a ${m.maxPose} pixels`)

/* --- La vue de dos devinee --- */
console.log('')
for (const [nom, d2] of Object.entries(m.dos)) {
  if (nom.startsWith('ecart')) continue
  check(`dos ${nom} : la silhouette ne bouge pas`,
    d2.masseDos === d2.masseSource && d2.bordIdentique,
    `${d2.masseSource} -> ${d2.masseDos} pixels`)
  check(`dos ${nom} : aucune couleur inventee`, d2.etrangeres === 0,
    `${d2.etrangeres} couleur(s)`)
  // Contre-epreuve : si rien ne changeait, la regle ne servirait a rien et le
  // personnage garderait ses yeux dans la nuque.
  check(`dos ${nom} : les traits du visage sont bien effaces`, d2.changes > 0,
    `${d2.changes} pixel(s) repeints`)
}
check('avec une vue de dos, aucune direction n\'invente plus d\'un quart de tour',
  m.dos.ecartAvecDos <= 90,
  `${m.dos.ecartAvecDos}deg avec, ${m.dos.ecartSansDos}deg sans`)
check('sans vue de dos, le banc avoue que le demi-tour est invente',
  m.dos.ecartSansDos >= 175, `${m.dos.ecartSansDos}deg`)

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
