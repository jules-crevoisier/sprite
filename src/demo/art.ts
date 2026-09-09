import { Bitmap } from '../core/bitmap'
import { fromHex } from '../core/color'

/**
 * Les dessins de la demonstration, en lettres.
 *
 * Meme convention que les mascottes : une lettre est une couleur, le point
 * est transparent. Deux differences, apprises a l'usage :
 *
 * - les lignes n'ont pas besoin de faire la largeur exacte de la toile. Le
 *   commentaire de `mascots.ts` previent qu'une ligne trop courte decale tout
 *   ce qui suit ; ici on complete a la volee, ce qui enleve le piege plutot
 *   que de le signaler ;
 * - le dessin est centre horizontalement dans sa toile, pour qu'un sprite se
 *   retrouve au milieu de sa case sans qu'on ait a compter les points.
 */

export type Palette = Record<string, string>

export interface Dessin {
  largeur: number
  hauteur: number
  palette: Palette
  lignes: string[]
}

/** Rend un dessin en bitmap, centre dans sa toile. */
export function bitmapDe(d: Dessin): Bitmap {
  const bm = new Bitmap(d.largeur, d.hauteur)
  const large = Math.max(...d.lignes.map((l) => l.length))
  const ox = Math.floor((d.largeur - large) / 2)
  const oy = Math.floor((d.hauteur - d.lignes.length) / 2)
  for (let y = 0; y < d.lignes.length; y++) {
    const ligne = d.lignes[y]
    for (let x = 0; x < ligne.length; x++) {
      const lettre = ligne[x]
      // Le point est le vide voulu. Toute autre lettre absente de la palette
      // est une faute de frappe, et la passer sous silence laisse un trou
      // transparent que personne ne voit : un `c` cyrillique U+0441 s'etait
      // ainsi glisse dans la caisse du donjon. On refuse plutot que de dessiner
      // un dessin qui n'est pas celui qui est ecrit.
      if (lettre === '.') continue
      const hex = d.palette[lettre]
      if (!hex) {
        const point = lettre.codePointAt(0)?.toString(16).padStart(4, '0').toUpperCase()
        throw new Error(`bitmapDe : la lettre « ${lettre} » (U+${point}) `
          + `ligne ${y} ne figure pas dans la palette`)
      }
      const px = ox + x, py = oy + y
      if (px < 0 || py < 0 || px >= d.largeur || py >= d.hauteur) continue
      bm.set(px, py, fromHex(hex))
    }
  }
  return bm
}

/* ------------------------------------------------------------------ */
/* Le heros                                                            */
/* ------------------------------------------------------------------ */

/**
 * Palette du heros, revue sur deux tours de critique.
 *
 * Tour 1 : `m` etait declare et employe zero fois ; `y` achetait deux pixels
 * pour seize unites d'ecart avec le contour ; le pantalon etait a luminance 57
 * quand le sol du donjon est a 59 — le personnage etait peint couleur du decor
 * et son quart inferieur s'y dissolvait ; la chemise n'avait pas de cote a
 * l'ombre, `T` etait pose des DEUX cotes du torse.
 *
 * Tour 2 : la ceinture (#7a4a22) et les cheveux (#8a4b2a) etaient a vingt-cinq
 * unites de distance mais a six de luminance — le meme brun a l'ecran, et une
 * case payee pour rien. La ceinture est franchement assombrie. Et les jambes
 * n'avaient que deux tons quand le torse en avait trois : `q` leur donne leur
 * cote a l'ombre.
 *
 * Rectification d'un chiffre annonce a tort au tour 1 : `m` ne bouche pas le
 * trou de la rampe, il le deplace — 137 puis 150 puis 194, l'ecart de
 * quarante-quatre entre l'ombre de peau et la peau reste le plus grand de la
 * rampe. C'est un choix defendable, une peau n'a que deux tons ici, mais ce
 * n'est pas ce qui avait ete dit.
 */
const PAL_HEROS: Palette = {
  o: '#1a1420',
  h: '#8f3f2a',
  H: '#c05f38',
  s: '#e8b892',
  m: '#c08a63',
  t: '#3f6fb5',
  T: '#5a90dd',
  u: '#2c4f85',
  b: '#5a3418',
  p: '#46536f',
  P: '#5e6d8c',
  q: '#1f3468',
  B: '#2e2018',
  A: '#dce6f0',
  a: '#8b9cb0',
}

/**
 * Le heros, apres trois tours de critique.
 *
 * ## Ce que le tour 2 a repris au tour 1
 *
 * La separation des bras avait ete faite en contour — opaque. Dans une
 * silhouette, une couleur opaque ne separe rien : le torse restait un bloc
 * plein, exactement comme avant. Pire, l'ecart entre les jambes avait ete
 * bouche au passage : le seul evenement de silhouette que le sprite possedait
 * avait disparu. Il est rouvert, et sur deux pixels, parce qu'un vide d'un
 * seul ne survit pas a la compression a soixante pour cent que fait la
 * generation des huit directions.
 *
 * La tete etait decentree d'une colonne : onze de large sur un corps de douze,
 * centre a 8,0 quand tout le reste est a 7,5. Le miroir de `vues.ts` se fait
 * autour d'un axe fixe, donc entre la vue de gauche et celle de droite la tete
 * sautait d'un pixel sur un corps immobile. Elle fait maintenant dix de large,
 * centree comme le corps, et les epaules la debordent d'UNE colonne de chaque
 * cote. La version precedente de ce commentaire disait « deux pixels au lieu
 * d'un » sans dire de quoi, ce qui se lisait par cote : c'est deux au total.
 *
 * ## Ce que le tour 3 a repris au tour 2
 *
 * Le tour 3 a d'abord rendu une planche identique a celle du tour 2, au
 * pixel pres, presentee comme un progres. Le critique l'a vu au md5. Les
 * corrections ci-dessous sont les vraies.
 *
 * Les bras ne se distinguaient pas du torse. Chacun portait EXACTEMENT la
 * couleur de la colonne de torse qu'il touche — `T` contre `T` a gauche, `u`
 * contre `u` a droite — separes par une seule colonne de contour, c'est-a-dire
 * par ce que la compression ravale en premier. Le commentaire ci-dessous
 * refusait le vide en promettant que les bras se liraient « par la couleur » :
 * la promesse n'etait pas tenue. Elle l'est maintenant, a largeur constante et
 * sans couleur ajoutee : le torse va de `t` a `u` en passant par sa haute
 * lumiere `T`, et chaque bras tranche d'une trentaine d'unites sur la colonne
 * qu'il touche.
 *
 * Les cheveux n'etaient remis a l'endroit qu'au sommet du crane : la tempe
 * gauche, du cote eclaire, restait au ton sombre, et les deux tempes avaient
 * la meme valeur. La gauche passe au ton clair.
 *
 * Les cheveux, enfin, etaient de la couleur des caisses du donjon — quinze
 * unites d'ecart — et les bottes de celle du bois sombre des portes. Les uns
 * virent a l'auburn, les autres s'assombrissent. Ce n'est pas un jugement de
 * gout : c'est la regle `fond-confondu` qui l'a chiffre.
 *
 * ## Ce que le tour 4 a repris au tour 3
 *
 * Le bras droit etait eclaire a l'envers : `t` a 106 contre une colonne de
 * torse `u` a 75, c'est-a-dire, du cote a l'ombre, un plan exterieur plus
 * clair que le plan tourne vers la lumiere. La separation des bras du tour 3
 * avait ete payee par une inversion d'eclairage. `q` devient un bleu franc a
 * 51 et prend le bras : vingt-quatre unites plus sombre que ce qu'il touche.
 *
 * Les bottes ne tenaient que sur un rang, votaient contre le rang de contour
 * d'en dessous et disparaissaient entierement a mi-taille. Elles en occupent
 * deux, prises sur un rang de jambe.
 *
 * La jambe droite etait un bloc plein d'un seul ton, et ce ton avait
 * exactement la valeur de la dalle claire du donjon — elle ne s'en separait
 * que par la teinte, ce que `fond-confondu` declare insuffisant. Chaque jambe
 * a maintenant son propre degrade.
 *
 * ## Deux reductions a ne pas confondre
 *
 * Un vide de deux pixels survit a la COMPRESSION A SOIXANTE POUR CENT qui
 * fabrique les huit directions. Il ne survit pas au VOTE DE MI-TAILLE de la
 * planche : il tombe a cheval sur deux cellules de vote, qui recoivent chacune
 * un pixel de vide contre un de remplissage. Pour qu'il tienne il faudrait le
 * caler sur une cellule, ce qu'un interieur de six colonnes ne permet pas sans
 * des jambes de largeur inegale. Les deux reductions ont longtemps ete
 * confondues dans ce commentaire.
 *
 * ## Ce que le tour 6 a change : le budget de largeur
 *
 * Cinq tours de critique ont corrige tout ce qui se corrigeait a douze
 * colonnes. Il restait un defaut qu'aucun ne pouvait atteindre : rien dans ce
 * sprite ne disait « heros de donjon » plutot que « villageois ». Pas d'arme,
 * pas de capuche, et la seule surface libre — le rang de la ceinture — ne
 * pouvait rien porter : une boucle de deux pixels y creuse un trou au vote de
 * mi-taille, chaque cellule tombant a un pixel sur quatre.
 *
 * La conclusion etait donc que l'identite ne peut pas venir de la palette ni
 * du detail a cette taille : elle vient de la silhouette, et la silhouette
 * demande de la largeur. Le budget est rouvert : dix-sept colonnes au lieu de
 * douze, une epee tenue au poing droit.
 *
 * La lame fait deux colonnes d'acier entre deux colonnes de contour. Deux, et
 * pas une : a une colonne, elle perd le vote de mi-taille contre ses propres
 * contours et l'arme se reduit a un baton noir. Ces deux colonnes sont calees
 * sur une cellule de vote, si bien que l'acier survit a la reduction.
 *
 * Au-dessus des epaules, deux colonnes de vide separent la lame de la tete :
 * c'est ce qu'il faut pour survivre a la compression a soixante pour cent, et
 * c'est la que se joue l'evenement de silhouette. Plus bas, la lame longe le
 * corps et le vide tombe a une colonne : elle s'y confond avec le contour a la
 * rotation, ce qui est aussi ce qu'on voit d'une epee tenue contre soi.
 *
 * Les bras restent attaches. Les detacher demanderait dix-huit colonnes pour
 * le seul corps, et vingt-deux avec l'epee — un personnage aussi large que
 * haut. Entre les deux depenses possibles, l'arme achete l'identite, que rien
 * d'autre ne pouvait acheter, quand le vide entre bras et torse n'aurait
 * achete qu'une redite de ce que la couleur fait deja.
 *
 * ## Ce que le tour 7 a repris au tour 6
 *
 * L'epee n'etait pas tenue. Le poing droit etait en colonne 11, la poignee en
 * colonnes 16-17, et entre les deux : un contour, deux colonnes vides, un
 * contour. Le seul contact entre l'arme et le corps etait la garde qui butait
 * contre le torse a hauteur de ceinture, dans le meme brun que la ceinture et
 * sur la meme rangee — a mi-taille les deux formaient une seule barre brune
 * traversante, qui se lisait comme une echarpe. Ce n'etait pas une epee tenue,
 * c'etait une epee glissee dans le ceinturon.
 *
 * L'avant-bras sort maintenant du torse et porte le poing jusqu'a la fusee,
 * sous la garde. Il fait trois rangs et non deux : a deux, le pont bras-epee
 * ne survit pas a la compression du profil, et le verificateur voyait la
 * silhouette se casser en deux morceaux — l'epee d'un cote, le personnage de
 * l'autre.
 *
 * Et le vide entre la lame et la tete ne survivait pas non plus. J'avais cale
 * l'acier sur la grille de vote et laisse le vide a cheval dessus : ses deux
 * colonnes tombaient sur deux cellules differentes, chacune remportee par le
 * contour qu'elle touchait, et a mi-taille la lame etait SOUDEE a la tete par
 * deux colonnes noires accolees. Cinq colonnes payees pour un evenement de
 * silhouette qui n'existait qu'a taille reelle. La regle est la meme pour le
 * vide que pour la matiere, et elle n'avait ete appliquee qu'a la matiere.
 *
 * L'epee est donc decalee de deux colonnes : l'acier retombe sur une paire
 * entiere, et le vide occupe desormais une cellule pleine. Deux colonnes et
 * pas une — a une seule, l'acier se repartit sur deux cellules, perd les deux
 * egalites contre ses propres contours, et l'arme redevient un baton noir.
 *
 * `P` ne survivait a aucune taille de lecture : trois pixels sur une seule
 * colonne, et sa cellule de vote la mettait a egalite avec le contour. La
 * jambe gauche lui donne une seconde colonne ; la case de palette est payee.
 *
 * ## Ce qui a ete refuse, et pourquoi
 *
 * Detacher les bras du torse par du vide. Il y faut deux pixels de part et
 * d'autre — un seul est ravale par la compression — donc trois colonnes de
 * bras, deux de vide, six de torse, deux de vide, trois de bras : seize de
 * large au lieu de douze. C'est un tiers de largeur en plus sur un sprite de
 * douze pixels, a une taille ou aucune reference ne detache les bras. Le refus
 * ne tenait que si la contrepartie en couleur etait payee ; elle l'est.
 *
 * Fondre les deux bruns `b` (ceinture) et `B` (bottes), qu'un critique
 * declarait a trente-cinq unites l'un de l'autre. Mesure : cinquante et une,
 * et douze de luminance. Ce ne sont pas des doublons, et la regle qui les
 * jugerait tels ne les a pas signales.
 *
 * Les huit directions calculees passent toutes le controle qualite depuis que
 * la coquille de contour est reposee apres rotation.
 */
export const HEROS: Dessin = {
  largeur: 24,
  hauteur: 24,
  palette: PAL_HEROS,
  lignes: [
    '.....oooooo.......oo..',
    '....oHHHhhho.....oAao.',
    '...oHHHHhhhho....oAao.',
    '...oHsssssmho....oAao.',
    '...oHsossomho....oAao.',
    '...oHsssssmho....oAao.',
    '....osssssmo.....oAao.',
    '.....oooooo......oAao.',
    '..ooTTTTttuuoo...oAao.',
    '..oTutTttuuqqo...oAao.',
    '..oTutTttuuqqo...oAao.',
    '..oTutTttuuqqo..obbbbo',
    '...osbbbbbbmmmmmmommo.',
    '...ostTttuummmmmmommo.',
    '...ootTttuummmmmmommo.',
    '....oPppppqooooooobbo.',
    '....oPP..pqo......oo..',
    '....oPP..pqo..........',
    '....oBB..BBo..........',
    '....oBB..BBo..........',
    '....ooo..ooo..........',
  ],
}

const PAL_SLIME: Palette = {
  o: '#0f2318',
  v: '#2f7d4f',
  V: '#49b06e',
  c: '#8ce0a5',
  y: '#f2f5d0',
  // Ce ton etait a douze unites de `o` : deux couleurs qu'aucun oeil ne
  // separe, et une case de palette perdue. Le verificateur l'a signale.
  n: '#08160f',
}

export const SLIME: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_SLIME,
  lignes: [
    '....oooo....',
    '..ooVVVVoo..',
    '.oVVVccVVVo.',
    'oVVVVccVVVVo',
    'oVyoVVVVoyVo',
    'oVyoVVVVoyVo',
    'oVVVVVVVVVVo',
    'oVVvvVVvvVVo',
    'ovvvvvvvvvvo',
    '.oovvvvvvoo.',
    '..oonnnnoo..',
  ],
}

/* ------------------------------------------------------------------ */
/* Les tuiles                                                          */
/* ------------------------------------------------------------------ */

const PAL_DECOR: Palette = {
  o: '#14101a',
  s: '#26263a',
  S: '#32324a',
  d: '#2b2b3c',
  m: '#5e5a52',
  M: '#7a7466',
  f: '#3d3428',
  F: '#57492f',
  b: '#8a5a2a',
  B: '#b07a3c',
  c: '#5a4020',
  p: '#2a5a8a',
  P: '#4a8ac8',
  y: '#f0c860',
  Y: '#fff0a8',
  r: '#a03028',
  g: '#2f7d4f',
}

export const SOL: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'ssssssssssssssss',
    'sSSSSSsssSSSSsss',
    'sSSSSSsssSSSSsss',
    'ssssssssssssssss',
    'sssSSSSSSSssssss',
    'sssSSSSSSSssSSss',
    'ssssssssssssSSss',
    'ssssssssssssssss',
    'sSSSsssSSSSSssss',
    'sSSSsssSSSSSssss',
    'ssssssssssssssss',
    'ssssSSSSsssSSSSs',
    'ssssSSSSsssSSSSs',
    'ssssssssssssssss',
    'sssssssSSSssssss',
    'ssssssssssssssss',
  ],
}

export const MUR: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'MMMMMMMMMMMMMMMM',
    'MmmmmmmmmmmmmmmM',
    'MmMMMMmmMMMMMmmM',
    'MmMMMMmmMMMMMmmM',
    'MmmmmmmmmmmmmmmM',
    'MMMMmmMMMMMmmMMM',
    'MMMMmmMMMMMmmMMM',
    'MmmmmmmmmmmmmmmM',
    'MmMMMMMmmMMMMmmM',
    'MmMMMMMmmMMMMmmM',
    'MmmmmmmmmmmmmmmM',
    'oooooooooooooooo',
    'dddddddddddddddd',
    'dddddddddddddddd',
    'dddddddddddddddd',
    'oooooooooooooooo',
  ],
}

export const CAISSE: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'oooooooooooooooo',
    'oBBBBBBBBBBBBBBo',
    'oBbbbbbbbbbbbbBo',
    'oBbBBbbbbbbBBbBo',
    'oBbbBBbbbbBBbbBo',
    'oBbbbBBbbBBbbbBo',
    'oBbbbbBBBBbbbbBo',
    'oBbbbbBBBBbbbbBo',
    'oBbbbBBbbBBbbbBo',
    'oBbbBBbbbbBBbbBo',
    'oBbBBbbbbbbBBbBo',
    'oBbbbbbbbbbbbbBo',
    'oBBBBBBBBBBBBBBo',
    'occcccccccccccco',
    'oooooooooooooooo',
  ],
}

export const PLAQUE: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    '................',
    '................',
    '...oooooooooo...',
    '..opppppppppo...',
    '..opPPPPPPPpo...',
    '..opPsssssPpo...',
    '..opPsssssPpo...',
    '..opPsssssPpo...',
    '..opPPPPPPPpo...',
    '..opppppppppo...',
    '...oooooooooo...',
    '................',
  ],
}

export const PLAQUE_ON: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    '................',
    '................',
    '...oooooooooo...',
    '..oyyyyyyyyyo...',
    '..oyYYYYYYYyo...',
    '..oyYYYYYYYyo...',
    '..oyYYYYYYYyo...',
    '..oyYYYYYYYyo...',
    '..oyYYYYYYYyo...',
    '..oyyyyyyyyyo...',
    '...oooooooooo...',
    '................',
  ],
}

export const PORTE: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'oooooooooooooooo',
    'oFFFFFFFFFFFFFFo',
    'oFffffffffffffFo',
    'oFfFFffffffFFffo',
    'oFffffffffffffFo',
    'oFffffyyffffffFo',
    'oFffffyyffffffFo',
    'oFffffffffffffFo',
    'oFfFFffffffFFffo',
    'oFffffffffffffFo',
    'oFffffffffffffFo',
    'oFfFFffffffFFffo',
    'oFffffffffffffFo',
    'oFFFFFFFFFFFFFFo',
    'oooooooooooooooo',
  ],
}

export const SORTIE: Dessin = {
  largeur: 16,
  hauteur: 16,
  palette: PAL_DECOR,
  lignes: [
    'oooooooooooooooo',
    'o..............o',
    'o..............o',
    'o....gggggg....o',
    'o...gggggggg...o',
    'o...gggggggg...o',
    'o...gggggggg...o',
    'o...gggggggg...o',
    'o...gggggggg...o',
    'o....gggggg....o',
    'o..............o',
    'o..............o',
    'oooooooooooooooo',
  ],
}
