/**
 * Banc du comblage de fentes.
 *
 * Une fente refermee peut etre parfaitement lisse et parfaitement fausse. La
 * seule facon de savoir ce que vaut la devinette est de la confronter a une
 * verite : on decoupe une fente dans un dessin qu'on possede entier, on
 * comble, et on compare pixel par pixel.
 *
 * Ce que le banc exige :
 *
 * - un dessin sans dechirure ressort inchange, au pixel pres — et le banc
 *   verifie que c'est bien l'information de proprietaire qui le protege, en
 *   la retirant pour voir le dessin se remplir ;
 * - le fond n'est jamais repeint, ni l'espace voulu entre deux jambes ;
 * - aucune couleur etrangere n'apparait ;
 * - sur une fente de deux pixels, la majorite des pixels retrouvent leur
 *   couleur d'origine — pas seulement une couleur ;
 * - la justesse se degrade avec la largeur, et le banc dit a partir d'ou ;
 * - sur une vraie pose de squelette, les dechirures se referment.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'

const PORT = 5100 + Math.floor(Math.random() * 200)
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
  const c = await import('/src/smart/combler.ts')
  const s = await import('/src/smart/scene.ts')
  const rs = await import('/src/smart/rig-scene.ts')
  const rig = await import('/src/smart/rig.ts')
  const { RIG_TEMPLATES, applyTemplate } = await import('/src/smart/rig-presets.ts')
  const { spritePixl } = await import('/src/ui/mascot-clips.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')

  const plein = (b, i) => (b.u32[i] >>> 24) !== 0
  const masse = (b) => {
    let n = 0
    for (let i = 0; i < b.u32.length; i++) if (plein(b, i)) n++
    return n
  }
  const palette = (b) => {
    const set = new Set()
    for (let i = 0; i < b.u32.length; i++) if (plein(b, i)) set.add(b.u32[i])
    return set
  }
  const etrangeres = (source, image) => {
    const p = palette(source)
    let n = 0
    for (let i = 0; i < image.u32.length; i++) {
      if (plein(image, i) && !p.has(image.u32[i])) n++
    }
    return n
  }
  /** Pixels vides cernes de matiere des quatre cotes, a moins de `max`. */
  const trous = (b, max) => {
    const w = b.width, h = b.height
    let n = 0
    const voit = (x, y, dx, dy) => {
      for (let k = 1; k <= max; k++) {
        const xx = x + dx * k, yy = y + dy * k
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false
        if (plein(b, yy * w + xx)) return true
      }
      return false
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (plein(b, y * w + x)) continue
        if (voit(x, y, -1, 0) && voit(x, y, 1, 0) && voit(x, y, 0, -1) && voit(x, y, 0, 1)) n++
      }
    }
    return n
  }

  const sujets = [
    { nom: 'pixl', img: spritePixl().layers[0].cels[0].bitmap },
    { nom: 'personnage', img: demoCharacter().layers[0].cels[0].bitmap },
  ]

  const rapport = []
  for (const { nom, img } of sujets) {
    const bb = img.trimBounds()
    const milieu = Math.round(bb.x + bb.w / 2)

    // 1. Rien a combler. Le dessin est d'un seul tenant : aucun de ses creux
    //    n'est une dechirure, donc rien ne doit bouger.
    const seul = c.proprietaireUnique(img)
    const intact = c.comblerLesFentes(img, { largeurMax: 6, proprietaire: seul })
    let identique = true
    for (let i = 0; i < img.u32.length; i++) {
      if (img.u32[i] !== intact.image.u32[i]) { identique = false; break }
    }

    // 2. Contre-epreuve : sans proprietaire, la geometrie seule ne distingue
    //    pas l'encoche de la dechirure et le dessin se remplit. Si ce nombre
    //    tombait a zero, la regle du dessus ne prouverait rien.
    const aveugle = c.comblerLesFentes(img, { largeurMax: 6 })
    const combleAveugle = masse(aveugle.image) - masse(img)

    // 3. Verite : on dechire, on comble, on compare. Le proprietaire est
    //    celui d'une vraie pose : deux morceaux qui se sont ecartes.
    const parLargeur = []
    for (const largeur of [1, 2, 3, 4, 6]) {
      const x0 = milieu - Math.floor(largeur / 2)
      const dechire = c.dechirerVertical(img, x0, largeur)
      const proprietaire = c.proprietairesParColonne(dechire, x0)
      const { image, bilan } = c.comblerLesFentes(dechire, { largeurMax: 6, proprietaire })
      const ex = c.exactitude(img, dechire, image)
      // Combien de pixels faux auraient pu etre justes ? Un pixel dont la
      // vraie couleur ne se trouve nulle part au bord de la fente est perdu
      // d'avance : la dechirure a emporte le seul endroit ou elle existait.
      // Ceux dont la vraie couleur EST au bord sont, eux, des erreurs de
      // choix — et c'est le seul chiffre sur lequel l'algorithme peut
      // encore progresser.
      let deBord = 0
      for (let i = 0; i < img.u32.length; i++) {
        if (!plein(img, i) || plein(dechire, i)) continue
        if (image.u32[i] === img.u32[i]) continue
        const y = Math.floor(i / img.width), x = i % img.width
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          let trouve = false
          for (let k = 1; k <= 6; k++) {
            const xx = x + dx * k, yy = y + dy * k
            if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) break
            const j = yy * img.width + xx
            if (!plein(dechire, j)) continue
            trouve = dechire.u32[j] === img.u32[i]
            break
          }
          if (trouve) { deBord++; break }
        }
      }
      parLargeur.push({
        deBord,
        largeur,
        manquants: ex.manquants,
        justes: ex.justes,
        faux: ex.faux,
        oublies: ex.oublies,
        etrangeres: etrangeres(img, image),
        epargnes: bilan.epargnes,
        taux: ex.manquants ? ex.justes / ex.manquants : 1,
      })
    }

    rapport.push({ nom, identique, combleAveugle, masseSource: masse(img), parLargeur })
  }

  // 4. Une fente large n'est pas une fente : le fond reste le fond.
  const img = sujets[0].img
  const fond = new (img.constructor)(img.width, img.height)
  for (let y = 10; y < 22; y++) for (let x = 4; x < 10; x++) fond.set(x, y, 0xff3388ff >>> 0)
  for (let y = 10; y < 22; y++) for (let x = 24; x < 30; x++) fond.set(x, y, 0xff3388ff >>> 0)
  const large = c.comblerLesFentes(fond, { largeurMax: 6 })
  const combleLargeVide = masse(large.image) - masse(fond)

  // 5. Une vraie pose : on leve un bras, la scene se dechire a l'epaule.
  const perso = demoCharacter()
  const dessin = perso.layers[0].cels[0].bitmap
  applyTemplate(perso.rig, RIG_TEMPLATES[0], dessin,
    { width: perso.width, height: perso.height })
  const partie = rig.autoBind(perso.rig, perso.layers[0].id, dessin)
  perso.rig.parts = [partie]
  const bras = perso.rig.bones.find((b) => b.role === 'armL') ?? perso.rig.bones[1]
  bras.angle = -0.9
  const pieces = rs.piecesDuRig(perso.rig, partie).map((x) => x.piece)
  const rendu = s.rendreScene(pieces, s.CAMERA_FACE, {
    largeur: perso.width, hauteur: perso.height, centre: { x: 0, y: 0 },
  })
  const MAX = 4
  const repare = c.comblerLesFentes(rendu.image,
    { largeurMax: MAX, proprietaire: rendu.proprietaire })
  // Une seconde passe, avec les proprietaires mis a jour : elle dit si
  // l'operation converge ou si elle grignoterait indefiniment la silhouette.
  const seconde = c.comblerLesFentes(repare.image,
    { largeurMax: MAX, proprietaire: repare.proprietaire })
  const pose = {
    combles: repare.bilan.combles,
    seconde: seconde.bilan.combles,
    trous: trous(rendu.image, MAX),
    etrangeres: etrangeres(dessin, repare.image),
    masseSource: masse(dessin),
    masseRendu: masse(rendu.image),
    masseReparee: masse(repare.image),
  }

  return { rapport, combleLargeVide, pose }
})

console.log('')
for (const r of m.rapport) {
  console.log(`--- ${r.nom} (${r.masseSource} pixels) ---`)
  check(`${r.nom} : un dessin d'un seul morceau ressort intact`, r.identique)
  // Contre-epreuve de la regle precedente : elle ne vaut que si la geometrie
  // seule, elle, se serait trompee.
  check(`${r.nom} : c'est bien le proprietaire qui protege les encoches`,
    r.combleAveugle > 0, `sans lui, ${r.combleAveugle} pixel(s) ajoutes a tort`)

  for (const l of r.parLargeur) {
    check(`${r.nom} : fente de ${l.largeur}px, aucune couleur etrangere`, l.etrangeres === 0,
      `${l.etrangeres} pixel(s)`)
  }

  const deux = r.parLargeur.find((l) => l.largeur === 2)
  check(`${r.nom} : une fente de 2px se referme entierement`,
    deux.oublies === 0, `${deux.oublies} pixel(s) laisses vides sur ${deux.manquants}`)
  // Le seuil dit ce que vaut la devinette. Sur une fente fine, les deux bords
  // portent presque toujours la meme couleur : on doit tomber juste souvent.
  check(`${r.nom} : une fente de 2px retrouve la bonne couleur`,
    deux.taux >= 0.6, `${Math.round(deux.taux * 100)}% justes `
    + `(${deux.justes}/${deux.manquants}, ${deux.faux} faux)`)
  // Le taux brut a un plafond qui ne depend pas de l'algorithme : un reflet
  // large de deux pixels que la fente a emporte en entier n'existe plus
  // nulle part, et aucune devinette ne le rendra. Ce qui se juge vraiment,
  // c'est le nombre de fois ou la bonne couleur etait au bord et ou on a
  // pris l'autre.
  // Un quart, c'est la barre mesuree aujourd'hui, pas un ideal : elle est la
  // pour qu'une modification qui choisit plus souvent le mauvais bord se
  // fasse voir. Une variante a ete essayee — preferer le bord dont la plage
  // de couleur est la plus longue — et rendue : +8 points sur la mascotte,
  // -3 sur le personnage. Rien de concluant, donc rien de change.
  check(`${r.nom} : la devinette se trompe rarement de bord`,
    deux.deBord <= Math.ceil(deux.manquants * 0.25),
    `${deux.deBord} erreur(s) de choix sur ${deux.manquants} pixels a retrouver`)

  console.log(`      degradation : ${r.parLargeur.map((l) =>
    `${l.largeur}px ${Math.round(l.taux * 100)}%`).join('  ')}`)
  // La justesse doit baisser avec la largeur : si elle ne baisse pas, c'est
  // que la mesure ne mesure rien.
  const decroit = r.parLargeur[0].taux >= r.parLargeur[r.parLargeur.length - 1].taux
  check(`${r.nom} : la justesse se degrade quand la fente s'elargit`, decroit)
}

console.log('\n--- une vraie pose ---')
check('un vide de plus de largeurMax n\'est pas comble', m.combleLargeVide === 0,
  `${m.combleLargeVide} pixel(s) ajoutes entre deux blocs distants de 14px`)
check('lever un bras ouvre bien des fentes que le comblage referme',
  m.pose.combles > 0,
  `${m.pose.combles} pixel(s) poses, ${m.pose.masseRendu} -> ${m.pose.masseReparee}`)
// Le rendu de scene bouche deja les trous cernes des quatre cotes : ce qui
// reste apres lui est exactement ce que ce module est la pour attraper.
check('les fentes d\'une pose echappent au bouchage du rendu', m.pose.trous === 0,
  `${m.pose.trous} trou(s) cerne(s) restants apres le rendu`)
check('la pose comblee n\'invente aucune couleur', m.pose.etrangeres === 0,
  `${m.pose.etrangeres} pixel(s)`)
// Une operation qui ne converge pas rongerait la silhouette a chaque appel.
check('une seconde passe n\'emporte pas la silhouette',
  m.pose.seconde <= Math.ceil(m.pose.combles * 0.25),
  `${m.pose.combles} pixel(s) a la premiere passe, ${m.pose.seconde} a la seconde`)

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
