import { Bitmap } from '../core/bitmap'
import { getA } from '../core/color'

/**
 * Profondeur par pixel, et rotation d'un dessin autour des trois axes.
 *
 * Le squelette sait deja tourner le personnage, mais avec une seule
 * profondeur par os : le corps s'écrase, les membres passent d'un cote a
 * l'autre, et c'est tout. Un dessin plat qui pivote reste un dessin plat qui
 * pivote — le nez ne sort pas du visage, l'epaule ne passe pas devant le
 * torse, et un trois-quarts demande d'etre redessine a la main.
 *
 * On donne donc une profondeur a *chaque pixel*. Le dessin cesse d'etre une
 * image et devient un volume : le dessin est la tranche du milieu, et le
 * relief dit de combien la matiere deborde de part et d'autre. Tourner
 * revient alors a faire tourner un nuage de points et a le reprojeter, ce qui
 * produit les occultations justes sans qu'aucun modèle 3D n'existe.
 *
 * Le volume est plein, et symetrique autour du plan du dessin. Une coque —
 * la seule surface avant — parait d'abord suffire, puisque c'est tout ce
 * qu'on voit de face : elle donne un resultat juste jusque vers trente
 * degres, puis se montre de profil et le personnage devient un croissant. Le
 * banc l'a mesure avant qu'on ne s'en apercoive a l'oeil : 50% de la masse
 * perdue a 75 degres sur un disque, la ou un corps plein n'en perd aucune.
 *
 * Deux choses distinguent ce module d'une simple projection :
 *
 * - La profondeur est *devinee* a partir de la silhouette. Un pixel loin du
 *   bord est au sommet du relief, un pixel au bord est a plat. C'est faux au
 *   sens strict — un dessin ne dit rien de son dos — mais c'est ce que l'oeil
 *   attend d'une forme dessinee, et cela se retouche au pinceau.
 * - Rien ne s'evapore et rien n'enfle. La matiere est parcourue tranche par
 *   tranche, d'un pixel de profondeur chacune : deux tranches voisines ne
 *   peuvent pas s'écarter de plus d'un pixel a l'ecran, donc la projection
 *   ne laisse pas de vide, et chaque tranche ne pose qu'un pixel, donc elle
 *   n'en invente pas. Le banc mesure la masse a chaque degre.
 */

/**
 * Demi-epaisseur du volume sous chaque pixel, en unites de pixel.
 *
 * La matiere occupe [-z, +z] autour du plan du dessin : 0 = une feuille de
 * papier, 8 = un corps de seize pixels d'epaisseur a cet endroit.
 */
export type ChampProfondeur = Float32Array

export interface ProfilRelief {
  /**
   * Hauteur du relief au centre de la forme, en pixels.
   *
   * Une tete de 16 pixels de large est a peu pres aussi profonde que large :
   * un relief de 8 la rend ronde. Une lame en fait 1.
   */
  hauteur: number
  /**
   * Galbe : 1 = cone (arete vive au centre), 0.5 = dome, 0.25 = plateau a
   * bords tombants. Un corps vivant est plutot un dome.
   */
  galbe: number
}

export const RELIEF_DEFAUT: ProfilRelief = { hauteur: 6, galbe: 0.5 }

/* ------------------------------------------------------------------ */
/* Distance au bord                                                    */
/* ------------------------------------------------------------------ */

/**
 * Distance de chaque pixel opaque au premier pixel transparent, en 8-voisins.
 *
 * Deux passes suffisent — avant puis arriere — parce que la distance de
 * chanfrein ne remonte jamais : chaque pixel ne depend que de ses voisins
 * deja vus dans le sens du balayage. Une distance euclidienne exacte
 * couterait plus cher sans rien changer a l'oeil, le relief etant de toute
 * facon une invention.
 */
export function distanceAuBord(src: Bitmap): Float32Array {
  const { width: w, height: h } = src
  const d = new Float32Array(w * h)
  const GRAND = 1e6
  // Le cout diagonal vaut ~sqrt(2) : sans lui, un disque devient un losange.
  const DROIT = 1, DIAG = 1.414

  for (let i = 0; i < d.length; i++) d[i] = getA(src.u32[i]) === 0 ? 0 : GRAND

  const lire = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (d[i] === 0) continue
      d[i] = Math.min(d[i],
        lire(x - 1, y) + DROIT, lire(x, y - 1) + DROIT,
        lire(x - 1, y - 1) + DIAG, lire(x + 1, y - 1) + DIAG)
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (d[i] === 0) continue
      d[i] = Math.min(d[i],
        lire(x + 1, y) + DROIT, lire(x, y + 1) + DROIT,
        lire(x + 1, y + 1) + DIAG, lire(x - 1, y + 1) + DIAG)
    }
  }
  return d
}

/* ------------------------------------------------------------------ */
/* Champ automatique                                                   */
/* ------------------------------------------------------------------ */

/**
 * Devine un relief a partir de la seule silhouette.
 *
 * La distance au bord, normalisee puis passee dans le galbe, donne une coque
 * bombee au milieu et plate sur les contours. C'est le comportement d'un
 * corps dessine : le ventre est devant, le contour est le profil.
 *
 * La normalisation se fait sur le maximum *reel* de la forme et non sur sa
 * taille : un membre fin et un torse epais recoivent alors le meme galbe
 * relatif, et un demi-tour ne les fait pas se traverser.
 */
export function champAuto(src: Bitmap, profil: ProfilRelief = RELIEF_DEFAUT): ChampProfondeur {
  const d = distanceAuBord(src)
  const z = new Float32Array(d.length)
  let max = 0
  for (let i = 0; i < d.length; i++) if (d[i] > max) max = d[i]
  if (max === 0) return z
  const galbe = Math.max(0.05, profil.galbe)
  for (let i = 0; i < d.length; i++) {
    if (d[i] === 0) continue
    // Plancher d'un demi-pixel : sur le contour, la distance au bord vaut 1
    // et le relief y tombe presque a zero. Ces pixels-la formaient une
    // feuille d'epaisseur nulle qui se dechirait en tournant — le banc a
    // trouve quatorze angles ou la silhouette de la mascotte se percait,
    // toujours sur une oreille ou le bout de la queue. Un demi-pixel de
    // matiere suffit a ce qu'une tranche couvre toujours la suivante.
    z[i] = Math.max(0.5, Math.pow(d[i] / max, galbe) * profil.hauteur)
  }
  return z
}

/**
 * Hauteur de relief raisonnable pour une forme donnee.
 *
 * C'est la distance au bord la plus grande de la forme, autrement dit le
 * rayon du plus gros cercle qui y tient : une forme est aussi profonde que
 * son endroit le plus epais est large. Un disque devient une sphere, une
 * lame reste une lame.
 *
 * Le plus petit cote de la boite englobante semblait dire la meme chose, et
 * le dit pour les formes pleines. Il se trompe des qu'une forme est creuse :
 * un anneau de vingt-six pixels de diametre dont la bande n'en fait que six
 * recevait treize pixels de relief. Il gonflait en bouee, sa section
 * bouchait son propre trou en tournant, et la masse sautait de quatre-vingts
 * pixels d'un degre au suivant.
 */
export function hauteurSuggeree(src: Bitmap): number {
  const d = distanceAuBord(src)
  let max = 0
  for (let i = 0; i < d.length; i++) if (d[i] > max) max = d[i]
  return max === 0 ? 0 : Math.max(1, Math.round(max))
}

/* ------------------------------------------------------------------ */
/* Rotation                                                            */
/* ------------------------------------------------------------------ */

export interface Angles {
  /** Rotation autour de l'axe vertical, en radians. Le personnage se tourne. */
  lacet: number
  /** Rotation autour de l'axe horizontal. Le personnage se penche en avant. */
  tangage: number
  /** Rotation dans le plan du dessin. */
  roulis: number
}

export const SANS_ROTATION: Angles = { lacet: 0, tangage: 0, roulis: 0 }

/** Matrice 3x3 d'une rotation lacet puis tangage puis roulis. */
function matrice(a: Angles): number[] {
  const cy = Math.cos(a.lacet), sy = Math.sin(a.lacet)
  const cp = Math.cos(a.tangage), sp = Math.sin(a.tangage)
  const cr = Math.cos(a.roulis), sr = Math.sin(a.roulis)
  // R = Rz(roulis) * Rx(tangage) * Ry(lacet)
  return [
    cr * cy + sr * sp * sy, -sr * cp, cr * sy - sr * sp * cy,
    sr * cy - cr * sp * sy, cr * cp, sr * sy + cr * sp * cy,
    -cp * sy, -sp, cp * cy,
  ]
}

export interface OptionsRotation {
  /** Centre de rotation en x ; par defaut le centre de la boite englobante. */
  cx?: number
  /** Centre de rotation en y. */
  cy?: number
  /**
   * Retour du champ tourne, pour composer plusieurs morceaux dans un meme
   * tampon de profondeur.
   */
  sortieZ?: Float32Array
}

/**
 * Tourne un dessin autour des trois axes en se servant de son relief.
 *
 * Chaque pixel opaque devient un point (x, y, z) tourne puis reprojete a
 * plat, le plus proche de l'oeil gagnant. Deux precautions font toute la
 * difference entre une image trouee et une image propre :
 *
 * 1. Chaque point est pose comme une tuile de la taille de l'etirement local
 *    et non comme un pixel isole. A 60 degres de lacet, la largeur se
 *    contracte : plusieurs sources tombent au meme endroit et la projection
 *    naive laisse des colonnes vides une ligne sur deux. La tuile les couvre.
 * 2. Ce qui resterait vide est bouche par la couleur du voisin le plus proche
 *    de l'oeil, et seulement si le trou est entoure — un creux du dessin
 *    d'origine ne se remplit pas.
 */
export function tourner(
  src: Bitmap,
  z: ChampProfondeur,
  angles: Angles,
  opts: OptionsRotation = {},
): Bitmap {
  const { width: w, height: h } = src
  const out = new Bitmap(w, h)
  const m = matrice(angles)

  const boite = src.trimBounds()
  const cx = opts.cx ?? (boite.w > 0 ? boite.x + boite.w / 2 : w / 2)
  const cy = opts.cy ?? (boite.h > 0 ? boite.y + boite.h / 2 : h / 2)

  // Tampon de profondeur : -Infinity = rien de pose. On garde le plus proche
  // de l'oeil, donc le z le plus grand.
  const zbuf = opts.sortieZ ?? new Float32Array(w * h)
  zbuf.fill(-Infinity)

  // Un pixel pose reste un pixel : pas de tuile d'elargissement.
  //
  // Une premiere version dimensionnait chaque tache selon l'etirement local,
  // pour combler les vides d'une projection clairsemee. Avec un volume plein
  // ces vides n'existent pas — deux tranches voisines ne s'ecartent jamais de
  // plus d'un pixel, puisqu'elles sont distantes d'un pixel en profondeur et
  // qu'aucune rotation n'agrandit. La tuile ne bouchait donc plus rien, et
  // elle mentait : a un degre de lacet, `ceil(1 / cos(1deg))` vaut 2 quand il
  // vaut 1 a zero degre. Chaque pixel doublait de largeur d'un coup, et la
  // masse sautait de 39 pixels entre 0 et 1 degre — un a-coup visible en
  // pleine animation, juste au passage de face.

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const couleur = src.u32[i]
      if (getA(couleur) === 0) continue
      const px = x - cx, py = y - cy
      // La colonne de matiere sous ce pixel, tranche par tranche. Un pas
      // d'un pixel suffit : plus fin ne change rien apres arrondi, plus
      // large laisse passer le fond entre deux tranches.
      const demi = z[i]
      const tranches = Math.max(1, Math.ceil(demi * 2) + 1)
      for (let t = 0; t < tranches; t++) {
        const pz = tranches === 1 ? 0 : -demi + (t * (demi * 2)) / (tranches - 1)
        const rx = m[0] * px + m[1] * py + m[2] * pz
        const ry = m[3] * px + m[4] * py + m[5] * pz
        const rz = m[6] * px + m[7] * py + m[8] * pz

        const tx = Math.round(rx + cx), ty = Math.round(ry + cy)
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue
        const j = ty * w + tx
        if (rz <= zbuf[j]) continue
        zbuf[j] = rz
        out.u32[j] = couleur
      }
    }
  }

  boucherLesTrous(out, zbuf)
  return out
}

/**
 * Comble les pixels vides cernes par du plein.
 *
 * Le critere est celui des quatre voisins orthogonaux : un pixel vide dont
 * le haut, le bas, la gauche et la droite sont pleins est enferme, et le
 * reste quelle que soit sa diagonale.
 *
 * Le seuil a d'abord ete pose a cinq voisins sur huit, et le banc a montre
 * ce que cela coutait : a zero degre, l'encoche entre les deux oreilles de
 * la mascotte a cinq voisins pleins, elle se refermait, et la rotation nulle
 * ne rendait plus le dessin d'origine. Exiger les huit reglait cela mais
 * laissait passer les trous a diagonale ouverte — que la mesure, elle,
 * comptait bien comme des trous, puisqu'elle inonde en quatre-connexite.
 * Boucher et mesurer parlent maintenant de la meme chose.
 *
 * Un vrai creux du dessin — l'espace entre deux jambes, l'oeil d'un anneau —
 * touche l'extérieur par construction et n'a donc jamais ses quatre voisins
 * pleins.
 */
function boucherLesTrous(img: Bitmap, zbuf: Float32Array): void {
  const { width: w, height: h } = img
  const copie = img.u32.slice()
  const ORTHO = [-1, 1, -w, w]

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (getA(copie[i]) !== 0) continue
      let meilleur = -Infinity
      let couleur = 0
      let enferme = true
      for (const v of ORTHO) {
        const j = i + v
        if (getA(copie[j]) === 0) { enferme = false; break }
        if (zbuf[j] > meilleur) { meilleur = zbuf[j]; couleur = copie[j] }
      }
      if (enferme) {
        img.u32[i] = couleur
        zbuf[i] = meilleur
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Mesures                                                             */
/* ------------------------------------------------------------------ */

/** Nombre de pixels opaques. Sert a verifier qu'une rotation ne perd rien. */
export const masse = (b: Bitmap): number => {
  let n = 0
  for (let i = 0; i < b.u32.length; i++) if (getA(b.u32[i]) !== 0) n++
  return n
}

/**
 * Couleurs qui font le contour d'un dessin : celles qui couvrent au moins
 * `part` de ses pixels de bord.
 *
 * En pixel art, la silhouette est presque toujours cernee d'un trait sombre.
 * Savoir lesquelles de ses couleurs jouent ce role permet de les traiter a
 * part au moment de tourner : voir `rendreScene`.
 */
export function couleursDeTrait(img: Bitmap, part = 0.6): Set<number> {
  const { width: w, height: h } = img
  const compte = new Map<number, number>()
  let bord = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (getA(img.u32[i]) === 0) continue
      const vide = (xx: number, yy: number): boolean =>
        xx < 0 || yy < 0 || xx >= w || yy >= h || getA(img.u32[yy * w + xx]) === 0
      if (!(vide(x - 1, y) || vide(x + 1, y) || vide(x, y - 1) || vide(x, y + 1))) continue
      bord++
      compte.set(img.u32[i], (compte.get(img.u32[i]) ?? 0) + 1)
    }
  }
  const cle = new Set<number>()
  if (!bord) return cle
  let cumul = 0
  for (const [c, n] of [...compte].sort((a, b) => b[1] - a[1])) {
    cle.add(c)
    cumul += n
    if (cumul >= bord * part) break
  }
  return cle
}

/**
 * Couleurs presentes dans le resultat mais absentes de la source.
 *
 * Une rotation qui melange les couleurs sort du pixel art : la palette doit
 * traverser la transformation intacte. Ici rien n'est interpole — les
 * couleurs sont recopiees telles quelles — et cette mesure le prouve au lieu
 * de le supposer.
 */
export function couleursEtrangeres(src: Bitmap, out: Bitmap): number[] {
  const connues = new Set<number>()
  for (let i = 0; i < src.u32.length; i++) {
    if (getA(src.u32[i]) !== 0) connues.add(src.u32[i])
  }
  const etrangeres = new Set<number>()
  for (let i = 0; i < out.u32.length; i++) {
    const c = out.u32[i]
    if (getA(c) !== 0 && !connues.has(c)) etrangeres.add(c)
  }
  return [...etrangeres]
}

/**
 * Trous interieurs : pixels vides entierement cernes par du plein.
 *
 * Un remplissage par diffusion depuis le bord marque tout ce que l'exterieur
 * atteint ; ce qui reste vide sans etre marque est un trou. C'est la mesure
 * qui distingue une silhouette percee d'une silhouette qui a simplement des
 * creux ouverts sur l'exterieur.
 */
export function trousInterieurs(img: Bitmap): number {
  const { width: w, height: h } = img
  const vu = new Uint8Array(w * h)
  const pile: number[] = []
  const pousser = (i: number) => {
    if (vu[i] || getA(img.u32[i]) !== 0) return
    vu[i] = 1
    pile.push(i)
  }
  for (let x = 0; x < w; x++) { pousser(x); pousser((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { pousser(y * w); pousser(y * w + w - 1) }
  while (pile.length) {
    const i = pile.pop()!
    const x = i % w, y = (i / w) | 0
    if (x > 0) pousser(i - 1)
    if (x < w - 1) pousser(i + 1)
    if (y > 0) pousser(i - w)
    if (y < h - 1) pousser(i + w)
  }
  let trous = 0
  for (let i = 0; i < vu.length; i++) {
    if (!vu[i] && getA(img.u32[i]) === 0) trous++
  }
  return trous
}
