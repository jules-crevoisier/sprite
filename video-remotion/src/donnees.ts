/**
 * Ce que la passe de recolte a sorti de l'application.
 *
 * Le JSON est importe plutot que charge par fetch : le rendu Remotion doit
 * pouvoir dessiner l'image 3000 sans attendre une requete, et une importation
 * statique supprime d'un coup toute la gestion d'attente et le risque qu'une
 * image sorte avant que les donnees soient la.
 */
import brut from '../public/data.json'

export interface Os {
  nom: string
  role: string
  parent: number | null
  x: number
  y: number
  ex: number
  ey: number
  couleur: string
}

export interface Rampe {
  nom: string
  pixels: number
  couleurs: string[]
}

export interface Outil {
  id: string
  nom: string
  raccourci: string
  icone: string
  groupe: string
}

export interface Clip {
  id: string
  label: string
  hint: string
  ms: number
  loop: boolean
  images: string[]
}

export interface Courbe {
  id: string
  label: string
  hint: string
  points: { x: number; y: number }[]
}

export interface Variante {
  label: string
  image: string
  rampe: string[]
}

export interface Effet {
  id: string
  label: string
  hint: string
  image: string
  champs: string[]
}

export interface ClipPixl {
  id: string
  nom: string
  ms: number
  loop: boolean
  images: string[]
}

export interface ClipArme extends ClipPixl {
  /** L'arme seule, sans le personnage : sa silhouette doit se reconnaitre. */
  seule: string
}

export interface Arme {
  id: string
  nom: string
  /** Ce que l'arme change au personnage quand il la porte. */
  pitch: string
  clips: ClipArme[]
}

export interface Pixl {
  taille: number
  clips: ClipPixl[]
  armes: Arme[]
}

export interface Donnees {
  grille: { w: number; h: number; couleurs: string[]; cases: number[] }
  palette: string[]
  rampes: Rampe[]
  outils: Outil[]
  modeleOs: { id: string; label: string }
  os: Os[]
  sprite: { w: number; h: number }
  clips: Clip[]
  tour: string[]
  courbes: Courbe[]
  ombrage: { touches: number; matieres: number; lisses: number }
  strategies: { id: string; label: string; hint: string }[]
  variantes: Variante[]
  detail: { preset: string; etapes: string[]; modes: string[]; taille: number; pierre: string }
  effets: Effet[]
  pile: { etapes: string[]; noms: string[] }
  export: {
    planche: { w: number; h: number; cases: { x: number; y: number; w: number; h: number }[] }
    json: string[]
    unity: string[]
    godot: string[]
    gifOctets: number
    images: number
  }
  pixl: Pixl
  cadrage: { x: number; y: number; w: number; h: number }
  dialogues: string[]
}

export const D = brut as unknown as Donnees

/** Cycle par identifiant, avec repli sur le premier : un cycle peut ne pas
 *  s'appliquer au squelette recolte, et le film ne doit pas casser pour ca. */
export const clip = (id: string): Clip => D.clips.find((c) => c.id === id) ?? D.clips[0]

export const courbe = (id: string): Courbe =>
  D.courbes.find((c) => c.id === id) ?? D.courbes[0]
