import { Bitmap } from '../../core/bitmap'
import { rgba } from '../../core/color'

/**
 * Lecture d'un GIF, anime ou non.
 *
 * PixelForge savait ecrire un GIF depuis longtemps mais pas en lire un, ce qui
 * est le sens dont on a le plus besoin : une animation trouvee quelque part,
 * un travail commence ailleurs, un rendu qu'on veut reprendre image par image.
 *
 * Le format date de 1989 et se lit d'un bout a l'autre : un en-tete, une table
 * de couleurs, puis une suite de blocs. Chaque image est compressee en LZW —
 * l'algorithme est court, et le decodeur tient ici en une trentaine de lignes.
 *
 * Trois pieges, tous rencontres sur des fichiers reels :
 *
 * - une image peut ne couvrir qu'une partie de l'ecran, et se poser sur ce que
 *   la precedente a laisse. Ignorer la composition donne une animation ou
 *   presque toutes les images sont vides ;
 * - le champ « disposal » dit ce qu'on fait de l'image d'avant : la garder, la
 *   remplacer par du vide, ou revenir a l'etat d'avant elle. Trois codes, trois
 *   comportements, et les trois se rencontrent ;
 * - une image peut etre entrelacee : ses lignes arrivent en quatre passes.
 */

export interface ImageGif {
  bitmap: Bitmap
  /** Duree affichee, en millisecondes. */
  delaiMs: number
}

export interface RenduGif {
  largeur: number
  hauteur: number
  images: ImageGif[]
  /** Couleurs rencontrees, dans l'ordre des tables du fichier. */
  couleurs: number[]
}

/** Vrai si ces octets commencent par la signature d'un GIF. */
export function estUnGif(octets: Uint8Array): boolean {
  return octets.length > 6 && octets[0] === 0x47 && octets[1] === 0x49 && octets[2] === 0x46
}

/**
 * Decompresse un bloc LZW en indices de palette.
 *
 * La table repart de zero des qu'elle atteint 4096 entrees ou qu'un code
 * d'effacement passe : sans ce redemarrage, les grandes images se decodent en
 * bouillie apres quelques milliers de pixels.
 */
function decompresserLzw(donnees: Uint8Array, tailleMin: number, pixels: number): Uint8Array {
  const sortie = new Uint8Array(pixels)
  const EFFACER = 1 << tailleMin
  const FIN = EFFACER + 1

  // Table de prefixes : chaque code renvoie a un code plus court plus un
  // octet. On la parcourt a l'envers pour reconstituer une suite.
  const prefixe = new Int32Array(4096)
  const suffixe = new Uint8Array(4096)
  const pile = new Uint8Array(4096)

  let tailleCode = tailleMin + 1
  let libre = FIN + 1
  let tampon = 0, bits = 0, lu = 0, ecrit = 0
  let precedent = -1

  while (ecrit < pixels) {
    if (bits < tailleCode) {
      if (lu >= donnees.length) break
      tampon |= donnees[lu++] << bits
      bits += 8
      continue
    }
    const code = tampon & ((1 << tailleCode) - 1)
    tampon >>= tailleCode
    bits -= tailleCode

    if (code === EFFACER) {
      tailleCode = tailleMin + 1
      libre = FIN + 1
      precedent = -1
      continue
    }
    if (code === FIN) break

    let courant = code
    let hauteurPile = 0
    if (code >= libre) {
      // Cas du code qui se decrit lui-meme : il vaut la suite precedente
      // suivie de son propre premier octet.
      if (precedent < 0) break
      pile[hauteurPile++] = premierOctet(prefixe, precedent, EFFACER)
      courant = precedent
    }
    while (courant >= EFFACER) {
      pile[hauteurPile++] = suffixe[courant]
      courant = prefixe[courant]
    }
    pile[hauteurPile++] = courant

    while (hauteurPile > 0 && ecrit < pixels) sortie[ecrit++] = pile[--hauteurPile]

    if (precedent >= 0 && libre < 4096) {
      prefixe[libre] = precedent
      suffixe[libre] = courant
      libre++
      if (libre === (1 << tailleCode) && tailleCode < 12) tailleCode++
    }
    precedent = code
  }
  return sortie
}

/**
 * Premier octet de la suite designee par un code.
 *
 * On remonte les prefixes jusqu'a tomber sur un code racine — ceux-la valent
 * directement leur octet. C'est ce qu'il faut pour le cas ou un code se
 * decrit lui-meme, seule subtilite du LZW de GIF.
 */
function premierOctet(prefixe: Int32Array, code: number, racines: number): number {
  let c = code
  let garde = 0
  while (c >= racines && garde++ < 4096) c = prefixe[c]
  return c
}

/** Lit les blocs de donnees successifs jusqu'au bloc vide qui les termine. */
function lireSousBlocs(o: Uint8Array, pos: number): { donnees: Uint8Array; fin: number } {
  const morceaux: Uint8Array[] = []
  let total = 0
  let p = pos
  while (p < o.length) {
    const taille = o[p++]
    if (!taille) break
    morceaux.push(o.subarray(p, p + taille))
    total += taille
    p += taille
  }
  const donnees = new Uint8Array(total)
  let d = 0
  for (const m of morceaux) { donnees.set(m, d); d += m.length }
  return { donnees, fin: p }
}

function lireTable(o: Uint8Array, pos: number, taille: number): number[] {
  const table: number[] = []
  for (let i = 0; i < taille; i++) {
    const p = pos + i * 3
    table.push(rgba(o[p], o[p + 1], o[p + 2], 255))
  }
  return table
}

/** Ordre des lignes d'une image entrelacee : quatre passes, pas huit. */
function lignesEntrelacees(hauteur: number): number[] {
  const out: number[] = []
  for (const [depart, pas] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = depart; y < hauteur; y += pas) out.push(y)
  }
  return out
}

export function decoderGif(octets: Uint8Array): RenduGif {
  if (!estUnGif(octets)) throw new Error('Ce fichier n\'est pas un GIF')
  let p = 6
  const largeur = octets[p] | (octets[p + 1] << 8)
  const hauteur = octets[p + 2] | (octets[p + 3] << 8)
  const packed = octets[p + 4]
  p += 7

  let tableGlobale: number[] = []
  if (packed & 0x80) {
    const taille = 2 << (packed & 7)
    tableGlobale = lireTable(octets, p, taille)
    p += taille * 3
  }

  const couleurs = new Set<number>(tableGlobale)
  const images: ImageGif[] = []
  // Etat courant de l'ecran : c'est lui qu'on photographie a chaque image.
  const ecran = new Bitmap(largeur, hauteur)

  let delai = 100
  let indexTransparent = -1
  let disposition = 0

  while (p < octets.length) {
    const marque = octets[p++]

    if (marque === 0x3b) break

    if (marque === 0x21) {
      const label = octets[p++]
      if (label === 0xf9) {
        const taille = octets[p++]
        const bloc = octets.subarray(p, p + taille)
        disposition = (bloc[0] >> 2) & 7
        const centiemes = bloc[1] | (bloc[2] << 8)
        // Un delai nul veut dire « aussi vite que possible » : les
        // navigateurs le lisent comme 100 ms, et nous aussi, faute de quoi
        // l'animation importee defile a plusieurs centaines d'images par
        // seconde.
        delai = centiemes ? centiemes * 10 : 100
        indexTransparent = (bloc[0] & 1) ? bloc[3] : -1
        p += taille
        p = lireSousBlocs(octets, p).fin
      } else {
        p = lireSousBlocs(octets, p).fin
      }
      continue
    }

    if (marque !== 0x2c) continue

    const gx = octets[p] | (octets[p + 1] << 8)
    const gy = octets[p + 2] | (octets[p + 3] << 8)
    const gw = octets[p + 4] | (octets[p + 5] << 8)
    const gh = octets[p + 6] | (octets[p + 7] << 8)
    const local = octets[p + 8]
    p += 9

    let table = tableGlobale
    if (local & 0x80) {
      const taille = 2 << (local & 7)
      table = lireTable(octets, p, taille)
      for (const c of table) couleurs.add(c)
      p += taille * 3
    }
    const entrelace = (local & 0x40) !== 0

    const tailleMin = octets[p++]
    const { donnees, fin } = lireSousBlocs(octets, p)
    p = fin

    const indices = decompresserLzw(donnees, tailleMin, gw * gh)

    // Etat a restaurer si la disposition le demande, pris AVANT de peindre.
    const avant = disposition === 3 ? ecran.u32.slice() : null

    const lignes = entrelace ? lignesEntrelacees(gh) : null
    for (let ly = 0; ly < gh; ly++) {
      const y = (lignes ? lignes[ly] : ly) + gy
      if (y < 0 || y >= hauteur) continue
      for (let lx = 0; lx < gw; lx++) {
        const idx = indices[ly * gw + lx]
        if (idx === indexTransparent) continue
        const x = lx + gx
        if (x < 0 || x >= largeur) continue
        ecran.u32[y * largeur + x] = table[idx] ?? 0
      }
    }

    images.push({ bitmap: ecran.clone(), delaiMs: delai })

    // La disposition s'applique APRES l'image qu'elle accompagne.
    if (disposition === 2) {
      for (let y = gy; y < gy + gh && y < hauteur; y++) {
        for (let x = gx; x < gx + gw && x < largeur; x++) ecran.u32[y * largeur + x] = 0
      }
    } else if (disposition === 3 && avant) {
      ecran.u32.set(avant)
    }
  }

  if (!images.length) throw new Error('GIF sans image')
  return { largeur, hauteur, images, couleurs: [...couleurs] }
}
