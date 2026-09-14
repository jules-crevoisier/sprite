import { genId } from './document'

/**
 * Une IMAGE DE RÉFÉRENCE : ce qu'on garde sous les yeux pour décalquer.
 *
 * ## Pourquoi ce n'est PAS un calque
 *
 * La premiere version en faisait un calque de pixels : l'image etait reduite
 * a la taille du sprite, gravee dans un bitmap, et posee la. Autant dire
 * detruite. Une photo de quatre cents pixels de large ramenee dans un cadre
 * de trente-deux perd tout ce qui en faisait une reference, et surtout elle
 * ne bouge plus : ni la deplacer sur le detail qu'on dessine, ni l'agrandir
 * pour regarder une main de pres.
 *
 * Une reference est donc une image POSEE DANS LA VUE, au-dessus ou au-dessous
 * du dessin, avec sa propre position et sa propre echelle — comme un fond
 * dans Blender, un calque libre dans Photoshop, une couche dans After Effects.
 * Elle garde sa definition d'origine : au zoom huit, on voit la photo en
 * grand, pas huit fois le meme gros pixel.
 *
 * ## Ce qu'elle n'est jamais
 *
 * Elle ne se peint pas — il n'y a rien a peindre, ce ne sont pas des pixels
 * du sprite — et elle ne s'exporte pas : ni dans le PNG, ni dans la planche,
 * ni dans le JSON. C'est ce qui la distingue d'un calque, et c'est la seule
 * chose qu'il ne faut jamais oublier a son sujet.
 */
export interface Reference {
  id: number
  nom: string
  /**
   * L'image elle-meme, en dataURL.
   *
   * C'est ce qui part dans le fichier de projet : une reference qui vivrait
   * seulement en memoire disparaitrait au rechargement, et l'on rouvrirait son
   * dessin sans le modele qui l'explique.
   */
  source: string
  /**
   * Ou elle se trouve et quelle taille elle fait, EN PIXELS DU SPRITE.
   *
   * Fractionnaires et sans borne : une reference deborde du cadre, et c'est
   * normal — on cadre le morceau qui nous interesse. Les exprimer en pixels
   * du sprite plutot qu'en pixels d'ecran est ce qui les rend independants du
   * zoom : on deplace la vue, la reference reste sur le dessin.
   */
  x: number
  y: number
  l: number
  h: number
  /**
   * L'angle, en DEGRES, autour du centre de la boite.
   *
   * Une photo prise de travers, un croquis scanne de biais : sans angle, on
   * redresse son dessin au lieu de redresser le modele, et l'on dessine faux
   * pour coller a un modele faux. Les grands logiciels le donnent tous ; c'est
   * ici le premier reglage qui manquait vraiment.
   */
  rotation: number
  /**
   * L'image retournee, horizontalement ou verticalement.
   *
   * Un personnage de profil sert a dessiner les deux profils. Retourner le
   * modele plutot que de le redessiner est le geste ordinaire ; il ne touche
   * QUE l'image, pas la boite, donc les poignees ne bougent pas sous la main.
   */
  miroirX: boolean
  miroirY: boolean
  /** De 0 a 1. A demi transparente par defaut : on dessine par-dessus. */
  opacite: number
  visible: boolean
  /** Verrouillee : on ne la deplace plus par megarde en dessinant a cote. */
  verrouille: boolean
  /** Sous le dessin — le cas ordinaire — ou par-dessus, pour comparer. */
  dessous: boolean
}

/** Les poignees d'une reference choisie, et ce qu'elles font. */
export type PoigneeRef =
  | 'corps' | 'no' | 'n' | 'ne' | 'e' | 'se' | 's' | 'so' | 'o' | 'rotation'

/** Le curseur qui va avec chaque poignee, IMAGE DROITE. Voir `curseurPoignee`. */
export const CURSEUR_POIGNEE: Record<PoigneeRef, string> = {
  corps: 'move', no: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', so: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', o: 'ew-resize',
  rotation: 'grab',
}

/** L'angle que regarde chaque poignee, en degres, image droite. */
const ANGLE_POIGNEE: Record<string, number> = {
  e: 0, se: 45, s: 90, so: 135, o: 180, no: 225, n: 270, ne: 315,
}

/**
 * Le curseur d'une poignee sur une image TOURNEE.
 *
 * Une fleche « redimensionne verticalement » sur le bord haut d'une image
 * tournee de quatre-vingt-dix degres ment : ce bord tire maintenant vers la
 * droite. On fait donc tourner le curseur avec l'image, au huitieme de tour
 * pres — c'est tout ce que les curseurs du navigateur savent distinguer.
 */
export function curseurPoignee(poignee: PoigneeRef, rotation: number): string {
  const base = ANGLE_POIGNEE[poignee]
  if (base === undefined) return CURSEUR_POIGNEE[poignee]
  const octant = Math.round((((base + rotation) % 360) + 360) % 360 / 45) % 8
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize',
    'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][octant]
}

/**
 * Cree une reference a partir d'une image, cadree dans le sprite.
 *
 * Elle arrive ENTIERE et centree : on veut la voir en entier avant de
 * decider quel morceau garder. Si elle est plus petite que le cadre, elle
 * garde sa taille — l'agrandir d'office ferait croire a une image floue.
 */
export function referenceDepuisImage(
  source: string, nom: string, imgL: number, imgH: number,
  spriteL: number, spriteH: number,
): Reference {
  const facteur = Math.min(1, Math.min(spriteL / Math.max(1, imgL), spriteH / Math.max(1, imgH)))
  const l = Math.max(1, imgL * facteur)
  const h = Math.max(1, imgH * facteur)
  return {
    id: genId(),
    nom,
    source,
    x: (spriteL - l) / 2,
    y: (spriteH - h) / 2,
    l,
    h,
    rotation: 0,
    miroirX: false,
    miroirY: false,
    opacite: 0.5,
    visible: true,
    verrouille: false,
    dessous: true,
  }
}

/** La boite d'une reference, sans le reste : ce que les gestes manipulent. */
export interface BoiteRef {
  x: number
  y: number
  l: number
  h: number
  /** En degres, autour du centre. Absent vaut zero. */
  rotation?: number
}

const RAD = Math.PI / 180

/** Le centre d'une boite : c'est autour de lui que tout tourne. */
export function centreRef(r: BoiteRef): { x: number; y: number } {
  return { x: r.x + r.l / 2, y: r.y + r.h / 2 }
}

/**
 * Un point du sprite, vu DANS le repere de l'image.
 *
 * Tout le reste en depend : sans ce passage, une image tournee garde des
 * poignees droites, on attrape le vide a cote du coin, et le redimensionnement
 * fait fuir l'image en diagonale. On ramene donc le curseur dans le repere ou
 * l'image est droite, on y fait le calcul simple, et l'on repart.
 */
export function versLocal(r: BoiteRef, px: number, py: number): { x: number; y: number } {
  const c = centreRef(r)
  const a = -(r.rotation ?? 0) * RAD
  const dx = px - c.x, dy = py - c.y
  const cos = Math.cos(a), sin = Math.sin(a)
  return { x: dx * cos - dy * sin + r.l / 2, y: dx * sin + dy * cos + r.h / 2 }
}

/** Un point du repere de l'image, ramene dans le sprite. */
export function versMonde(r: BoiteRef, lx: number, ly: number): { x: number; y: number } {
  const c = centreRef(r)
  const a = (r.rotation ?? 0) * RAD
  const dx = lx - r.l / 2, dy = ly - r.h / 2
  const cos = Math.cos(a), sin = Math.sin(a)
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** Les quatre coins, dans l'ordre : haut-gauche, haut-droit, bas-droit, bas-gauche. */
export function coinsRef(r: BoiteRef): { x: number; y: number }[] {
  return [
    versMonde(r, 0, 0), versMonde(r, r.l, 0),
    versMonde(r, r.l, r.h), versMonde(r, 0, r.h),
  ]
}

/**
 * A quelle distance du bord haut se tient la poignee de rotation.
 *
 * En pixels d'ECRAN, convertis par l'appelant : comme les poignees, elle doit
 * rester a la meme distance a l'oeil quel que soit le zoom.
 */
export const RECUL_ROTATION = 26

/**
 * La poignee sous un point, en pixels du sprite — ou null.
 *
 * `marge` est en pixels d'ECRAN convertis par l'appelant : une poignee doit
 * faire la meme taille a l'oeil quel que soit le zoom, sinon elle devient
 * inattrapable a 1x et couvre toute l'image a 32x.
 */
export function poigneeRef(
  r: BoiteRef, px: number, py: number, marge: number, reculRotation = 0,
): PoigneeRef | null {
  const p = versLocal(r, px, py)

  // La rotation d'abord : sa poignee est HORS de la boite, et se disputerait
  // sinon le bord haut des que l'image devient petite a l'ecran.
  if (reculRotation > 0) {
    const d = Math.hypot(p.x - r.l / 2, p.y - (-reculRotation))
    if (d <= marge * 1.4) return 'rotation'
  }

  const dedans = p.x >= -marge && p.x <= r.l + marge && p.y >= -marge && p.y <= r.h + marge
  if (!dedans) return null
  const gauche = Math.abs(p.x) <= marge
  const droite = Math.abs(p.x - r.l) <= marge
  const haut = Math.abs(p.y) <= marge
  const bas = Math.abs(p.y - r.h) <= marge
  if (haut && gauche) return 'no'
  if (haut && droite) return 'ne'
  if (bas && gauche) return 'so'
  if (bas && droite) return 'se'
  if (haut) return 'n'
  if (bas) return 's'
  if (gauche) return 'o'
  if (droite) return 'e'
  // A l'interieur franc : on deplace.
  return p.x >= 0 && p.x <= r.l && p.y >= 0 && p.y <= r.h ? 'corps' : null
}

/** Taille minimale d'une reference, en pixels du sprite. */
export const REF_MIN = 4

/** Ce qu'une touche enfoncee change pendant qu'on tire une poignee. */
export interface OptionsTirage {
  /** Maj : les coins cessent de garder les proportions. */
  libre?: boolean
  /** Alt : on dimensionne depuis le CENTRE, comme partout ailleurs. */
  centre?: boolean
}

/**
 * La reference telle qu'elle devient quand on tire une poignee.
 *
 * ## Pourquoi les coins gardent les proportions par defaut
 *
 * Une reference deformee ne sert plus a rien : on decalque des proportions
 * autant qu'un contour. Les coins les preservent donc, et `libre` — la touche
 * Maj — permet de deformer quand on le veut vraiment. Les bords, eux, ne
 * touchent qu'un axe par definition.
 *
 * ## Ce que la rotation change
 *
 * Rien, dans le calcul — et c'est tout l'interet du repere local. Le
 * deplacement du curseur y est ramene, le redimensionnement s'y fait comme sur
 * une image droite, puis le centre obtenu repart dans le monde. Sans cela il
 * faudrait un cas par angle, et l'on en oublierait.
 */
export function tirerRef(
  depart: BoiteRef, poignee: PoigneeRef, dx: number, dy: number,
  options: OptionsTirage | boolean = {},
): BoiteRef {
  // L'ancienne signature passait `libre` en booleen : on l'accepte encore,
  // pour que les appels d'hier ne deviennent pas faux en silence.
  const opts: OptionsTirage = typeof options === 'boolean' ? { libre: options } : options
  const rotation = depart.rotation ?? 0
  if (poignee === 'corps') {
    return { ...depart, x: depart.x + dx, y: depart.y + dy, rotation }
  }
  if (poignee === 'rotation') return { ...depart, rotation }

  // Le deplacement du curseur, vu dans le repere de l'image.
  const a = -rotation * RAD
  const dlx = dx * Math.cos(a) - dy * Math.sin(a)
  const dly = dx * Math.sin(a) + dy * Math.cos(a)

  const ouest = poignee.includes('o')
  const est = poignee.includes('e')
  const nord = poignee.includes('n')
  const sud = poignee.includes('s')

  // Tout se calcule dans une boite locale qui part de (0,0).
  let x = 0, y = 0, l = depart.l, h = depart.h

  if (opts.centre) {
    // Depuis le centre : les deux bords opposes bougent d'autant, en sens
    // contraire. Le centre, lui, ne bouge pas du tout.
    if (ouest) { l = Math.max(REF_MIN, depart.l - dlx * 2); x = (depart.l - l) / 2 }
    if (est) { l = Math.max(REF_MIN, depart.l + dlx * 2); x = (depart.l - l) / 2 }
    if (nord) { h = Math.max(REF_MIN, depart.h - dly * 2); y = (depart.h - h) / 2 }
    if (sud) { h = Math.max(REF_MIN, depart.h + dly * 2); y = (depart.h - h) / 2 }
  } else {
    if (ouest) { const d = Math.min(dlx, l - REF_MIN); x += d; l -= d }
    if (est) l = Math.max(REF_MIN, l + dlx)
    if (nord) { const d = Math.min(dly, h - REF_MIN); y += d; h -= d }
    if (sud) h = Math.max(REF_MIN, h + dly)
  }

  const coin = (ouest || est) && (nord || sud)
  if (coin && !opts.libre) {
    // Le rapport de depart fait foi ; on suit l'axe qui a le plus bouge, et
    // l'autre s'aligne. Prendre la moyenne des deux ferait glisser l'image
    // sous le curseur au lieu de la suivre.
    const ratio = depart.l / Math.max(1e-6, depart.h)
    if (Math.abs(l - depart.l) >= Math.abs(h - depart.h) * ratio) h = Math.max(REF_MIN, l / ratio)
    else l = Math.max(REF_MIN, h * ratio)
    if (opts.centre) { x = (depart.l - l) / 2; y = (depart.h - h) / 2 }
    else {
      // Un coin ancre le coin OPPOSE : sans cela, redimensionner par le haut a
      // gauche ferait fuir l'image vers le bas a droite.
      if (ouest) x = depart.l - l
      if (nord) y = depart.h - h
    }
  }

  // Le centre a bouge dans le repere local ; on le ramene dans le monde, et la
  // boite se reconstruit autour de lui.
  const dc = versMonde(depart, x + l / 2, y + h / 2)
  return { x: dc.x - l / 2, y: dc.y - h / 2, l, h, rotation }
}

/**
 * L'angle, quand on tire la poignee de rotation.
 *
 * On compare l'angle du curseur a celui qu'il avait au depart, plutot que de
 * pointer l'image vers le curseur : autrement, l'image saute d'un quart de
 * tour des qu'on attrape la poignee, parce que celle-ci n'est pas sur l'axe
 * qu'on croit.
 */
export function tournerRef(
  depart: BoiteRef, px: number, py: number, pxDepart: number, pyDepart: number,
  pas = 0,
): BoiteRef {
  const c = centreRef(depart)
  const a0 = Math.atan2(pyDepart - c.y, pxDepart - c.x)
  const a1 = Math.atan2(py - c.y, px - c.x)
  let rotation = (depart.rotation ?? 0) + (a1 - a0) / RAD
  if (pas > 0) rotation = Math.round(rotation / pas) * pas
  // Toujours entre -180 et 180 : un champ qui afficherait 725° serait juste et
  // illisible.
  rotation = ((rotation + 180) % 360 + 360) % 360 - 180
  return { ...depart, rotation }
}

/* ------------------------------------------------------------------ */
/* Aimantation                                                         */
/* ------------------------------------------------------------------ */

/** Un rappel visible de ce sur quoi la boite vient de se poser. */
export interface Aimant {
  /** L'axe de la ligne de rappel : verticale ou horizontale. */
  axe: 'x' | 'y'
  /** Ou elle passe, en pixels du sprite. */
  ou: number
}

/**
 * Colle les bords et le centre de la boite a ceux du sprite.
 *
 * ## Pourquoi ca vaut le detour
 *
 * Centrer une reference a la main, c'est viser un demi-pixel a la souris et
 * rater. Tous les grands logiciels aimantent ; ce qui les rend supportables
 * est qu'on puisse le couper — ici, la touche Ctrl — et qu'on VOIE a quoi la
 * boite vient de se coller, sinon on croit avoir mal vise.
 *
 * L'aimantation ne s'applique qu'a une image DROITE : coller les bords de la
 * boite d'englobement d'une image tournee de trente degres collerait quelque
 * chose que personne ne regarde.
 */
export function aimanterRef(
  boite: BoiteRef, spriteL: number, spriteH: number, tolerance: number,
): { boite: BoiteRef; aimants: Aimant[] } {
  const aimants: Aimant[] = []
  if (tolerance <= 0 || Math.abs(boite.rotation ?? 0) > 0.5) return { boite, aimants }
  const out = { ...boite }

  const candidats = (debut: number, taille: number, borne: number): {
    delta: number; ou: number
  } | null => {
    const lignes = [0, borne / 2, borne]
    const points: [number, number][] = [
      [debut, 0], [debut + taille / 2, 1], [debut + taille, 2],
    ]
    let meilleur: { delta: number; ou: number } | null = null
    for (const [valeur] of points) {
      for (const ligne of lignes) {
        const ecart = ligne - valeur
        if (Math.abs(ecart) > tolerance) continue
        if (!meilleur || Math.abs(ecart) < Math.abs(meilleur.delta)) {
          meilleur = { delta: ecart, ou: ligne }
        }
      }
    }
    return meilleur
  }

  const ax = candidats(boite.x, boite.l, spriteL)
  if (ax) { out.x = boite.x + ax.delta; aimants.push({ axe: 'x', ou: ax.ou }) }
  const ay = candidats(boite.y, boite.h, spriteH)
  if (ay) { out.y = boite.y + ay.delta; aimants.push({ axe: 'y', ou: ay.ou }) }
  return { boite: out, aimants }
}

/* ------------------------------------------------------------------ */
/* Cadrages                                                            */
/* ------------------------------------------------------------------ */

/** Les cadrages tout faits, ceux qu'on refait a la main vingt fois par jour. */
export type Cadrage = 'contenir' | 'remplir' | 'reelle' | 'centrer'

/**
 * Recadre une reference dans le sprite.
 *
 * - `contenir` : l'image entiere tient dans le cadre — pour la voir toute.
 * - `remplir` : le cadre est couvert, l'image deborde — pour decalquer un
 *   detail sans laisser de vide sur les bords.
 * - `reelle` : un pixel de l'image pour un pixel du sprite, centre. C'est le
 *   cadrage des planches et des tuiles, celui ou l'on compare vraiment.
 * - `centrer` : la taille ne bouge pas, seule la position.
 */
export function cadrerRef(
  r: BoiteRef, cadrage: Cadrage, spriteL: number, spriteH: number,
  imgL: number, imgH: number,
): BoiteRef {
  const ratio = imgL > 0 && imgH > 0 ? imgL / imgH : r.l / Math.max(1e-6, r.h)
  let l = r.l, h = r.h
  if (cadrage === 'contenir') {
    l = Math.min(spriteL, spriteH * ratio)
    h = l / ratio
  } else if (cadrage === 'remplir') {
    l = Math.max(spriteL, spriteH * ratio)
    h = l / ratio
  } else if (cadrage === 'reelle') {
    l = Math.max(REF_MIN, imgL || r.l)
    h = Math.max(REF_MIN, imgH || r.h)
  }
  return { ...r, l, h, x: (spriteL - l) / 2, y: (spriteH - h) / 2 }
}

/* ------------------------------------------------------------------ */
/* Les images decodees                                                 */
/* ------------------------------------------------------------------ */

const cache = new Map<string, HTMLImageElement>()

/**
 * L'image decodee d'une reference, ou null tant qu'elle charge.
 *
 * Le decodage est asynchrone et le rendu, lui, est synchrone : on rend donc
 * null la premiere fois et l'on previent quand l'image est prete. Attendre
 * dans le rendu figerait la vue le temps de decoder une photo.
 */
export function imageDeReference(
  source: string, quandPrete?: () => void,
): HTMLImageElement | null {
  const deja = cache.get(source)
  if (deja) return deja.complete && deja.naturalWidth > 0 ? deja : null
  const img = new Image()
  img.decoding = 'async'
  img.onload = () => quandPrete?.()
  img.src = source
  cache.set(source, img)
  return null
}

/** Oublie les images qu'aucune reference n'emploie plus. */
export function purgerImages(sources: Iterable<string>): void {
  const vivantes = new Set(sources)
  for (const clef of [...cache.keys()]) if (!vivantes.has(clef)) cache.delete(clef)
}
