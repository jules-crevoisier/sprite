import { Bitmap } from '../core/bitmap'
import { hauteurSuggeree } from '../smart/depth'
import { planchesDeDirections, pivotDesPieces, type Piece } from '../smart/scene'
import { sourcesFaceEtDos } from '../smart/vues'
import {
  bitmapDe, CAISSE, HEROS, MUR, PLAQUE, PLAQUE_ON, PORTE, SLIME, SOL, SORTIE,
} from './art'

/**
 * « La salle du gardien » : une salle de donjon jouable, faite entierement
 * avec PixelForge.
 *
 * Ce n'est pas une vitrine passive. Les huit directions du heros ne sont pas
 * dessinees : elles sont CALCULEES au chargement, ici, par le meme code que
 * l'editeur — un seul dessin de face, `sourcesFaceEtDos` en deduit le dos, et
 * `planchesDeDirections` rend les huit vues. Ouvrez la console : le temps de
 * calcul s'y affiche.
 *
 * C'est la seule maniere honnete de montrer que la technologie tient : la
 * faire tourner dans un vrai jeu, avec un vrai joueur qui regarde le
 * personnage marcher vers le nord-est.
 *
 * ## Le jeu
 *
 * Pousser les deux caisses sur les deux plaques ouvre la porte. Une creature
 * patrouille ; la toucher renvoie au depart. R remet la salle a zero, parce
 * qu'une caisse poussee dans un coin est irrattrapable et qu'un jeu qui
 * enferme sans le dire est un jeu casse.
 */

const TUILE = 16
const ECHELLE = 3
/** Duree d'un pas, en millisecondes. Assez lent pour se voir, assez vif pour ne pas peser. */
const PAS_MS = 130

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

type Case = '#' | '.' | 'P' | 'D' | 'S'

interface Mobile {
  /** Position en cases, entiere quand le mouvement est fini. */
  x: number
  y: number
  /** Depart et arrivee du pas en cours, et sa progression de 0 a 1. */
  dex: number
  dey: number
  t: number
  /** Direction regardee, en index de la planche : 0 = sud, sens horaire. */
  dir: number
}

const nouveau = (x: number, y: number, dir = 0): Mobile =>
  ({ x, y, dex: x, dey: y, t: 1, dir })

/**
 * Index de direction pour un deplacement, dans l'ordre de la planche.
 *
 * `planchesDeDirections` numerote a partir du sud et tourne dans le sens
 * horaire : S, SE, E, NE, N, NO, O, SO. L'ecran, lui, a son y vers le bas —
 * d'ou le signe sur dy.
 */
function directionDe(dx: number, dy: number, defaut: number): number {
  if (!dx && !dy) return defaut
  const angle = Math.atan2(dx, dy)
  const index = Math.round((angle / (Math.PI * 2)) * 8)
  return ((index % 8) + 8) % 8
}

/** Prepare une image pour le rendu : agrandie une fois pour toutes. */
function calque(bm: Bitmap): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = bm.width * ECHELLE
  c.height = bm.height * ECHELLE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bm.toCanvas(), 0, 0, c.width, c.height)
  return c
}

/**
 * Les huit vues du heros, calculees depuis son unique dessin de face.
 *
 * C'est le coeur de la demonstration, et cela tient en six lignes parce que
 * tout le travail est dans `src/smart`.
 */
function directionsDuHeros(): { images: HTMLCanvasElement[]; ms: number; largeur: number; hauteur: number } {
  const debut = performance.now()
  const face = bitmapDe(HEROS)
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
    images: vues.map((v) => calque(v.rendu.image)),
    ms: Math.round(performance.now() - debut),
    largeur: face.width,
    hauteur: face.height,
  }
}

export function lancerLeJeu(hote: HTMLElement, etat: HTMLElement): void {
  const largeurCases = PLAN[0].length
  const hauteurCases = PLAN.length

  const canvas = document.createElement('canvas')
  canvas.width = largeurCases * TUILE * ECHELLE
  canvas.height = hauteurCases * TUILE * ECHELLE
  canvas.className = 'jeu-canvas'
  canvas.tabIndex = 0
  hote.appendChild(canvas)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const heros = directionsDuHeros()
  const tuiles = {
    sol: calque(bitmapDe(SOL)),
    mur: calque(bitmapDe(MUR)),
    caisse: calque(bitmapDe(CAISSE)),
    plaque: calque(bitmapDe(PLAQUE)),
    plaqueOn: calque(bitmapDe(PLAQUE_ON)),
    porte: calque(bitmapDe(PORTE)),
    sortie: calque(bitmapDe(SORTIE)),
    slime: calque(bitmapDe(SLIME)),
  }

  /* ---------------- etat de la salle ---------------- */

  let grille: Case[][] = []
  let joueur = nouveau(0, 0)
  let depart = { x: 0, y: 0 }
  let caisses: Mobile[] = []
  let creatures: (Mobile & { sens: number })[] = []
  let porteOuverte = false
  let gagne = false
  let pas = 0
  let morts = 0

  const remettre = (): void => {
    grille = []
    caisses = []
    creatures = []
    porteOuverte = false
    gagne = false
    pas = 0
    for (let y = 0; y < hauteurCases; y++) {
      const ligne: Case[] = []
      for (let x = 0; x < largeurCases; x++) {
        const c = PLAN[y][x]
        if (c === 'C') { caisses.push(nouveau(x, y)); ligne.push('.') }
        else if (c === 's') { creatures.push({ ...nouveau(x, y), sens: 1 }); ligne.push('.') }
        else if (c === '@') { depart = { x, y }; ligne.push('.') }
        else ligne.push(c as Case)
      }
      grille.push(ligne)
    }
    joueur = nouveau(depart.x, depart.y)
    dire()
  }

  const caseEn = (x: number, y: number): Case =>
    (y < 0 || x < 0 || y >= hauteurCases || x >= largeurCases) ? '#' : grille[y][x]

  const caisseEn = (x: number, y: number): Mobile | undefined =>
    caisses.find((c) => c.x === x && c.y === y)

  /** Une case ou l'on peut poser quelque chose : ni mur, ni porte fermee. */
  const libre = (x: number, y: number): boolean => {
    const c = caseEn(x, y)
    if (c === '#') return false
    if (c === 'D' && !porteOuverte) return false
    return !caisseEn(x, y)
  }

  const plaquesPressees = (): number =>
    grille.flatMap((ligne, y) => ligne.map((c, x) => (c === 'P' && caisseEn(x, y) ? 1 : 0)))
      .reduce((a: number, b: number) => a + b, 0)

  const plaquesTotal = PLAN.join('').split('P').length - 1

  const dire = (): void => {
    const n = plaquesPressees()
    etat.textContent = gagne
      ? `Salle terminée en ${pas} pas${morts ? `, ${morts} mort(s)` : ', sans une égratignure'}.`
      : `${n}/${plaquesTotal} plaque(s) · ${pas} pas`
      + (porteOuverte ? ' · la porte est ouverte' : '')
  }

  /* ---------------- deplacement ---------------- */

  const bouger = (dx: number, dy: number): void => {
    if (gagne || joueur.t < 1) return
    joueur.dir = directionDe(dx, dy, joueur.dir)
    const nx = joueur.x + dx, ny = joueur.y + dy
    const mur = caseEn(nx, ny)
    if (mur === '#' || (mur === 'D' && !porteOuverte)) return

    const caisse = caisseEn(nx, ny)
    if (caisse) {
      // Une caisse ne se pousse que sur une case libre, et jamais en diagonale :
      // pousser deux caisses d'un coup ou traverser un angle rendrait le
      // puzzle illisible.
      if (dx !== 0 && dy !== 0) return
      const cx = nx + dx, cy = ny + dy
      if (!libre(cx, cy) || caseEn(cx, cy) === 'D' || caseEn(cx, cy) === 'S') return
      caisse.dex = cx; caisse.dey = cy; caisse.t = 0
      caisse.x = cx; caisse.y = cy
    }
    // La case quittee sert d'origine a l'interpolation ; la case d'arrivee
    // devient tout de suite la position logique, pour que les regles ne
    // dependent jamais d'une animation en cours.
    joueur.dex = joueur.x; joueur.dey = joueur.y
    joueur.x = nx; joueur.y = ny
    joueur.t = 0
    pas++

    if (plaquesPressees() === plaquesTotal) porteOuverte = true
    if (caseEn(joueur.x, joueur.y) === 'S') { gagne = true }
    dire()
  }

  const mourir = (): void => {
    morts++
    joueur = nouveau(depart.x, depart.y, joueur.dir)
    dire()
  }

  /* ---------------- boucle ---------------- */

  const touches = new Set<string>()
  /**
   * Dernier appui, garde quelques dixiemes de seconde.
   *
   * Sans lui, une touche tapee et relachee entre deux images est perdue : le
   * pas en cours n'etait pas fini, la touche n'etait deja plus enfoncee, et
   * rien ne se passait. Au banc, six appuis sur neuf disparaissaient — et
   * c'est exactement ce qu'un joueur ressent comme « le jeu ne repond pas ».
   */
  let tampon: { dx: number; dy: number; quand: number } | null = null
  const MEMOIRE_MS = 260
  let dernier = performance.now()
  let horloge = 0

  const avancer = (m: Mobile, dt: number): void => {
    if (m.t < 1) m.t = Math.min(1, m.t + dt / PAS_MS)
  }
  /** Position a l'ecran d'un mobile, interpolee entre sa case de depart et son arrivee. */
  const ecran = (m: Mobile): [number, number] => {
    // Adouci aux deux bouts : un pas a vitesse constante donne le pantin
    // mecanique qu'on reproche aux jeux faits a la hate.
    const p = m.t >= 1 ? 1 : m.t * m.t * (3 - 2 * m.t)
    return [m.dex + (m.x - m.dex) * p, m.dey + (m.y - m.dey) * p]
  }

  const boucle = (maintenant: number): void => {
    const dt = Math.min(50, maintenant - dernier)
    dernier = maintenant
    horloge += dt

    // Une touche tenue enchaine les pas, sans avoir a marteler ; un appui
    // bref est rattrape par le tampon.
    if (joueur.t >= 1 && !gagne) {
      let dx = 0, dy = 0
      if (touches.has('gauche')) dx--
      if (touches.has('droite')) dx++
      if (touches.has('haut')) dy--
      if (touches.has('bas')) dy++
      if (!dx && !dy && tampon && maintenant - tampon.quand < MEMOIRE_MS) {
        dx = tampon.dx; dy = tampon.dy
      }
      if (dx || dy) { tampon = null; bouger(dx, dy) }
    }

    avancer(joueur, dt)
    for (const c of caisses) avancer(c, dt)

    // Les creatures vont et viennent, une case toutes les 450 ms.
    for (const c of creatures) {
      avancer(c, dt)
      if (c.t >= 1 && horloge % 450 < dt) {
        const nx = c.x + c.sens
        if (caseEn(nx, c.y) !== '.' || caisseEn(nx, c.y)) { c.sens *= -1 }
        else {
          c.dex = c.x; c.dey = c.y
          c.x = nx
          c.t = 0
          c.dir = directionDe(c.sens, 0, c.dir)
        }
      }
      if (!gagne && c.x === joueur.x && c.y === joueur.y) mourir()
    }

    /* --- rendu --- */
    ctx.fillStyle = '#0d0b12'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const T = TUILE * ECHELLE
    for (let y = 0; y < hauteurCases; y++) {
      for (let x = 0; x < largeurCases; x++) {
        const c = grille[y][x]
        if (c === '#') { ctx.drawImage(tuiles.mur, x * T, y * T); continue }
        ctx.drawImage(tuiles.sol, x * T, y * T)
        if (c === 'P') ctx.drawImage(caisseEn(x, y) ? tuiles.plaqueOn : tuiles.plaque, x * T, y * T)
        if (c === 'S') ctx.drawImage(tuiles.sortie, x * T, y * T)
        if (c === 'D' && !porteOuverte) ctx.drawImage(tuiles.porte, x * T, y * T)
      }
    }
    for (const c of caisses) {
      const [ex, ey] = ecran(c)
      ctx.drawImage(tuiles.caisse, Math.round(ex * T), Math.round(ey * T))
    }
    for (const c of creatures) {
      const [ex, ey] = ecran(c)
      // Une creature qui respire : un pixel de haut en bas, deux fois par seconde.
      const souffle = Math.round(Math.sin(horloge / 260) * 1) * ECHELLE
      ctx.drawImage(tuiles.slime, Math.round(ex * T), Math.round(ey * T) + souffle)
    }
    {
      const [ex, ey] = ecran(joueur)
      const image = heros.images[joueur.dir]
      // Le heros deborde de sa case : on le pose par les pieds, centre.
      const dx = Math.round(ex * T - (image.width - T) / 2)
      const dy = Math.round(ey * T - (image.height - T))
      // Balancement de marche : un pixel, le temps du pas.
      const bob = joueur.t < 1 && joueur.t > 0.15 && joueur.t < 0.85 ? -ECHELLE : 0
      ctx.drawImage(image, dx, dy + bob)
    }
    if (gagne) {
      ctx.fillStyle = 'rgba(10,12,18,0.72)'
      ctx.fillRect(0, canvas.height / 2 - 46, canvas.width, 92)
      ctx.fillStyle = '#8ce0a5'
      ctx.font = '600 34px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Salle franchie', canvas.width / 2, canvas.height / 2 + 2)
      ctx.fillStyle = '#9aa0aa'
      ctx.font = '15px system-ui, sans-serif'
      ctx.fillText('R pour recommencer', canvas.width / 2, canvas.height / 2 + 30)
    }
    requestAnimationFrame(boucle)
  }

  const NOMS: Record<string, string> = {
    ArrowLeft: 'gauche', ArrowRight: 'droite', ArrowUp: 'haut', ArrowDown: 'bas',
    KeyA: 'gauche', KeyD: 'droite', KeyW: 'haut', KeyS: 'bas', KeyQ: 'gauche', KeyZ: 'haut',
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') { remettre(); return }
    const nom = NOMS[e.code] ?? NOMS[e.key]
    if (!nom) return
    e.preventDefault()
    touches.add(nom)
    const dx = nom === 'gauche' ? -1 : nom === 'droite' ? 1 : 0
    const dy = nom === 'haut' ? -1 : nom === 'bas' ? 1 : 0
    tampon = { dx, dy, quand: performance.now() }
  })
  window.addEventListener('keyup', (e) => {
    const nom = NOMS[e.code] ?? NOMS[e.key]
    if (nom) touches.delete(nom)
  })

  remettre()
  requestAnimationFrame(boucle)

  const note = document.getElementById('calcul')
  if (note) {
    note.textContent = `Les 8 directions du héros ont été calculées à l'ouverture de cette page, `
      + `en ${heros.ms} ms, depuis un seul dessin de face de ${heros.largeur}×${heros.hauteur} pixels.`
  }
}
