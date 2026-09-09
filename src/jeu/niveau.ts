/**
 * Le format d'un niveau, et les regles qui vont avec.
 *
 * Il est volontairement minuscule. Un niveau, c'est une grille d'index de
 * tuiles et une liste d'entites : rien d'autre. Ce qu'une tuile FAIT n'est pas
 * dans le niveau mais dans le decor — la meme grille jouee avec un autre jeu
 * de roles donne un autre jeu.
 *
 * Ce decoupage n'est pas de l'elegance gratuite : c'est lui qui permet a
 * l'editeur de niveaux d'exister. On dessine ses tuiles dans PixelForge, on
 * dit lesquelles sont des murs, on peint une grille, on appuie sur Jouer. Le
 * moteur ne sait rien du reste.
 */

/** Ce qu'une tuile fait quand on marche dessus. */
export type Role =
  | 'sol'        // on passe
  | 'mur'        // on ne passe pas
  | 'caisse'     // se pousse
  | 'plaque'     // s'allume quand une caisse s'y trouve
  | 'porte'      // bloque tant que les plaques ne sont pas toutes allumees
  | 'sortie'     // fin du niveau
  | 'depart'     // ou le heros apparait
  | 'creature'   // patrouille, renvoie au depart

export const ROLES: { id: Role; nom: string; aide: string }[] = [
  { id: 'sol', nom: 'Sol', aide: 'On marche dessus' },
  { id: 'mur', nom: 'Mur', aide: 'Infranchissable' },
  { id: 'caisse', nom: 'Caisse', aide: 'Se pousse d\'une case, jamais en diagonale' },
  { id: 'plaque', nom: 'Plaque', aide: 'S\'allume sous une caisse' },
  { id: 'porte', nom: 'Porte', aide: 'S\'ouvre quand toutes les plaques sont allumées' },
  { id: 'sortie', nom: 'Sortie', aide: 'Termine le niveau' },
  { id: 'depart', nom: 'Départ', aide: 'Où le héros apparaît' },
  { id: 'creature', nom: 'Créature', aide: 'Patrouille horizontalement' },
]

export interface Niveau {
  largeur: number
  hauteur: number
  /** Cote d'une case, en pixels. */
  tuile: number
  /** Index de tuile par case, -1 pour rien. Longueur = largeur * hauteur. */
  cases: number[]
}

/** Ce qu'un jeu de tuiles sait faire : une image et un role par index. */
export interface Decor {
  images: (HTMLCanvasElement | null)[]
  roles: Role[]
  /** Les huit vues du heros, du sud au sud-est en tournant. */
  heros: HTMLCanvasElement[]
  /** Tuile peinte sous tout le reste. -1 pour un fond noir. */
  fond: number
}

export const niveauVide = (largeur: number, hauteur: number, tuile: number): Niveau => ({
  largeur, hauteur, tuile, cases: new Array(largeur * hauteur).fill(-1),
})

/**
 * Ce qui manque a un niveau pour etre jouable.
 *
 * Rendu en clair plutot qu'en booleen : un editeur qui grise « Jouer » sans
 * dire pourquoi est un editeur qui punit.
 */
export function manquePour(niveau: Niveau, decor: Decor): string[] {
  const compte = (r: Role): number =>
    niveau.cases.filter((i) => i >= 0 && decor.roles[i] === r).length
  const manques: string[] = []
  if (compte('depart') === 0) manques.push('un départ')
  if (compte('depart') > 1) manques.push('un seul départ (il y en a plusieurs)')
  if (compte('sortie') === 0) manques.push('une sortie')
  const plaques = compte('plaque')
  const caisses = compte('caisse')
  if (plaques > caisses) {
    manques.push(`autant de caisses que de plaques (${caisses} pour ${plaques})`)
  }
  if (compte('porte') > 0 && plaques === 0) {
    manques.push('au moins une plaque, sinon la porte ne s\'ouvrira jamais')
  }
  return manques
}

export function serialiser(niveau: Niveau, roles: Role[]): string {
  return JSON.stringify({ format: 'pixelforge-niveau-1', niveau, roles }, null, 2)
}

export function deserialiser(texte: string): { niveau: Niveau; roles: Role[] } {
  const brut = JSON.parse(texte) as { niveau?: Niveau; roles?: Role[] }
  if (!brut.niveau || !Array.isArray(brut.niveau.cases)) throw new Error('Niveau illisible')
  return { niveau: brut.niveau, roles: brut.roles ?? [] }
}
