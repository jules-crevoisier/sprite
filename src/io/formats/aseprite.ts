import { Bitmap } from '../../core/bitmap'
import { Sprite, Layer, type Tag, type AnimDirection } from '../../core/document'
import { Palette } from '../../core/palette'
import { rgba, getR, getG, getB, getA } from '../../core/color'
import type { BlendMode } from '../../core/blend'

/**
 * Lecture et ecriture du format d'Aseprite (.aseprite / .ase).
 *
 * C'est le format que la plupart des gens ont deja sur leur disque, et le
 * seul dont l'absence oblige a tout recommencer. Un export en planche PNG perd
 * les calques, les durees, les tags et la palette : le fichier natif les garde
 * tous, et ce module les rend.
 *
 * Le format est une suite de blocs longueur-type-contenu, ce qui le rend
 * tolerant : un bloc inconnu se saute sans rien casser. On lit les calques,
 * les cases, la palette, les tags et la grille ; on ignore les blocs qui
 * n'ont pas d'equivalent ici (tilesets, donnees utilisateur, masques
 * anciens) plutot que d'echouer.
 *
 * ## Ce qui se perd
 *
 * A l'ecriture, les groupes de calques deviennent des calques ordinaires et
 * les effets non destructifs ne sont pas emportes — Aseprite n'a pas de quoi
 * les representer. Le reste passe : pixels, opacites, modes de fusion,
 * durees, tags, palette, grille.
 *
 * ## Compression
 *
 * Les images sont compressees en zlib. Le navigateur sait le faire depuis
 * `CompressionStream`, sans bibliotheque : le module est donc asynchrone des
 * deux cotes, ce qui est de toute facon le cas d'une lecture de fichier.
 */

const MAGIE_FICHIER = 0xa5e0
const MAGIE_FRAME = 0xf1fa

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/** Vrai si ces octets portent la signature d'un fichier Aseprite. */
export function estUnAseprite(octets: Uint8Array): boolean {
  return octets.length > 8 && (octets[4] | (octets[5] << 8)) === MAGIE_FICHIER
}

class Curseur {
  pos = 0
  private vue: DataView
  constructor(private o: Uint8Array) { this.vue = new DataView(o.buffer, o.byteOffset, o.byteLength) }
  u8(): number { return this.o[this.pos++] }
  u16(): number { const v = this.vue.getUint16(this.pos, true); this.pos += 2; return v }
  i16(): number { const v = this.vue.getInt16(this.pos, true); this.pos += 2; return v }
  u32(): number { const v = this.vue.getUint32(this.pos, true); this.pos += 4; return v }
  saut(n: number): void { this.pos += n }
  texte(): string {
    const n = this.u16()
    const s = new TextDecoder().decode(this.o.subarray(this.pos, this.pos + n))
    this.pos += n
    return s
  }
  bloc(n: number): Uint8Array { const b = this.o.subarray(this.pos, this.pos + n); this.pos += n; return b }
}

/** Decompresse un flux zlib avec les outils du navigateur. */
async function inflate(donnees: Uint8Array): Promise<Uint8Array> {
  const flux = enBlob(donnees).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(flux).arrayBuffer())
}

async function deflate(donnees: Uint8Array): Promise<Uint8Array> {
  const flux = enBlob(donnees).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(flux).arrayBuffer())
}

/**
 * Recopie les octets dans un tampon a nous avant d'en faire un Blob.
 *
 * Une vue posee sur le tampon d'un fichier peut viser une memoire partagee,
 * que `Blob` refuse. La copie coute un tampon de plus et supprime la
 * question.
 */
function enBlob(donnees: Uint8Array): Blob {
  const copie = new Uint8Array(donnees.length)
  copie.set(donnees)
  return new Blob([copie.buffer])
}

/**
 * Modes de fusion d'Aseprite, dans son ordre a lui.
 *
 * Ceux qui n'ont pas d'equivalent ici retombent sur « normal » : mieux vaut un
 * calque visible avec une fusion approchee qu'un fichier refuse.
 */
const FUSIONS: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
  'addition', 'subtract', 'divide',
]

const DIRECTIONS: AnimDirection[] = ['forward', 'reverse', 'pingpong', 'pingpong-reverse']

interface CalqueLu {
  layer: Layer
  /** Niveau d'imbrication : un groupe et ses enfants montent d'un cran. */
  niveau: number
  groupe: boolean
}

/** Convertit les pixels bruts d'une case selon la profondeur du fichier. */
function pixelsVers32(
  brut: Uint8Array, largeur: number, hauteur: number, profondeur: number,
  palette: number[], indexTransparent: number,
): Bitmap {
  const bm = new Bitmap(largeur, hauteur)
  const n = largeur * hauteur
  if (profondeur === 32) {
    for (let i = 0; i < n; i++) {
      const p = i * 4
      bm.u32[i] = rgba(brut[p], brut[p + 1], brut[p + 2], brut[p + 3])
    }
  } else if (profondeur === 16) {
    // Niveaux de gris : une valeur et son alpha.
    for (let i = 0; i < n; i++) {
      const v = brut[i * 2]
      bm.u32[i] = rgba(v, v, v, brut[i * 2 + 1])
    }
  } else {
    for (let i = 0; i < n; i++) {
      const idx = brut[i]
      bm.u32[i] = idx === indexTransparent ? 0 : (palette[idx] ?? 0)
    }
  }
  return bm
}

export async function lireAseprite(octets: Uint8Array, nom = 'sans-titre'): Promise<Sprite> {
  if (!estUnAseprite(octets)) throw new Error('Ce fichier n\'est pas un .aseprite')
  const c = new Curseur(octets)
  c.saut(4)               // taille du fichier
  c.saut(2)               // magie, deja verifiee
  const nbFrames = c.u16()
  const largeur = c.u16()
  const hauteur = c.u16()
  const profondeur = c.u16()
  c.saut(4)               // drapeaux
  c.saut(2)               // vitesse, obsolete
  c.saut(8)               // deux mots reserves
  const indexTransparent = c.u8()
  c.saut(3)
  c.saut(2)               // nombre de couleurs, redit par le bloc palette
  c.saut(2)               // taille du pixel
  const grilleX = c.i16()
  const grilleY = c.i16()
  const grilleL = c.u16()
  const grilleH = c.u16()
  c.saut(84)

  if (!largeur || !hauteur || !nbFrames) throw new Error('En-tete Aseprite invalide')

  const sprite = new Sprite(largeur, hauteur)
  sprite.name = nom
  sprite.layers = []
  sprite.frameDurations = []
  if (grilleL && grilleH) sprite.grid = { x: grilleX, y: grilleY, w: grilleL, h: grilleH }

  const calques: CalqueLu[] = []
  let palette: number[] = []
  const tags: Tag[] = []

  for (let f = 0; f < nbFrames; f++) {
    const debut = c.pos
    const taille = c.u32()
    const magie = c.u16()
    if (magie !== MAGIE_FRAME) throw new Error(`Frame ${f + 1} illisible`)
    const anciensBlocs = c.u16()
    const duree = c.u16()
    c.saut(2)
    const nouveaux = c.u32()
    const nbBlocs = nouveaux || anciensBlocs
    sprite.frameDurations.push(duree || 100)

    for (let b = 0; b < nbBlocs; b++) {
      const debutBloc = c.pos
      const tailleBloc = c.u32()
      const type = c.u16()
      const finBloc = debutBloc + tailleBloc

      if (type === 0x2004) {
        // Calque.
        const drapeaux = c.u16()
        const typeCalque = c.u16()
        const niveau = c.u16()
        c.saut(4)
        const fusion = c.u16()
        const opacite = c.u8()
        c.saut(3)
        const nomCalque = c.texte()
        const layer = new Layer(nomCalque || `Calque ${calques.length + 1}`, nbFrames)
        layer.visible = (drapeaux & 1) !== 0
        layer.locked = (drapeaux & 2) === 0 ? false : false
        layer.opacity = opacite
        layer.blendMode = FUSIONS[fusion] ?? 'normal'
        calques.push({ layer, niveau, groupe: typeCalque === 1 })
      } else if (type === 0x2005) {
        // Case.
        const iCalque = c.u16()
        const x = c.i16()
        const y = c.i16()
        const opacite = c.u8()
        const typeCase = c.u16()
        c.saut(2)   // z-index
        c.saut(5)
        const cible = calques[iCalque]
        if (!cible) { c.pos = finBloc; continue }

        if (typeCase === 1) {
          // Case liee : elle reprend celle d'une autre frame, sans copie.
          const source = c.u16()
          const lien = cible.layer.cels[source]
          if (lien) cible.layer.cels[f] = { bitmap: lien.bitmap, opacity: lien.opacity }
        } else if (typeCase === 0 || typeCase === 2) {
          const cl = c.u16()
          const ch = c.u16()
          const attendus = cl * ch * (profondeur === 32 ? 4 : profondeur === 16 ? 2 : 1)
          const brutCompresse = c.bloc(finBloc - c.pos)
          const brut = typeCase === 2 ? await inflate(brutCompresse) : brutCompresse
          if (brut.length >= attendus && cl > 0 && ch > 0) {
            const petit = pixelsVers32(brut, cl, ch, profondeur, palette, indexTransparent)
            // Une case ne couvre que sa propre boite : on la repose a sa
            // place dans une image de la taille du sprite.
            const plein = new Bitmap(largeur, hauteur)
            for (let py = 0; py < ch; py++) {
              const dy = y + py
              if (dy < 0 || dy >= hauteur) continue
              for (let px = 0; px < cl; px++) {
                const dx = x + px
                if (dx < 0 || dx >= largeur) continue
                plein.u32[dy * largeur + dx] = petit.u32[py * cl + px]
              }
            }
            cible.layer.cels[f] = { bitmap: plein, opacity: opacite }
          }
        }
      } else if (type === 0x2019) {
        // Palette.
        const total = c.u32()
        const premier = c.u32()
        const dernier = c.u32()
        c.saut(8)
        if (palette.length < total) palette = palette.concat(new Array(total - palette.length).fill(0))
        for (let i = premier; i <= dernier && i < total; i++) {
          const drapeaux = c.u16()
          const r = c.u8(), g = c.u8(), bl = c.u8(), a = c.u8()
          if (drapeaux & 1) c.texte()
          palette[i] = rgba(r, g, bl, a)
        }
      } else if (type === 0x0004 || type === 0x0011) {
        // Anciennes palettes : lues seulement si aucune moderne n'est venue.
        const paquets = c.u16()
        let index = 0
        const lue: number[] = palette.slice()
        for (let pq = 0; pq < paquets; pq++) {
          index += c.u8()
          const combien = c.u8() || 256
          for (let i = 0; i < combien; i++) {
            const r = c.u8(), g = c.u8(), bl = c.u8()
            const mise = type === 0x0004 ? 255 / 63 : 1
            lue[index + i] = rgba(
              Math.round(r * mise), Math.round(g * mise), Math.round(bl * mise), 255)
          }
          index += combien
        }
        if (!palette.length) palette = lue
      } else if (type === 0x2018) {
        // Tags d'animation.
        const combien = c.u16()
        c.saut(8)
        for (let t = 0; t < combien; t++) {
          const de = c.u16()
          const a = c.u16()
          const sens = c.u8()
          c.saut(2)   // repetitions
          c.saut(6)
          const couleur = rgba(c.u8(), c.u8(), c.u8(), 255)
          c.saut(1)
          const nomTag = c.texte()
          tags.push({
            id: t + 1,
            name: nomTag || `Tag ${t + 1}`,
            from: de,
            to: a,
            direction: DIRECTIONS[sens] ?? 'forward',
            repeat: 0,
            color: couleur,
          })
        }
      }

      c.pos = finBloc
    }
    c.pos = debut + taille
  }

  // Les groupes ne se representent pas ici : leurs enfants remontent au meme
  // niveau, dans l'ordre, plutot que d'etre perdus.
  sprite.layers = calques.filter((x) => !x.groupe).map((x) => x.layer)
  if (!sprite.layers.length) {
    const vide = new Layer('Calque 1', nbFrames)
    sprite.layers.push(vide)
  }
  for (const l of sprite.layers) {
    for (let f = 0; f < nbFrames; f++) if (l.cels[f] === undefined) l.cels[f] = null
  }
  sprite.tags = tags
  if (palette.length) {
    sprite.palette = new Palette('Importée', palette.filter((c2) => getA(c2) !== 0).slice(0, 256))
  }
  return sprite
}

/* ------------------------------------------------------------------ */
/* Ecriture                                                            */
/* ------------------------------------------------------------------ */

class Ruban {
  private octets: number[] = []
  u8(v: number): void { this.octets.push(v & 0xff) }
  u16(v: number): void { this.u8(v); this.u8(v >> 8) }
  i16(v: number): void { this.u16(v < 0 ? v + 0x10000 : v) }
  u32(v: number): void { this.u16(v); this.u16(v >>> 16) }
  zeros(n: number): void { for (let i = 0; i < n; i++) this.u8(0) }
  texte(s: string): void {
    const b = new TextEncoder().encode(s)
    this.u16(b.length)
    for (const x of b) this.u8(x)
  }
  brut(b: Uint8Array): void { for (const x of b) this.u8(x) }
  get taille(): number { return this.octets.length }
  /** Reecrit un entier 32 bits deja pose : sert aux tailles de blocs. */
  reecrireU32(pos: number, v: number): void {
    this.octets[pos] = v & 0xff
    this.octets[pos + 1] = (v >> 8) & 0xff
    this.octets[pos + 2] = (v >> 16) & 0xff
    this.octets[pos + 3] = (v >>> 24) & 0xff
  }
  vers(): Uint8Array { return new Uint8Array(this.octets) }
}

/** Bornes des pixels non vides : une case ne stocke que ce qu'elle couvre. */
function boite(bm: Bitmap): { x: number; y: number; w: number; h: number } {
  let x0 = bm.width, y0 = bm.height, x1 = -1, y1 = -1
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      if (getA(bm.u32[y * bm.width + x]) === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export async function ecrireAseprite(sprite: Sprite): Promise<Uint8Array> {
  const r = new Ruban()
  const nbFrames = Math.max(1, sprite.frameCount)

  r.u32(0)                    // taille du fichier, reecrite a la fin
  r.u16(MAGIE_FICHIER)
  r.u16(nbFrames)
  r.u16(sprite.width)
  r.u16(sprite.height)
  r.u16(32)                   // RGBA : c'est ainsi qu'on travaille ici
  r.u32(1)                    // le calque d'opacite est valide
  r.u16(100)                  // vitesse obsolete, mais des lecteurs la lisent
  r.u32(0); r.u32(0)
  r.u8(0)                     // index transparent, sans objet en RGBA
  r.zeros(3)
  r.u16(Math.min(256, sprite.palette.size))
  r.u8(1); r.u8(1)            // pixel carre
  r.i16(sprite.grid.x); r.i16(sprite.grid.y)
  r.u16(sprite.grid.w); r.u16(sprite.grid.h)
  r.zeros(84)

  for (let f = 0; f < nbFrames; f++) {
    const debutFrame = r.taille
    r.u32(0)                  // taille de la frame, reecrite plus bas
    r.u16(MAGIE_FRAME)
    r.u16(0)                  // ancien compte de blocs : on passe par le neuf
    r.u16(Math.max(1, Math.round(sprite.frameDurations[f] ?? 100)))
    r.zeros(2)
    const posNbBlocs = r.taille
    r.u32(0)
    let nbBlocs = 0

    const bloc = (type: number, ecrire: () => void): void => {
      const debut = r.taille
      r.u32(0)
      r.u16(type)
      ecrire()
      r.reecrireU32(debut, r.taille - debut)
      nbBlocs++
    }

    if (f === 0) {
      // Palette et calques ne sont declares qu'une fois, sur la premiere frame.
      const couleurs = sprite.palette.colors.slice(0, 256)
      bloc(0x2019, () => {
        r.u32(couleurs.length)
        r.u32(0)
        r.u32(Math.max(0, couleurs.length - 1))
        r.zeros(8)
        for (const col of couleurs) {
          r.u16(0)
          r.u8(getR(col)); r.u8(getG(col)); r.u8(getB(col)); r.u8(getA(col))
        }
      })

      for (const layer of sprite.layers) {
        bloc(0x2004, () => {
          r.u16((layer.visible ? 1 : 0) | 4)   // visible + modifiable
          r.u16(0)                              // calque d'images
          r.u16(0)                              // pas de groupe
          r.u16(0); r.u16(0)
          const i = FUSIONS.indexOf(layer.blendMode)
          r.u16(i < 0 ? 0 : i)
          r.u8(layer.opacity)
          r.zeros(3)
          r.texte(layer.name)
        })
      }

      if (sprite.tags.length) {
        bloc(0x2018, () => {
          r.u16(sprite.tags.length)
          r.zeros(8)
          for (const t of sprite.tags) {
            r.u16(t.from); r.u16(t.to)
            r.u8(Math.max(0, DIRECTIONS.indexOf(t.direction)))
            r.u16(0)
            r.zeros(6)
            r.u8(getR(t.color)); r.u8(getG(t.color)); r.u8(getB(t.color))
            r.u8(0)
            r.texte(t.name)
          }
        })
      }
    }

    for (let li = 0; li < sprite.layers.length; li++) {
      const cel = sprite.layers[li].cels[f]
      if (!cel) continue
      const b = boite(cel.bitmap)
      if (!b.w || !b.h) continue
      const pixels = new Uint8Array(b.w * b.h * 4)
      for (let y = 0; y < b.h; y++) {
        for (let x = 0; x < b.w; x++) {
          const col = cel.bitmap.u32[(y + b.y) * cel.bitmap.width + (x + b.x)]
          const p = (y * b.w + x) * 4
          pixels[p] = getR(col); pixels[p + 1] = getG(col)
          pixels[p + 2] = getB(col); pixels[p + 3] = getA(col)
        }
      }
      const compresse = await deflate(pixels)
      bloc(0x2005, () => {
        r.u16(li)
        r.i16(b.x); r.i16(b.y)
        r.u8(cel.opacity)
        r.u16(2)              // image compressee
        r.i16(0)              // z-index
        r.zeros(5)
        r.u16(b.w); r.u16(b.h)
        r.brut(compresse)
      })
    }

    r.reecrireU32(posNbBlocs, nbBlocs)
    r.reecrireU32(debutFrame, r.taille - debutFrame)
  }

  r.reecrireU32(0, r.taille)
  return r.vers()
}
