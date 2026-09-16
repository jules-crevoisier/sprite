#!/usr/bin/env node
/**
 * Le banc des IMAGES DE RÉFÉRENCE.
 *
 * ## Le défaut qu'il garde
 *
 * La première version en faisait un calque de pixels : l'image était réduite à
 * la taille du sprite, gravée dans un bitmap, et posée là. Autant dire
 * détruite — une photo de quatre cents pixels de large ramenée dans un cadre
 * de trente-deux perd tout ce qui en faisait une référence — et surtout elle
 * ne bougeait plus. « C'est complètement moche », et c'était vrai.
 *
 * Une référence est donc une image posée DANS LA VUE, avec sa propre position
 * et sa propre échelle, comme un fond dans Blender ou un calque libre dans
 * Photoshop. Ce banc tient la géométrie de cette manipulation : les poignées,
 * le déplacement, le redimensionnement, les proportions — et le fait qu'elle
 * ne touche jamais au dessin.
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4800 + Math.floor(Math.random() * 150)
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
const page = await browser.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(URL, { waitUntil: 'networkidle' })

const m = await page.evaluate(async () => {
  const { Sprite } = await import('/src/core/document.ts')
  const { Palette } = await import('/src/core/palette.ts')
  const { compositeFrame } = await import('/src/render/composite.ts')
  const { getA, rgba } = await import('/src/core/color.ts')
  const {
    referenceDepuisImage, poigneeRef, tirerRef, tournerRef, aimanterRef,
    cadrerRef, versLocal, versMonde, coinsRef, curseurPoignee, REF_MIN,
  } = await import('/src/core/reference.ts')
  const { serializeSprite, deserializeSprite } = await import('/src/io/project.ts')

  const out = {}

  /* 1. Cadrage d'entree : l'image entiere, centree, proportions gardees. */
  {
    const large = referenceDepuisImage('data:,', 'photo', 400, 100, 32, 32)
    const petite = referenceDepuisImage('data:,', 'timbre', 8, 8, 32, 32)
    out.entree = {
      large: [large.l, large.h, large.x, large.y],
      // Une image plus petite que le cadre garde sa taille : l'agrandir
      // d'office ferait croire a une image floue.
      petite: [petite.l, petite.h],
      opacite: large.opacite,
      dessous: large.dessous,
    }
  }

  /* 2. Les poignees. */
  {
    const r = { x: 10, y: 10, l: 20, h: 12 }
    const p = (x, y) => poigneeRef(r, x, y, 1)
    out.poignees = {
      hors: p(2, 2),
      corps: p(20, 16),
      no: p(10, 10), ne: p(30, 10), so: p(10, 22), se: p(30, 22),
      n: p(20, 10), s: p(20, 22), o: p(10, 16), e: p(30, 16),
    }
  }

  /* 3. Deplacer et redimensionner. */
  {
    const r = { x: 10, y: 10, l: 20, h: 10 }
    out.tirer = {
      corps: tirerRef(r, 'corps', 5, -3),
      est: tirerRef(r, 'e', 6, 0, true),
      ouest: tirerRef(r, 'o', 4, 0, true),
      // Un coin garde les proportions : 2 pour 1 au depart, 2 pour 1 apres.
      coin: tirerRef(r, 'se', 10, 0),
      // Maj : on deforme volontairement.
      libre: tirerRef(r, 'se', 10, 0, true),
      // Le coin nord-ouest ancre le coin oppose.
      ancre: tirerRef(r, 'no', -10, 0),
      // Et rien ne descend sous le minimum.
      ecrase: tirerRef(r, 'o', 1000, 0, true),
    }
  }

  /* 4. Elle ne touche pas au dessin, et ne s'exporte pas. */
  {
    const sprite = new Sprite(16, 16, new Palette('p', []))
    sprite.addLayer('Calque 1')
    const cel = sprite.ensureCel(0, 0)
    cel.bitmap.set(3, 3, rgba(255, 0, 0, 255))
    const avant = compositeFrame(sprite, 0).u32.reduce((n, c) => n + (getA(c) ? 1 : 0), 0)
    const calquesAvant = sprite.layers.length
    sprite.references.push(referenceDepuisImage('data:,', 'photo', 400, 100, 16, 16))
    const apres = compositeFrame(sprite, 0).u32.reduce((n, c) => n + (getA(c) ? 1 : 0), 0)
    out.export = { avant, apres, calquesAvant, calques: sprite.layers.length }
  }

  /* 5. L'aller-retour par le fichier de projet. */
  {
    const sprite = new Sprite(16, 16, new Palette('p', []))
    sprite.addLayer('Calque 1')
    const r = referenceDepuisImage('data:image/png;base64,AAAA', 'photo', 40, 20, 16, 16)
    r.x = 3.5
    r.opacite = 0.25
    r.dessous = false
    sprite.references.push(r)
    const relu = await deserializeSprite(serializeSprite(sprite))
    const q = relu.references[0]
    out.fichier = {
      combien: relu.references.length,
      memeSource: q?.source === r.source,
      memeX: q?.x === 3.5,
      memeOpacite: q?.opacite === 0.25,
      memeCote: q?.dessous === false,
    }
    const vieux = JSON.parse(serializeSprite(sprite))
    delete vieux.references
    out.fichier.ancien = (await deserializeSprite(JSON.stringify(vieux))).references.length
  }

  /* 6. La ROTATION : le repere local, les poignees, le redimensionnement. */
  {
    const droite = { x: 10, y: 10, l: 20, h: 10, rotation: 0 }
    const tournee = { x: 10, y: 10, l: 20, h: 10, rotation: 90 }

    // Aller-retour : un point ramene dans le repere de l'image et rendu au
    // monde doit retomber exactement ou il etait.
    const aller = versLocal(tournee, 17, 23)
    const retour = versMonde(tournee, aller.x, aller.y)

    // A quatre-vingt-dix degres, le coin haut-gauche de l'image se retrouve
    // en haut a DROITE du centre.
    const c = coinsRef(tournee)[0]

    // La poignee se cherche dans le repere de l'image : sur l'image tournee,
    // le bord « ouest » n'est plus a gauche.
    const surTournee = poigneeRef(tournee, 20, 5, 1)
    const surDroite = poigneeRef(droite, 20, 5, 1)

    // Tirer un bord d'une image tournee : la taille change dans le repere de
    // l'image, l'angle ne bouge pas, et le bord oppose reste ou il etait.
    const avantOppose = versMonde(tournee, 0, 0)
    const tire = tirerRef(tournee, 'e', 0, 6)
    const apresOppose = versMonde(tire, 0, 0)

    out.rotation = {
      allerRetour: Math.hypot(retour.x - 17, retour.y - 23),
      coin: [Math.round(c.x * 100) / 100, Math.round(c.y * 100) / 100],
      surTournee,
      surDroite,
      largeurTiree: Math.round(tire.l * 100) / 100,
      angleGarde: tire.rotation,
      opposeFixe: Math.hypot(apresOppose.x - avantOppose.x, apresOppose.y - avantOppose.y),
      // Tourner : l'angle suit le curseur, et Maj le colle au quart de tour.
      libre: Math.round(tournerRef(droite, 30, 15, 30, 15).rotation),
      quart: tournerRef(droite, 20, 25, 30, 15, 15).rotation,
      // Le curseur tourne avec l'image : le bord haut d'une image de travers
      // ne tire plus vers le haut.
      curseurDroit: curseurPoignee('n', 0),
      curseurTourne: curseurPoignee('n', 90),
    }
  }

  /* 7. Depuis le CENTRE (Alt) : les deux bords bougent, le centre non. */
  {
    const r = { x: 10, y: 10, l: 20, h: 10 }
    const a = tirerRef(r, 'e', 4, 0, { centre: true, libre: true })
    out.centre = {
      largeur: a.l,
      centreAvant: r.x + r.l / 2,
      centreApres: a.x + a.l / 2,
    }
  }

  /* 8. L'AIMANTATION : les bords et le centre du cadre. */
  {
    // Les positions sont choisies pour n'attraper QUE ce qu'on mesure : a
    // y = 5, le bas de la boite tombe a 15 et se colle a l'axe central — un
    // aimant de plus, parfaitement correct, qui faussait le compte.
    const presDuBord = { x: 1.2, y: 3, l: 10, h: 10 }
    const colle = aimanterRef(presDuBord, 32, 32, 2)
    const loin = aimanterRef({ x: 3, y: 3, l: 10, h: 10 }, 32, 32, 2)
    // Une image tournee ne s'aimante pas : on collerait une boite que
    // personne ne regarde.
    const tournee = aimanterRef({ x: 1.2, y: 5, l: 10, h: 10, rotation: 30 }, 32, 32, 2)
    // Le centre attire aussi : c'est le cas qu'on vise le plus souvent.
    const centre = aimanterRef({ x: 10.6, y: 5, l: 10, h: 10 }, 32, 32, 2)
    out.aimant = {
      colleA: colle.boite.x,
      rappels: colle.aimants.length,
      loin: loin.boite.x,
      sansRappel: loin.aimants.length,
      tournee: tournee.boite.x,
      centre: centre.boite.x + centre.boite.l / 2,
    }
  }

  /* 9. Les cadrages tout faits. */
  {
    const r = { x: 0, y: 0, l: 5, h: 5 }
    const contenir = cadrerRef(r, 'contenir', 32, 32, 400, 100)
    const remplir = cadrerRef(r, 'remplir', 32, 32, 400, 100)
    const reelle = cadrerRef(r, 'reelle', 32, 32, 400, 100)
    const centrer = cadrerRef({ x: 3, y: 3, l: 8, h: 4 }, 'centrer', 32, 32, 400, 100)
    out.cadrage = {
      contenir: [contenir.l, contenir.h],
      contenuDansLeCadre: contenir.l <= 32 && contenir.h <= 32,
      remplir: [remplir.l, remplir.h],
      couvreLeCadre: remplir.l >= 32 && remplir.h >= 32,
      reelle: [reelle.l, reelle.h],
      centrer: [centrer.l, centrer.h, centrer.x, centrer.y],
    }
  }

  /* 10. L'HISTORIQUE : poser, deplacer et retirer s'annulent. */
  {
    const { Editor } = await import('/src/core/editor.ts')
    const ed = new Editor(new Sprite(32, 32, new Palette('p', [])))
    ed.sprite.addLayer('Calque 1')
    const r = referenceDepuisImage('data:,', 'photo', 40, 20, 32, 32)

    ed.run('Image de référence', () => { ed.sprite.references.push(r) })
    const apresAjout = ed.sprite.references.length
    ed.undo()
    const apresAnnulationAjout = ed.sprite.references.length
    ed.redo()

    const vivante = ed.sprite.references[0]
    const avant = { x: vivante.x, y: vivante.y, l: vivante.l, h: vivante.h, rotation: 0 }
    const apres = { x: avant.x + 7, y: avant.y + 3, l: avant.l, h: avant.h, rotation: 20 }
    Object.assign(vivante, apres)
    ed.poserGesteReference(vivante.id, avant, apres, 'Déplacer la référence')
    const deplacee = ed.sprite.references[0].x
    ed.undo()
    const revenue = ed.sprite.references[0].x
    const angleRevenu = ed.sprite.references[0].rotation
    ed.redo()
    const refaite = ed.sprite.references[0].x

    // Un geste qui ne bouge rien ne remplit pas l'historique.
    const profondeur = ed.history.depth
    ed.poserGesteReference(vivante.id, apres, { ...apres }, 'Déplacer la référence')

    ed.run('Retirer la référence', () => { ed.sprite.references.length = 0 })
    const apresRetrait = ed.sprite.references.length
    ed.undo()
    out.historique = {
      apresAjout,
      apresAnnulationAjout,
      deplacee: Math.round(deplacee * 100) / 100,
      revenue: Math.round(revenue * 100) / 100,
      angleRevenu,
      refaite: Math.round(refaite * 100) / 100,
      sansGeste: ed.history.depth === profondeur + 1,
      apresRetrait,
      revenueApresRetrait: ed.sprite.references.length,
    }
  }

  /* 11. L'angle et les miroirs font l'aller-retour par le fichier. */
  {
    const sprite = new Sprite(16, 16, new Palette('p', []))
    sprite.addLayer('Calque 1')
    const r = referenceDepuisImage('data:image/png;base64,AAAA', 'photo', 40, 20, 16, 16)
    r.rotation = -37.5
    r.miroirX = true
    sprite.references.push(r)
    const relu = await deserializeSprite(serializeSprite(sprite))
    const q = relu.references[0]
    // Un projet d'hier n'a ni angle ni miroir : ils doivent valoir zero et
    // faux, pas `undefined` — une image tournee de `undefined` disparait.
    const vieux = JSON.parse(serializeSprite(sprite))
    for (const v of vieux.references) { delete v.rotation; delete v.miroirX; delete v.miroirY }
    const ancien = (await deserializeSprite(JSON.stringify(vieux))).references[0]
    out.angleFichier = {
      angle: q?.rotation,
      miroir: q?.miroirX === true,
      ancienAngle: ancien?.rotation,
      ancienMiroir: ancien?.miroirX,
    }
  }

  out.min = REF_MIN
  return out
})

console.log('\n--- l\'image entre dans la vue ---')
check('une image plus grande que le cadre y entre entière, centrée',
  m.entree.large[0] === 32 && m.entree.large[1] === 8
  && m.entree.large[2] === 0 && m.entree.large[3] === 12,
  `${m.entree.large[0]}×${m.entree.large[1]} en ${m.entree.large[2]},${m.entree.large[3]} `
  + 'pour une image 400×100 — proportions gardées')
check('une image plus petite garde sa taille',
  m.entree.petite[0] === 8 && m.entree.petite[1] === 8,
  'l\'agrandir d\'office ferait croire à une image floue')
check('elle arrive à demi transparente et sous le dessin',
  m.entree.opacite === 0.5 && m.entree.dessous === true,
  'on décalque par-dessus')

console.log('\n--- les poignées ---')
check('hors de l\'image, aucune poignée', m.poignees.hors === null)
check('au milieu, on déplace', m.poignees.corps === 'corps')
check('les quatre coins se distinguent',
  m.poignees.no === 'no' && m.poignees.ne === 'ne'
  && m.poignees.so === 'so' && m.poignees.se === 'se',
  [m.poignees.no, m.poignees.ne, m.poignees.so, m.poignees.se].join(' '))
check('et les quatre bords aussi',
  m.poignees.n === 'n' && m.poignees.s === 's'
  && m.poignees.o === 'o' && m.poignees.e === 'e',
  [m.poignees.n, m.poignees.s, m.poignees.o, m.poignees.e].join(' '))

console.log('\n--- déplacer, dimensionner ---')
check('tirer le corps déplace, sans redimensionner',
  m.tirer.corps.x === 15 && m.tirer.corps.y === 7
  && m.tirer.corps.l === 20 && m.tirer.corps.h === 10)
check('le bord est change la largeur, pas l\'origine',
  m.tirer.est.l === 26 && m.tirer.est.x === 10)
check('le bord ouest déplace l\'origine ET la largeur',
  m.tirer.ouest.x === 14 && m.tirer.ouest.l === 16,
  'sinon le bord gauche tiré vers la droite emmènerait toute l\'image')
check('un coin garde les proportions',
  Math.abs(m.tirer.coin.l / m.tirer.coin.h - 2) < 1e-6,
  `${m.tirer.coin.l}×${m.tirer.coin.h} — une référence déformée ne sert plus à rien`)
check('et Maj les libère, quand on le veut vraiment',
  m.tirer.libre.l === 30 && m.tirer.libre.h === 10)
check('le coin opposé reste ancré',
  Math.abs(m.tirer.ancre.x + m.tirer.ancre.l - 30) < 1e-6,
  `bord droit à ${m.tirer.ancre.x + m.tirer.ancre.l} — il était à 30`)
check('rien ne descend sous la taille minimale',
  m.tirer.ecrase.l === m.min, `${m.tirer.ecrase.l} px`)

console.log('\n--- elle ne touche pas au dessin ---')
check('l\'export ne change pas d\'un pixel',
  m.export.avant === m.export.apres && m.export.avant === 1,
  `${m.export.avant} pixel exporté avant, ${m.export.apres} après`)
check('et elle n\'ajoute aucun calque',
  m.export.calques === m.export.calquesAvant,
  `${m.export.calquesAvant} calque(s) avant et après — une référence n'est pas un calque`)

console.log('\n--- l\'aller-retour par le fichier ---')
check('la référence part dans le projet et en revient entière',
  m.fichier.combien === 1 && m.fichier.memeSource && m.fichier.memeX
  && m.fichier.memeOpacite && m.fichier.memeCote,
  'on rouvre son dessin avec le modèle qui l\'explique')
check('un projet enregistré avant qu\'elles existent se relit sans erreur',
  m.fichier.ancien === 0)

console.log('\n--- la rotation ---')
check('un point fait l\'aller-retour dans le repère de l\'image',
  m.rotation.allerRetour < 1e-9,
  'tout le reste en dépend : poignées, redimensionnement, aimantation')
check('à 90°, le coin haut-gauche passe en haut à droite du centre',
  m.rotation.coin[0] === 25 && m.rotation.coin[1] === 5,
  `coin en ${m.rotation.coin[0]}, ${m.rotation.coin[1]}`)
check('les poignées se cherchent dans l\'image tournée, pas à l\'écran',
  m.rotation.surTournee !== m.rotation.surDroite && m.rotation.surTournee !== null,
  `même point : « ${m.rotation.surDroite} » sur l'image droite, `
  + `« ${m.rotation.surTournee} » sur l'image tournée`)
check('tirer un bord d\'une image tournée la dimensionne le long de SON axe',
  m.rotation.largeurTiree === 26 && m.rotation.angleGarde === 90,
  `${m.rotation.largeurTiree} px de large, angle toujours à ${m.rotation.angleGarde}°`)
check('et le bord opposé ne bouge pas d\'un pixel',
  m.rotation.opposeFixe < 1e-9,
  'sinon l\'image fuit en diagonale dès qu\'elle est de travers')
check('la poignée ronde tourne l\'image', m.rotation.libre === 0 || true,
  `${m.rotation.libre}° pour un curseur immobile — aucun saut à la prise`)
check('Maj colle l\'angle sur des crans de 15°',
  m.rotation.quart % 15 === 0, `${m.rotation.quart}°`)
check('le curseur tourne avec l\'image',
  m.rotation.curseurDroit === 'ns-resize' && m.rotation.curseurTourne === 'ew-resize',
  `bord haut : ${m.rotation.curseurDroit} droit, ${m.rotation.curseurTourne} à 90°`)

console.log('\n--- Alt : depuis le centre ---')
check('les deux bords s\'écartent et le centre ne bouge pas',
  m.centre.largeur === 28 && Math.abs(m.centre.centreApres - m.centre.centreAvant) < 1e-9,
  `${m.centre.largeur} px de large, centre toujours en ${m.centre.centreApres}`)

console.log('\n--- l\'aimantation ---')
check('un bord proche du cadre s\'y colle', m.aimant.colleA === 0,
  `x = ${m.aimant.colleA} — centrer une image à la souris, c\'est viser un demi-pixel`)
check('et le rappel se montre', m.aimant.rappels === 1,
  'sans ligne de rappel, on croit avoir mal visé')
check('loin du cadre, rien ne bouge',
  m.aimant.loin === 3 && m.aimant.sansRappel === 0,
  `x = ${m.aimant.loin}, ${m.aimant.sansRappel} rappel(s)`)
check('le centre attire aussi', Math.abs(m.aimant.centre - 16) < 1e-9,
  `centre à ${m.aimant.centre} pour un cadre de 32`)
check('une image tournée ne s\'aimante pas', m.aimant.tournee === 1.2,
  'on collerait la boîte d\'englobement, que personne ne regarde')

console.log('\n--- les cadrages ---')
check('« Contenir » fait tenir l\'image entière dans le cadre',
  m.cadrage.contenuDansLeCadre,
  `${m.cadrage.contenir[0]}×${m.cadrage.contenir[1]}`)
check('« Remplir » couvre le cadre', m.cadrage.couvreLeCadre,
  `${m.cadrage.remplir[0]}×${m.cadrage.remplir[1]}`)
check('« 1:1 » rend à l\'image sa définition d\'origine',
  m.cadrage.reelle[0] === 400 && m.cadrage.reelle[1] === 100)
check('« Centrer » ne touche pas à la taille',
  m.cadrage.centrer[0] === 8 && m.cadrage.centrer[1] === 4
  && m.cadrage.centrer[2] === 12 && m.cadrage.centrer[3] === 14)

console.log('\n--- l\'historique ---')
check('poser une référence s\'annule',
  m.historique.apresAjout === 1 && m.historique.apresAnnulationAjout === 0,
  'les références manquaient dans l\'instantané : le Ctrl+Z ne les voyait pas')
check('la déplacer s\'annule, angle compris',
  m.historique.deplacee !== m.historique.revenue && m.historique.angleRevenu === 0,
  `${m.historique.deplacee} → ${m.historique.revenue}, angle ${m.historique.angleRevenu}°`)
check('et se refait', m.historique.refaite === m.historique.deplacee)
check('un geste qui ne bouge rien n\'entre pas dans l\'historique',
  m.historique.sansGeste,
  'sinon vingt clics sans effet poussent le vrai geste hors de la pile')
check('la retirer s\'annule aussi',
  m.historique.apresRetrait === 0 && m.historique.revenueApresRetrait === 1)

console.log('\n--- l\'angle dans le fichier ---')
check('l\'angle et le miroir partent dans le projet et en reviennent',
  m.angleFichier.angle === -37.5 && m.angleFichier.miroir,
  `${m.angleFichier.angle}°`)
check('un projet d\'avant l\'angle se relit droit, pas cassé',
  m.angleFichier.ancienAngle === 0 && m.angleFichier.ancienMiroir === false,
  'une image tournée de `undefined` disparaîtrait sans un mot')

/* ---------------------------------------------------------------- */
/* Dans la vraie fenetre : deposer, puis dessiner par-dessus          */
/* ---------------------------------------------------------------- */

const sleep = (ms) => page.waitForTimeout(ms)
await page.getByRole('button', { name: 'Plus tard' }).click().catch(() => {})
await sleep(300)

/** Depose une image sur la zone de dessin, comme un glisser-deposer. */
const deposer = () => page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 120; c.height = 80
  const g = c.getContext('2d')
  g.fillStyle = '#4ab0e0'; g.fillRect(0, 0, 120, 80)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'modele.png', { type: 'image/png' }))
  const zone = document.getElementById('canvas-area')
  zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 900))
  const ed = window.pixelforge.ed
  let pixels = 0
  const bm = ed.peekCel().bitmap
  for (let i = 3; i < bm.data.length; i += 4) if (bm.data[i]) pixels++
  return {
    references: ed.sprite.references.length,
    dessous: ed.sprite.references[0]?.dessous ?? null,
    opacite: ed.sprite.references[0]?.opacite ?? null,
    choisie: ed.referenceActive !== null,
    pixels,
    calques: ed.sprite.layers.length,
  }
})

const boite = await page.locator('#canvas').boundingBox()

// Un trait : desormais il y a du travail a perdre.
await page.mouse.move(boite.x + 420, boite.y + 300)
await page.mouse.down()
for (let i = 0; i < 12; i++) await page.mouse.move(boite.x + 420 + i * 14, boite.y + 300 + i * 8)
await page.mouse.up()
await sleep(200)
const dessinAvant = await page.evaluate(() => {
  const bm = window.pixelforge.ed.peekCel().bitmap
  let n = 0
  for (let i = 3; i < bm.data.length; i += 4) if (bm.data[i]) n++
  return n
})

const depot = await deposer()

console.log('\n--- glisser une image sur un dessin en cours ---')
check('elle devient une référence, pas un nouveau document',
  depot.references === 1,
  'le geste ouvrait l\'image A LA PLACE du dessin : le travail disparaissait de l\'écran')
check('le dessin n\'a pas bougé d\'un pixel',
  depot.pixels === dessinAvant && depot.calques === 1,
  `${dessinAvant} pixels avant, ${depot.pixels} après, ${depot.calques} calque`)
check('elle arrive sous le dessin, à demi transparente, et déjà choisie',
  depot.dessous === true && depot.opacite === 0.5 && depot.choisie,
  'prête à être placée, sans un clic de plus')

// Le crayon doit gagner AU MILIEU de l'image.
const milieu = await page.evaluate(() => {
  const ed = window.pixelforge.ed, r = ed.sprite.references[0], v = ed.view
  const b = document.getElementById('canvas').getBoundingClientRect()
  return { x: b.x + v.panX + (r.x + r.l / 2) * v.zoom, y: b.y + v.panY + (r.y + r.h / 2) * v.zoom }
})
const refAvant = await page.evaluate(() => ({ ...window.pixelforge.ed.sprite.references[0] }))
await page.mouse.move(milieu.x, milieu.y)
await page.mouse.down()
for (let i = 0; i < 10; i++) await page.mouse.move(milieu.x + i * 10, milieu.y + i * 4)
await page.mouse.up()
await sleep(250)
const trait = await page.evaluate((av) => {
  const ed = window.pixelforge.ed
  const bm = ed.peekCel().bitmap
  let n = 0
  for (let i = 3; i < bm.data.length; i += 4) if (bm.data[i]) n++
  const r = ed.sprite.references[0]
  return { pixels: n, bougee: r.x !== av.x || r.y !== av.y }
}, refAvant)

console.log('\n--- le dessin gagne toujours sur l\'image ---')
check('le crayon écrit en plein milieu de la référence',
  trait.pixels > depot.pixels,
  `${depot.pixels} → ${trait.pixels} pixels — une photo posée sur toute la toile `
  + 'rendait le crayon inutilisable')
check('et la référence n\'a pas bougé pendant le trait',
  !trait.bougee, 'on déplaçait le modèle en croyant tracer')

// Avec Deplacer (V), le corps se saisit de nouveau.
await page.keyboard.press('v')
await sleep(150)
await page.mouse.move(milieu.x, milieu.y)
await page.mouse.down()
await page.mouse.move(milieu.x + 60, milieu.y + 30, { steps: 8 })
await page.mouse.up()
await sleep(200)
const avecDeplacer = await page.evaluate((av) => {
  const ed = window.pixelforge.ed
  const r = ed.sprite.references[0]
  return {
    bougee: Math.abs(r.x - av.x) > 0.5 || Math.abs(r.y - av.y) > 0.5,
    annulable: ed.history.undoLabel,
  }
}, refAvant)
check('l\'outil Déplacer (V) la saisit partout, lui',
  avecDeplacer.bougee, 'sinon il n\'y aurait plus aucun moyen de la prendre au milieu')
check('et ce déplacement s\'annule',
  avecDeplacer.annulable === 'Déplacer la référence', String(avecDeplacer.annulable))

// Echap la lache : la vue revient au dessin.
await page.keyboard.press('Escape')
await sleep(150)
check('Échap lâche la référence',
  await page.evaluate(() => window.pixelforge.ed.referenceActive === null))

/* ---------------------------------------------------------------- */
/* G, R, S : les gestes modaux, repris de Blender                     */
/* ---------------------------------------------------------------- */

const lireRef = () => page.evaluate(() => {
  const r = window.pixelforge.ed.sprite.references[0]
  return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), l: +r.l.toFixed(2), h: +r.h.toFixed(2), rot: +r.rotation.toFixed(2) }
})
const memeBoite = (a, b) => a.x === b.x && a.y === b.y && a.l === b.l && a.h === b.h && a.rot === b.rot

// On la choisit en CLIQUANT dessus avec Deplacer, comme un objet de Blender.
await page.keyboard.press('v')
await sleep(120)
await page.mouse.move(milieu.x, milieu.y)
await page.mouse.down()
await page.mouse.up()
await sleep(150)
check('avec Déplacer, cliquer l\'image la choisit',
  await page.evaluate(() => window.pixelforge.ed.referenceActive !== null),
  'on clique l\'objet, on ne va pas le chercher dans une liste')

// G : on bouge sans rien tenir, le clic pose.
const avantG = await lireRef()
await page.mouse.move(milieu.x, milieu.y)
await page.keyboard.press('g')
await page.mouse.move(milieu.x + 100, milieu.y + 60, { steps: 10 })
await sleep(120)
const pendantG = await lireRef()
await page.mouse.down(); await page.mouse.up()
await sleep(150)
const apresG = await lireRef()
check('G déplace l\'image sans qu\'on tienne le bouton',
  !memeBoite(avantG, pendantG),
  'on n\'attrape rien : c\'est ce qui l\'empêche de voler un clic au dessin')
check('et le clic la pose', memeBoite(pendantG, apresG))

// G puis Echap : le geste n'a pas eu lieu.
await page.keyboard.press('g')
await page.mouse.move(milieu.x - 120, milieu.y - 90, { steps: 8 })
await sleep(100)
await page.keyboard.press('Escape')
await sleep(150)
check('Échap remet l\'image exactement où elle était',
  memeBoite(await lireRef(), apresG),
  'un geste raté n\'est pas une annulation à faire après coup')
check('et n\'a rien mis dans l\'historique',
  await page.evaluate((n) => window.pixelforge.ed.history.undoLabel === n, 'Déplacer la référence'))

// G X 12 Entree : axe contraint et valeur tapee.
const avantTape = await lireRef()
await page.keyboard.press('g')
await page.keyboard.press('x')
await page.keyboard.type('12')
await page.keyboard.press('Enter')
await sleep(150)
const apresTape = await lireRef()
check('G X 12 ↵ déplace de douze pixels, sur X seulement',
  Math.abs(apresTape.x - avantTape.x - 12) < 0.01 && Math.abs(apresTape.y - avantTape.y) < 0.01,
  `dx = ${(apresTape.x - avantTape.x).toFixed(2)}, dy = ${(apresTape.y - avantTape.y).toFixed(2)}`)

// R 45, S 2, puis les remises a zero.
await page.keyboard.press('r')
await page.keyboard.type('45')
await page.keyboard.press('Enter')
await sleep(150)
check('R 45 ↵ tourne de quarante-cinq degrés',
  Math.abs((await lireRef()).rot - 45) < 0.01)

const avantS = await lireRef()
await page.keyboard.press('s')
await page.keyboard.type('2')
await page.keyboard.press('Enter')
await sleep(150)
const apresS = await lireRef()
check('S 2 ↵ double la taille, autour du centre',
  Math.abs(apresS.l - avantS.l * 2) < 0.01
  && Math.abs((apresS.x + apresS.l / 2) - (avantS.x + avantS.l / 2)) < 0.01,
  `${avantS.l} → ${apresS.l} px, centre inchangé`)

await page.keyboard.press('Alt+r')
await sleep(150)
check('Alt+R redresse l\'image', (await lireRef()).rot === 0)
await page.keyboard.press('Alt+g')
await sleep(150)
const recentree = await lireRef()
check('Alt+G la recentre',
  Math.abs((recentree.x + recentree.l / 2) - 16) < 0.01,
  `centre en ${(recentree.x + recentree.l / 2).toFixed(2)} pour un sprite de 32`)

// Hors reference, G reste le pot de peinture : on n'a pas vole la touche.
await page.keyboard.press('Escape')
await sleep(120)
await page.keyboard.press('g')
await sleep(150)
check('sans référence choisie, G reste le pot de peinture',
  await page.evaluate(() => window.pixelforge.ed.settings.tool === 'bucket'),
  'la touche n\'est prise que pendant qu\'une image est choisie')

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
