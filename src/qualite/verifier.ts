import { Bitmap } from '../core/bitmap'
import { getA, getR, getG, getB, luminance, toHex, type RGBA } from '../core/color'

/**
 * Controle qualite d'un sprite, entierement calcule.
 *
 * ## Pourquoi du code et pas un jugement
 *
 * Faire juger un dessin par un modele coute cher, varie d'un appel a l'autre,
 * et — le plus grave — son score derive : a chaque tour de boucle il se
 * persuade que c'est mieux. Or la plupart des defauts du pixel art ne se
 * jugent pas, ils se comptent : une couleur en double a trois unites pres,
 * un pixel isole au milieu d'un aplat, un contour qui ne tranche pas sur son
 * remplissage, une silhouette qui ne se lit plus a la moitie de sa taille.
 *
 * Ces regles-la sont ici. Elles ne varient jamais, elles sont gratuites, et
 * elles filtrent avant qu'on demande son avis a qui que ce soit. Ce qui reste
 * — le gout, la lisibilite d'une intention, le style — se juge a l'oeil, et
 * seulement sur ce qui a deja passe ces controles.
 *
 * ## Ce que chaque regle attrape
 *
 * Chaque constat porte son defaut, pas seulement sa note : « ces deux couleurs
 * sont a deux unites l'une de l'autre » se corrige, « 6/10 » ne se corrige
 * pas.
 */

export type Gravite = 'bloquant' | 'important' | 'remarque'

export interface Constat {
  /** Identifiant stable, pour qu'une boucle sache ce qui a change. */
  id: string
  gravite: Gravite
  /** Ce qui ne va pas, en une phrase, avec les chiffres. */
  quoi: string
  /** Ce qu'il faut faire. Vide si le constat est seulement informatif. */
  quoiFaire: string
  /** Endroits concernes, en coordonnees du dessin. */
  ou?: { x: number; y: number }[]
}

export interface Rapport {
  constats: Constat[]
  /** Chiffres bruts, pour un banc ou un tableau de bord. */
  mesures: Record<string, number>
  /** Vrai si aucun constat bloquant. */
  passe: boolean
}

export interface OptionsVerif {
  /** Palette du projet ; toute couleur hors de cette liste est signalee. */
  palette?: RGBA[]
  /**
   * Les tuiles du decor sur lequel ce sprite sera pose.
   *
   * Sans elles, le verificateur ne compare les couleurs d'un dessin qu'entre
   * elles. Un personnage peut donc passer toutes les regles, dans ses huit
   * directions, en etant peint de la couleur du sol qu'il foule : il se
   * dissout a l'ecran sans qu'aucune mesure ne l'ait vu.
   *
   * Ce sont bien les tuiles et non une liste de couleurs : il faut savoir
   * quelle SURFACE chaque couleur occupe. La premiere version prenait la
   * liste, et accusait le heros a 66% — sur son propre trait de contour, qui
   * doit ressembler a celui du decor, et sur un brun de caisse qui ne couvre
   * que quelques pixels d'une seule tuile.
   */
  decor?: Bitmap[]
  /** Le dessin doit-il tenir dans une silhouette d'un seul tenant ? */
  unSeulMorceau?: boolean
  /**
   * Force le traitement en tuile. Par defaut c'est devine : un dessin qui
   * remplit sa toile jusqu'aux quatre bords n'a pas de silhouette, donc ni
   * contour a juger ni cadrage a reprocher.
   */
  tuile?: boolean
}

const distance = (a: RGBA, b: RGBA): number =>
  Math.abs(getR(a) - getR(b)) + Math.abs(getG(a) - getG(b)) + Math.abs(getB(a) - getB(b))

/** Toutes les couleurs opaques et leur effectif. */
function effectifs(bm: Bitmap): Map<RGBA, number> {
  const out = new Map<RGBA, number>()
  for (let i = 0; i < bm.u32.length; i++) {
    const c = bm.u32[i]
    if (getA(c) === 0) continue
    out.set(c, (out.get(c) ?? 0) + 1)
  }
  return out
}

const plein = (bm: Bitmap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < bm.width && y < bm.height && getA(bm.u32[y * bm.width + x]) !== 0

/**
 * Masque binaire reduit de moitie.
 *
 * Il faut TROIS pixels sur quatre, et non deux : avec deux, une ligne d'un
 * pixel de large survit toujours — chaque bloc en contient exactement deux —
 * et la regle ne voyait jamais disparaitre ce qui disparait vraiment quand on
 * regarde un sprite en petit.
 */
function moitie(bm: Bitmap): { masque: Uint8Array; w: number; h: number } {
  const w = Math.max(1, Math.ceil(bm.width / 2))
  const h = Math.max(1, Math.ceil(bm.height / 2))
  const masque = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (plein(bm, x * 2 + dx, y * 2 + dy)) n++
      }
      masque[y * w + x] = n >= 3 ? 1 : 0
    }
  }
  return { masque, w, h }
}

/** Nombre de groupes 8-connexes d'un masque. */
function morceaux(masque: Uint8Array, w: number, h: number, minimum = 1): number {
  const vus = new Uint8Array(w * h)
  let n = 0
  for (let depart = 0; depart < w * h; depart++) {
    if (vus[depart] || !masque[depart]) continue
    let taille = 0
    const pile = [depart]
    vus[depart] = 1
    while (pile.length) {
      const i = pile.pop()!
      taille++
      const x = i % w, y = (i / w) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (vus[j] || !masque[j]) continue
          vus[j] = 1
          pile.push(j)
        }
      }
    }
    if (taille >= minimum) n++
  }
  return n
}

export function verifier(bm: Bitmap, opts: OptionsVerif = {}): Rapport {
  const constats: Constat[] = []
  const mesures: Record<string, number> = {}
  const compte = effectifs(bm)
  const couleurs = [...compte.keys()]
  const total = [...compte.values()].reduce((a, b) => a + b, 0)
  const boite = bm.trimBounds()

  // Une tuile n'a pas d'exterieur : ses pixels de bord touchent la tuile
  // voisine, pas le vide. Lui reprocher un contour qui ne tranche pas, ou un
  // cadrage, n'a aucun sens — et c'est ce que faisait la premiere version sur
  // le sol et le mur du donjon.
  const remplitLeCadre = boite.w === bm.width && boite.h === bm.height
    && total >= bm.width * bm.height * 0.98
  const estTuile = opts.tuile ?? remplitLeCadre
  mesures.tuile = estTuile ? 1 : 0

  mesures.pixels = total
  mesures.couleurs = couleurs.length
  mesures.largeur = boite.w
  mesures.hauteur = boite.h

  if (!total) {
    return {
      constats: [{ id: 'vide', gravite: 'bloquant', quoi: 'Le dessin est vide.', quoiFaire: 'Dessiner quelque chose.' }],
      mesures, passe: false,
    }
  }

  /* --- 1. Couleurs en double : deux teintes qu'on ne distingue pas --- */
  //
  // Deux tests, parce qu'un seul laissait passer le cas le plus courant. La
  // distance brute attrape les quasi-jumelles ; elle a laisse filer la
  // ceinture (#7a4a22) et les cheveux (#8a4b2a) du heros, distantes de
  // vingt-cinq — au-dessus du seuil — mais separees de six unites de
  // luminance seulement. A l'ecran c'etait le meme brun, et une case de
  // palette payee pour rien. Une paire proche en luminance ET pas franchement
  // eloignee en teinte se lit comme une seule couleur.
  const doublons: string[] = []
  for (let i = 0; i < couleurs.length; i++) {
    for (let j = i + 1; j < couleurs.length; j++) {
      const d = distance(couleurs[i], couleurs[j])
      const dl = Math.abs(luminance(couleurs[i]) - luminance(couleurs[j]))
      const jumelles = d <= 12
      const memeValeur = dl < 10 && d < 40
      if (!jumelles && !memeValeur) continue
      doublons.push(`${toHex(couleurs[i])} et ${toHex(couleurs[j])} `
        + `(écart ${d}, luminance ${dl.toFixed(0)})`)
    }
  }
  mesures.doublons = doublons.length
  if (doublons.length) {
    constats.push({
      id: 'doublons',
      gravite: 'important',
      quoi: `${doublons.length} paire(s) de couleurs indiscernables : ${doublons.slice(0, 3).join(', ')}`
        + (doublons.length > 3 ? '…' : ''),
      quoiFaire: 'Fondre chaque paire en une seule couleur : une case de palette qui ne se voit '
        + 'pas est une case perdue, et elle salit les dégradés.',
    })
  }

  /* --- 2. Pixels isoles : du bruit, jamais du detail --- */
  const isoles: { x: number; y: number }[] = []
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      const c = bm.u32[y * bm.width + x]
      if (getA(c) === 0) continue
      let pareils = 0, voisins = 0
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (!plein(bm, x + dx, y + dy)) continue
        voisins++
        if (bm.u32[(y + dy) * bm.width + (x + dx)] === c) pareils++
      }
      // Un pixel entoure de matiere mais d'aucune couleur pareille : il ne
      // fait partie d'aucune forme. Un oeil en fait partie — il touche un
      // autre oeil, ou il est sur le bord. Ce test ne prend que l'interieur.
      if (voisins === 4 && pareils === 0) isoles.push({ x, y })
    }
  }
  mesures.isoles = isoles.length
  // Trois pour cent, et six pixels au moins. En dessous, ce sont des yeux,
  // des reflets, des boutons : du detail voulu. Mesure sur les dessins du
  // depot — le personnage en a 1,6%, la mascotte 1,2%, un bruit fabrique 6,3%.
  if (isoles.length >= 6 && isoles.length > total * 0.03) {
    constats.push({
      id: 'bruit',
      gravite: 'important',
      quoi: `${isoles.length} pixels isolés au milieu des aplats (${(isoles.length / total * 100).toFixed(1)}%).`,
      quoiFaire: 'Les fondre dans la couleur qui les entoure, ou les relier à une forme. '
        + 'Un pixel seul se lit comme une poussière, pas comme un détail.',
      ou: isoles.slice(0, 20),
    })
  }

  /* --- 3. Transparence partielle : du pixel art n'en a pas --- */
  let flous = 0
  for (let i = 0; i < bm.u32.length; i++) {
    const a = getA(bm.u32[i])
    if (a > 0 && a < 250) flous++
  }
  mesures.flous = flous
  if (flous > total * 0.02) {
    constats.push({
      id: 'alpha',
      gravite: 'bloquant',
      quoi: `${flous} pixels à demi transparents (${(flous / total * 100).toFixed(1)}%).`,
      quoiFaire: 'Rendre l\'alpha franc : opaque ou rien. Un bord adouci est le signe '
        + 'd\'une image redimensionnée, et il épaissit la silhouette au rendu.',
    })
  }

  /* --- 4. Hors palette --- */
  if (opts.palette?.length) {
    const connues = new Set(opts.palette)
    const hors = couleurs.filter((c) => !connues.has(c))
    mesures.horsPalette = hors.length
    if (hors.length) {
      constats.push({
        id: 'palette',
        gravite: 'bloquant',
        quoi: `${hors.length} couleur(s) hors de la palette du projet : ${hors.slice(0, 4).map((c) => toHex(c)).join(', ')}`
          + (hors.length > 4 ? '…' : ''),
        quoiFaire: 'Les remplacer par la couleur la plus proche de la palette '
          + '(Sprite ▸ Accrocher à la palette).',
      })
    }
  }

  /* --- 5. Lisibilite : la silhouette tient-elle a mi-taille ? --- */
  const petite = moitie(bm)
  const morceauxGrand = morceaux(new Uint8Array(bm.u32.length).map((_, i) =>
    (getA(bm.u32[i]) !== 0 ? 1 : 0)), bm.width, bm.height, 3)
  const morceauxPetit = morceaux(petite.masque, petite.w, petite.h, 1)
  mesures.morceaux = morceauxGrand
  mesures.morceauxAMiTaille = morceauxPetit
  if (morceauxPetit > morceauxGrand) {
    constats.push({
      id: 'lisibilite',
      gravite: 'important',
      quoi: `La silhouette se casse en ${morceauxPetit} morceaux à mi-taille, contre `
        + `${morceauxGrand} à taille réelle.`,
      quoiFaire: 'Épaissir ce qui se détache — un membre d\'un pixel de large disparaît '
        + 'dès qu\'on réduit. Un sprite doit se lire à la moitié de sa taille.',
    })
  }
  if (opts.unSeulMorceau && morceauxGrand > 1) {
    constats.push({
      id: 'morcele',
      gravite: 'bloquant',
      quoi: `Le dessin est en ${morceauxGrand} morceaux séparés.`,
      quoiFaire: 'Les relier, ou les séparer en plusieurs sprites.',
    })
  }

  /* --- 6. Le contour : present, et tranchant --- */
  //
  // Deux defauts distincts, et la premiere version les melangeait en un seul
  // pourcentage illisible. Sur le personnage de demonstration elle annoncait
  // « 49% des bords ne tranchent pas » sans pouvoir nommer une seule couleur
  // fautive — parce que le probleme n'etait pas la couleur du trait, mais son
  // ABSENCE sur la moitie de la silhouette.
  const bord: number[] = []
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      if (!plein(bm, x, y)) continue
      if (plein(bm, x - 1, y) && plein(bm, x + 1, y)
        && plein(bm, x, y - 1) && plein(bm, x, y + 1)) continue
      bord.push(y * bm.width + x)
    }
  }
  // La couleur de trait : celle qui tient le plus de bord, si elle en tient
  // vraiment. Un dessin sans contour n'en a pas, et il faut le dire.
  const surLeBord = new Map<RGBA, number>()
  for (const i of bord) surLeBord.set(bm.u32[i], (surLeBord.get(bm.u32[i]) ?? 0) + 1)
  let trait: RGBA = 0
  let mieux = 0
  for (const [c, n] of surLeBord) if (n > mieux) { mieux = n; trait = c }
  const partCernee = bord.length ? mieux / bord.length : 1
  mesures.bord = bord.length
  mesures.cerne = Math.round(partCernee * 100)

  if (!estTuile && bord.length > 20 && partCernee < 0.7) {
    constats.push({
      id: 'contour-manquant',
      gravite: 'important',
      quoi: `${Math.round((1 - partCernee) * 100)}% du bord de la silhouette n'est pas cerné : `
        + `la couleur de trait la plus employée n'en tient que ${Math.round(partCernee * 100)}%.`,
      quoiFaire: 'Cerner toute la silhouette de la même couleur sombre. Un bord laissé '
        + 'en couleur de remplissage se dissout dès que le fond s\'éclaircit.',
    })
  }

  // Et quand il y a un trait, il doit trancher sur ce qu'il cerne.
  let contacts = 0, francs = 0
  for (const i of bord) {
    if (bm.u32[i] !== trait) continue
    const x = i % bm.width, y = (i / bm.width) | 0
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (!plein(bm, x + dx, y + dy)) continue
      const voisin = bm.u32[(y + dy) * bm.width + (x + dx)]
      if (voisin === trait) continue
      contacts++
      // `luminance` rend une valeur de 0 a 255. Quarante-cinq, c'est le saut
      // minimal qu'un oeil lit comme « un trait, puis autre chose ».
      if (Math.abs(luminance(voisin) - luminance(trait)) >= 45) francs++
    }
  }
  const partFranche = contacts ? francs / contacts : 1
  mesures.traitFranc = Math.round(partFranche * 100)
  if (!estTuile && contacts > 20 && partFranche < 0.6) {
    constats.push({
      id: 'contour-fade',
      gravite: 'important',
      quoi: `Le trait ne tranche que sur ${Math.round(partFranche * 100)}% de ce qu'il touche `
        + `(${toHex(trait)}).`,
      quoiFaire: 'Assombrir le trait, ou éclaircir les aplats qui le touchent : deux tons '
        + 'voisins collés l\'un à l\'autre se lisent comme une seule masse.',
    })
  }

  /* --- 7. Occupation du cadre --- */
  const occupation = (boite.w * boite.h) / (bm.width * bm.height)
  mesures.occupation = Math.round(occupation * 100)
  if (!estTuile && occupation < 0.25) {
    constats.push({
      id: 'cadre',
      gravite: 'remarque',
      quoi: `Le dessin n'occupe que ${Math.round(occupation * 100)}% de sa toile `
        + `(${boite.w}×${boite.h} sur ${bm.width}×${bm.height}).`,
      quoiFaire: 'Recadrer, ou agrandir le dessin : chaque pixel perdu au cadrage est '
        + 'un pixel de moins pour le lire en jeu.',
    })
  }

  /* --- 8. Aplats : une forme se lit, un grain non --- */
  //
  // La premiere version comptait les ruptures de couleur d'un pixel a l'autre.
  // Elle accusait tout : un sol de pierre moucherte, un personnage de vingt
  // pixels de large, une mascotte — de soixante-seize a quatre-vingt-quatorze
  // pour cent, alors qu'aucun n'est de la bouillie. A cette taille, presque
  // tout pixel touche une autre couleur ; la mesure ne mesurait que la
  // petitesse du dessin.
  //
  // Ce qui separe vraiment une forme d'un grain, c'est l'existence d'APLATS :
  // des groupes de meme couleur assez grands pour se voir. On compte donc la
  // part des pixels qui appartiennent a un groupe d'au moins quatre.
  const vus = new Uint8Array(bm.u32.length)
  let enAplats = 0
  let plusGrand = 0
  for (let depart = 0; depart < bm.u32.length; depart++) {
    if (vus[depart] || getA(bm.u32[depart]) === 0) continue
    const couleur = bm.u32[depart]
    const groupe: number[] = []
    const pile = [depart]
    vus[depart] = 1
    while (pile.length) {
      const i = pile.pop()!
      groupe.push(i)
      const x = i % bm.width, y = (i / bm.width) | 0
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= bm.width || yy >= bm.height) continue
        const j = yy * bm.width + xx
        if (vus[j] || bm.u32[j] !== couleur) continue
        vus[j] = 1
        pile.push(j)
      }
    }
    if (groupe.length >= 4) enAplats += groupe.length
    if (groupe.length > plusGrand) plusGrand = groupe.length
  }
  const partAplats = total ? enAplats / total : 0
  const partPlusGrand = total ? plusGrand / total : 0
  mesures.aplats = Math.round(partAplats * 100)
  mesures.plusGrandAplat = Math.round(partPlusGrand * 100)
  if (partAplats < 0.45) {
    constats.push({
      id: 'bouillie',
      gravite: 'important',
      quoi: `Seuls ${Math.round(partAplats * 100)}% des pixels appartiennent à un aplat `
        + 'de quatre pixels ou plus.',
      quoiFaire: 'Poser de vraies zones de couleur. En dessous de ce seuil, l\'œil ne voit '
        + 'plus de formes, seulement du grain.',
    })
  }
  // Le modele ne se mesure pas a la proprete des aplats — du bon pixel art en
  // est fait a cent pour cent — mais a leur NOMBRE. Un seul aplat qui couvre
  // presque tout, c'est une silhouette remplie au seau.
  if (!estTuile && total > 150 && partPlusGrand > 0.8) {
    constats.push({
      id: 'plat',
      gravite: 'remarque',
      quoi: `Un seul aplat couvre ${Math.round(partPlusGrand * 100)}% du dessin : aucun modelé.`,
      quoiFaire: 'Une ombre et une lumière suffisent à donner du volume. '
        + 'Assisté ▸ Ombrage automatique en pose une base.',
    })
  }

  /* --- 10. Le sprite contre le decor qui le portera --- */
  //
  // Un personnage se lit sur un fond, pas dans le vide. C'est le seul controle
  // qui regarde en dehors du dessin, et il a fallu qu'un critique le reclame :
  // le heros du donjon avait un pantalon a cinq unites de luminance de la
  // dalle, et il passait ses huit directions sans qu'une regle s'en emeuve.
  //
  // Ce qui se dissout, c'est une masse dans une masse. Deux precautions donc :
  //
  // - on ne retient du decor que ses aplats : une couleur qui couvre au moins
  //   un dixieme d'UNE tuile. Un accent de trois pixels sur une caisse n'avale
  //   personne, et le sol, lui, pave tout le niveau. La tuile est la bonne
  //   unite parce qu'on se tient sur une tuile a la fois : mesuree sur la
  //   reunion des tuiles, la dalle claire du donjon tombait a 6,9% et passait
  //   sous le seuil, alors qu'elle couvre 28% du sol.
  // - le trait du sprite est exclu. Il RESSEMBLE au trait du decor, et c'est
  //   voulu — c'est ce qui fait qu'ils appartiennent au meme jeu. Un trait ne
  //   dissout rien : il est mince, et bien plus sombre que tout le reste.
  if (!estTuile && opts.decor?.length) {
    const aplats = new Set<RGBA>()
    for (const tuile of opts.decor) {
      const surTuile = new Map<RGBA, number>()
      let n = 0
      for (let i = 0; i < tuile.u32.length; i++) {
        const c = tuile.u32[i]
        if (getA(c) === 0) continue
        surTuile.set(c, (surTuile.get(c) ?? 0) + 1)
        n++
      }
      for (const [c, k] of surTuile) if (k >= n * 0.1) aplats.add(c)
    }
    const aplatsDuDecor = [...aplats]

    let enDanger = 0
    const coupables: string[] = []
    for (const [c, n] of compte) {
      if (getA(c) === 0 || c === trait) continue
      let pire: { d: number; dl: number; f: RGBA } | null = null
      for (const f of aplatsDuDecor) {
        const d = distance(c, f)
        const dl = Math.abs(luminance(c) - luminance(f))
        // Se confondre, c'est etre proche ET porter la meme valeur : c'est la
        // valeur qui decide de ce qu'on distingue a distance, pas la teinte.
        if (d < 40 && dl < 12 && (!pire || d < pire.d)) pire = { d, dl, f }
      }
      if (!pire) continue
      enDanger += n
      if (coupables.length < 3) {
        coupables.push(`${toHex(c)} (${n} px) contre ${toHex(pire.f)} `
          + `— écart ${pire.d}, valeur ${Math.round(pire.dl)}`)
      }
    }
    const part = total ? enDanger / total : 0
    mesures.confonduAvecDecor = Math.round(part * 100)
    if (part > 0.1) {
      constats.push({
        id: 'fond-confondu',
        gravite: 'important',
        quoi: `${Math.round(part * 100)}% du sprite porte la couleur d'un aplat du décor : `
          + coupables.join(' ; '),
        quoiFaire: 'Écarter ces couleurs de celles du décor — par la teinte plutôt que '
          + 'par la valeur, si le dessin doit rester dans cette gamme. Un personnage '
          + 'qui partage la valeur de sa dalle disparaît en jeu.',
      })
    }
  }

  return { constats, mesures, passe: !constats.some((c) => c.gravite === 'bloquant') }
}

/** Le rapport en texte, pour une console, un banc, ou un agent qui juge. */
export function enTexte(r: Rapport): string {
  const lignes = [`${r.mesures.largeur}×${r.mesures.hauteur}, ${r.mesures.pixels} pixels, `
    + `${r.mesures.couleurs} couleurs`]
  if (!r.constats.length) return `${lignes[0]}\n  Rien à signaler.`
  for (const c of r.constats) {
    lignes.push(`  [${c.gravite}] ${c.quoi}`)
    if (c.quoiFaire) lignes.push(`      → ${c.quoiFaire}`)
  }
  return lignes.join('\n')
}
