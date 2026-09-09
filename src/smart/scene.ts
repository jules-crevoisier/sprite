import { Bitmap } from '../core/bitmap'
import { getA } from '../core/color'
import type { Angles, ChampProfondeur } from './depth'

/**
 * Scene volumetrique et cameras : un personnage dessine une fois, rendu sous
 * n'importe quelle vue.
 *
 * Ce module repond a la question qui coute le plus cher dans un jeu 2D :
 * fournir un personnage sous huit directions, ou en isometrique, sans le
 * redessiner huit fois. Il part d'un constat que la plupart des outils
 * escamotent.
 *
 * ## Un dessin de face ne contient pas la vue de dessus
 *
 * Faire tourner un relief devine a partir d'une silhouette de face donne un
 * trois-quarts credible jusque vers soixante degres. Au-dela, on demande au
 * calcul d'inventer ce que le dessin ne dit pas : le dos, le sommet du crane,
 * la plante des pieds. Aucune interpolation ne le sait, et pretendre le
 * contraire produit exactement la bouillie qu'on reproche a ces outils.
 *
 * Une piece porte donc *plusieurs dessins sources*, chacun etiquete par la
 * direction depuis laquelle il a ete dessine. Le rendu choisit celui dont la
 * direction est la plus proche de la camera, et ne fait tourner que l'ecart
 * qui reste. Avec un seul dessin, on retombe sur la rotation par relief. Avec
 * trois — face, profil, dessus — aucune direction du compas n'est jamais a
 * plus de quarante-cinq degres d'un vrai dessin, et le banc le mesure.
 *
 * C'est le compromis honnete : l'artiste dessine trois vues au lieu de
 * soixante-quatre images, et la machine fabrique le reste.
 *
 * ## Un seul tampon de profondeur pour toute la scene
 *
 * Les pieces ne sont pas composees l'une apres l'autre : elles sont projetees
 * dans le meme tampon. C'est la seule facon d'obtenir une occultation juste —
 * une main qui passe devant le torse le cache, et devient cachee par lui au
 * demi-tour, sans qu'aucun ordre de calque n'ait a etre gere a la main.
 */

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

export interface Camera {
  /** Tour autour de l'axe vertical du personnage, en radians. */
  azimut: number
  /** Inclinaison vers le bas : 0 = de face, PI/2 = a la verticale. */
  elevation: number
  /** Grossissement. 1 = un pixel du dessin pour un pixel a l'ecran. */
  zoom: number
}

export const CAMERA_FACE: Camera = { azimut: 0, elevation: 0, zoom: 1 }

/**
 * Elevation de la vue isometrique du pixel art.
 *
 * Le « 2:1 » designe la pente a l'ecran : un pas vers l'est descend d'un pixel
 * pour deux vers la droite. Cette pente vaut sin(elevation) une fois l'azimut
 * a 45 degres — la demonstration tient en une ligne et le banc la verifie —
 * donc l'elevation vaut arcsin(1/2), soit trente degres pile.
 *
 * On la confond souvent avec l'angle des aretes a l'ecran, atan(1/2) = 26,57
 * degres, qui est une autre grandeur. Et l'isometrie *vraie*, celle ou les
 * trois axes sont egalement raccourcis, demande arcsin(1/racine(3)) = 35,26
 * degres : ses aretes tombent a 30 degres, hors de la grille, et c'est
 * precisement pour cela que le pixel art ne l'emploie pas.
 */
export const ELEVATION_ISO_2_1 = Math.asin(0.5)
export const ELEVATION_ISO_VRAIE = Math.asin(1 / Math.sqrt(3))

const DEG = Math.PI / 180

/** Vues nommees, celles qu'un jeu demande vraiment. */
export const VUES: { id: string; nom: string; camera: Camera }[] = [
  { id: 'face', nom: 'Face', camera: { azimut: 0, elevation: 0, zoom: 1 } },
  { id: 'trois-quarts', nom: 'Trois-quarts', camera: { azimut: 40 * DEG, elevation: 8 * DEG, zoom: 1 } },
  { id: 'profil', nom: 'Profil', camera: { azimut: 90 * DEG, elevation: 0, zoom: 1 } },
  { id: 'dos', nom: 'Dos', camera: { azimut: 180 * DEG, elevation: 0, zoom: 1 } },
  { id: 'dessus', nom: 'Vue de dessus', camera: { azimut: 0, elevation: 90 * DEG, zoom: 1 } },
  { id: 'iso', nom: 'Isometrique 2:1', camera: { azimut: 45 * DEG, elevation: ELEVATION_ISO_2_1, zoom: 1 } },
  { id: 'iso-vraie', nom: 'Isometrique vraie', camera: { azimut: 45 * DEG, elevation: ELEVATION_ISO_VRAIE, zoom: 1 } },
  { id: 'plongee', nom: 'Plongee de jeu', camera: { azimut: 0, elevation: 55 * DEG, zoom: 1 } },
]

export const vueParId = (id: string): Camera =>
  VUES.find((v) => v.id === id)?.camera ?? CAMERA_FACE

/* ------------------------------------------------------------------ */
/* Matrices                                                            */
/* ------------------------------------------------------------------ */

type Mat3 = [number, number, number, number, number, number, number, number, number]

function multiplier(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9) as Mat3
  for (let l = 0; l < 3; l++) {
    for (let c = 0; c < 3; c++) {
      r[l * 3 + c] = a[l * 3] * b[c] + a[l * 3 + 1] * b[3 + c] + a[l * 3 + 2] * b[6 + c]
    }
  }
  return r
}

/** Rotation autour de l'axe vertical du dessin (y), dite lacet. */
function rotY(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}

/** Rotation autour de l'axe horizontal (x), dite tangage. */
function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}

/** Rotation dans le plan de l'ecran (z), dite roulis. */
function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

const matriceAngles = (a: Angles): Mat3 =>
  multiplier(rotZ(a.roulis), multiplier(rotX(a.tangage), rotY(a.lacet)))

/**
 * Matrice de la camera.
 *
 * L'azimut agit avant l'elevation : on tourne autour du personnage, puis on
 * le regarde de plus haut. L'ordre inverse ferait basculer l'axe de rotation
 * avec la camera, et un tour du compas partirait en vrille au lieu de rester
 * horizontal.
 */
const matriceCamera = (c: Camera): Mat3 => multiplier(rotX(c.elevation), rotY(c.azimut))

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** Un dessin de reference, et la direction depuis laquelle il a ete fait. */
export interface VueSource {
  /** Direction du regard qui a produit ce dessin. Face = azimut 0. */
  azimut: number
  elevation: number
  bitmap: Bitmap
  /** Demi-epaisseur par pixel ; voir `depth.ts`. */
  champ: ChampProfondeur
}

/**
 * Un morceau du personnage : une tete, un torse, une arme.
 *
 * Le pivot est exprime dans les coordonnees de la bitmap, la position dans
 * celles du monde : une piece se pose donc « par son epaule » sans que
 * l'appelant ait a compenser la taille de son dessin.
 */
export interface Piece {
  nom: string
  sources: VueSource[]
  /** Point de la bitmap autour duquel la piece tourne. */
  pivot: { x: number; y: number; z: number }
  /** Ou ce pivot se trouve dans le monde. */
  position: { x: number; y: number; z: number }
  /** Rotation propre de la piece, appliquee autour de son pivot. */
  rotation: Angles
}

/**
 * Choisit le dessin le plus proche de la camera, et l'ecart qui reste.
 *
 * La distance est l'angle reel entre les deux directions de regard, pas la
 * somme des ecarts d'azimut et d'elevation : pres du zenith, tous les azimuts
 * designent presque le meme point de vue, et une somme naive y choisirait
 * n'importe quoi.
 */
export function choisirSource(
  sources: VueSource[],
  azimut: number,
  elevation: number,
): { source: VueSource; ecart: number } | null {
  if (!sources.length) return null
  const versVecteur = (az: number, el: number): [number, number, number] => [
    Math.cos(el) * Math.sin(az),
    -Math.sin(el),
    Math.cos(el) * Math.cos(az),
  ]
  const cible = versVecteur(azimut, elevation)
  let meilleure = sources[0]
  let meilleurCos = -2
  for (const s of sources) {
    const v = versVecteur(s.azimut, s.elevation)
    const cos = v[0] * cible[0] + v[1] * cible[1] + v[2] * cible[2]
    if (cos > meilleurCos) { meilleurCos = cos; meilleure = s }
  }
  return { source: meilleure, ecart: Math.acos(Math.max(-1, Math.min(1, meilleurCos))) }
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

export interface RenduScene {
  image: Bitmap
  /** Profondeur retenue par pixel ; -Infinity la ou rien n'a ete pose. */
  profondeur: Float32Array
  /**
   * Plus grand ecart, en radians, entre la camera et le dessin source
   * effectivement employe. C'est la mesure de confiance du resultat : a zero
   * on montre un vrai dessin, a un demi-tour on montre une invention.
   */
  ecartMax: number
}

export interface OptionsRendu {
  largeur: number
  hauteur: number
  /** Centre de la projection a l'ecran. Par defaut, le centre de l'image. */
  centre?: { x: number; y: number }
}

/**
 * Projette toutes les pieces dans un meme tampon.
 *
 * Chaque pixel opaque d'un dessin source represente une colonne de matiere
 * d'epaisseur `2 * champ`, parcourue tranche par tranche d'un pixel. Deux
 * tranches voisines ne peuvent pas s'ecarter de plus d'un pixel a l'ecran —
 * aucune rotation n'agrandit — donc la projection ne laisse pas de vide, et
 * chaque tranche ne pose qu'un pixel, donc elle n'en invente pas.
 */
export function rendreScene(
  pieces: Piece[],
  camera: Camera,
  opts: OptionsRendu,
): RenduScene {
  const { largeur: w, hauteur: h } = opts
  const image = new Bitmap(w, h)
  const profondeur = new Float32Array(w * h).fill(-Infinity)
  const cam = matriceCamera(camera)
  const cx = opts.centre?.x ?? w / 2
  const cy = opts.centre?.y ?? h / 2
  let ecartMax = 0

  for (const piece of pieces) {
    const choix = choisirSource(piece.sources, camera.azimut, camera.elevation)
    if (!choix) continue
    ecartMax = Math.max(ecartMax, choix.ecart)

    // Le dessin choisi a ete fait depuis sa propre direction : pour l'amener
    // sous la camera, il faut defaire cette direction puis appliquer celle
    // qu'on veut. C'est ce produit qui evite de faire tourner de cent quatre
    // vingts degres un dessin de dos deja correct.
    const versSource = multiplier(rotX(choix.source.elevation), rotY(choix.source.azimut))
    const residuel = multiplier(cam, transposee(versSource))
    const m = multiplier(residuel, matriceAngles(piece.rotation))

    const { bitmap, champ } = choix.source
    const bw = bitmap.width, bh = bitmap.height
    const z = camera.zoom

    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const i = py * bw + px
        const couleur = bitmap.u32[i]
        if (getA(couleur) === 0) continue

        const lx = px - piece.pivot.x
        const ly = py - piece.pivot.y
        const demi = champ[i]
        const tranches = Math.max(1, Math.ceil(demi * 2) + 1)

        for (let t = 0; t < tranches; t++) {
          const lz = (tranches === 1 ? 0 : -demi + (t * demi * 2) / (tranches - 1)) - piece.pivot.z
          const rx = m[0] * lx + m[1] * ly + m[2] * lz
          const ry = m[3] * lx + m[4] * ly + m[5] * lz
          const rz = m[6] * lx + m[7] * ly + m[8] * lz

          // La position de la piece est deja exprimee dans le monde : elle
          // subit la camera, jamais la rotation propre de la piece.
          const px3 = piece.position.x, py3 = piece.position.y, pz3 = piece.position.z
          const wx = cam[0] * px3 + cam[1] * py3 + cam[2] * pz3
          const wy = cam[3] * px3 + cam[4] * py3 + cam[5] * pz3
          const wz = cam[6] * px3 + cam[7] * py3 + cam[8] * pz3

          const sx = Math.round((rx + wx) * z + cx)
          const sy = Math.round((ry + wy) * z + cy)
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
          const j = sy * w + sx
          const prof = rz + wz
          if (prof <= profondeur[j]) continue
          profondeur[j] = prof
          image.u32[j] = couleur
        }
      }
    }
  }

  boucherLesTrous(image, profondeur)
  return { image, profondeur, ecartMax }
}

function transposee(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

/**
 * Comble les pixels vides dont les quatre voisins orthogonaux sont pleins.
 *
 * Le critere est le meme que celui de la mesure des trous : boucher et
 * mesurer doivent parler de la meme chose, sinon le banc signale des percees
 * que le bouchage n'avait aucun moyen de voir. Un creux ouvert sur
 * l'exterieur — l'espace entre deux jambes — n'a jamais ses quatre voisins
 * pleins et reste donc ouvert.
 */
function boucherLesTrous(img: Bitmap, prof: Float32Array): void {
  const w = img.width, h = img.height
  const copie = img.u32.slice()
  const ORTHO = [-1, 1, -w, w]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (getA(copie[i]) !== 0) continue
      let enferme = true
      let meilleur = -Infinity
      let couleur = 0
      for (const v of ORTHO) {
        const j = i + v
        if (getA(copie[j]) === 0) { enferme = false; break }
        if (prof[j] > meilleur) { meilleur = prof[j]; couleur = copie[j] }
      }
      if (enferme) { img.u32[i] = couleur; prof[i] = meilleur }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Planche de directions                                               */
/* ------------------------------------------------------------------ */

export interface Direction {
  /** Azimut en radians, 0 = de face, puis dans le sens horaire. */
  azimut: number
  /** Nom court, du genre de ceux qu'un moteur attend : S, SE, E… */
  nom: string
  rendu: RenduScene
}

/** Les huit points cardinaux d'un jeu vu de dessus, dans l'ordre usuel. */
const NOMS_8 = ['S', 'SE', 'E', 'NE', 'N', 'NO', 'O', 'SO']
const NOMS_4 = ['S', 'E', 'N', 'O']

/**
 * Rend le meme personnage sous N directions autour de lui.
 *
 * C'est la raison d'etre du module : une animation posee une fois donne les
 * huit directions d'un jeu vu de dessus, ou les quatre d'un jeu isometrique,
 * sans qu'aucune image ne soit redessinee. L'elevation, elle, ne change pas
 * d'une direction a l'autre — c'est le point de vue du jeu, pas celui du
 * personnage.
 */
export function planchesDeDirections(
  pieces: Piece[],
  nombre: number,
  elevation: number,
  opts: OptionsRendu,
): Direction[] {
  const noms = nombre === 8 ? NOMS_8 : nombre === 4 ? NOMS_4 : null
  const out: Direction[] = []
  for (let i = 0; i < nombre; i++) {
    const azimut = (i / nombre) * Math.PI * 2
    out.push({
      azimut,
      nom: noms?.[i] ?? `d${i}`,
      rendu: rendreScene(pieces, { azimut, elevation, zoom: 1 }, opts),
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Mesures                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pente a l'ecran d'un deplacement d'une unite vers l'est, sous cette camera.
 *
 * C'est la grandeur qui definit une projection isometrique de pixel art :
 * elle doit valoir exactement 1/2, sans quoi les tuiles ne se raccordent pas
 * et l'oeil voit les marches. Une constante d'elevation mal recopiee se
 * detecte ici, pas a l'usage six mois plus tard.
 */
export function penteIsometrique(camera: Camera): number {
  const m = matriceCamera(camera)
  // Vecteur unite vers l'est du monde, projete.
  const dx = m[0], dy = m[3]
  return dx === 0 ? Infinity : Math.abs(dy / dx)
}

/** Nombre de pixels opaques. */
export const masse = (b: Bitmap): number => {
  let n = 0
  for (let i = 0; i < b.u32.length; i++) if (getA(b.u32[i]) !== 0) n++
  return n
}
