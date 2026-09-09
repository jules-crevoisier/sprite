import { rgba, getR, getG, getB, toHex } from '../../core/color'

/**
 * Palettes des autres logiciels, lues et ecrites.
 *
 * Une palette est ce qu'on echange le plus souvent : elle tient en quelques
 * dizaines de couleurs, elle circule sur les forums et les sites de ressources,
 * et chaque logiciel a impose la sienne. Aucun de ces formats n'est difficile —
 * ce qui l'est, c'est de deviner lequel on a sous la main, car l'extension ment
 * souvent : `.pal` designe deux formats sans rapport, l'un texte et l'autre
 * binaire, et `.ase` designe a la fois un nuancier Adobe et un fichier
 * Aseprite. On regarde donc le contenu, pas le nom.
 *
 * Formats lus : GIMP (.gpl), JASC et Microsoft (.pal), Adobe (.act, .ase),
 * hexadecimal brut (.hex), Paint.NET (.txt), et le JSON de lospec.
 */

export interface PaletteLue {
  nom: string
  couleurs: number[]
}

export interface FormatPalette {
  id: string
  ext: string
  label: string
  /** Vrai si l'ecriture produit des octets plutot que du texte. */
  binaire?: boolean
}

export const FORMATS_PALETTE: FormatPalette[] = [
  { id: 'gpl', ext: 'gpl', label: 'GIMP, Krita, Inkscape (.gpl)' },
  { id: 'pal', ext: 'pal', label: 'JASC — Paint Shop, Aseprite (.pal)' },
  { id: 'hex', ext: 'hex', label: 'Hexadecimal brut (.hex)' },
  { id: 'txt', ext: 'txt', label: 'Paint.NET (.txt)' },
  { id: 'act', ext: 'act', label: 'Adobe Color Table (.act)', binaire: true },
  { id: 'css', ext: 'css', label: 'Variables CSS (.css)' },
]

const nettoyerNom = (nom: string): string => nom.replace(/\.[^.]+$/, '') || 'palette'

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/** Ajoute une couleur si elle n'y est pas deja : les doublons ne servent personne. */
function pousser(sortie: number[], vus: Set<number>, couleur: number): void {
  if (vus.has(couleur)) return
  vus.add(couleur)
  sortie.push(couleur)
}

function lireGpl(texte: string, nomFichier: string): PaletteLue {
  const lignes = texte.split(/\r?\n/)
  let nom = nettoyerNom(nomFichier)
  const couleurs: number[] = []
  const vus = new Set<number>()
  for (const ligne of lignes) {
    const l = ligne.trim()
    if (!l || l.startsWith('#')) continue
    if (/^GIMP Palette/i.test(l)) continue
    const nomDit = /^Name:\s*(.+)$/i.exec(l)
    if (nomDit) { nom = nomDit[1].trim(); continue }
    if (/^Columns:/i.test(l)) continue
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(l)
    if (!m) continue
    pousser(couleurs, vus, rgba(+m[1], +m[2], +m[3], 255))
  }
  return { nom, couleurs }
}

function lireJascPal(texte: string, nomFichier: string): PaletteLue {
  const lignes = texte.split(/\r?\n/).slice(3)
  const couleurs: number[] = []
  const vus = new Set<number>()
  for (const ligne of lignes) {
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(ligne.trim())
    if (!m) continue
    pousser(couleurs, vus, rgba(+m[1], +m[2], +m[3], 255))
  }
  return { nom: nettoyerNom(nomFichier), couleurs }
}

function lireHex(texte: string, nomFichier: string): PaletteLue {
  const couleurs: number[] = []
  const vus = new Set<number>()
  for (const brut of texte.split(/[\s,;]+/)) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(brut.trim())
    if (!m) continue
    const h = m[1]
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255
    pousser(couleurs, vus, rgba(r, g, b, a))
  }
  return { nom: nettoyerNom(nomFichier), couleurs }
}

/** Paint.NET : une couleur AARRGGBB par ligne, les commentaires en `;`. */
function lirePaintNet(texte: string, nomFichier: string): PaletteLue {
  const couleurs: number[] = []
  const vus = new Set<number>()
  for (const ligne of texte.split(/\r?\n/)) {
    const l = ligne.split(';')[0].trim()
    const m = /^([0-9a-f]{8})$/i.exec(l)
    if (!m) continue
    const v = m[1]
    pousser(couleurs, vus, rgba(
      parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16),
      parseInt(v.slice(6, 8), 16), parseInt(v.slice(0, 2), 16)))
  }
  return { nom: nettoyerNom(nomFichier), couleurs }
}

/** JSON de lospec : `{ name, colors: ["ff0000", ...] }`. */
function lireJson(texte: string, nomFichier: string): PaletteLue | null {
  try {
    const brut = JSON.parse(texte) as { name?: string; colors?: string[] }
    if (!Array.isArray(brut.colors)) return null
    const lu = lireHex(brut.colors.join(' '), nomFichier)
    return { nom: brut.name?.trim() || lu.nom, couleurs: lu.couleurs }
  } catch {
    return null
  }
}

/** Adobe Color Table : 256 triplets, parfois suivis du nombre reellement utilise. */
function lireAct(octets: Uint8Array, nomFichier: string): PaletteLue {
  let combien = Math.floor(octets.length / 3)
  if (octets.length === 772 || octets.length === 768 + 4) {
    const dit = (octets[768] << 8) | octets[769]
    if (dit > 0 && dit <= 256) combien = dit
  }
  const couleurs: number[] = []
  const vus = new Set<number>()
  for (let i = 0; i < Math.min(combien, 256); i++) {
    pousser(couleurs, vus, rgba(octets[i * 3], octets[i * 3 + 1], octets[i * 3 + 2], 255))
  }
  return { nom: nettoyerNom(nomFichier), couleurs }
}

/** Palette RIFF de Microsoft : « RIFF….PAL data », puis des quadruplets. */
function lireRiffPal(octets: Uint8Array, nomFichier: string): PaletteLue {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  const combien = vue.getUint16(0x16, true)
  const couleurs: number[] = []
  const vus = new Set<number>()
  for (let i = 0; i < combien; i++) {
    const p = 0x18 + i * 4
    if (p + 2 >= octets.length) break
    pousser(couleurs, vus, rgba(octets[p], octets[p + 1], octets[p + 2], 255))
  }
  return { nom: nettoyerNom(nomFichier), couleurs }
}

/**
 * Nuancier Adobe (.ase). Seuls les groupes et les couleurs RVB sont lus : le
 * CMJN et le Lab demandent un profil colorimetrique pour avoir un sens, et
 * une conversion inventee serait pire que rien.
 */
function lireAdobeAse(octets: Uint8Array, nomFichier: string): PaletteLue {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  const blocs = vue.getUint32(8, false)
  const couleurs: number[] = []
  const vus = new Set<number>()
  let p = 12
  for (let i = 0; i < blocs && p + 6 <= octets.length; i++) {
    const type = vue.getUint16(p, false)
    const taille = vue.getUint32(p + 2, false)
    const fin = p + 6 + taille
    if (type === 0x0001) {
      let q = p + 6
      const lettres = vue.getUint16(q, false)
      q += 2 + lettres * 2
      const espace = new TextDecoder().decode(octets.subarray(q, q + 4))
      q += 4
      if (espace === 'RGB ') {
        const r = vue.getFloat32(q, false)
        const g = vue.getFloat32(q + 4, false)
        const b = vue.getFloat32(q + 8, false)
        pousser(couleurs, vus, rgba(
          Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255))
      } else if (espace === 'Gray') {
        const v = Math.round(vue.getFloat32(q, false) * 255)
        pousser(couleurs, vus, rgba(v, v, v, 255))
      }
    }
    p = fin
  }
  return { nom: nettoyerNom(nomFichier), couleurs }
}

const texteDe = (octets: Uint8Array, n = 4): string =>
  new TextDecoder().decode(octets.subarray(0, n))

/**
 * Devine le format et lit la palette.
 *
 * L'ordre compte : on reconnait d'abord les signatures binaires, qui ne
 * trompent pas, puis on tente les formats texte du plus specifique au plus
 * general. L'hexadecimal passe en dernier, car il accepterait des morceaux
 * de n'importe quoi.
 */
export function lirePalette(nomFichier: string, octets: Uint8Array): PaletteLue {
  if (texteDe(octets) === 'RIFF') return lireRiffPal(octets, nomFichier)
  if (texteDe(octets) === 'ASEF') return lireAdobeAse(octets, nomFichier)

  const ext = (/\.([^.]+)$/.exec(nomFichier)?.[1] ?? '').toLowerCase()
  // Un .act n'a aucune signature : il se reconnait a sa taille, toujours un
  // multiple de trois, et a son extension.
  if (ext === 'act' && (octets.length === 768 || octets.length === 772)) {
    return lireAct(octets, nomFichier)
  }

  const texte = new TextDecoder().decode(octets)
  if (/^GIMP Palette/i.test(texte)) return lireGpl(texte, nomFichier)
  if (/^JASC-PAL/i.test(texte)) return lireJascPal(texte, nomFichier)
  if (ext === 'json' || texte.trimStart().startsWith('{')) {
    const json = lireJson(texte, nomFichier)
    if (json?.couleurs.length) return json
  }
  const paintNet = lirePaintNet(texte, nomFichier)
  if (paintNet.couleurs.length) return paintNet
  return lireHex(texte, nomFichier)
}

/* ------------------------------------------------------------------ */
/* Ecriture                                                            */
/* ------------------------------------------------------------------ */

export function ecrirePalette(
  format: string, nom: string, couleurs: number[],
): { texte?: string; octets?: Uint8Array } {
  const c = couleurs.slice(0, 256)
  switch (format) {
    case 'gpl':
      return {
        texte: `GIMP Palette\nName: ${nom}\nColumns: 0\n#\n`
          + c.map((x) => `${String(getR(x)).padStart(3)} ${String(getG(x)).padStart(3)} `
            + `${String(getB(x)).padStart(3)}\t${toHex(x).toUpperCase()}`).join('\n') + '\n',
      }
    case 'pal':
      return {
        texte: `JASC-PAL\n0100\n${c.length}\n`
          + c.map((x) => `${getR(x)} ${getG(x)} ${getB(x)}`).join('\n') + '\n',
      }
    case 'hex':
      return { texte: c.map((x) => toHex(x).replace('#', '').toUpperCase()).join('\n') + '\n' }
    case 'txt':
      return {
        texte: `; Palette ${nom} — exportée par PixelForge\n`
          + c.map((x) => `FF${toHex(x).replace('#', '').toUpperCase()}`).join('\n') + '\n',
      }
    case 'css':
      return {
        texte: `:root {\n${c.map((x, i) =>
          `  --couleur-${i + 1}: ${toHex(x)};`).join('\n')}\n}\n`,
      }
    case 'act': {
      // Toujours 768 octets, plus le compte reel : c'est ce qu'attend Photoshop.
      const out = new Uint8Array(772)
      for (let i = 0; i < c.length && i < 256; i++) {
        out[i * 3] = getR(c[i]); out[i * 3 + 1] = getG(c[i]); out[i * 3 + 2] = getB(c[i])
      }
      out[768] = (c.length >> 8) & 0xff
      out[769] = c.length & 0xff
      out[770] = 0xff; out[771] = 0xff
      return { octets: out }
    }
    default:
      throw new Error(`Format de palette inconnu : ${format}`)
  }
}
