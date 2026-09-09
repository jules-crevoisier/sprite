/**
 * Banc des formats voisins.
 *
 * Un import qui se trompe silencieusement est pire qu'un import qui refuse :
 * on decouvre la perte trois heures plus tard. Chaque format est donc verifie
 * sur une verite connue — soit un aller-retour complet, soit un fichier
 * construit a la main ici meme, dont on sait exactement ce qu'il contient.
 *
 * Le GIF est en plus confronte au decodeur du navigateur, qui sert d'arbitre
 * independant : si nos pixels different des siens, c'est nous qui avons tort.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'

const PORT = 5300 + Math.floor(Math.random() * 200)
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
  const { Sprite, Layer } = await import('/src/core/document.ts')
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const { Palette } = await import('/src/core/palette.ts')
  const { rgba } = await import('/src/core/color.ts')
  const { encodeGif } = await import('/src/export/gif.ts')
  const gifIn = await import('/src/io/formats/gif.ts')
  const ase = await import('/src/io/formats/aseprite.ts')
  const pal = await import('/src/io/formats/palettes.ts')
  const formats = await import('/src/io/formats/index.ts')
  const { demoCharacter } = await import('/src/ui/demo-content.ts')

  /* ---------------- sujet commun ---------------- */
  const source = demoCharacter()
  source.name = 'sujet'
  // Deux calques, trois frames, des tags : de quoi voir ce qui se perd.
  const dessin = source.layers[0].cels[0].bitmap
  const sprite = new Sprite(source.width, source.height)
  sprite.name = 'sujet'
  sprite.frameDurations = [80, 120, 160]
  sprite.layers = []
  for (const [nom, decalage, opacite, fusion] of [
    ['Fond', 0, 255, 'normal'], ['Perso', 2, 180, 'multiply'],
  ]) {
    const c = new Layer(nom, 3)
    for (let f = 0; f < 3; f++) {
      const bm = new Bitmap(sprite.width, sprite.height)
      bm.paste(dessin, decalage + f, f)
      c.cels[f] = { bitmap: bm, opacity: 255 - f * 10 }
    }
    c.opacity = opacite
    c.blendMode = fusion
    sprite.layers.push(c)
  }
  sprite.tags = [{ id: 1, name: 'marche', from: 0, to: 2, direction: 'pingpong', repeat: 0, color: rgba(200, 60, 60, 255) }]
  sprite.grid = { x: 1, y: 2, w: 8, h: 8 }
  sprite.palette = new Palette('Sujet', [rgba(0, 0, 0, 255), rgba(255, 0, 0, 255), rgba(30, 90, 200, 255)])

  const memes = (a, b) => {
    if (a.width !== b.width || a.height !== b.height) return false
    for (let i = 0; i < a.u32.length; i++) if (a.u32[i] !== b.u32[i]) return false
    return true
  }
  const differences = (a, b) => {
    let n = 0
    for (let i = 0; i < a.u32.length; i++) if (a.u32[i] !== b.u32[i]) n++
    return n
  }

  /* ---------------- Aseprite ---------------- */
  const octetsAse = await ase.ecrireAseprite(sprite)
  const relu = await ase.lireAseprite(octetsAse, 'sujet')
  const aseprite = {
    signature: ase.estUnAseprite(octetsAse),
    taille: octetsAse.length,
    dims: relu.width === sprite.width && relu.height === sprite.height,
    calques: relu.layers.length,
    noms: relu.layers.map((l) => l.name).join(','),
    opacites: relu.layers.map((l) => l.opacity).join(','),
    fusions: relu.layers.map((l) => l.blendMode).join(','),
    frames: relu.frameCount,
    durees: relu.frameDurations.join(','),
    tags: relu.tags.map((t) => `${t.name}:${t.from}-${t.to}:${t.direction}`).join(','),
    grille: `${relu.grid.x},${relu.grid.y},${relu.grid.w},${relu.grid.h}`,
    palette: relu.palette.colors.join(','),
    pixels: (() => {
      let faux = 0
      for (let l = 0; l < sprite.layers.length; l++) {
        for (let f = 0; f < 3; f++) {
          const a = sprite.layers[l].cels[f].bitmap
          const b = relu.layers[l]?.cels[f]?.bitmap
          if (!b) { faux += a.u32.length; continue }
          faux += differences(a, b)
        }
      }
      return faux
    })(),
    celOpacites: relu.layers[0].cels.map((c) => c?.opacity).join(','),
  }
  let refus = ''
  try {
    await ase.lireAseprite(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'x')
  } catch (e) { refus = e.message }

  /* ---------------- GIF : aller-retour ---------------- */
  const images = [0, 1, 2].map((f) => {
    const bm = new Bitmap(sprite.width, sprite.height)
    bm.paste(dessin, f * 2, 0)
    return bm
  })
  const octetsGif = encodeGif(images, [80, 120, 160])
  const luGif = gifIn.decoderGif(octetsGif)
  const gif = {
    signature: gifIn.estUnGif(octetsGif),
    largeur: luGif.largeur,
    hauteur: luGif.hauteur,
    nb: luGif.images.length,
    delais: luGif.images.map((i) => i.delaiMs).join(','),
    identiques: luGif.images.every((im, i) => memes(im.bitmap, images[i])),
    ecarts: luGif.images.reduce((n, im, i) => n + differences(im.bitmap, images[i]), 0),
  }

  // Arbitre independant : le decodeur GIF du navigateur.
  const blob = new Blob([octetsGif.buffer], { type: 'image/gif' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url })
  const cv = document.createElement('canvas')
  cv.width = img.naturalWidth; cv.height = img.naturalHeight
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const duNavigateur = Bitmap.fromImageData(ctx.getImageData(0, 0, cv.width, cv.height))
  URL.revokeObjectURL(url)
  gif.commeLeNavigateur = differences(duNavigateur, luGif.images[0].bitmap)

  /* ---------------- GIF : entrelacement et images partielles ---------------- */
  // Fichier bati ici, dont on connait chaque pixel. Le codage LZW n'emet que
  // des codes litteraux, separes par des codes d'effacement : c'est valide, et
  // cela evite d'avoir a suivre la croissance de la table dans le banc.
  const construireGif = (largeur, hauteur, cadres) => {
    const o = []
    const b = (v) => o.push(v & 0xff)
    const w = (v) => { b(v); b(v >> 8) }
    for (const ch of 'GIF89a') b(ch.charCodeAt(0))
    w(largeur); w(hauteur)
    b(0x80 | 0x70 | 1)          // table globale de 4 couleurs
    b(0); b(0)
    const table = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]]
    for (const [r, g, bl] of table) { b(r); b(g); b(bl) }
    for (const cadre of cadres) {
      b(0x21); b(0xf9); b(4)
      b((cadre.disposition << 2) | (cadre.transparent >= 0 ? 1 : 0))
      w(cadre.delai / 10)
      b(cadre.transparent >= 0 ? cadre.transparent : 0)
      b(0)
      b(0x2c)
      w(cadre.x); w(cadre.y); w(cadre.w); w(cadre.h)
      b(cadre.entrelace ? 0x40 : 0)
      b(2)                       // taille de code minimale
      // Flux LZW : effacement, deux litteraux, effacement, deux litteraux…
      const bits = []
      const pousser = (code) => { for (let i = 0; i < 3; i++) bits.push((code >> i) & 1) }
      let depuis = 0
      for (const px of cadre.pixels) {
        if (depuis === 0) { pousser(4); }
        pousser(px)
        depuis = (depuis + 1) % 2
      }
      pousser(5)
      const octets = []
      for (let i = 0; i < bits.length; i += 8) {
        let v = 0
        for (let j = 0; j < 8 && i + j < bits.length; j++) v |= bits[i + j] << j
        octets.push(v)
      }
      for (let i = 0; i < octets.length; i += 255) {
        const bout = octets.slice(i, i + 255)
        b(bout.length)
        for (const x of bout) b(x)
      }
      b(0)
    }
    b(0x3b)
    return new Uint8Array(o)
  }

  // Une image 4x4 entrelacee : lignes 0,2 puis 1,3 dans l'ordre 0,4,2,1,3…
  // Sur quatre lignes, les passes donnent l'ordre 0, 2, 1, 3.
  const entrelaceePixels = []
  for (const ligne of [0, 2, 1, 3]) for (let x = 0; x < 4; x++) entrelaceePixels.push(ligne % 3 + 1)
  const gifEntrelace = construireGif(4, 4, [{
    x: 0, y: 0, w: 4, h: 4, entrelace: true, delai: 100, disposition: 0,
    transparent: -1, pixels: entrelaceePixels,
  }])
  const luEntrelace = gifIn.decoderGif(gifEntrelace)
  // Les lignes sont ECRITES dans l'ordre 0, 2, 1, 3 et portent la couleur de
  // la ligne d'affichage a laquelle elles appartiennent. A l'ecran, on doit
  // donc lire 1, 2, 3, 1 de haut en bas — et 1, 3, 2, 1 si l'entrelacement
  // est ignore, ce qui est exactement ce que ce controle attrape.
  const attenduEntrelace = [1, 2, 3, 1]
  let entrelaceJuste = 0
  for (let y = 0; y < 4; y++) {
    const couleur = luEntrelace.images[0].bitmap.u32[y * 4]
    const voulu = [rgba(255, 0, 0, 255), rgba(0, 255, 0, 255), rgba(0, 0, 255, 255)][attenduEntrelace[y] - 1]
    if (couleur === voulu) entrelaceJuste++
  }

  // Deux images dont la seconde ne couvre qu'un coin : sans composition, elle
  // ressortirait presque vide.
  const gifPartiel = construireGif(4, 4, [
    { x: 0, y: 0, w: 4, h: 4, entrelace: false, delai: 100, disposition: 1, transparent: -1,
      pixels: new Array(16).fill(1) },
    { x: 2, y: 2, w: 2, h: 2, entrelace: false, delai: 200, disposition: 1, transparent: -1,
      pixels: [2, 2, 2, 2] },
  ])
  const luPartiel = gifIn.decoderGif(gifPartiel)
  const seconde = luPartiel.images[1]?.bitmap
  const partiel = {
    nb: luPartiel.images.length,
    coinGarde: seconde ? seconde.u32[0] === rgba(255, 0, 0, 255) : false,
    coinPeint: seconde ? seconde.u32[3 * 4 + 3] === rgba(0, 255, 0, 255) : false,
    delais: luPartiel.images.map((i) => i.delaiMs).join(','),
  }

  // Import complet : le GIF devient un sprite anime.
  const spriteGif = formats.spriteDepuisGif(octetsGif, 'anim')
  const versSprite = {
    frames: spriteGif.frameCount,
    durees: spriteGif.frameDurations.join(','),
    calques: spriteGif.layers.length,
    palette: spriteGif.palette.size,
  }

  /* ---------------- Palettes ---------------- */
  const couleurs = [rgba(18, 22, 30, 255), rgba(240, 200, 60, 255), rgba(80, 160, 255, 255)]
  const allerRetour = {}
  for (const f of pal.FORMATS_PALETTE) {
    if (f.id === 'css') continue     // le CSS sort mais ne se relit pas
    const ecrit = pal.ecrirePalette(f.id, 'Essai', couleurs)
    const octets = ecrit.octets ?? new TextEncoder().encode(ecrit.texte)
    const relue = pal.lirePalette(`essai.${f.ext}`, octets)
    allerRetour[f.id] = relue.couleurs.slice(0, 3).join(',') === couleurs.join(',')
      ? 'ok' : `${relue.couleurs.length} couleur(s) : ${relue.couleurs.slice(0, 3).join(',')}`
  }

  const enOctets = (s) => new TextEncoder().encode(s)
  const echantillons = {
    gpl: pal.lirePalette('x.gpl', enOctets('GIMP Palette\nName: Test\nColumns: 4\n#\n 18  22  30\t#12161E\n240 200  60\n')),
    jasc: pal.lirePalette('x.pal', enOctets('JASC-PAL\n0100\n2\n18 22 30\n240 200 60\n')),
    hex: pal.lirePalette('x.hex', enOctets('12161E\nF0C83C\n')),
    paintnet: pal.lirePalette('x.txt', enOctets('; commentaire\nFF12161E\nFFF0C83C\n')),
    lospec: pal.lirePalette('x.json', enOctets(JSON.stringify({ name: 'Lospec', colors: ['12161e', 'f0c83c'] }))),
  }
  const attendues = [rgba(18, 22, 30, 255), rgba(240, 200, 60, 255)]
  const lus = {}
  for (const [k, v] of Object.entries(echantillons)) {
    lus[k] = { nom: v.nom, ok: v.couleurs.slice(0, 2).join(',') === attendues.join(',') }
  }

  /* ---------------- Piskel ---------------- */
  const bandeCanvas = document.createElement('canvas')
  bandeCanvas.width = 4 * 2; bandeCanvas.height = 4
  const bctx = bandeCanvas.getContext('2d')
  bctx.fillStyle = '#ff0000'; bctx.fillRect(0, 0, 4, 4)
  bctx.fillStyle = '#0000ff'; bctx.fillRect(4, 0, 4, 4)
  const piskel = JSON.stringify({
    modelVersion: 2,
    piskel: {
      name: 'depuis-piskel', fps: 20, width: 4, height: 4,
      layers: [JSON.stringify({
        name: 'Calque A', opacity: 1, frameCount: 2,
        chunks: [{ layout: [[0], [1]], base64PNG: bandeCanvas.toDataURL('image/png') }],
      })],
    },
  })
  let spritePiskel = null, erreurPiskel = ''
  try { spritePiskel = await formats.spriteDepuisPiskel(piskel, 'x') } catch (e) { erreurPiskel = e.message }
  const dePiskel = spritePiskel ? {
    nom: spritePiskel.name,
    frames: spritePiskel.frameCount,
    duree: spritePiskel.frameDurations[0],
    calques: spritePiskel.layers.length,
    rouge: spritePiskel.layers[0].cels[0]?.bitmap.u32[0] === rgba(255, 0, 0, 255),
    bleu: spritePiskel.layers[0].cels[1]?.bitmap.u32[0] === rgba(0, 0, 255, 255),
  } : { erreur: erreurPiskel }

  /* ---------------- Porte d'entree unique ---------------- */
  const fichier = (octets, nom, type) => new File([octets], nom, { type })
  const portes = {}
  for (const [nom, f] of [
    ['aseprite', fichier(octetsAse, 'x.aseprite', 'application/octet-stream')],
    ['gif', fichier(octetsGif, 'x.gif', 'image/gif')],
    ['gpl', fichier(enOctets('GIMP Palette\nName: P\n#\n18 22 30\n'), 'x.gpl', 'text/plain')],
    ['piskel', fichier(enOctets(piskel), 'x.piskel', 'application/json')],
  ]) {
    try {
      const lu = await formats.ouvrirFichier(f)
      portes[nom] = lu.genre
    } catch (e) { portes[nom] = `erreur : ${e.message}` }
  }
  // Un fichier renomme reste ce qu'il est : on lit le contenu, pas le nom.
  let renomme = ''
  try {
    renomme = (await formats.ouvrirFichier(fichier(octetsGif, 'menteur.png', 'image/png'))).genre
  } catch (e) { renomme = `erreur : ${e.message}` }

  return {
    aseprite, refus, gif, entrelaceJuste, partiel, versSprite,
    allerRetour, lus, dePiskel, portes, renomme,
    attenduPalette: sprite.palette.colors.join(','),
    attenduTags: 'marche:0-2:pingpong',
  }
})

console.log('\n--- Aseprite ---')
check('le fichier ecrit porte la signature d\'Aseprite', m.aseprite.signature,
  `${m.aseprite.taille} octets`)
check('les dimensions survivent a l\'aller-retour', m.aseprite.dims)
check('les calques reviennent, dans l\'ordre et avec leurs noms',
  m.aseprite.calques === 2 && m.aseprite.noms === 'Fond,Perso', m.aseprite.noms)
check('l\'opacite et le mode de fusion des calques survivent',
  m.aseprite.opacites === '255,180' && m.aseprite.fusions === 'normal,multiply',
  `${m.aseprite.opacites} / ${m.aseprite.fusions}`)
check('les frames et leurs durees survivent',
  m.aseprite.frames === 3 && m.aseprite.durees === '80,120,160', m.aseprite.durees)
check('l\'opacite de chaque case survit', m.aseprite.celOpacites === '255,245,235',
  m.aseprite.celOpacites)
check('les tags survivent', m.aseprite.tags === m.attenduTags, m.aseprite.tags || 'aucun')
check('la grille survit', m.aseprite.grille === '1,2,8,8', m.aseprite.grille)
check('la palette survit', m.aseprite.palette === m.attenduPalette)
check('aucun pixel ne change', m.aseprite.pixels === 0, `${m.aseprite.pixels} pixel(s) differents`)
check('un fichier qui n\'en est pas un est refuse', /aseprite/i.test(m.refus), m.refus)

console.log('\n--- GIF ---')
check('le GIF relu a les bonnes dimensions et le bon nombre d\'images',
  m.gif.largeur > 0 && m.gif.nb === 3, `${m.gif.largeur}x${m.gif.hauteur}, ${m.gif.nb} images`)
check('les durees survivent', m.gif.delais === '80,120,160', m.gif.delais)
check('nos pixels sont ceux qu\'on avait encodes', m.gif.identiques,
  `${m.gif.ecarts} pixel(s) differents`)
// L'arbitre : si le navigateur voit autre chose que nous, c'est nous.
check('notre lecture est celle du navigateur', m.gif.commeLeNavigateur === 0,
  `${m.gif.commeLeNavigateur} pixel(s) d'ecart avec le decodeur du navigateur`)
check('une image entrelacee remet ses lignes dans l\'ordre', m.entrelaceJuste === 4,
  `${m.entrelaceJuste}/4 lignes justes`)
check('une image partielle se pose sur la precedente',
  m.partiel.nb === 2 && m.partiel.coinGarde && m.partiel.coinPeint,
  `${m.partiel.nb} images, coin garde ${m.partiel.coinGarde}, coin peint ${m.partiel.coinPeint}`)
check('les durees d\'un GIF bati a la main sont lues', m.partiel.delais === '100,200',
  m.partiel.delais)
check('un GIF devient un sprite anime',
  m.versSprite.frames === 3 && m.versSprite.calques === 1 && m.versSprite.palette > 1,
  `${m.versSprite.frames} frames, ${m.versSprite.palette} couleurs`)

console.log('\n--- Palettes ---')
for (const [id, etat] of Object.entries(m.allerRetour)) {
  check(`palette ${id} : aller-retour fidele`, etat === 'ok', etat === 'ok' ? '' : etat)
}
for (const [id, etat] of Object.entries(m.lus)) {
  check(`palette ${id} : un fichier ecrit a la main se lit`, etat.ok, `nom lu : ${etat.nom}`)
}
check('le nom annonce dans un .gpl est retenu', m.lus.gpl.nom === 'Test', m.lus.gpl.nom)

console.log('\n--- Piskel ---')
check('un .piskel donne ses frames et ses couleurs',
  m.dePiskel.frames === 2 && m.dePiskel.rouge && m.dePiskel.bleu,
  m.dePiskel.erreur || `${m.dePiskel.frames} frames, ${m.dePiskel.calques} calque(s)`)
check('la cadence d\'un .piskel devient une duree', m.dePiskel.duree === 50,
  `${m.dePiskel.duree} ms pour 20 images par seconde`)

console.log('\n--- Porte d\'entree ---')
for (const [nom, genre] of Object.entries(m.portes)) {
  const voulu = nom === 'gpl' ? 'palette' : 'sprite'
  check(`un fichier ${nom} entre par la porte commune`, genre === voulu, genre)
}
check('un fichier renomme est reconnu a son contenu', m.renomme === 'sprite', m.renomme)

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
