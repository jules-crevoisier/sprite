/**
 * Les FONTES du pixel art : des glyphes dessinés, jamais une police du système.
 *
 * ## Pourquoi pas `fillText`
 *
 * Une police du système donne du texte ANTICRÉNELÉ — gris sur les bords —
 * dans un dessin où chaque pixel est une couleur choisie. Agrandi huit fois,
 * la différence ne se discute pas : l'un appartient au dessin, l'autre est
 * posé dessus. Et une police du système n'est pas la même partout : un texte
 * cadré au pixel près chez soi déborde chez quelqu'un d'autre.
 *
 * ## La forme des données
 *
 * Un glyphe par ligne, ses rangées séparées par une barre. C'est fait pour le
 * DIFF : quand un pixel bouge, on voit lequel, dans quelle lettre. Une fonte
 * encodée en nombres serait plus courte et illisible à la relecture — et une
 * fonte se relit, parce qu'une lettre mal dessinée ne se découvre qu'à l'œil.
 *
 * ## Les accents ne sont pas une option
 *
 * Le projet est en français. Une fonte sans « é » oblige à écrire « eleve », et
 * l'on finit par tout écrire sans accents « parce que la fonte ne les a pas ».
 * Ils sont là dès le premier jour, capitales comprises.
 */

export interface Fonte {
  id: string
  nom: string
  /**
   * Largeur de reference et hauteur d'un glyphe, en pixels.
   *
   * La hauteur vaut pour tous les glyphes : une lettre plus courte que les
   * autres ferait sautiller la ligne de base. La largeur, elle, n'est qu'une
   * valeur de repli — celle du curseur, celle du rectangle d'inconnu. Chaque
   * glyphe porte la sienne : voir `largeurGlyphe`.
   */
  l: number
  h: number
  /** Espace entre deux lettres, et entre deux lignes. */
  chasse: number
  interligne: number
  /** Les glyphes, par caractere. */
  dessins: Record<string, string>
  /**
   * Les minuscules n'existent pas : on les rend en capitales.
   *
   * C'est le cas des tres petites fontes — en trois pixels de large, une
   * minuscule a jambage n'est pas dessinable. Mieux vaut le dire ici que
   * laisser un texte se remplir de rectangles d'inconnus.
   */
  sansMinuscules?: boolean
  /**
   * Les accents tombent : « É » se rend « E ».
   *
   * On ne le fait que pour la fonte de cinq rangees, et parce que l'essai a
   * ete fait : un accent pose sur la rangee du dessus TOUCHE la lettre, faute
   * d'une rangee vide entre les deux, et « É » devient une tache qu'on ne
   * relit pas. Perdre l'accent garde le mot lisible ; le coller le detruit.
   * Pour du texte accentue, la fonte de sept rangees a la place qu'il faut.
   */
  sansAccents?: boolean
}

const CINQ_SEPT: Record<string, string> = {
  'A': '.###.|#...#|#...#|#####|#...#|#...#|.....',
  'B': '####.|#...#|####.|#...#|#...#|####.|.....',
  'C': '.####|#....|#....|#....|#....|.####|.....',
  'D': '####.|#...#|#...#|#...#|#...#|####.|.....',
  'E': '#####|#....|####.|#....|#....|#####|.....',
  'F': '#####|#....|####.|#....|#....|#....|.....',
  'G': '.####|#....|#..##|#...#|#...#|.####|.....',
  'H': '#...#|#...#|#####|#...#|#...#|#...#|.....',
  'I': '#####|..#..|..#..|..#..|..#..|#####|.....',
  'J': '....#|....#|....#|....#|#...#|.###.|.....',
  'K': '#...#|#..#.|###..|#..#.|#...#|#...#|.....',
  'L': '#....|#....|#....|#....|#....|#####|.....',
  'M': '#...#|##.##|#.#.#|#...#|#...#|#...#|.....',
  'N': '#...#|##..#|#.#.#|#..##|#...#|#...#|.....',
  'O': '.###.|#...#|#...#|#...#|#...#|.###.|.....',
  'P': '####.|#...#|####.|#....|#....|#....|.....',
  'Q': '.###.|#...#|#...#|#.#.#|#..#.|.##.#|.....',
  'R': '####.|#...#|####.|#..#.|#...#|#...#|.....',
  'S': '.####|#....|.###.|....#|....#|####.|.....',
  'T': '#####|..#..|..#..|..#..|..#..|..#..|.....',
  'U': '#...#|#...#|#...#|#...#|#...#|.###.|.....',
  'V': '#...#|#...#|#...#|#...#|.#.#.|..#..|.....',
  'W': '#...#|#...#|#...#|#.#.#|##.##|#...#|.....',
  'X': '#...#|.#.#.|..#..|..#..|.#.#.|#...#|.....',
  'Y': '#...#|.#.#.|..#..|..#..|..#..|..#..|.....',
  'Z': '#####|....#|...#.|..#..|.#...|#####|.....',
  'a': '.....|.###.|....#|.####|#...#|.####|.....',
  'b': '#....|#....|####.|#...#|#...#|####.|.....',
  'c': '.....|.####|#....|#....|#....|.####|.....',
  'd': '....#|....#|.####|#...#|#...#|.####|.....',
  'e': '.....|.###.|#...#|#####|#....|.###.|.....',
  'f': '..##.|.#...|####.|.#...|.#...|.#...|.....',
  'g': '.....|.####|#...#|#...#|.####|....#|.###.',
  'h': '#....|#....|####.|#...#|#...#|#...#|.....',
  'i': '..#..|.....|.##..|..#..|..#..|.###.|.....',
  'j': '...#.|.....|..##.|...#.|...#.|#..#.|.##..',
  'k': '#....|#..#.|#.#..|##...|#.#..|#..#.|.....',
  'l': '.##..|..#..|..#..|..#..|..#..|.###.|.....',
  'm': '.....|##.#.|#.#.#|#.#.#|#...#|#...#|.....',
  'n': '.....|####.|#...#|#...#|#...#|#...#|.....',
  'o': '.....|.###.|#...#|#...#|#...#|.###.|.....',
  'p': '.....|####.|#...#|#...#|####.|#....|#....',
  'q': '.....|.####|#...#|#...#|.####|....#|....#',
  'r': '.....|#.##.|##...|#....|#....|#....|.....',
  's': '.....|.####|#....|.###.|....#|####.|.....',
  't': '.#...|.#...|####.|.#...|.#...|..##.|.....',
  'u': '.....|#...#|#...#|#...#|#..##|.##.#|.....',
  'v': '.....|#...#|#...#|#...#|.#.#.|..#..|.....',
  'w': '.....|#...#|#...#|#.#.#|##.##|#...#|.....',
  'x': '.....|#...#|.#.#.|..#..|.#.#.|#...#|.....',
  'y': '.....|#...#|#...#|#...#|.####|....#|.###.',
  'z': '.....|#####|...#.|..#..|.#...|#####|.....',
  '0': '.###.|#..##|#.#.#|##..#|#...#|.###.|.....',
  '1': '..#..|.##..|..#..|..#..|..#..|.###.|.....',
  '2': '.###.|#...#|...#.|..#..|.#...|#####|.....',
  '3': '####.|....#|.###.|....#|....#|####.|.....',
  '4': '#..#.|#..#.|#..#.|#####|...#.|...#.|.....',
  '5': '#####|#....|####.|....#|....#|####.|.....',
  '6': '.###.|#....|####.|#...#|#...#|.###.|.....',
  '7': '#####|....#|...#.|..#..|..#..|..#..|.....',
  '8': '.###.|#...#|.###.|#...#|#...#|.###.|.....',
  '9': '.###.|#...#|#...#|.####|....#|.###.|.....',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|..#..|.....',
  ',': '.....|.....|.....|.....|..#..|..#..|.#...',
  ':': '.....|..#..|.....|.....|..#..|.....|.....',
  ';': '.....|..#..|.....|.....|..#..|..#..|.#...',
  '!': '..#..|..#..|..#..|..#..|.....|..#..|.....',
  '?': '.###.|#...#|...#.|..#..|.....|..#..|.....',
  '\'': '..#..|..#..|.....|.....|.....|.....|.....',
  '’': '..#..|..#..|.....|.....|.....|.....|.....',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '_': '.....|.....|.....|.....|.....|.....|#####',
  '(': '...#.|..#..|..#..|..#..|..#..|...#.|.....',
  ')': '.#...|..#..|..#..|..#..|..#..|.#...|.....',
  '«': '.....|..#.#|.#.#.|#.#..|.#.#.|..#.#|.....',
  '»': '.....|#.#..|.#.#.|..#.#|.#.#.|#.#..|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '=': '.....|.....|#####|.....|#####|.....|.....',
  '/': '....#|...#.|..#..|..#..|.#...|#....|.....',
  '%': '#...#|...#.|..#..|..#..|.#...|#...#|.....',
  '*': '.....|.#.#.|..#..|#####|..#..|.#.#.|.....',
  'É': '..##.|.....|#####|#....|####.|#####|.....',
  'È': '.##..|.....|#####|#....|####.|#####|.....',
  'Ê': '..#..|.#.#.|#####|#....|####.|#####|.....',
  'À': '.##..|.....|.###.|#...#|#####|#...#|.....',
  'Â': '..#..|.#.#.|.###.|#...#|#####|#...#|.....',
  'Ç': '.####|#....|#....|#....|.####|..#..|..##.',
  'Ù': '.##..|.....|#...#|#...#|#...#|.###.|.....',
  'Û': '..#..|.#.#.|#...#|#...#|#...#|.###.|.....',
  'Î': '..#..|.#.#.|#####|..#..|..#..|#####|.....',
  'Ô': '..#..|.#.#.|.###.|#...#|#...#|.###.|.....',
  'é': '..#..|.#...|.###.|#####|#....|.###.|.....',
  'è': '.#...|..#..|.###.|#####|#....|.###.|.....',
  'ê': '..#..|.#.#.|.###.|#####|#....|.###.|.....',
  'ë': '.#.#.|.....|.###.|#####|#....|.###.|.....',
  'à': '.#...|..#..|.###.|....#|.####|.####|.....',
  'â': '..#..|.#.#.|.###.|....#|.####|.####|.....',
  'ç': '.....|.####|#....|#....|.####|..#..|..##.',
  'ù': '.#...|..#..|#...#|#...#|#..##|.##.#|.....',
  'û': '..#..|.#.#.|#...#|#...#|#..##|.##.#|.....',
  'î': '..#..|.#.#.|.##..|..#..|..#..|.###.|.....',
  'ï': '.#.#.|.....|.##..|..#..|..#..|.###.|.....',
  'ô': '..#..|.#.#.|.###.|#...#|#...#|.###.|.....',
  'œ': '.....|.##.#|#..##|####.|#..##|.##.#|.....',
  '>': '#....|.#...|..#..|...#.|..#..|.#...|#....',
  '<': '....#|...#.|..#..|.#...|..#..|...#.|....#',
  '"': '.#.#.|.#.#.|.....|.....|.....|.....|.....',
  '#': '.#.#.|#####|.#.#.|#####|.#.#.|.....|.....',
  '&': '.##..|#..#.|.##..|#.#.#|#..#.|.##.#|.....',
  '@': '.###.|#...#|#.###|#.#.#|#....|.###.|.....',
  '$': '..#..|.####|#.#..|.###.|..#.#|####.|..#..',
  '[': '..##.|..#..|..#..|..#..|..#..|..##.|.....',
  ']': '.##..|..#..|..#..|..#..|..#..|.##..|.....',
  '{': '...##|..#..|.##..|..#..|..#..|...##|.....',
  '}': '##...|..#..|..##.|..#..|..#..|##...|.....',
  '|': '..#..|..#..|..#..|..#..|..#..|..#..|.....',
  '\\': '#....|.#...|..#..|..#..|...#.|....#|.....',
  '^': '..#..|.#.#.|#...#|.....|.....|.....|.....',
  '~': '.....|.##.#|#..#.|.....|.....|.....|.....',
  '`': '.#...|..#..|.....|.....|.....|.....|.....',
  '°': '.##..|#..#.|.##..|.....|.....|.....|.....',
  '€': '..###|.#...|####.|.#...|####.|..###|.....',
  '…': '.....|.....|.....|.....|.....|#.#.#|.....',
  '–': '.....|.....|.....|#####|.....|.....|.....',
  '·': '.....|.....|.....|..#..|.....|.....|.....',
  '×': '.....|#...#|.#.#.|..#..|.#.#.|#...#|.....',
}
/**
 * TROIS SUR CINQ : la plus petite fonte lisible.
 *
 * Capitales seulement — en trois pixels de large, une minuscule a jambage
 * n'est pas dessinable, et pretendre le contraire donnerait des taches. Les
 * minuscules tapees sortent donc en capitales : c'est ce que faisaient les
 * jeux de l'epoque, par la meme contrainte.
 *
 * ## Pourquoi M et W sont plus larges que les autres
 *
 * Trois colonnes ne contiennent pas un M : le seul dessin possible est un H
 * avec une barre deplacee d'une rangee, et MAMAN se lit HAHAN — verifie a
 * l'oeil avant d'ecrire ces lignes. Plutot que de garder une fonte carree et
 * fausse, ces deux lettres prennent cinq colonnes ; le I et le 1 en prennent
 * une, ce qui rend a la ligne la place que M vient de lui couter.
 */
const TROIS_CINQ: Record<string, string> = {
  'A': '.#.|#.#|###|#.#|#.#',
  'B': '##.|#.#|##.|#.#|##.',
  'C': '.##|#..|#..|#..|.##',
  'D': '##.|#.#|#.#|#.#|##.',
  'E': '###|#..|##.|#..|###',
  'F': '###|#..|##.|#..|#..',
  'G': '.##|#..|#.#|#.#|.##',
  'H': '#.#|#.#|###|#.#|#.#',
  'I': '#|#|#|#|#',
  'J': '..#|..#|..#|#.#|.#.',
  'K': '#.#|#.#|##.|#.#|#.#',
  'L': '#..|#..|#..|#..|###',
  // M et W tiennent sur CINQ colonnes, pas trois. Voir la note de la fonte :
  // en trois colonnes, MAMAN se lit HAHAN.
  'M': '#...#|##.##|#.#.#|#...#|#...#',
  'N': '##.|#.#|#.#|#.#|#.#',
  'O': '.#.|#.#|#.#|#.#|.#.',
  'P': '##.|#.#|##.|#..|#..',
  'Q': '.#.|#.#|#.#|.#.|..#',
  'R': '##.|#.#|##.|#.#|#.#',
  'S': '.##|#..|.#.|..#|##.',
  'T': '###|.#.|.#.|.#.|.#.',
  'U': '#.#|#.#|#.#|#.#|###',
  'V': '#.#|#.#|#.#|#.#|.#.',
  'W': '#...#|#...#|#.#.#|#.#.#|.#.#.',
  'X': '#.#|#.#|.#.|#.#|#.#',
  'Y': '#.#|#.#|.#.|.#.|.#.',
  'Z': '###|..#|.#.|#..|###',
  '0': '###|#.#|#.#|#.#|###',
  '1': '.#|##|.#|.#|.#',
  '2': '##.|..#|.#.|#..|###',
  '3': '##.|..#|.#.|..#|##.',
  '4': '#.#|#.#|###|..#|..#',
  '5': '###|#..|##.|..#|##.',
  '6': '###|#..|###|#.#|###',
  '7': '###|..#|.#.|.#.|.#.',
  '8': '###|#.#|###|#.#|###',
  '9': '###|#.#|###|..#|###',
  ' ': '..|..|..|..|..',
  '.': '.|.|.|.|#',
  ',': '.|.|.|#|#',
  ':': '.|#|.|#|.',
  ';': '.|#|.|#|#',
  '!': '#|#|#|.|#',
  '?': '##.|..#|.#.|...|.#.',
  "'": '#|#|.|.|.',
  '-': '...|...|###|...|...',
  '+': '...|.#.|###|.#.|...',
  '=': '...|###|...|###|...',
  '/': '..#|..#|.#.|#..|#..',
  '\\': '#..|#..|.#.|..#|..#',
  '(': '.#|#.|#.|#.|.#',
  ')': '#.|.#|.#|.#|#.',
  '*': '...|#.#|.#.|#.#|...',
  '<': '..#|.#.|#..|.#.|..#',
  '>': '#..|.#.|..#|.#.|#..',
  '_': '...|...|...|...|###',
  '"': '#.#|#.#|...|...|...',
  '%': '#.#|..#|.#.|#..|#.#',
  '#': '#.#|###|#.#|###|#.#',
  '\u2026': '.....|.....|.....|.....|#.#.#',
}


/** Les fontes proposées, dans l'ordre où elles apparaissent. */
export const FONTES: Fonte[] = [
  {
    id: 'cinq-sept',
    nom: '5×7 — deux casses, accents',
    l: 5, h: 7, chasse: 1, interligne: 2,
    dessins: CINQ_SEPT,
  },
  {
    id: 'trois-cinq',
    nom: '3×5 — capitales, sans accents',
    l: 3, h: 5, chasse: 1, interligne: 2,
    dessins: TROIS_CINQ,
    sansMinuscules: true,
    sansAccents: true,
  },
]

export function fonteParId(id: string): Fonte {
  return FONTES.find((f) => f.id === id) ?? FONTES[0]
}

/**
 * Le glyphe d'un caractère, en rangées de pixels.
 *
 * Un caractère inconnu rend un rectangle plein. On pourrait rendre un espace,
 * et c'est le mauvais choix : un texte où les caractères manquants
 * DISPARAISSENT se lit presque normalement, et l'on garde son dessin sans
 * avoir vu que la moitié d'un mot manquait. Un rectangle se remarque à la
 * première lecture.
 */
export function glyphe(f: Fonte, c: string): string[] {
  const direct = f.dessins[c]
  if (direct) return direct.split('|')
  if (f.sansMinuscules) {
    const haut = f.dessins[c.toUpperCase()]
    if (haut) return haut.split('|')
  }
  if (f.sansAccents) {
    const nu = sansAccent(c)
    const replie = f.dessins[nu]
      ?? (f.sansMinuscules ? f.dessins[nu.toUpperCase()] : undefined)
    if (replie) return replie.split('|')
  }
  return Array.from({ length: f.h }, () => '#'.repeat(f.l))
}

/**
 * « É » sans son accent.
 *
 * On décompose puis l'on jette les diacritiques, plutôt que de tenir une
 * table : une table oublie toujours un caractère, et c'est celui que
 * quelqu'un tapera. Les ligatures — « œ » — ne se décomposent pas et restent
 * inconnues : elles valent deux lettres, et un glyphe n'en rend qu'une. Elles
 * sortiront en rectangle, ce qui se voit.
 */
function sansAccent(c: string): string {
  return c.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * La largeur d'un glyphe, en pixels.
 *
 * Elle se lit dans le dessin lui-même : la première rangée dit combien de
 * colonnes la lettre occupe. Rien à tenir à jour à côté — un glyphe élargi
 * l'est partout du seul fait qu'on a rallongé ses rangées.
 */
export function largeurGlyphe(f: Fonte, c: string): number {
  return glyphe(f, c)[0]?.length ?? f.l
}

/** Largeur d'une ligne, en pixels, chasse comprise. */
export function largeurLigne(f: Fonte, ligne: string): number {
  const lettres = [...ligne]
  if (!lettres.length) return 0
  let large = -f.chasse
  for (const c of lettres) large += largeurGlyphe(f, c) + f.chasse
  return large
}

export interface PoseTexte {
  /** Échelle entière : ×2 double chaque pixel, sans jamais interpoler. */
  echelle: number
  /** Alignement des lignes les unes par rapport aux autres. */
  alignement: 'gauche' | 'centre' | 'droite'
}

/** L'échelle telle qu'on la respecte : entière, et au moins un. */
export function echelleDe(pose: PoseTexte): number {
  return Math.max(1, Math.round(pose.echelle))
}

/** Les lignes d'un texte, et la boîte qu'il occupe une fois posé. */
export function mesurerTexte(
  f: Fonte, texte: string, pose: PoseTexte,
): { lignes: string[]; l: number; h: number } {
  const lignes = texte.split('\n')
  const e = echelleDe(pose)
  const large = Math.max(0, ...lignes.map((q) => largeurLigne(f, q)))
  const haut = lignes.length * f.h + (lignes.length - 1) * f.interligne
  return { lignes, l: large * e, h: haut * e }
}

/**
 * Les pixels d'un texte, en coordonnées relatives au point d'ancrage.
 *
 * Rendre des POINTS et non un bitmap : l'appelant les pose lui-même, avec sa
 * couleur, dans le calque qu'il veut, et l'aperçu les dessine sans rien
 * graver. Un bitmap intermédiaire obligerait à choisir une couleur et une
 * taille avant de savoir où le texte va.
 */
export function pixelsDeTexte(
  f: Fonte, texte: string, pose: PoseTexte,
): { x: number; y: number }[] {
  const { lignes, l } = mesurerTexte(f, texte, pose)
  const e = echelleDe(pose)
  const out: { x: number; y: number }[] = []
  lignes.forEach((ligne, rang) => {
    const largeur = largeurLigne(f, ligne) * e
    const decalage = pose.alignement === 'centre'
      ? Math.floor((l - largeur) / 2)
      : pose.alignement === 'droite' ? l - largeur : 0
    const y0 = rang * (f.h + f.interligne) * e
    let x0 = decalage
    for (const c of [...ligne]) {
      const g = glyphe(f, c)
      const large = g[0]?.length ?? f.l
      for (let y = 0; y < f.h; y++) {
        const rangee = g[y] ?? ''
        for (let x = 0; x < large; x++) {
          if (rangee[x] !== '#') continue
          // L'échelle DUPLIQUE les pixels : c'est la seule façon d'agrandir
          // du pixel art. Un agrandissement interpolé inventerait des demi-
          // teintes, ce que tout l'éditeur refuse par ailleurs.
          for (let dy = 0; dy < e; dy++) {
            for (let dx = 0; dx < e; dx++) {
              out.push({ x: x0 + x * e + dx, y: y0 + y * e + dy })
            }
          }
        }
      }
      x0 += (large + f.chasse) * e
    }
  })
  return out
}
