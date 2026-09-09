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
  /**
   * Largeur du profil, en fraction de la largeur de face. Par defaut, elle
   * est deduite du relief : un personnage epais a un profil large.
   */
  profil?: number
  /**
   * Part du relief qui sert a decaler les colonnes. A un, la surface bombe de
   * toute son epaisseur ; en dessous, elle s'aplatit sans que la silhouette
   * change de largeur.
   */
  influence?: number
}

/**
 * Tourne un dessin de face vers un profil, sans jamais montrer son dos.
 *
 * ## Pourquoi la version d'avant etait mauvaise
 *
 * Elle traitait le dessin comme la tranche du milieu d'un volume plein et
 * faisait tourner ce volume. C'est juste en geometrie et faux en dessin : les
 * deux faces du volume portent la MEME image, celle de face. Passe quarante-
 * cinq degres, la face arriere gagne le tampon de profondeur sur une partie de
 * l'image, et le personnage se dedouble — deux demi-silhouettes accolees, avec
 * une couture au milieu. A quatre-vingt-dix degres, la projection ecrase les
 * colonnes les unes sur les autres et il ne reste qu'une trainee.
 *
 * Les mesures d'alors ne voyaient rien : la masse, les trous, les couleurs
 * etrangeres et la symetrie restaient irreprochables pendant que l'image
 * devenait illisible. Ce qui manquait, c'est une mesure de LISIBILITE : la
 * couleur dominante de chaque ligne. Sur le personnage de demonstration, elle
 * tombait a 70% des lignes justes a trente degres, 49% a quarante-cinq, 32% a
 * quatre-vingt-dix. Autrement dit : les deux tiers des lignes ne montraient
 * plus la bonne couleur.
 *
 * ## Ce qu'on fait a la place
 *
 * Un dessin de face ne contient pas son profil. Aucune geometrie ne l'en fera
 * sortir — la seule chose honnete est de le COMPRIMER en gardant son dessin,
 * et de laisser le relief decaler les colonnes pour donner le galbe. C'est le
 * principe du demi-tour d'animation : le personnage reste dessine de face,
 * s'amincit, et ses volumes glissent lateralement.
 *
 * Trois regles :
 *
 * 1. La compression horizontale ne descend jamais a zero. Elle va de 1 (de
 *    face) a `profil` (de profil), ou `profil` vaut l'epaisseur du personnage
 *    rapportee a sa largeur — deduite du relief, donc le curseur « Relief »
 *    epaissit aussi le profil. Sans ce plancher, toutes les colonnes tombent
 *    au meme endroit et l'image se reduit a un trait.
 * 2. Seule la surface avant est peinte, jamais la coque arriere. Chaque pixel
 *    du dessin apparait une fois et une seule : plus de dedoublement.
 * 3. Au-dela du quart de tour, on montre le dessin retourne. Ce n'est pas le
 *    dos — le dos n'existe pas — c'est le meilleur substitut, et l'interface
 *    le dit.
 *
 * La profondeur, elle, reste la vraie : c'est elle qui decide qui masque qui
 * quand un volume passe devant un autre.
 */
/**
 * Largeur du profil d'un dessin, en fraction de sa largeur de face.
 *
 * C'est l'epaisseur du personnage rapportee a sa largeur : un relief plat
 * donne une silhouette de papier, un relief genereux un personnage rond. Le
 * plancher evite le trait — un dessin ne doit jamais se reduire a une ligne,
 * meme vu exactement de profil.
 */
export function profilDe(src: Bitmap, champ: ChampProfondeur, vertical = false): number {
  const boite = src.trimBounds()
  let epaisseur = 0
  for (let i = 0; i < champ.length; i++) if (champ[i] > epaisseur) epaisseur = champ[i]
  const cote = Math.max(1, vertical ? boite.h : boite.w)
  return Math.max(PROFIL_MINI, Math.min(0.85, epaisseur / cote))
}

/**
 * Largeur minimale d'un profil, en fraction de la largeur de face.
 *
 * Un plancher a 0,25 crushait les silhouettes fines : une mascotte de dix-huit
 * pixels de large tombait a six, ses bras disparaissaient et le relief, qui
 * s'etale sur autant de pixels que la silhouette comprimee en occupe, la
 * dechirait. Mesure sur dix sujets — quatre mascottes, un bloc isometrique,
 * une balle, un dessin agrandi quatre fois, un dessin aux bords adoucis, une
 * planche de quatre sprites, un sprite de seize pixels : 0,6 gagne ou egale
 * partout.
 *
 * C'est aussi ce que dit l'anatomie : un humain est a peu pres deux fois
 * moins epais que large aux epaules.
 */
export const PROFIL_MINI = 0.6

/**
 * Part du relief qui sert a decaler les colonnes.
 *
 * A un, la surface bombe de toute son epaisseur — et comme le relief varie
 * aussi vite que la position (c'est une distance au bord, sa pente vaut un),
 * la projection se replie sur elle-meme des que la compression descend sous
 * cette pente. C'est ce repli qui emiettait les silhouettes au quart de tour.
 *
 * A 0,4, le bombement se voit encore et la projection reste presque monotone.
 * Meme mesure, memes dix sujets.
 */
export const INFLUENCE_RELIEF = 0.4

/**
 * Compression a appliquer pour un angle donne, signe compris.
 *
 * Sa valeur absolue va de 1 (de face) a la largeur du profil, et n'atteint
 * jamais zero : c'est ce plancher qui empeche le dessin de se reduire a un
 * trait quand on le regarde par la tranche.
 *
 * Le SIGNE, lui, est celui du cosinus, et il porte tout le demi-tour. Passe
 * le quart de tour il devient negatif, l'image se retourne d'elle-meme, et
 * l'on voit le dessin de face par derriere — ce qui est exactement le
 * substitut qu'on veut faute d'un vrai dessin de dos. Le prendre en valeur
 * absolue obligeait a retourner la bitmap a la main, ce qui marchait pour un
 * dessin seul et se cassait des qu'une scene avait plusieurs pieces : le
 * miroir se faisait autour du cadre et non autour du personnage, et l'ordre
 * de profondeur ne s'inversait pas au demi-tour.
 */
export const compression = (profil: number, angle: number): number => {
  const c = Math.cos(angle)
  return Math.sign(c || 1) * (profil + (1 - profil) * Math.abs(c))
}

/**
 * Combien le relief decale une colonne, pour un angle donne.
 *
 * C'est `sin` — mais portant le meme signe que la compression. Passe le quart
 * de tour, on regarde l'autre face du volume : le relief doit bomber de
 * l'autre cote, sinon il tire l'image dans le sens contraire de la
 * compression et la silhouette se replie sur elle-meme. Mesure : a cent
 * degres, la mascotte se dechirait en morceaux avec deux trous dans le corps.
 *
 * Les deux termes changent donc de signe ensemble, exactement au profil : ce
 * qu'on voit a quatre-vingt-onze degres est le miroir exact de ce qu'on voit
 * a quatre-vingt-neuf, ce qui est precisement le sens de « passer de l'autre
 * cote ».
 *
 * Amortir ce decalage pres du profil — le multiplier par |cos| — a ete essaye
 * pour adoucir la couture entre deux dessins sources : la couture passe de
 * 122% a 106%, et tout le reste se degrade. La profondeur d'un os ne le place
 * plus devant le corps au quart de tour, deux directions sur huit deviennent
 * identiques, et la lisibilite tombe. Rendu.
 */
export const deplacementRelief = (angle: number): number =>
  Math.sign(Math.cos(angle) || 1) * Math.sin(angle)

export function tourner(
  src: Bitmap,
  z: ChampProfondeur,
  angles: Angles,
  opts: OptionsRotation = {},
): Bitmap {
  const { width: w, height: h } = src

  const boite = src.trimBounds()
  // Centre en indices de pixels, et non en coordonnees continues : une boite
  // qui va de la colonne 2 a la colonne 29 a pour milieu l'indice 15,5 et non
  // 16. Le demi-pixel d'ecart rendait le quart de tour a droite different de
  // celui a gauche — six pour cent d'ecart sur un disque pourtant parfaitement
  // symetrique.
  const cx = opts.cx ?? (boite.w > 0 ? boite.x + (boite.w - 1) / 2 : (w - 1) / 2)
  const cy = opts.cy ?? (boite.h > 0 ? boite.y + (boite.h - 1) / 2 : (h - 1) / 2)

  // Au-dela d'un quart de tour, c'est le signe de la compression qui retourne
  // le dessin : on voit la face par derriere. Un substitut du dos, faute de
  // dessin — et l'interface le dit.
  const lacet = normaliser(angles.lacet)
  const tangage = normaliser(angles.tangage)
  const source = src
  const champ = z

  const profilX = opts.profil ?? profilDe(src, champ)
  const profilY = opts.profil ?? profilDe(src, champ, true)

  const lam = opts.influence ?? INFLUENCE_RELIEF
  const cosL = Math.cos(lacet), sinL = deplacementRelief(lacet) * lam
  const cosT = Math.cos(tangage), sinT = deplacementRelief(tangage) * lam
  const compX = compression(profilX, lacet)
  const compY = compression(profilY, tangage)

  const out = new Bitmap(w, h)
  const zbuf = opts.sortieZ ?? new Float32Array(w * h)
  zbuf.fill(-Infinity)

  // Position a l'ecran d'un point du relief, et sa profondeur reelle.
  const projX = (x: number, d: number): number => (x - cx) * compX + d * sinL + cx
  const projY = (y: number, d: number): number => (y - cy) * compY - d * sinT + cy

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const couleur = source.u32[i]
      if (getA(couleur) === 0) continue
      const d = champ[i]

      // Chaque pixel couvre l'intervalle qui va du milieu de son voisin de
      // gauche au milieu de son voisin de droite. Sans cet etalement, une
      // compression de moitie laisserait une colonne sur deux vide et un
      // relief pentu ouvrirait des fentes la ou la surface bascule.
      //
      // Les bornes sont prises a mi-chemin, et non sur le voisin lui-meme :
      // un intervalle [x, x+1[ appartient au pixel de gauche, ce qui decale
      // tout d'une colonne quand la projection descend au lieu de monter. Le
      // banc l'avait vu — quarante pour cent d'ecart entre un quart de tour a
      // droite et le meme a gauche, sur une lame pourtant symetrique.
      const dGauche = x > 0 ? champ[i - 1] : d
      const dDroite = x + 1 < w ? champ[i + 1] : d
      const dHaut = y > 0 ? champ[i - w] : d
      const dBas = y + 1 < h ? champ[i + w] : d
      const x0 = projX(x - 0.5, (d + dGauche) / 2)
      const x1 = projX(x + 0.5, (d + dDroite) / 2)
      const y0 = projY(y - 0.5, (d + dHaut) / 2)
      const y1 = projY(y + 0.5, (d + dBas) / 2)

      const [xa, xb] = couverture(x0, x1)
      const [ya, yb] = couverture(y0, y1)

      // La profondeur est celle du vrai point tourne : elle seule dit
      // correctement qui passe devant qui.
      const zApres = (d * cosL - (x - cx) * sinL) * cosT + (y - cy) * sinT

      for (let ty = ya; ty <= yb; ty++) {
        if (ty < 0 || ty >= h) continue
        for (let tx = xa; tx <= xb; tx++) {
          if (tx < 0 || tx >= w) continue
          const j = ty * w + tx
          if (zApres <= zbuf[j]) continue
          zbuf[j] = zApres
          out.u32[j] = couleur
        }
      }
    }
  }

  if (angles.roulis) return rouler(out, angles.roulis, cx, cy, zbuf)
  boucherLesPoches(out, zbuf)
  return out
}

/**
 * Colonnes (ou lignes) couvertes par un intervalle continu.
 *
 * Un pixel d'indice t est couvert si son centre tombe dans [min, max[. La
 * regle doit etre exactement symetrique : sinon le quart de tour a droite et
 * celui a gauche different d'une colonne, et le banc mesure jusqu'a quarante
 * pour cent d'ecart sur une forme pourtant symetrique. `Math.round` ne
 * convient pas — il arrondit toujours les demis vers le haut, ce qui n'a pas
 * de miroir. Deux `ceil` en ont un.
 *
 * Quand l'intervalle est plus etroit qu'un pixel et ne contient aucun centre,
 * on prend le pixel le plus proche de son milieu : le dessin reste dense, et
 * ce sont les collisions, arbitrees par la profondeur, qui decident du
 * resultat.
 */
export function couverture(a: number, b: number): [number, number] {
  const min = Math.min(a, b), max = Math.max(a, b)
  const debut = Math.ceil(min)
  const fin = Math.ceil(max) - 1
  if (fin >= debut) return [debut, fin]
  const seul = arrondiPair((min + max) / 2)
  return [seul, seul]
}

/**
 * Arrondi au plus proche, les demis vers le pair.
 *
 * C'est le seul arrondi qui commute avec le miroir : `f(n - u) = n - f(u)`
 * pour tout entier n. Avec l'arrondi ordinaire, un centre a 15,5 suffit a
 * decaler d'un pixel toute une moitie de l'image.
 */
function arrondiPair(v: number): number {
  const bas = Math.floor(v)
  const reste = v - bas
  if (reste > 0.5) return bas + 1
  if (reste < 0.5) return bas
  return bas % 2 === 0 ? bas : bas + 1
}

/** Ramene un angle dans ]-pi, pi]. */
function normaliser(a: number): number {
  let r = a % (Math.PI * 2)
  if (r > Math.PI) r -= Math.PI * 2
  if (r <= -Math.PI) r += Math.PI * 2
  return r
}

/**
 * Roulis : une vraie rotation dans le plan du dessin, faite a l'envers.
 *
 * On parcourt les pixels d'arrivee et on va chercher d'ou ils viennent, ce qui
 * ne laisse aucun trou — contrairement au parcours direct, qui en laisse des
 * qu'un pixel s'etale sur plus d'un pixel.
 */
function rouler(
  src: Bitmap, angle: number, cx: number, cy: number, zbuf: Float32Array,
): Bitmap {
  const { width: w, height: h } = src
  const out = new Bitmap(w, h)
  const co = Math.cos(-angle), si = Math.sin(-angle)
  const zOut = new Float32Array(w * h).fill(-Infinity)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const sx = Math.round(dx * co - dy * si + cx)
      const sy = Math.round(dx * si + dy * co + cy)
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
      const j = sy * w + sx
      if (getA(src.u32[j]) === 0) continue
      out.u32[y * w + x] = src.u32[j]
      zOut[y * w + x] = zbuf[j]
    }
  }
  boucherLesPoches(out, zOut)
  return out
}

/**
 * Comble les petites poches fermees ouvertes par la projection.
 *
 * Une poche est un groupe de pixels vides que le fond n'atteint pas : on part
 * du bord de l'image et on inonde ; ce qui reste vide sans avoir ete atteint
 * est enferme. C'est mot pour mot la definition qu'emploie la mesure des
 * trous — boucher et mesurer doivent parler de la meme chose, sinon le banc
 * signale des percees que le bouchage n'avait aucun moyen de voir.
 *
 * Seules les PETITES poches sont comblees. Le trou d'un anneau est enferme
 * lui aussi, et il appartient au dessin : le seuil separe l'accident de
 * projection — deux ou trois pixels au milieu d'un aplat, la ou le relief a
 * replie la surface sur elle-meme — du vide voulu.
 *
 * Le critere d'avant, « les quatre voisins orthogonaux sont pleins », ne
 * voyait que les poches d'un seul pixel. Le banc comptait deux poches de deux
 * pixels que le bouchage laissait passer, a des angles ou la projection se
 * replie.
 */
export function boucherLesPoches(
  img: Bitmap, zbuf: Float32Array, tailleMax = 4, prop?: Int32Array,
): void {
  const { width: w, height: h } = img
  const dehors = new Uint8Array(w * h)
  const pile: number[] = []
  const pousser = (i: number): void => {
    if (dehors[i] || getA(img.u32[i]) !== 0) return
    dehors[i] = 1
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

  const vus = new Uint8Array(w * h)
  for (let depart = 0; depart < w * h; depart++) {
    if (dehors[depart] || vus[depart] || getA(img.u32[depart]) !== 0) continue
    // Une poche : on la releve entierement avant de decider de son sort.
    const poche: number[] = []
    const aVoir = [depart]
    vus[depart] = 1
    while (aVoir.length) {
      const i = aVoir.pop()!
      poche.push(i)
      const x = i % w, y = (i / w) | 0
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (vus[j] || getA(img.u32[j]) !== 0) continue
        vus[j] = 1
        aVoir.push(j)
      }
    }
    if (poche.length > tailleMax) continue

    // Chaque pixel prend la couleur de son voisin plein le plus proche de
    // l'oeil : c'est celui qui aurait du le recouvrir.
    for (const i of poche) {
      const x = i % w, y = (i / w) | 0
      let meilleur = -Infinity, couleur = 0, qui = -1
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (getA(img.u32[j]) === 0) continue
        if (zbuf[j] <= meilleur) continue
        meilleur = zbuf[j]
        couleur = img.u32[j]
        qui = prop ? prop[j] : -1
      }
      if (!couleur) continue
      img.u32[i] = couleur
      zbuf[i] = meilleur
      if (prop) prop[i] = qui
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
