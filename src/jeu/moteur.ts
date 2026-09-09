import type { Decor, Niveau, Role } from './niveau'

/**
 * Le moteur : il fait tourner un niveau, et rien de plus.
 *
 * Il ne connait ni PixelForge, ni les dessins, ni d'ou vient la grille. On lui
 * donne un niveau et un decor, il rend une salle jouable et un moyen de
 * l'arreter. C'est ce qui permet a la meme boucle de servir la demonstration
 * publique et le bouton « Jouer » de l'editeur de niveaux : il n'y a qu'un
 * seul jeu, donc l'editeur ne peut pas mentir sur ce qu'on obtiendra.
 *
 * ## Les regles, en une phrase
 *
 * On pousse les caisses sur les plaques, ce qui ouvre la porte, et on sort.
 * Toucher une creature renvoie au depart.
 */

/** Duree d'un pas. Assez lent pour se voir, assez vif pour ne pas peser. */
const PAS_MS = 130
/**
 * Memoire des touches.
 *
 * Sans elle, une touche tapee et relachee entre deux images est perdue : au
 * banc, six appuis sur neuf disparaissaient — ce qu'un joueur ressent comme
 * « le jeu ne repond pas ».
 */
const MEMOIRE_MS = 260

interface Mobile {
  x: number
  y: number
  /** Case quittee, pour interpoler le pas en cours. */
  dex: number
  dey: number
  t: number
  dir: number
}

const nouveau = (x: number, y: number, dir = 0): Mobile =>
  ({ x, y, dex: x, dey: y, t: 1, dir })

/**
 * Index de direction pour un deplacement.
 *
 * `planchesDeDirections` numerote a partir du sud et tourne dans le sens
 * horaire : S, SE, E, NE, N, NO, O, SO. L'ecran a son y vers le bas, d'ou
 * l'ordre des arguments.
 */
export function directionDe(dx: number, dy: number, defaut: number): number {
  if (!dx && !dy) return defaut
  const index = Math.round((Math.atan2(dx, dy) / (Math.PI * 2)) * 8)
  return ((index % 8) + 8) % 8
}

export interface Partie {
  canvas: HTMLCanvasElement
  arreter(): void
  recommencer(): void
}

export interface OptionsPartie {
  echelle?: number
  /** Appele a chaque changement d'etat, pour l'affichage hors du canvas. */
  surEtat?: (texte: string, gagne: boolean) => void
}

export function jouer(niveau: Niveau, decor: Decor, opts: OptionsPartie = {}): Partie {
  const E = opts.echelle ?? 3
  const T = niveau.tuile * E
  const canvas = document.createElement('canvas')
  canvas.width = niveau.largeur * T
  canvas.height = niveau.hauteur * T
  canvas.className = 'jeu-canvas'
  canvas.tabIndex = 0
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const roleEn = (x: number, y: number): Role | null => {
    if (x < 0 || y < 0 || x >= niveau.largeur || y >= niveau.hauteur) return 'mur'
    const i = niveau.cases[y * niveau.largeur + x]
    return i >= 0 ? (decor.roles[i] ?? 'sol') : null
  }
  const tuileEn = (x: number, y: number): number => niveau.cases[y * niveau.largeur + x]

  let joueur = nouveau(0, 0)
  let depart = { x: 0, y: 0 }
  let caisses: Mobile[] = []
  let creatures: (Mobile & { sens: number })[] = []
  let porteOuverte = false
  let gagne = false
  let pas = 0
  let morts = 0
  let vivant = true

  const plaques: { x: number; y: number }[] = []

  const remettre = (): void => {
    caisses = []
    creatures = []
    plaques.length = 0
    porteOuverte = false
    gagne = false
    pas = 0
    for (let y = 0; y < niveau.hauteur; y++) {
      for (let x = 0; x < niveau.largeur; x++) {
        const r = roleEn(x, y)
        if (r === 'caisse') caisses.push(nouveau(x, y))
        else if (r === 'creature') creatures.push({ ...nouveau(x, y), sens: 1 })
        else if (r === 'depart') depart = { x, y }
        else if (r === 'plaque') plaques.push({ x, y })
      }
    }
    joueur = nouveau(depart.x, depart.y)
    dire()
  }

  const caisseEn = (x: number, y: number): Mobile | undefined =>
    caisses.find((c) => c.x === x && c.y === y)

  /** Vrai si l'on peut entrer sur cette case. */
  const passable = (x: number, y: number): boolean => {
    const r = roleEn(x, y)
    if (r === 'mur' || r === 'caisse' || r === 'creature') {
      // Une case portant une caisse a l'origine redevient du sol des qu'on
      // l'a poussee : c'est l'entite qui bloque, pas la tuile.
      if (r === 'mur') return false
    }
    if (r === 'porte' && !porteOuverte) return false
    return true
  }

  const plaquesPressees = (): number =>
    plaques.filter((p) => caisseEn(p.x, p.y)).length

  const dire = (): void => {
    const texte = gagne
      ? `Niveau terminé en ${pas} pas${morts ? `, ${morts} mort(s)` : ', sans une égratignure'}.`
      : `${plaquesPressees()}/${plaques.length} plaque(s) · ${pas} pas`
        + (porteOuverte ? ' · la porte est ouverte' : '')
    opts.surEtat?.(texte, gagne)
  }

  const bouger = (dx: number, dy: number): void => {
    if (gagne || joueur.t < 1) return
    joueur.dir = directionDe(dx, dy, joueur.dir)
    const nx = joueur.x + dx, ny = joueur.y + dy
    if (!passable(nx, ny)) return

    const caisse = caisseEn(nx, ny)
    if (caisse) {
      // Jamais en diagonale : pousser en coin rendrait le puzzle illisible.
      if (dx !== 0 && dy !== 0) return
      const cx = nx + dx, cy = ny + dy
      const rc = roleEn(cx, cy)
      if (!passable(cx, cy) || caisseEn(cx, cy) || rc === 'porte' || rc === 'sortie') return
      caisse.dex = caisse.x; caisse.dey = caisse.y
      caisse.x = cx; caisse.y = cy
      caisse.t = 0
    }
    joueur.dex = joueur.x; joueur.dey = joueur.y
    joueur.x = nx; joueur.y = ny
    joueur.t = 0
    pas++

    if (plaques.length && plaquesPressees() === plaques.length) porteOuverte = true
    if (roleEn(joueur.x, joueur.y) === 'sortie') gagne = true
    dire()
  }

  const mourir = (): void => {
    morts++
    joueur = nouveau(depart.x, depart.y, joueur.dir)
    dire()
  }

  /* ---------------- entrees ---------------- */

  const touches = new Set<string>()
  let tampon: { dx: number; dy: number; quand: number } | null = null

  const NOMS: Record<string, string> = {
    ArrowLeft: 'gauche', ArrowRight: 'droite', ArrowUp: 'haut', ArrowDown: 'bas',
    KeyA: 'gauche', KeyD: 'droite', KeyW: 'haut', KeyS: 'bas', KeyQ: 'gauche', KeyZ: 'haut',
  }
  const auClavier = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR') { remettre(); return }
    const nom = NOMS[e.code] ?? NOMS[e.key]
    if (!nom) return
    e.preventDefault()
    touches.add(nom)
    tampon = {
      dx: nom === 'gauche' ? -1 : nom === 'droite' ? 1 : 0,
      dy: nom === 'haut' ? -1 : nom === 'bas' ? 1 : 0,
      quand: performance.now(),
    }
  }
  const auRelachement = (e: KeyboardEvent): void => {
    const nom = NOMS[e.code] ?? NOMS[e.key]
    if (nom) touches.delete(nom)
  }
  window.addEventListener('keydown', auClavier)
  window.addEventListener('keyup', auRelachement)

  /* ---------------- boucle ---------------- */

  let dernier = performance.now()
  let horloge = 0

  const avancer = (m: Mobile, dt: number): void => {
    if (m.t < 1) m.t = Math.min(1, m.t + dt / PAS_MS)
  }
  /** Position a l'ecran, adoucie aux deux bouts : un pas lineaire fait pantin. */
  const ecran = (m: Mobile): [number, number] => {
    const p = m.t >= 1 ? 1 : m.t * m.t * (3 - 2 * m.t)
    return [m.dex + (m.x - m.dex) * p, m.dey + (m.y - m.dey) * p]
  }

  const boucle = (maintenant: number): void => {
    if (!vivant) return
    const dt = Math.min(50, maintenant - dernier)
    dernier = maintenant
    horloge += dt

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
    for (const c of creatures) {
      avancer(c, dt)
      if (c.t >= 1 && horloge % 450 < dt) {
        const nx = c.x + c.sens
        const r = roleEn(nx, c.y)
        if (r === null || r === 'mur' || r === 'porte' || caisseEn(nx, c.y)) c.sens *= -1
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
    const fond = decor.fond >= 0 ? decor.images[decor.fond] : null
    for (let y = 0; y < niveau.hauteur; y++) {
      for (let x = 0; x < niveau.largeur; x++) {
        const i = tuileEn(x, y)
        const role = i >= 0 ? decor.roles[i] : null
        // Le sol passe sous tout ce qui n'est pas un mur : une caisse posee
        // sur du vide flotterait.
        if (fond && role !== 'mur') ctx.drawImage(fond, x * T, y * T)
        if (i < 0) continue
        if (role === 'caisse' || role === 'creature' || role === 'depart') continue
        if (role === 'porte' && porteOuverte) continue
        const img = decor.images[i]
        if (img) ctx.drawImage(img, x * T, y * T)
      }
    }
    // Les plaques allumees : on repeint par-dessus avec la tuile suivante si
    // le decor en propose une, sinon un halo.
    for (const p of plaques) {
      if (!caisseEn(p.x, p.y)) continue
      ctx.fillStyle = 'rgba(240,200,96,0.35)'
      ctx.fillRect(p.x * T, p.y * T, T, T)
    }
    const dessiner = (m: Mobile, img: HTMLCanvasElement | null, souffle = 0): void => {
      if (!img) return
      const [ex, ey] = ecran(m)
      ctx.drawImage(img,
        Math.round(ex * T - (img.width - T) / 2),
        Math.round(ey * T - (img.height - T)) + souffle)
    }
    const premiere = (r: Role): HTMLCanvasElement | null => {
      const i = decor.roles.indexOf(r)
      return i >= 0 ? decor.images[i] : null
    }
    for (const c of caisses) dessiner(c, premiere('caisse'))
    for (const c of creatures) {
      dessiner(c, premiere('creature'), Math.round(Math.sin(horloge / 260)) * E)
    }
    {
      const img = decor.heros[joueur.dir] ?? decor.heros[0]
      const bob = joueur.t > 0.15 && joueur.t < 0.85 ? -E : 0
      dessiner(joueur, img ?? null, bob)
    }
    if (gagne) {
      ctx.fillStyle = 'rgba(10,12,18,0.72)'
      ctx.fillRect(0, canvas.height / 2 - 46, canvas.width, 92)
      ctx.fillStyle = '#8ce0a5'
      ctx.font = '600 34px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Niveau franchi', canvas.width / 2, canvas.height / 2 + 2)
      ctx.fillStyle = '#9aa0aa'
      ctx.font = '15px system-ui, sans-serif'
      ctx.fillText('R pour recommencer', canvas.width / 2, canvas.height / 2 + 30)
    }
    requestAnimationFrame(boucle)
  }

  remettre()
  requestAnimationFrame(boucle)

  return {
    canvas,
    recommencer: remettre,
    arreter: () => {
      vivant = false
      window.removeEventListener('keydown', auClavier)
      window.removeEventListener('keyup', auRelachement)
    },
  }
}
