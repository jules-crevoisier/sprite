import { Bitmap } from '../core/bitmap'
import { getA } from '../core/color'

/**
 * Comble les fentes ouvertes par une deformation.
 *
 * Quand le squelette pose un personnage, chaque morceau tourne autour de son
 * propre os. Deux morceaux voisins qui ne tournent pas du meme angle
 * s'ecartent, et il reste entre eux une fente de quelques pixels — un trait
 * de vide en plein milieu du torse. C'est le defaut le plus visible d'une
 * pose : l'oeil ne pardonne pas un personnage fendu.
 *
 * Ce module devine ce qui devait s'y trouver.
 *
 * ## Deviner, pas inventer
 *
 * Aucune couleur n'est fabriquee. Chaque pixel comble reprend une couleur
 * deja presente au bord de la fente : la palette du dessin traverse
 * l'operation intacte, ce qu'un flou ou une interpolation ne garantiraient
 * pas. En pixel art, une couleur intermediaire se voit immediatement — elle
 * n'appartient a aucune rampe et le degrade devient sale.
 *
 * ## Une dechirure ressemble a une encoche
 *
 * C'est la difficulte du probleme, et elle ne se resout pas par la geometrie.
 * L'espace entre les deux oreilles de la mascotte fait quatre pixels de large
 * et de la matiere de chaque cote : il est indiscernable d'une fente ouverte
 * par une pose. Un comblage qui se fie a la seule forme referme les deux, et
 * la mascotte se retrouve avec un bloc a la place des oreilles. Mesure : sur
 * un dessin intact, quarante et un pixels ajoutes sans qu'aucune deformation
 * n'ait eu lieu.
 *
 * On ne devine donc pas — on demande. Le rendu d'une scene sait quel morceau
 * a peint chaque pixel : une fente entre DEUX morceaux differents est une
 * dechirure, un creux a l'interieur d'un seul morceau est un choix du
 * dessin. C'est `proprietaire` qui porte cette information. A defaut,
 * `autorise` laisse l'appelant designer la zone lui-meme — une selection,
 * par exemple.
 *
 * Sans l'un ni l'autre, tout vide encadre est comble : c'est le mode « je
 * sais ce que je fais », et il n'est pas le defaut de l'interface.
 *
 * ## Comment
 *
 * Pour chaque pixel vide on cherche la matiere la plus proche de part et
 * d'autre, sur les deux axes. Un axe borde des deux cotes a moins de
 * `largeurMax` pixels est une fente candidate ; on retient la plus etroite.
 * Deux bords de meme couleur donnent cette couleur — c'est le cas courant, et
 * c'est pour cela que la devinette tombe juste. Deux bords differents donnent
 * le plus proche, et a egalite celui que confirme le voisinage
 * perpendiculaire.
 *
 * Les voisins orthogonaux immediats ne suffisaient pas : dans une fente de
 * deux pixels de large, chaque pixel vide n'a qu'un seul voisin plein, et
 * exiger deux voisins ne comblait jamais rien au-dela d'un pixel. Le banc l'a
 * dit sans detour : 0% sur une fente de deux. On regarde donc au-dela du
 * voisin immediat, jusqu'au bord de la fente.
 */

export interface OptionsComblage {
  /**
   * Largeur maximale d'une fente, en pixels. Au-dela, le vide est considere
   * comme voulu et laisse tel quel.
   */
  largeurMax: number
  /**
   * Morceau qui a peint chaque pixel ; -1 pour le vide. Quand il est fourni,
   * on ne comble qu'entre deux morceaux DIFFERENTS : un creux a l'interieur
   * d'un seul morceau appartient au dessin.
   */
  proprietaire?: Int32Array
  /** Filtre libre, quand l'appelant sait ou se trouve la zone a reparer. */
  autorise?: (x: number, y: number) => boolean
}

export const COMBLAGE_DEFAUT: OptionsComblage = { largeurMax: 6 }

export interface BilanComblage {
  /** Pixels ajoutes. */
  combles: number
  /** Pixels vides tenus pour une fente qu'on n'a pas su combler. */
  restants: number
  /**
   * Pixels vides encadres qu'on a laisses parce qu'ils appartiennent a un
   * seul morceau : des encoches, pas des dechirures. Zero quand personne n'a
   * fourni de proprietaire — dans ce mode-la, rien n'est protege.
   */
  epargnes: number
}

export interface ResultatComblage {
  image: Bitmap
  bilan: BilanComblage
  /**
   * Proprietaire mis a jour : chaque pixel comble herite du morceau dont il a
   * repris la couleur. Rendu seulement si l'appelant en a fourni un — de quoi
   * enchainer une seconde passe, ou mesurer ce qui reste.
   */
  proprietaire: Int32Array | null
}

interface Bord {
  /** Nombre de pixels a franchir avant de rencontrer de la matiere. */
  dist: number
  /** Index du premier pixel plein rencontre. */
  index: number
}

/**
 * Premier pixel plein dans une direction, ou `null` si l'on sort du cadre.
 *
 * Sortir du cadre ne borne pas la fente : un pixel de fond au ras du bord de
 * l'image n'est pas coince entre deux morceaux, il est dehors.
 */
function bordDans(
  u32: Uint32Array, w: number, h: number,
  x: number, y: number, dx: number, dy: number, max: number,
): Bord | null {
  for (let k = 1; k <= max; k++) {
    const xx = x + dx * k, yy = y + dy * k
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) return null
    const j = yy * w + xx
    if (getA(u32[j]) !== 0) return { dist: k, index: j }
  }
  return null
}

interface Fente {
  largeur: number
  a: Bord
  b: Bord
  /** Vrai si la fente est mesuree sur l'axe horizontal. */
  horizontal: boolean
  /** Vrai si les deux bords appartiennent a deux morceaux differents. */
  entreDeuxMorceaux: boolean
}

/**
 * La fente la plus etroite qui traverse ce pixel vide, s'il y en a une.
 *
 * On exige de la matiere des DEUX cotes d'un meme axe : un pixel vide colle
 * au flanc du personnage a de la matiere a gauche et rien a droite, il n'est
 * donc pas dans une fente. C'est ce test qui empeche l'operation de repeindre
 * le fond.
 *
 * Les deux axes sont examines, et pas seulement le plus etroit : dans une
 * dechirure oblique, l'axe le plus court peut relier deux points d'un meme
 * morceau alors que l'autre relie bien les deux morceaux ecartes. Prendre le
 * plus etroit sans regarder qui il relie faisait manquer ces pixels-la.
 */
function fenteEn(
  u32: Uint32Array, w: number, h: number, x: number, y: number,
  max: number, proprietaire?: Int32Array,
): Fente | null {
  const axes: Fente[] = []
  const paires: Array<[number, number, boolean]> = [[-1, 0, true], [0, -1, false]]
  for (const [dx, dy, horizontal] of paires) {
    const a = bordDans(u32, w, h, x, y, dx, dy, max)
    if (!a) continue
    const b = bordDans(u32, w, h, x, y, -dx, -dy, max)
    if (!b) continue
    // a.dist compte le pixel courant, b.dist aussi : la largeur du vide est
    // leur somme moins ce pixel compte deux fois.
    const largeur = a.dist + b.dist - 1
    if (largeur > max) continue
    const entreDeuxMorceaux = proprietaire
      ? proprietaire[a.index] !== proprietaire[b.index]
      : true
    axes.push({ largeur, a, b, horizontal, entreDeuxMorceaux })
  }
  if (!axes.length) return null
  // Une fente qui relie deux morceaux prime sur une plus etroite qui n'en
  // relie qu'un : c'est elle qui est une vraie dechirure.
  axes.sort((p, q) =>
    Number(q.entreDeuxMorceaux) - Number(p.entreDeuxMorceaux) || p.largeur - q.largeur)
  return axes[0]
}

/**
 * Depart au conflit : les deux bords sont a egale distance et de couleurs
 * differentes. On demande au voisinage perpendiculaire laquelle des deux il
 * connait deja ; a defaut, on garde le bord amont, pour que le resultat ne
 * depende pas du sens de parcours.
 */
function arbitrer(
  u32: Uint32Array, w: number, h: number, x: number, y: number,
  horizontal: boolean, ca: number, cb: number,
): number {
  let pa = 0, pb = 0
  const dx = horizontal ? 0 : 1
  const dy = horizontal ? 1 : 0
  for (const s of [-1, 1]) {
    for (let k = 1; k <= 2; k++) {
      const xx = x + dx * s * k, yy = y + dy * s * k
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) break
      const c = u32[yy * w + xx]
      if (getA(c) === 0) continue
      if (c === ca) pa++
      else if (c === cb) pb++
      break
    }
  }
  return pb > pa ? cb : ca
}

/**
 * Referme les fentes d'une image.
 *
 * L'image d'entree n'est pas modifiee : la version comblee est rendue a part,
 * pour qu'un appelant puisse la comparer, la refuser, ou l'appliquer dans une
 * commande annulable.
 *
 * Une seule passe : chaque pixel vide voit deja jusqu'au bord de la fente,
 * donc rien ne reste a propager. Une seconde passe ne ferait que grignoter la
 * silhouette, puisque les pixels poses deviendraient a leur tour des bords.
 */
export function comblerLesFentes(
  src: Bitmap,
  opts: OptionsComblage = COMBLAGE_DEFAUT,
): ResultatComblage {
  const w = src.width, h = src.height
  const out = src.clone()
  const proprietaire = opts.proprietaire ? opts.proprietaire.slice() : null
  const max = Math.max(1, Math.round(opts.largeurMax))
  const avant = src.u32
  let combles = 0, restants = 0, epargnes = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (getA(avant[i]) !== 0) continue
      const fente = fenteEn(avant, w, h, x, y, max, opts.proprietaire)
      if (!fente) continue
      if (!fente.entreDeuxMorceaux) { epargnes++; continue }
      if (opts.autorise && !opts.autorise(x, y)) { epargnes++; continue }

      const ca = avant[fente.a.index]
      const cb = avant[fente.b.index]
      const cote = ca === cb
        ? fente.a
        : fente.a.dist < fente.b.dist ? fente.a
          : fente.b.dist < fente.a.dist ? fente.b
            : arbitrer(avant, w, h, x, y, fente.horizontal, ca, cb) === ca ? fente.a : fente.b
      const couleur = avant[cote.index]
      if (getA(couleur) === 0) { restants++; continue }
      out.u32[i] = couleur
      if (proprietaire) proprietaire[i] = proprietaire[cote.index]
      combles++
    }
  }

  return { image: out, bilan: { combles, restants, epargnes }, proprietaire }
}

/* ------------------------------------------------------------------ */
/* Mesure                                                              */
/* ------------------------------------------------------------------ */

export interface Exactitude {
  /** Pixels que la fente avait emportes. */
  manquants: number
  /** Pixels combles dont la couleur est celle d'origine. */
  justes: number
  /** Pixels combles d'une autre couleur que l'originale. */
  faux: number
  /** Pixels laisses vides. */
  oublies: number
}

/**
 * Compare un comblage a la verite.
 *
 * On decoupe une fente dans un dessin dont on possede l'original, on comble,
 * et on regarde pixel par pixel. C'est la seule facon de savoir si la
 * devinette vaut quelque chose : une fente refermee peut etre parfaitement
 * lisse et parfaitement fausse.
 */
export function exactitude(verite: Bitmap, dechire: Bitmap, comble: Bitmap): Exactitude {
  let manquants = 0, justes = 0, faux = 0, oublies = 0
  for (let i = 0; i < verite.u32.length; i++) {
    const vrai = verite.u32[i]
    if (getA(vrai) === 0) continue
    if (getA(dechire.u32[i]) !== 0) continue
    manquants++
    const c = comble.u32[i]
    if (getA(c) === 0) oublies++
    else if (c === vrai) justes++
    else faux++
  }
  return { manquants, justes, faux, oublies }
}

/** Ouvre une fente verticale, pour eprouver le comblage sur une verite connue. */
export function dechirerVertical(src: Bitmap, x: number, largeur: number): Bitmap {
  const out = src.clone()
  for (let y = 0; y < src.height; y++) {
    for (let k = 0; k < largeur; k++) {
      const xx = x + k
      if (xx >= 0 && xx < src.width) out.u32[y * src.width + xx] = 0
    }
  }
  return out
}

/**
 * Proprietaire deduit d'une dechirure verticale : ce qui est a gauche de la
 * fente est un morceau, ce qui est a droite en est un autre.
 *
 * C'est exactement ce que le rendu d'une scene sait dire de lui-meme, en plus
 * simple : de quoi eprouver le comblage sans monter un squelette entier.
 */
export function proprietairesParColonne(src: Bitmap, x: number): Int32Array {
  const out = new Int32Array(src.u32.length).fill(-1)
  for (let y = 0; y < src.height; y++) {
    for (let px = 0; px < src.width; px++) {
      const i = y * src.width + px
      if (getA(src.u32[i]) === 0) continue
      out[i] = px < x ? 0 : 1
    }
  }
  return out
}

/** Proprietaire d'un dessin d'une seule piece : tout ce qui est plein lui appartient. */
export function proprietaireUnique(src: Bitmap): Int32Array {
  const out = new Int32Array(src.u32.length).fill(-1)
  for (let i = 0; i < src.u32.length; i++) if (getA(src.u32[i]) !== 0) out[i] = 0
  return out
}
