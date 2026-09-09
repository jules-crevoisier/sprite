import { Bitmap } from '../core/bitmap'
import { type RGBA, getA } from '../core/color'

/* ------------------------------------------------------------------ */
/* Transformations affines                                             */
/* ------------------------------------------------------------------ */

/** Matrice affine [a, b, c, d, e, f] : x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-9) return IDENTITY
  const id = 1 / det
  return [
    m[3] * id, -m[1] * id, -m[2] * id, m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ]
}

export const applyX = (m: Mat, x: number, y: number): number => m[0] * x + m[2] * y + m[4]
export const applyY = (m: Mat, x: number, y: number): number => m[1] * x + m[3] * y + m[5]

/** Rotation d'angle `a` autour de (cx,cy), puis mise a l'echelle et translation. */
function poseMatrix(cx: number, cy: number, angle: number, scale: number, tx: number, ty: number): Mat {
  const cos = Math.cos(angle) * scale
  const sin = Math.sin(angle) * scale
  return [
    cos, sin, -sin, cos,
    cx - cx * cos + cy * sin + tx,
    cy - cx * sin - cy * cos + ty,
  ]
}

/* ------------------------------------------------------------------ */
/* Modele                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fonction d'un os dans le corps. C'est ce qui permet aux animations
 * preenregistrees de s'appliquer a n'importe quel squelette : un cycle de
 * marche fait plier « la jambe gauche », quel que soit son nom.
 */
export type BoneRole =
  | 'torso' | 'head'
  // Membres en deux segments : un bras qui pivote d'un bloc reste une planche,
  // c'est le coude et le genou qui font lire le mouvement.
  | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'legL' | 'legR' | 'shinL' | 'shinR'
  | 'tail' | 'wingL' | 'wingR' | 'none'

export interface Bone {
  id: number
  name: string
  /** Identifiant de l'os parent, ou null pour une racine. */
  parent: number | null
  /** Fonction dans le corps, pour les animations preenregistrees. */
  role: BoneRole
  /**
   * Position devant / derriere le plan du dessin, en pixels. Sert au demi-tour
   * pseudo-3D : un bras place devant passe de l'autre cote quand le
   * personnage pivote. 0 = dans le plan.
   */
  depth: number
  /** Extremites de l'os dans la pose de repos, en pixels sprite. */
  x: number
  y: number
  ex: number
  ey: number
  /** Ordre de dessin : un os de valeur superieure passe devant. */
  z: number
  /**
   * Portee de l'os, en pixels : la moitié de l'epaisseur de la partie qu'il
   * commande. La liaison compare des distances rapportees a cette portee,
   * faute de quoi un os de bras, mince mais proche, rafle le cote d'une tete
   * pourtant commandee par un os central plus eloigne.
   */
  radius: number
  /**
   * Souplesse, de 0 a 1. A zero l'os suit le corps a l'image pres. Au-dessus,
   * il traine derriere, depasse a l'arret, puis se stabilise : c'est ce qu'on
   * veut d'une cape, d'une queue ou d'une meche.
   */
  softness: number
  /* --- pose courante, relative au repos --- */
  angle: number
  tx: number
  ty: number
  scale: number
}

/**
 * Un calque relie au squelette. Un personnage tient rarement sur un seul
 * calque : le corps, l'arme et la cape se suivent, chacun avec sa propre
 * liaison mais commande par les memes os.
 */
export interface RigPart {
  /** Identifiant du calque porte par ce morceau. */
  layer: number
  /** Dessin de reference sur lequel les pixels ont ete lies. */
  rest: Bitmap
  /** Pour chaque pixel du repos, l'index de l'os qui le porte ; 255 = libre. */
  weights: Uint8Array
  /**
   * Numero d'edition, a incrementer des que le repos ou les poids changent.
   *
   * Le repos est modifie sur place — par la ponderation comme par la reprise
   * d'une retouche — donc son identite ne dit rien de son contenu. Sans ce
   * compteur, la version agrandie gardee en cache resservirait un dessin
   * perime et la retouche disparaitrait a la pose suivante.
   */
  version: number
}

/** Signale qu'un morceau a change : les caches qui en dependent l'apprennent. */
export const touchPart = (part: RigPart): void => { part.version++ }

/**
 * Demi-tour pseudo-3D. Le dessin n'a pas de profondeur reelle : on simule la
 * rotation autour d'un axe vertical en ecrasant horizontalement le sprite et
 * en faisant passer les membres d'un cote a l'autre selon leur profondeur.
 */
export interface Turn {
  /** Angle de rotation autour de l'axe vertical, en radians. */
  angle: number
  /** Abscisse de l'axe de rotation, en pixels sprite. */
  axis: number
}

export interface Rig {
  bones: Bone[]
  /** Calques relies, dans l'ordre ou ils ont ete lies. */
  parts: RigPart[]
  /** Demi-tour en cours, ou null. Etat de travail : jamais enregistre. */
  turn: Turn | null
}

export const emptyRig = (): Rig => ({ bones: [], parts: [], turn: null })

/**
 * Ecrasement horizontal minimal. Un corps vu de profil n'est pas un trait :
 * il garde a peu pres la moitie de sa largeur de face. Sans ce plancher, un
 * quart de tour reduirait le personnage a une colonne d'un pixel, ce que le
 * cosinus seul donnerait. Le resultat reste une base a retoucher : le dessin
 * n'a pas de vrai dos.
 */
const TURN_MIN_WIDTH = 0.45

/** Facteur d'ecrasement horizontal pour un angle donne. */
export const turnSquash = (angle: number): number =>
  Math.max(TURN_MIN_WIDTH, Math.abs(Math.cos(angle))) * (Math.cos(angle) < 0 ? -1 : 1)

/**
 * Profondeur d'un os après rotation : c'est elle qui decide qui passe
 * devant. Un bras place devant le corps se retrouve derriere quand le
 * personnage pivote de l'autre cote.
 */
export function turnedDepth(bone: Bone, turn: Turn): number {
  const u = (bone.x + bone.ex) / 2 - turn.axis
  return -u * Math.sin(turn.angle) + bone.depth * Math.cos(turn.angle)
}

/**
 * Matrice du demi-tour pour un os : ecrasement autour de l'axe, plus le
 * decalage horizontal du a sa profondeur. C'est ce decalage qui fait tourner
 * le personnage plutot que simplement l'aplatir.
 */
function turnMatrix(bone: Bone, turn: Turn): Mat {
  const k = turnSquash(turn.angle)
  const dx = bone.depth * Math.sin(turn.angle)
  return [k, 0, 0, 1, turn.axis * (1 - k) + dx, 0]
}

/** Liaison d'un calque donne, ou null s'il n'est pas relie. */
export const partFor = (rig: Rig, layer: number): RigPart | null =>
  rig.parts.find((p) => p.layer === layer) ?? null

/** Vrai des qu'au moins un calque est relie. */
export const isBound = (rig: Rig): boolean => rig.parts.length > 0

/** Oublie toutes les liaisons : les poids designent les os par index. */
export const unbind = (rig: Rig): void => { rig.parts = [] }

/**
 * Couleurs d'identification des os. Elles servent a montrer sur la toile a
 * quel os appartient chaque pixel : c'est la lecture la plus directe de ce
 * que fait la liaison.
 */
export const BONE_COLORS = [
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff',
  '#ff77a8', '#a06cff', '#00d6b4', '#ff6b3d', '#7bd93a',
]

export const boneColor = (index: number): string => BONE_COLORS[index % BONE_COLORS.length]

let nextBoneId = 1
export const newBoneId = (): number => nextBoneId++
export const seedBoneIds = (from: number): void => { nextBoneId = Math.max(nextBoneId, from + 1) }

export function createBone(
  rig: Rig,
  x: number, y: number, ex: number, ey: number,
  parent: number | null = null,
  name?: string,
): Bone {
  const bone: Bone = {
    id: newBoneId(),
    name: name ?? `os ${rig.bones.length + 1}`,
    parent,
    role: 'none',
    depth: 0,
    x, y, ex, ey,
    z: rig.bones.length,
    // A defaut d'indication, une portée proportionnee a la longueur de l'os.
    radius: Math.max(2, Math.hypot(ex - x, ey - y) * 0.35),
    softness: 0,
    angle: 0, tx: 0, ty: 0, scale: 1,
  }
  rig.bones.push(bone)
  return bone
}

export const boneLength = (b: Bone): number => Math.hypot(b.ex - b.x, b.ey - b.y)
export const boneAngle = (b: Bone): number => Math.atan2(b.ey - b.y, b.ex - b.x)

/** Enfants directs d'un os. */
export function childrenOf(rig: Rig, id: number): Bone[] {
  return rig.bones.filter((b) => b.parent === id)
}

/** Empeche un cycle parent/enfant lors d'un rattachement. */
export function canParent(rig: Rig, childId: number, parentId: number | null): boolean {
  if (parentId === null) return true
  if (childId === parentId) return false
  let cursor: number | null = parentId
  const seen = new Set<number>()
  while (cursor !== null) {
    if (cursor === childId) return false
    if (seen.has(cursor)) return false
    seen.add(cursor)
    cursor = rig.bones.find((b) => b.id === cursor)?.parent ?? null
  }
  return true
}

/**
 * Transformations monde de chaque os, indexees par identifiant.
 * La pose d'un os s'applique autour de son point d'attache dans le repos,
 * puis la transformation du parent l'emmene : une rotation d'epaule entraine
 * donc tout le bras.
 */
export function worldTransforms(rig: Rig): Map<number, Mat> {
  const byId = new Map(rig.bones.map((b) => [b.id, b]))
  const chaine = new Map<number, Mat>()

  const resolve = (bone: Bone, depth = 0): Mat => {
    const hit = chaine.get(bone.id)
    if (hit) return hit
    const local = poseMatrix(bone.x, bone.y, bone.angle, bone.scale, bone.tx, bone.ty)
    const parent = bone.parent !== null ? byId.get(bone.parent) : undefined
    // La profondeur est bornee : une hierarchie corrompue ne doit pas boucler.
    const world = parent && depth < 32 ? mul(resolve(parent, depth + 1), local) : local
    chaine.set(bone.id, world)
    return world
  }

  for (const bone of rig.bones) resolve(bone)
  if (!rig.turn || Math.abs(rig.turn.angle) < 1e-4) return chaine

  // Le demi-tour s'applique une fois la hierarchie resolue : chaque os y
  // ajoute sa propre profondeur, ce qu'un enchainement de parents ne saurait
  // pas faire sans dupliquer l'ecrasement a chaque etage.
  const out = new Map<number, Mat>()
  for (const bone of rig.bones) {
    out.set(bone.id, mul(turnMatrix(bone, rig.turn), chaine.get(bone.id) ?? IDENTITY))
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Liaison des pixels                                                  */
/* ------------------------------------------------------------------ */

/** Distance d'un point au segment d'un os. */
function distanceToBone(bone: Bone, px: number, py: number): number {
  const dx = bone.ex - bone.x
  const dy = bone.ey - bone.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return Math.hypot(px - bone.x, py - bone.y)
  let t = ((px - bone.x) * dx + (py - bone.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (bone.x + t * dx), py - (bone.y + t * dy))
}

/**
 * Attribue chaque pixel opaque a l'os le plus proche.
 * L'affectation est exclusive : en pixel art, un melange de poids brouille
 * les contours au lieu de les preserver.
 */
export function autoBind(rig: Rig, layer: number, rest: Bitmap, maxDistance = Infinity): RigPart {
  const weights = new Uint8Array(rest.width * rest.height).fill(255)
  if (rig.bones.length) {
    for (let y = 0; y < rest.height; y++) {
      for (let x = 0; x < rest.width; x++) {
        const i = y * rest.width + x
        if (getA(rest.u32[i]) === 0) continue
        let best = 255, bestScore = Infinity, bestD = Infinity
        for (let b = 0; b < rig.bones.length && b < 255; b++) {
          const bone = rig.bones[b]
          const d = distanceToBone(bone, x + 0.5, y + 0.5)
          if (d > maxDistance) continue
          // Distance rapportee a la portee de l'os : une tete large garde
          // ses tempes, qu'un os de bras voisin lui prendrait autrement.
          const score = d / Math.max(1, bone.radius)
          if (score < bestScore) { bestScore = score; bestD = d; best = b }
        }
        if (best !== 255 && bestD > maxDistance) best = 255
        weights[i] = best
      }
    }
  }
  const part: RigPart = { layer, rest: rest.clone(), weights, version: 0 }
  const at = rig.parts.findIndex((p) => p.layer === layer)
  if (at >= 0) rig.parts[at] = part
  else rig.parts.push(part)
  return part
}

/** Force l'affectation des pixels d'un masque a un os donne. */
export function assignMask(part: RigPart, mask: Uint8Array, boneIndex: number): void {
  for (let i = 0; i < part.weights.length; i++) if (mask[i]) part.weights[i] = boneIndex
}

/* ------------------------------------------------------------------ */
/* Agrandissement Scale2x, pour une rotation propre                    */
/* ------------------------------------------------------------------ */

/**
 * Agrandit deux fois une image en preservant les diagonales.
 *
 * Scale2x regarde les quatre voisins orthogonaux de chaque pixel et n'ecrit
 * un voisin a la place du centre que lorsque deux voisins adjacents
 * s'accordent contre les deux autres : c'est ce qui redresse un escalier en
 * diagonale au lieu de le doubler. Aucune couleur nouvelle n'est inventee,
 * ce qui compte en pixel art ou la palette est choisie.
 */
export function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const dw = w * 2
  const out = new Uint32Array(dw * h * 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = src[y * w + x]
      const a = y > 0 ? src[(y - 1) * w + x] : p
      const d = y < h - 1 ? src[(y + 1) * w + x] : p
      const c = x > 0 ? src[y * w + (x - 1)] : p
      const b = x < w - 1 ? src[y * w + (x + 1)] : p
      const at = y * 2 * dw + x * 2
      out[at] = c === a && c !== d && a !== b ? a : p
      out[at + 1] = a === b && a !== c && b !== d ? b : p
      out[at + dw] = d === c && d !== b && c !== a ? c : p
      out[at + dw + 1] = b === d && b !== a && d !== c ? d : p
    }
  }
  return out
}

/** Agrandissement au plus proche, pour une carte d'etiquettes. */
function scaleNearest(src: Uint8Array, w: number, h: number, factor: number): Uint8Array {
  const dw = w * factor
  const out = new Uint8Array(dw * h * factor)
  for (let y = 0; y < h * factor; y++) {
    const sy = (y / factor) | 0
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[sy * w + ((x / factor) | 0)]
  }
  return out
}

/**
 * Version agrandie d'une liaison, gardee en cache.
 *
 * C'est le coeur de la qualite de rotation. Tourner du pixel art au plus
 * proche casse la grille : le contour se decoupe en marches irregulieres et
 * des pixels disparaissent. La methode de RotSprite consiste a agrandir huit
 * fois avec Scale2x, tourner a cette echelle, puis redescendre en votant :
 * les bords redeviennent nets et la palette est preservee.
 */
interface Upscaled {
  factor: number
  pixels: Uint32Array
  weights: Uint8Array
  width: number
  height: number
}

const upscaleCache = new WeakMap<RigPart, { version: number; data: Upscaled }>()

function upscaledOf(part: RigPart, factor: number): Upscaled {
  const hit = upscaleCache.get(part)
  if (hit && hit.version === part.version && hit.data.factor === factor) return hit.data
  let pixels = part.rest.u32
  let w = part.rest.width, h = part.rest.height
  for (let f = 1; f < factor; f *= 2) {
    pixels = scale2x(pixels, w, h)
    w *= 2; h *= 2
  }
  const data: Upscaled = {
    factor,
    pixels,
    weights: scaleNearest(part.weights, part.rest.width, part.rest.height, factor),
    width: w,
    height: h,
  }
  upscaleCache.set(part, { version: part.version, data })
  return data
}

/* ------------------------------------------------------------------ */
/* Deformation                                                         */
/* ------------------------------------------------------------------ */

export interface DeformOptions {
  /** Recherche autour du point source pour recoller les jointures. */
  seamRadius?: number
  /** Passes de comblement des trous restants. */
  fillPasses?: number
  /**
   * Nombre de voisins pleins exiges pour recoller un vide. Plus la valeur
   * est haute, plus la silhouette reste fidele ; plus elle est basse, plus
   * les fissures se referment.
   */
  seamNeighbours?: number
  /**
   * Rempli, si fourni, avec l'index de l'os proprietaire de chaque pixel
   * d'arrivee (255 = aucun). Permet de montrer l'influence des os sur le
   * dessin pose, et pas seulement sur le dessin de repos.
   */
  owners?: Uint8Array
  /**
   * Rempli, si fourni, avec l'index du pixel de repos dont chaque pixel
   * d'arrivee provient (-1 = aucun). C'est la carte qui permet de renvoyer
   * vers le repos une retouche faite sur le dessin pose.
   */
  sources?: Int32Array
  /**
   * Finesse de la rotation, facteur d'agrandissement interne (1, 2, 4 ou 8).
   *
   * A 1 chaque pixel d'arrivee prend une seule mesure : c'est rapide, et
   * suffisant pendant qu'on tire un os a la souris. Au-dela, la methode de
   * RotSprite s'applique — agrandissement Scale2x, rotation a cette echelle,
   * puis vote majoritaire au retour — et les contours obliques cessent de se
   * decouper en marches. 8 est la valeur retenue pour les frames produites.
   */
  quality?: 1 | 2 | 4 | 8
}

/**
 * Produit le dessin pose a partir du dessin de repos.
 *
 * Le parcours est inverse : pour chaque pixel de destination on remonte a sa
 * source. Un balayage direct laisserait des trous des qu'un membre s'etire,
 * alors que le parcours inverse remplit toute la surface couverte par l'os.
 * Les jointures restantes sont recollees par une petite recherche autour du
 * point source, puis par un comblement majoritaire : c'est ce qui regenere
 * les pixels manquants quand un bras s'ecarte du corps.
 */
export function deform(rig: Rig, part: RigPart | null, options: DeformOptions = {}): Bitmap | null {
  if (!part || !rig.bones.length) return null
  const rest = part.rest
  const weights = part.weights

  const seamRadius = options.seamRadius ?? 1
  const fillPasses = options.fillPasses ?? 1
  const seamNeighbours = options.seamNeighbours ?? 4
  // Le proprietaire de chaque pixel d'arrivee est toujours calcule : c'est lui
  // qui empeche le recollement de tisser une toile entre deux membres.
  const owners = options.owners ?? new Uint8Array(rest.width * rest.height).fill(255)
  if (options.owners) options.owners.fill(255)
  const sources = options.sources
  if (sources) sources.fill(-1)
  const w = rest.width, h = rest.height
  const out = new Bitmap(w, h)

  const world = worldTransforms(rig)
  // Les os de z eleve sont testes en premier : ils passent devant. Pendant un
  // demi-tour, c'est la profondeur tournee qui commande : un bras passe
  // derriere le corps des que le personnage s'est assez retourne.
  const turn = rig.turn
  const rang = (b: Bone): number => (turn ? turnedDepth(b, turn) * 100 + b.z * 0.01 : b.z)
  const order = rig.bones
    .map((bone, index) => ({ bone, index }))
    .sort((a, b) => rang(b.bone) - rang(a.bone))
  const inverses = new Map<number, Mat>()
  for (const { bone } of order) inverses.set(bone.id, invert(world.get(bone.id) ?? IDENTITY))

  /** Index du dernier pixel de repos echantillonne avec succes. */
  let lastSource = -1
  const sampleAt = (index: number, sx: number, sy: number): RGBA | null => {
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null
    const si = sy * w + sx
    if (weights[si] !== index) return null
    const color = rest.u32[si]
    if (getA(color) === 0) return null
    lastSource = si
    return color
  }

  /* --- echantillonnage fin, facon RotSprite --- */
  const quality = options.quality ?? 1
  const fine = quality > 1 ? upscaledOf(part, quality) : null
  const votes = new Map<RGBA, number>()

  /**
   * Couleur d'un pixel d'arrivee, mesuree sur la version agrandie.
   *
   * On prend `quality × quality` mesures dans le carre du pixel et l'on garde
   * la couleur majoritaire. Un pixel dont moins de la moitie des mesures
   * touchent de la matiere reste vide : c'est ce seuil qui garde un contour
   * franc au lieu d'une frange.
   */
  const sampleFine = (index: number, inv: Mat, x: number, y: number): RGBA | null => {
    if (!fine) return null
    const k = fine.factor
    votes.clear()
    let pleins = 0
    for (let sy = 0; sy < k; sy++) {
      for (let sx = 0; sx < k; sx++) {
        const px = x + (sx + 0.5) / k
        const py = y + (sy + 0.5) / k
        const rx = Math.floor(applyX(inv, px, py) * k)
        const ry = Math.floor(applyY(inv, px, py) * k)
        if (rx < 0 || ry < 0 || rx >= fine.width || ry >= fine.height) continue
        const at = ry * fine.width + rx
        if (fine.weights[at] !== index) continue
        const color = fine.pixels[at]
        if (getA(color) === 0) continue
        pleins++
        votes.set(color, (votes.get(color) ?? 0) + 1)
      }
    }
    if (pleins * 2 < k * k) return null
    let best: RGBA = 0, bestN = 0
    for (const [color, n] of votes) if (n > bestN) { bestN = n; best = color }
    // La source sert au report des retouches : on la prend au centre.
    const cx = Math.floor(applyX(inv, x + 0.5, y + 0.5))
    const cy = Math.floor(applyY(inv, x + 0.5, y + 0.5))
    lastSource = cx >= 0 && cy >= 0 && cx < w && cy < h ? cy * w + cx : -1
    return best
  }

  // Passe 1 : echantillonnage exact. Elargir la recherche des ici gonflerait
  // la silhouette d'un pixel autour de chaque os.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const restIndex = y * w + x
      // Un pixel qu'aucun os ne porte ne bouge pas : on peut donc ne rigger
      // qu'une partie du dessin, le reste reste en place.
      if (weights[restIndex] === 255 && getA(rest.u32[restIndex]) !== 0) {
        out.u32[restIndex] = rest.u32[restIndex]
        owners[restIndex] = 254   // pose mais sans os : ne se recolle a rien
        if (sources) sources[restIndex] = restIndex
        continue
      }
      for (const { bone, index } of order) {
        const inv = inverses.get(bone.id)!
        const color = fine
          ? sampleFine(index, inv, x, y)
          : sampleAt(
              index,
              Math.floor(applyX(inv, x + 0.5, y + 0.5)),
              Math.floor(applyY(inv, x + 0.5, y + 0.5)),
            )
        if (color !== null) {
          out.u32[restIndex] = color
          owners[restIndex] = index
          if (sources) sources[restIndex] = lastSource
          break
        }
      }
    }
  }

  // Passe 2 : les fissures d'articulation. On n'elargit la recherche que sur
  // un vide deja entoure de matiere, donc jamais sur le contour exterieur.
  if (seamRadius > 0) {
    const filled = new Uint32Array(out.u32)
    const before = new Uint8Array(owners)
    /**
     * Voisinage d'un vide : combien de pixels pleins l'entourent, et
     * appartiennent-ils tous au meme os.
     *
     * La question du proprietaire est decisive. Une fissure d'articulation
     * est un vide au milieu d'un seul membre : la refermer est juste. Le
     * creux entre un bras qui s'ecarte et le torse est borde par deux os
     * differents : le combler tisserait une palme entre les deux, ce qui se
     * voit immediatement sur un cycle de marche.
     */
    const survey = (x: number, y: number): { n: number; owner: number } => {
      let n = 0, owner = -1, mixed = false
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const at = ny * w + nx
          if (getA(filled[at]) === 0) continue
          n++
          const o = before[at]
          if (owner < 0) owner = o
          else if (owner !== o) mixed = true
        }
      }
      return { n, owner: mixed ? -1 : owner }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (getA(filled[i]) !== 0) continue
        const autour = survey(x, y)
        if (autour.n < seamNeighbours) continue
        if (autour.owner < 0 || autour.owner >= 254) continue
        let color: RGBA | null = null
        for (const { bone, index } of order) {
          if (index !== autour.owner) continue
          const inv = inverses.get(bone.id)!
          const fx = Math.floor(applyX(inv, x + 0.5, y + 0.5))
          const fy = Math.floor(applyY(inv, x + 0.5, y + 0.5))
          for (let r = 1; r <= seamRadius && color === null; r++) {
            for (let dy = -r; dy <= r && color === null; dy++) {
              for (let dx = -r; dx <= r && color === null; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
                color = sampleAt(index, fx + dx, fy + dy)
              }
            }
          }
          if (color !== null) { owners[i] = index; break }
        }
        if (color !== null) {
          out.u32[i] = color
          if (sources) sources[i] = lastSource
        }
      }
    }
  }

  for (let pass = 0; pass < fillPasses; pass++) fillHoles(out, owners)
  return out
}

/**
 * Comble les pixels vides entoures de matiere, en reprenant la couleur
 * majoritaire du voisinage. C'est ce qui referme les fentes apparues a
 * l'articulation quand un membre pivote.
 */
function fillHoles(bm: Bitmap, owners: Uint8Array): number {
  const w = bm.width, h = bm.height
  const source = new Uint32Array(bm.u32)
  const before = new Uint8Array(owners)
  let filled = 0
  const counts = new Map<number, number>()

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (getA(source[i]) !== 0) continue
      counts.clear()
      let neighbours = 0
      let owner = -1, mixed = false
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const at = ny * w + nx
          const c = source[at]
          if (getA(c) === 0) continue
          neighbours++
          counts.set(c, (counts.get(c) ?? 0) + 1)
          const o = before[at]
          if (owner < 0) owner = o
          else if (owner !== o) mixed = true
        }
      }
      // Un pixel isole n'est pas un trou : on ne comble que ce qui est cerne
      // de toutes parts, sinon la matiere deborde de la silhouette.
      if (neighbours < 6) continue
      // Un vide cerne par six voisins est un vrai trou, meme quand ses bords
      // appartiennent a deux os : c'est le cas de l'epaule et de la hanche,
      // ou trois parties se rejoignent. C'est le recollement de la passe
      // precedente, bien plus permissif, qui doit s'en tenir a un seul os
      // pour ne pas tisser de palme entre un bras ecarte et le corps.
      if (owner < 0) continue
      void mixed
      let best = 0, bestN = 0
      for (const [color, n] of counts) if (n > bestN) { bestN = n; best = color }
      bm.u32[i] = best
      owners[i] = mixed ? 254 : owner
      filled++
    }
  }
  return filled
}

/* ------------------------------------------------------------------ */
/* Retour du dessin pose vers le repos                                 */
/* ------------------------------------------------------------------ */

export interface BakeResult {
  /** Pixels du repos reecrits par la retouche. */
  changed: number
  /** Pixels peints hors de toute zone connue, rattaches a un os voisin. */
  adopted: number
}

/**
 * Renvoie vers le dessin de repos une retouche faite sur le dessin pose.
 *
 * `posed` est le rendu que la deformation avait produit, `sources` la carte
 * qui dit de quel pixel de repos chaque pixel pose provient, et `edited` la
 * toile telle que l'utilisateur l'a laissee. Tout pixel qui differe est
 * reporte a sa source : le repos reste donc la reference, et les poses
 * suivantes tiennent compte du nouveau dessin sans avoir a relier les pixels.
 *
 * Un pixel peint la ou rien n'existait n'a pas de source. On le rattache
 * alors a l'os du voisin connu le plus proche et on remonte par sa
 * transformation inverse : un detail ajoute sur un bras leve suit ensuite
 * le bras.
 */
export function bakePose(
  rig: Rig,
  part: RigPart,
  posed: Bitmap,
  sources: Int32Array,
  owners: Uint8Array,
  edited: Bitmap,
): BakeResult {
  const rest = part.rest
  const weights = part.weights
  const out: BakeResult = { changed: 0, adopted: 0 }
  if (edited.width !== rest.width || edited.height !== rest.height) return out

  const w = rest.width, h = rest.height
  const world = worldTransforms(rig)
  const inverses = rig.bones.map((b) => invert(world.get(b.id) ?? IDENTITY))

  for (let i = 0; i < edited.u32.length; i++) {
    const now = edited.u32[i]
    if (now === posed.u32[i]) continue

    const source = sources[i]
    if (source >= 0) {
      rest.u32[source] = now
      // Un pixel efface sur la pose disparait aussi du repos.
      if (getA(now) === 0) weights[source] = 255
      out.changed++
      continue
    }
    if (getA(now) === 0) continue

    // Pixel neuf : on cherche a quel os il appartient, en regardant autour.
    const x = i % w, y = (i / w) | 0
    let bone = -1
    for (let r = 1; r <= 4 && bone < 0; r++) {
      for (let dy = -r; dy <= r && bone < 0; dy++) {
        for (let dx = -r; dx <= r && bone < 0; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const o = owners[ny * w + nx]
          if (o !== 255 && o < rig.bones.length) bone = o
        }
      }
    }
    if (bone < 0) {
      // Aucun os autour : le pixel reste ou il est, libre de toute influence.
      rest.u32[i] = now
      weights[i] = 255
      out.adopted++
      continue
    }
    const inv = inverses[bone]
    const sx = Math.floor(applyX(inv, x + 0.5, y + 0.5))
    const sy = Math.floor(applyY(inv, x + 0.5, y + 0.5))
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
    const at = sy * w + sx
    rest.u32[at] = now
    weights[at] = bone
    out.adopted++
  }
  if (out.changed + out.adopted > 0) touchPart(part)
  return out
}

/** Remet toutes les poses a zero. */
export function resetPose(rig: Rig): void {
  for (const bone of rig.bones) {
    bone.angle = 0
    bone.tx = 0
    bone.ty = 0
    bone.scale = 1
  }
}

/** Copie de la pose courante, pour l'enregistrer sur une frame. */
export type Pose = Record<number, { angle: number; tx: number; ty: number; scale: number }>

export function capturePose(rig: Rig): Pose {
  const pose: Pose = {}
  for (const b of rig.bones) pose[b.id] = { angle: b.angle, tx: b.tx, ty: b.ty, scale: b.scale }
  return pose
}

export function applyPose(rig: Rig, pose: Pose): void {
  for (const bone of rig.bones) {
    const p = pose[bone.id]
    if (!p) continue
    bone.angle = p.angle
    bone.tx = p.tx
    bone.ty = p.ty
    bone.scale = p.scale
  }
}

/** Interpolation de deux poses, pour generer des frames intermediaires. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {}
  for (const key of Object.keys(b)) {
    const id = Number(key)
    const pa = a[id] ?? { angle: 0, tx: 0, ty: 0, scale: 1 }
    const pb = b[id]
    out[id] = {
      angle: pa.angle + (pb.angle - pa.angle) * t,
      tx: pa.tx + (pb.tx - pa.tx) * t,
      ty: pa.ty + (pb.ty - pa.ty) * t,
      scale: pa.scale + (pb.scale - pa.scale) * t,
    }
  }
  return out
}
