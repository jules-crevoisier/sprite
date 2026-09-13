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
  /** De 0 a 1. A demi transparente par defaut : on dessine par-dessus. */
  opacite: number
  visible: boolean
  /** Verrouillee : on ne la deplace plus par megarde en dessinant a cote. */
  verrouille: boolean
  /** Sous le dessin — le cas ordinaire — ou par-dessus, pour comparer. */
  dessous: boolean
}

/** Les poignees d'une reference choisie, et ce qu'elles font. */
export type PoigneeRef = 'corps' | 'no' | 'n' | 'ne' | 'e' | 'se' | 's' | 'so' | 'o'

/** Le curseur qui va avec chaque poignee. */
export const CURSEUR_POIGNEE: Record<PoigneeRef, string> = {
  corps: 'move', no: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', so: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', o: 'ew-resize',
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
    opacite: 0.5,
    visible: true,
    verrouille: false,
    dessous: true,
  }
}

/**
 * La poignee sous un point, en pixels du sprite — ou null.
 *
 * `marge` est en pixels d'ECRAN convertis par l'appelant : une poignee doit
 * faire la meme taille a l'oeil quel que soit le zoom, sinon elle devient
 * inattrapable a 1x et couvre toute l'image a 32x.
 */
export function poigneeRef(
  r: { x: number; y: number; l: number; h: number },
  px: number, py: number, marge: number,
): PoigneeRef | null {
  const dedans = px >= r.x - marge && px <= r.x + r.l + marge
    && py >= r.y - marge && py <= r.y + r.h + marge
  if (!dedans) return null
  const gauche = Math.abs(px - r.x) <= marge
  const droite = Math.abs(px - (r.x + r.l)) <= marge
  const haut = Math.abs(py - r.y) <= marge
  const bas = Math.abs(py - (r.y + r.h)) <= marge
  if (haut && gauche) return 'no'
  if (haut && droite) return 'ne'
  if (bas && gauche) return 'so'
  if (bas && droite) return 'se'
  if (haut) return 'n'
  if (bas) return 's'
  if (gauche) return 'o'
  if (droite) return 'e'
  // A l'interieur franc : on deplace.
  return px >= r.x && px <= r.x + r.l && py >= r.y && py <= r.y + r.h ? 'corps' : null
}

/** Taille minimale d'une reference, en pixels du sprite. */
export const REF_MIN = 4

/**
 * La reference telle qu'elle devient quand on tire une poignee.
 *
 * ## Pourquoi les coins gardent les proportions par defaut
 *
 * Une reference deformee ne sert plus a rien : on decalque des proportions
 * autant qu'un contour. Les coins les preservent donc, et `libre` — la touche
 * Maj — permet de deformer quand on le veut vraiment. Les bords, eux, ne
 * touchent qu'un axe par definition.
 */
export function tirerRef(
  depart: { x: number; y: number; l: number; h: number },
  poignee: PoigneeRef, dx: number, dy: number, libre = false,
): { x: number; y: number; l: number; h: number } {
  if (poignee === 'corps') return { ...depart, x: depart.x + dx, y: depart.y + dy }
  let { x, y, l, h } = depart
  const ouest = poignee.includes('o')
  const est = poignee.includes('e')
  const nord = poignee.includes('n')
  const sud = poignee.includes('s')

  if (ouest) { const d = Math.min(dx, l - REF_MIN); x += d; l -= d }
  if (est) l = Math.max(REF_MIN, l + dx)
  if (nord) { const d = Math.min(dy, h - REF_MIN); y += d; h -= d }
  if (sud) h = Math.max(REF_MIN, h + dy)

  const coin = (ouest || est) && (nord || sud)
  if (coin && !libre) {
    // Le rapport de depart fait foi ; on suit l'axe qui a le plus bouge, et
    // l'autre s'aligne. Prendre la moyenne des deux ferait glisser l'image
    // sous le curseur au lieu de la suivre.
    const ratio = depart.l / Math.max(1e-6, depart.h)
    if (Math.abs(l - depart.l) >= Math.abs(h - depart.h) * ratio) h = Math.max(REF_MIN, l / ratio)
    else l = Math.max(REF_MIN, h * ratio)
    // Un coin ancre le coin OPPOSE : sans cela, redimensionner par le haut a
    // gauche ferait fuir l'image vers le bas a droite.
    if (ouest) x = depart.x + depart.l - l
    if (nord) y = depart.y + depart.h - h
  }
  return { x, y, l, h }
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
