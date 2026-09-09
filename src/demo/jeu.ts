import { Bitmap } from '../core/bitmap'
import { hauteurSuggeree } from '../smart/depth'
import { planchesDeDirections, pivotDesPieces, type Piece } from '../smart/scene'
import { sourcesFaceEtDos } from '../smart/vues'
import { jouer } from '../jeu/moteur'
import type { Decor, Niveau, Role } from '../jeu/niveau'
import {
  bitmapDe, CAISSE, HEROS, MUR, PLAQUE, PORTE, SLIME, SOL, SORTIE,
} from './art'

/**
 * « La salle du gardien » : la salle de donjon publique.
 *
 * Elle ne contient plus une ligne de regle de jeu — tout est dans
 * `src/jeu/moteur.ts`, le meme moteur que le bouton « Jouer » de l'editeur de
 * niveaux. Il ne reste ici que le decor et la grille, c'est-a-dire exactement
 * ce qu'un niveau est.
 *
 * Ce qu'elle prouve : les huit directions du heros ne sont pas dessinees.
 * Elles sont CALCULEES a l'ouverture de la page, par le meme code que
 * l'editeur, depuis un unique dessin de face. La page importe `src/smart`
 * directement : elle ne peut donc pas mentir sur ce que fait l'editeur.
 */

const TUILE = 16
const ECHELLE = 3

const PLAN = [
  '###############',
  '#.............#',
  '#..P.......P..#',
  '#.............#',
  '#....C...C....#',
  '#......@......#',
  '#.............#',
  '#..s.......s..#',
  '#.............#',
  '#######D#######',
  '#######S#######',
]

/** Ordre des tuiles du decor ; l'index sert de valeur dans la grille. */
const TUILES: { lettre: string; role: Role; dessin: Parameters<typeof bitmapDe>[0] | null }[] = [
  { lettre: '.', role: 'sol', dessin: SOL },
  { lettre: '#', role: 'mur', dessin: MUR },
  { lettre: 'C', role: 'caisse', dessin: CAISSE },
  { lettre: 'P', role: 'plaque', dessin: PLAQUE },
  { lettre: 'D', role: 'porte', dessin: PORTE },
  { lettre: 'S', role: 'sortie', dessin: SORTIE },
  { lettre: '@', role: 'depart', dessin: null },
  { lettre: 's', role: 'creature', dessin: SLIME },
]

/** Agrandit une image une fois pour toutes : le rendu n'a plus qu'a la poser. */
export function calque(bm: Bitmap, echelle: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = bm.width * echelle
  c.height = bm.height * echelle
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bm.toCanvas(), 0, 0, c.width, c.height)
  return c
}

/**
 * Les huit vues d'un dessin de face, calculees par PixelForge.
 *
 * Six lignes, parce que tout le travail est dans `src/smart`. C'est la
 * fonction que la demonstration existe pour montrer.
 */
export function huitDirections(face: Bitmap, echelle: number): {
  images: HTMLCanvasElement[]; ms: number
} {
  const debut = performance.now()
  const relief = { hauteur: hauteurSuggeree(face), galbe: 0.5 }
  const boite = face.trimBounds()
  const piece: Piece = {
    nom: 'heros',
    sources: sourcesFaceEtDos(face, relief),
    pivot: { x: boite.x + (boite.w - 1) / 2, y: boite.y + (boite.h - 1) / 2, z: 0 },
    position: { x: boite.x + (boite.w - 1) / 2, y: boite.y + (boite.h - 1) / 2, z: 0 },
    rotation: { lacet: 0, tangage: 0, roulis: 0 },
  }
  const vues = planchesDeDirections([piece], 8, 0, {
    largeur: face.width,
    hauteur: face.height,
    centre: { x: face.width / 2, y: face.height / 2 },
    pivotMonde: pivotDesPieces([piece]),
  })
  return {
    images: vues.map((v) => calque(v.rendu.image, echelle)),
    ms: Math.round(performance.now() - debut),
  }
}

export function lancerLeJeu(hote: HTMLElement, etat: HTMLElement): void {
  const face = bitmapDe(HEROS)
  const heros = huitDirections(face, ECHELLE)

  const decor: Decor = {
    images: TUILES.map((t) => (t.dessin ? calque(bitmapDe(t.dessin), ECHELLE) : null)),
    roles: TUILES.map((t) => t.role),
    heros: heros.images,
    fond: 0,
  }

  const niveau: Niveau = {
    largeur: PLAN[0].length,
    hauteur: PLAN.length,
    tuile: TUILE,
    cases: PLAN.flatMap((ligne) => [...ligne].map((c) =>
      TUILES.findIndex((t) => t.lettre === c))),
  }

  const partie = jouer(niveau, decor, {
    echelle: ECHELLE,
    surEtat: (texte) => { etat.textContent = texte },
  })
  hote.appendChild(partie.canvas)

  const note = document.getElementById('calcul')
  if (note) {
    note.textContent = 'Les 8 directions du héros ont été calculées à l\'ouverture de cette '
      + `page, en ${heros.ms} ms, depuis un seul dessin de face de `
      + `${face.width}×${face.height} pixels.`
  }
}
