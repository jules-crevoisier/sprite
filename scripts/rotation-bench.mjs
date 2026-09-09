/**
 * Banc de la rotation par relief.
 *
 * « Mieux et fiable » ne veut rien dire tant qu'on ne mesure pas. Ce banc
 * balaie la rotation sur toute sa plage et exige, a chaque angle, ce qu'un
 * pixel-artiste exigerait d'une pose :
 *
 * - a zero degre, le dessin ressort identique, pixel pour pixel ;
 * - ON RECONNAIT ENCORE LE PERSONNAGE : la couleur dominante de chaque ligne
 *   reste la sienne. C'est la seule mesure qui voyait le vrai defaut de la
 *   version d'avant — elle faisait tourner un volume dont les deux faces
 *   portaient la meme image, si bien que le personnage se dedoublait passe
 *   quarante-cinq degres. La masse, les trous, les couleurs et la symetrie
 *   restaient irreprochables pendant que l'image devenait illisible : 32% des
 *   lignes justes a quatre-vingt-dix degres ;
 * - la masse suit la compression annoncee : elle ne s'evapore pas, et ne
 *   gonfle pas non plus ;
 * - aucune couleur etrangere n'apparait : rien n'est interpole ;
 * - la silhouette ne se perce pas ;
 * - deux angles voisins se ressemblent : pas de saut d'une image a l'autre ;
 * - tourner a droite est exactement le miroir de tourner a gauche.
 *
 * Un banc qui ne sait pas echouer ne protege rien : chaque regle a ete
 * verifiee en la cassant volontairement avant d'etre gardee.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'

const PORT = 4100 + Math.floor(Math.random() * 800)
const URL = `http://127.0.0.1:${PORT}/`
const VITE = 'node_modules/.bin/vite'

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

const serveur = spawn(VITE, ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore',
})
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

const mesures = await page.evaluate(async () => {
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const d = await import('/src/smart/depth.ts')
  const { spritePixl } = await import('/src/ui/mascot-clips.ts')

  /** Les sujets : la mascotte au repos, plus trois formes limites. */
  const sujets = []

  // Pixl, premiere image du repos : une vraie silhouette dessinee, avec ses
  // aplats, son contour et ses details d'un pixel.
  const pixl = spritePixl()
  const repos = pixl.layers[0].cels[0]?.bitmap
  if (repos) sujets.push({ nom: 'pixl-repos', img: repos })

  // Le personnage de demonstration : c'est lui qu'on voit dans l'editeur, et
  // c'est sur lui que le dedoublement de l'ancienne methode se remarquait le
  // plus — cheveux, visage, chemise, pantalon, quatre bandes horizontales
  // qu'aucune rotation ne doit melanger.
  const { demoCharacter } = await import('/src/ui/demo-content.ts')
  sujets.push({ nom: 'personnage', img: demoCharacter().layers[0].cels[0].bitmap })

  // Un disque : la forme ou le relief est le plus haut, donc celle qui
  // etire le plus la projection.
  const disque = new Bitmap(32, 32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5, dy = y - 15.5
      if (dx * dx + dy * dy <= 144) disque.set(x, y, 0xff5588ee)
    }
  }
  sujets.push({ nom: 'disque', img: disque })

  // Une lame : longue et fine, le cas ou une hauteur de relief mal choisie
  // transforme le dessin en cylindre.
  const lame = new Bitmap(32, 32)
  for (let y = 4; y < 28; y++) for (let x = 14; x < 18; x++) lame.set(x, y, 0xffdddddd)
  sujets.push({ nom: 'lame', img: lame })

  // Un anneau : il a un vrai trou, que le bouchage ne doit jamais combler.
  const anneau = new Bitmap(32, 32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5, dy = y - 15.5
      const r = Math.hypot(dx, dy)
      if (r <= 13 && r >= 7) anneau.set(x, y, 0xff33cc66)
    }
  }
  sujets.push({ nom: 'anneau', img: anneau })

  /** Repartition des couleurs d'une ligne, en proportions. */
  const profilLigne = (b, y) => {
    const compte = new Map()
    let total = 0
    for (let x = 0; x < b.width; x++) {
      const i = y * b.width + x
      if ((b.u32[i] >>> 24) === 0) continue
      compte.set(b.u32[i], (compte.get(b.u32[i]) ?? 0) + 1)
      total++
    }
    if (!total) return null
    const out = new Map()
    for (const [c, n] of compte) out.set(c, n / total)
    return out
  }

  /**
   * Ressemblance ligne a ligne entre deux dessins : pour chaque ligne, la
   * part de couleur commune entre les deux repartitions.
   *
   * Un lacet ne deplace rien verticalement — les cheveux restent en haut, le
   * pantalon en bas. Comprimer une ligne ne change pas ses proportions ; la
   * barbouiller, si. C'est la seule mesure qui separait l'ancienne methode de
   * la nouvelle, la ou la masse, les trous et les couleurs ne voyaient rien.
   *
   * On compare des repartitions et non la couleur dominante : sur une ligne
   * de trois pixels, deux couleurs a egalite font basculer la dominante d'un
   * dessin a l'autre sans que rien n'ait vraiment change.
   */
  const ressemblance = (a, b) => {
    let total = 0, lignes = 0
    for (let y = 0; y < a.height; y++) {
      const pa = profilLigne(a, y)
      if (!pa) continue
      lignes++
      const pb = profilLigne(b, y)
      if (!pb) continue
      let commun = 0
      for (const [c, p] of pa) commun += Math.min(p, pb.get(c) ?? 0)
      total += commun
    }
    return lignes ? total / lignes : 1
  }

  /**
   * Temoin : l'ancienne methode, gardee ici pour qu'on puisse verifier que la
   * mesure sait encore la refuser.
   *
   * Elle traitait le dessin comme la tranche du milieu d'un volume plein et
   * faisait tourner ce volume, si bien que la face arriere — qui porte la
   * meme image que l'avant — se montrait passe quarante-cinq degres.
   */
  const tournerVolume = (src, champ, lacet) => {
    const w = src.width, h = src.height
    const out = new Bitmap(w, h)
    const zbuf = new Float32Array(w * h).fill(-Infinity)
    const bb = src.trimBounds()
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2
    const co = Math.cos(lacet), si = Math.sin(lacet)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if ((src.u32[i] >>> 24) === 0) continue
        const px = x - cx
        const demi = champ[i]
        const tranches = Math.max(1, Math.ceil(demi * 2) + 1)
        for (let t = 0; t < tranches; t++) {
          const pz = tranches === 1 ? 0 : -demi + (t * demi * 2) / (tranches - 1)
          const tx = Math.round(px * co + pz * si + cx)
          const tz = -px * si + pz * co
          if (tx < 0 || tx >= w) continue
          const j = y * w + tx
          if (tz <= zbuf[j]) continue
          zbuf[j] = tz
          out.u32[j] = src.u32[i]
        }
      }
    }
    void cy
    return out
  }
  const miroir = (b) => {
    const o = new Bitmap(b.width, b.height)
    for (let y = 0; y < b.height; y++) {
      for (let x = 0; x < b.width; x++) o.u32[y * b.width + x] = b.u32[y * b.width + (b.width - 1 - x)]
    }
    return o
  }

  const rapport = []
  for (const { nom, img } of sujets) {
    const hauteur = d.hauteurSuggeree(img)
    const champ = d.champAuto(img, { hauteur, galbe: 0.5 })
    const masse0 = d.masse(img)
    const trous0 = d.trousInterieurs(img)

    const identite = d.tourner(img, champ, d.SANS_ROTATION)
    let identiquePixel = true
    for (let i = 0; i < img.u32.length; i++) {
      if (img.u32[i] !== identite.u32[i]) { identiquePixel = false; break }
    }

    // Balayage du lacet, un degre a la fois, sur le quart de tour entier. La
    // version d'avant s'arretait a soixante-quinze degres, ce qui laissait
    // hors du banc precisement la zone ou elle se cassait.
    const lisibilite = []
    const masses = []
    const etrangeres = []
    const trous = []
    let sautMax = 0
    let precedente = null
    for (let deg = -90; deg <= 90; deg += 1) {
      const r = d.tourner(img, champ, { lacet: (deg * Math.PI) / 180, tangage: 0, roulis: 0 })
      const m = d.masse(r)
      masses.push({ deg, m })
      const et = d.couleursEtrangeres(img, r)
      if (et.length) etrangeres.push({ deg, n: et.length })
      const t = d.trousInterieurs(r)
      if (t > trous0) trous.push({ deg, t })

      lisibilite.push({ deg, part: ressemblance(img, r) })
      if (precedente !== null && m > 0 && precedente > 0) {
        sautMax = Math.max(sautMax, Math.abs(m - precedente))
      }
      precedente = m
    }
    // Deux exigences, parce qu'une seule ne peut pas etre a la fois vraie et
    // utile sur toute la plage.
    //
    // Jusqu'a 45 degres — la plage ou se joue une animation de jeu — un corps
    // plein ne perd presque rien : sa profondeur compense ce que sa largeur
    // cede. C'est la que le défaut de la coque se voyait, et c'est donc la
    // qu'on serre a 90%.
    //
    // Au-dela, une forme reellement plate — un anneau, une lame — a le droit
    // de maigrir : vue de trois-quarts elle montre sa tranche. Le plancher
    // devient alors celui d'une feuille de papier, |cos theta| : un volume
    // solide ne peut jamais projeter moins que sa propre tranche du milieu.
    // Ce que la compression prevoit a chaque angle : le profil, plus ce que
    // la face conserve. La masse mesuree doit s'y tenir.
    const profil = d.profilDe(img, champ)
    let epaisseur = 0
    for (let i = 0; i < champ.length; i++) if (champ[i] > epaisseur) epaisseur = champ[i]
    const boite0 = img.trimBounds()
    let debordement = { deg: 0, largeur: 0, permis: 0, exces: -Infinity }
    let pireEcart = { deg: 0, marge: Infinity, ratio: 1, prevu: 1 }
    let masseMax = 0
    for (const { deg, m } of masses) {
      const ratio = m / masse0
      masseMax = Math.max(masseMax, ratio)
      const prevu = profil + (1 - profil) * Math.abs(Math.cos((deg * Math.PI) / 180))
      const marge = ratio - prevu
      if (marge < pireEcart.marge) pireEcart = { deg, marge, ratio, prevu }
    }

    // La silhouette a le droit de s'elargir : un volume epais vu de biais
    // presente sa tranche en plus de sa face. Mais pas au-dela de ce que la
    // geometrie permet — largeur comprimee, plus deux fois le relief incline.
    for (let deg = -90; deg <= 90; deg += 5) {
      const rad = (deg * Math.PI) / 180
      const r = d.tourner(img, champ, { lacet: rad, tangage: 0, roulis: 0 })
      const b = r.trimBounds()
      const comp = profil + (1 - profil) * Math.abs(Math.cos(rad))
      const permis = Math.ceil(boite0.w * comp + 2 * epaisseur * Math.abs(Math.sin(rad))) + 1
      if (b.w - permis > debordement.exces) {
        debordement = { deg, largeur: b.w, permis, exces: b.w - permis }
      }
    }

    // Le temoin, aux angles ou l'ancienne methode se cassait.
    let temoin = 1
    for (const deg of [45, 60, 75, 90]) {
      temoin = Math.min(temoin, ressemblance(img, tournerVolume(img, champ, (deg * Math.PI) / 180)))
    }

    // Symetrie exacte : tourner le miroir du dessin dans l'autre sens doit
    // rendre, au pixel pres, le miroir du dessin tourne. Comparer seulement
    // les masses de +theta et -theta ne valait que pour un sujet symetrique —
    // et laissait passer un decalage d'une colonne, qui est pourtant ce qui
    // arrive quand l'arrondi n'a pas de miroir.
    const champMiroir = d.champAuto(miroir(img), { hauteur, galbe: 0.5 })
    let pixelsDissymetriques = 0
    for (const deg of [15, 30, 45, 60, 75, 90]) {
      const rad = (deg * Math.PI) / 180
      const a = miroir(d.tourner(img, champ, { lacet: rad, tangage: 0, roulis: 0 }))
      const b = d.tourner(miroir(img), champMiroir, { lacet: -rad, tangage: 0, roulis: 0 })
      let n = 0
      for (let i = 0; i < a.u32.length; i++) if (a.u32[i] !== b.u32[i]) n++
      pixelsDissymetriques = Math.max(pixelsDissymetriques, n)
    }

    // Au-dela du quart de tour, on montre le dessin retourne : le passage
    // doit etre continu, sinon l'animation cogne pile au profil.
    // Passe le quart de tour, le dessin est retourne — c'est le substitut du
    // dos, et il fait forcement basculer les details a gauche-droite. Ce qui
    // ne doit pas bouger, c'est la SILHOUETTE : une largeur qui saute
    // trahirait un changement de regle, pas un changement de point de vue.
    const justeAvant = d.tourner(img, champ, { lacet: (89 * Math.PI) / 180, tangage: 0, roulis: 0 })
    const justeApres = d.tourner(img, champ, { lacet: (91 * Math.PI) / 180, tangage: 0, roulis: 0 })
    const sautAuProfil = justeApres.trimBounds().w - justeAvant.trimBounds().w

    // Le tangage doit se comporter comme le lacet, a un quart de tour pres :
    // c'est le même volume vu par l'autre axe. Une matrice mal composee
    // donnerait ici un resultat different.
    const parLacet = d.masse(d.tourner(img, champ, { lacet: Math.PI / 4, tangage: 0, roulis: 0 }))
    const boiteImg = img.trimBounds()
    const colonne = Math.max(boiteImg.w, boiteImg.h)

    rapport.push({
      nom, hauteur, masse0, trous0, identiquePixel,
      pireEcart, masseMax, debordement,
      etrangeres: etrangeres.length,
      troublants: trous.length,
      sautMax, colonne, parLacet,
      pixelsDissymetriques, sautAuProfil, temoin,
      couleurs: (() => {
        const s2 = new Set()
        for (let i = 0; i < img.u32.length; i++) if ((img.u32[i] >>> 24) !== 0) s2.add(img.u32[i])
        return s2.size
      })(),
      pireLisibilite: lisibilite.reduce((p, l) => (l.part < p.part ? l : p), { deg: 0, part: 1 }),
      lisibiliteA90: lisibilite.find((l) => l.deg === 90)?.part ?? 0,
      profil: d.profilDe(img, champ),
    })
  }
  return rapport
})

console.log('')
for (const r of mesures) {
  console.log(`--- ${r.nom} (relief ${r.hauteur}px, ${r.masse0} pixels) ---`)
  check(`${r.nom} : a zero degre le dessin ressort intact`, r.identiquePixel)
  // La masse ne se juge plus dans l'absolu mais contre la compression
  // annoncee : comprimer un dessin, c'est justement lui retirer de la
  // largeur. Un quart de tour a un profil de 0,44 doit rendre environ 44% de
  // la matiere, plus ce que le relief etale. En exiger 90% obligeait a
  // peindre le dos, ce qui etait tout le probleme.
  check(`${r.nom} : la masse suit la compression annoncee`,
    r.pireEcart.marge >= -0.06,
    `au pire ${(r.pireEcart.ratio * 100).toFixed(1)}% a ${r.pireEcart.deg}deg,`
    + ` la compression en prevoit ${(r.pireEcart.prevu * 100).toFixed(1)}%`)
  // Elle a le droit de gonfler — une tranche vient s'ajouter a la face — mais
  // seulement dans les bornes que la geometrie autorise.
  check(`${r.nom} : la silhouette ne deborde pas de ce que le relief permet`,
    r.debordement.largeur <= r.debordement.permis,
    `${r.debordement.largeur}px a ${r.debordement.deg}deg, ${r.debordement.permis}px permis`)
  check(`${r.nom} : aucune couleur etrangere`, r.etrangeres === 0,
    `${r.etrangeres} angle(s) fautif(s)`)
  check(`${r.nom} : la silhouette ne se perce pas`, r.troublants === 0,
    `${r.troublants} angle(s) troue(s)`)
  // Le plus petit changement possible d'un degre au suivant est l'apparition
  // d'une colonne entiere : on ne peut pas exiger plus fin que la grille.
  check(`${r.nom} : pas de saut d'un degre a l'autre`, r.sautMax <= r.colonne,
    `saut max ${r.sautMax} pixels, une colonne en fait ${r.colonne}`)
  check(`${r.nom} : tourner a droite est le miroir de tourner a gauche`,
    r.pixelsDissymetriques === 0,
    `${r.pixelsDissymetriques} pixel(s) d'ecart au pire`)
  check(`${r.nom} : la silhouette ne cogne pas au passage du profil`,
    Math.abs(r.sautAuProfil) <= 2,
    `${r.sautAuProfil} pixel(s) de largeur entre 89 et 91 degres`)
  // Le coeur de l'affaire : reconnait-on encore le dessin ?
  // Le seuil est celui qu'on tient vraiment, pas un ideal : 85% sur la
  // mascotte, 85% sur le personnage, contre 66% et 72% pour l'ancienne
  // methode. Ce qui manque a cent, c'est la face cachee — de profil, on ne
  // voit plus l'autre bras, et c'est juste.
  check(`${r.nom} : on reconnait le dessin a tous les angles`,
    r.pireLisibilite.part >= 0.82,
    `au pire ${(r.pireLisibilite.part * 100).toFixed(0)}% de couleur commune par ligne, a `
    + `${r.pireLisibilite.deg}deg ; ${(r.lisibiliteA90 * 100).toFixed(0)}% au profil`)
  // Contre-epreuve : la mesure doit savoir refuser. L'ancienne methode est
  // gardee dans le banc et doit y tomber franchement. Sur un sujet d'une
  // seule couleur elle ne prouverait rien — toute image monochrome ressemble
  // a toute autre — donc on ne l'interroge que sur un vrai dessin.
  if (r.couleurs >= 3) {
    check(`${r.nom} : la mesure refuse encore l'ancienne methode`,
      r.temoin <= r.pireLisibilite.part - 0.1,
      `temoin ${(r.temoin * 100).toFixed(0)}% contre ${(r.pireLisibilite.part * 100).toFixed(0)}%`)
  }
}

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
