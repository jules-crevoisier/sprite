import type { Editor } from '../core/editor'
import { compositeFrame } from '../render/composite'
import { jouer, type Partie } from '../jeu/moteur'
import {
  manquePour, niveauVide, ROLES, serialiser,
  type Decor, type Niveau, type Role,
} from '../jeu/niveau'
import { calque, huitDirections } from '../demo/jeu'
import { downloadText, safeName } from '../export/files'
import { el, clear, numberInput, select } from './dom'
import { openModal, showToast } from './overlay'

/**
 * Editeur de niveaux : les frames du sprite deviennent des tuiles.
 *
 * C'est la reponse a une question qu'on se pose des qu'on a dessine un
 * tileset : et maintenant ? Exporter une planche PNG et aller la peindre
 * ailleurs, c'est perdre le lien — on change une tuile, il faut tout
 * reexporter, et on ne sait jamais si le niveau tient encore debout.
 *
 * Ici les tuiles SONT les frames du document. On dit ce que chacune fait —
 * sol, mur, caisse, plaque, porte, sortie, depart, creature — on peint la
 * grille, et on appuie sur Jouer. Le moteur est exactement celui de la
 * demonstration publique : l'editeur ne peut donc pas promettre un jeu qu'on
 * n'obtiendrait pas.
 *
 * Le niveau vit dans le document, pas a cote : il part avec le projet, se
 * range dans la bibliotheque, et survit au rechargement.
 */

/** Roles devines a l'ouverture, quand aucun n'a encore ete choisi. */
function rolesParDefaut(nb: number): Role[] {
  const out: Role[] = new Array(nb).fill('sol')
  // La premiere frame sert de sol, la deuxieme de mur : c'est l'ordre dans
  // lequel on dessine un tileset neuf neuf fois sur dix, et cela evite
  // d'ouvrir sur une grille ou rien n'est jouable.
  if (nb > 1) out[1] = 'mur'
  return out
}

export function niveauDialog(ed: Editor): void {
  const sprite = ed.sprite
  const nbTuiles = sprite.frameCount
  const cote = Math.max(sprite.width, sprite.height)

  const enregistre = sprite.niveau
  let niveau: Niveau = enregistre
    ? { largeur: enregistre.largeur, hauteur: enregistre.hauteur, tuile: enregistre.tuile, cases: [...enregistre.cases] }
    : niveauVide(15, 11, cote)
  let roles: Role[] = enregistre?.roles?.length
    ? (enregistre.roles as Role[]).slice(0, nbTuiles)
    : rolesParDefaut(nbTuiles)
  while (roles.length < nbTuiles) roles.push('sol')

  /** Les tuiles, rendues une fois : une frame aplatie par index. */
  const ECHELLE_JEU = 2
  const images = Array.from({ length: nbTuiles }, (_, f) =>
    calque(compositeFrame(sprite, f), ECHELLE_JEU))
  const vignettes = Array.from({ length: nbTuiles }, (_, f) =>
    calque(compositeFrame(sprite, f), 2))

  let choisie = 0
  let partie: Partie | null = null

  /* ---------------- la grille ---------------- */

  const ZOOM = 2
  const grille = document.createElement('canvas')
  grille.className = 'niv-grille'
  const gctx = grille.getContext('2d')!
  gctx.imageSmoothingEnabled = false

  const dimensionner = (): void => {
    grille.width = niveau.largeur * niveau.tuile * ZOOM
    grille.height = niveau.hauteur * niveau.tuile * ZOOM
  }

  const peindreGrille = (): void => {
    const T = niveau.tuile * ZOOM
    gctx.fillStyle = '#0d0b12'
    gctx.fillRect(0, 0, grille.width, grille.height)
    for (let y = 0; y < niveau.hauteur; y++) {
      for (let x = 0; x < niveau.largeur; x++) {
        const i = niveau.cases[y * niveau.largeur + x]
        if (i >= 0 && images[i]) {
          gctx.drawImage(images[i], 0, 0, images[i].width, images[i].height, x * T, y * T, T, T)
        }
        // Le depart n'a pas d'image a lui : sans marque, on le poserait deux
        // fois sans le voir.
        if (i >= 0 && roles[i] === 'depart') {
          gctx.fillStyle = '#5b8dee'
          gctx.fillRect(x * T + T / 4, y * T + T / 4, T / 2, T / 2)
        }
      }
    }
    gctx.strokeStyle = 'rgba(255,255,255,0.07)'
    gctx.lineWidth = 1
    for (let x = 0; x <= niveau.largeur; x++) {
      gctx.beginPath(); gctx.moveTo(x * T + 0.5, 0); gctx.lineTo(x * T + 0.5, grille.height); gctx.stroke()
    }
    for (let y = 0; y <= niveau.hauteur; y++) {
      gctx.beginPath(); gctx.moveTo(0, y * T + 0.5); gctx.lineTo(grille.width, y * T + 0.5); gctx.stroke()
    }
  }

  const caseSous = (e: PointerEvent): { x: number; y: number } | null => {
    const r = grille.getBoundingClientRect()
    const T = (niveau.tuile * ZOOM) * (r.width / grille.width)
    const x = Math.floor((e.clientX - r.left) / T)
    const y = Math.floor((e.clientY - r.top) / T)
    if (x < 0 || y < 0 || x >= niveau.largeur || y >= niveau.hauteur) return null
    return { x, y }
  }

  let peint = false
  const poser = (e: PointerEvent, effacer: boolean): void => {
    const c = caseSous(e)
    if (!c) return
    niveau.cases[c.y * niveau.largeur + c.x] = effacer ? -1 : choisie
    peindreGrille()
    dire()
  }
  grille.addEventListener('pointerdown', (e) => {
    if (partie) return
    grille.setPointerCapture(e.pointerId)
    peint = true
    poser(e, e.button === 2)
  })
  grille.addEventListener('pointermove', (e) => { if (peint) poser(e, e.buttons === 2) })
  grille.addEventListener('pointerup', () => { peint = false })
  grille.addEventListener('contextmenu', (e) => e.preventDefault())

  /* ---------------- la palette ---------------- */

  const palette = el('div', { class: 'niv-palette' })

  const rendrePalette = (): void => {
    clear(palette)
    for (let f = 0; f < nbTuiles; f++) {
      const vignette = el('div', { class: 'niv-vignette' })
      vignette.appendChild(vignettes[f])
      const carte = el('button', {
        class: `niv-tuile ${f === choisie ? 'active' : ''}`,
        title: `Frame ${f + 1} — ${ROLES.find((r) => r.id === roles[f])?.aide ?? ''}`,
        onclick: () => { choisie = f; rendrePalette() },
      }, vignette, el('span', { class: 'niv-num' }, String(f + 1)))
      const choixRole = select(ROLES.map((r) => ({ value: r.id, label: r.nom })), roles[f],
        (v) => { roles[f] = v as Role; rendrePalette(); peindreGrille(); dire() })
      choixRole.className = 'niv-role'
      choixRole.addEventListener('pointerdown', (e) => e.stopPropagation())
      palette.append(el('div', { class: 'niv-case-palette' }, carte, choixRole))
    }
  }

  /* ---------------- pied : etat et jeu ---------------- */

  const info = el('p', { class: 'form-note' })
  const scene = el('div', { class: 'niv-scene' }, grille)

  const decorCourant = (): Decor => ({
    images,
    roles,
    heros: huitDirections(compositeFrame(sprite, ed.activeFrame), ECHELLE_JEU).images,
    fond: roles.indexOf('sol'),
  })

  /** L'etat du bouton seul : il change aussi pendant la partie. */
  const majBouton = (): void => {
    const manques = manquePour(niveau, { images, roles, heros: [], fond: 0 })
    boutonJouer.disabled = manques.length > 0 && !partie
    boutonJouer.textContent = partie ? 'Revenir à l\'éditeur' : 'Jouer'
  }

  /**
   * La ligne d'etat. Pendant une partie, c'est le moteur qui parle : la
   * recouvrir de « prêt à jouer » effacerait le compte de pas au moment ou il
   * commence a servir.
   */
  const dire = (): void => {
    majBouton()
    if (partie) return
    const manques = manquePour(niveau, { images, roles, heros: [], fond: 0 })
    info.textContent = manques.length
      ? `Il manque ${manques.join(', ')}.`
      : `${niveau.largeur}×${niveau.hauteur} cases · prêt à jouer`
    info.style.color = manques.length ? 'var(--warn, #e0a33e)' : 'var(--text-faint)'
  }

  const boutonJouer = el('button', { class: 'btn primary sm' }, 'Jouer')
  boutonJouer.addEventListener('click', () => {
    if (partie) {
      partie.arreter()
      partie = null
      clear(scene)
      scene.appendChild(grille)
      dire()
      return
    }
    const manques = manquePour(niveau, { images, roles, heros: [], fond: 0 })
    if (manques.length) { showToast(`Il manque ${manques.join(', ')}`, 'error'); return }
    // Le heros, c'est la frame courante, vue sous huit directions calculees
    // a l'instant : on teste son propre personnage, pas une doublure.
    partie = jouer(niveau, decorCourant(), {
      echelle: ECHELLE_JEU,
      surEtat: (texte) => { info.textContent = texte; info.style.color = 'var(--text-faint)' },
    })
    clear(scene)
    scene.appendChild(partie.canvas)
    partie.canvas.focus()
    majBouton()
  })

  const largeur = numberInput(niveau.largeur, (v) => redimensionner(v, niveau.hauteur), { min: 4, max: 64 })
  const hauteur = numberInput(niveau.hauteur, (v) => redimensionner(niveau.largeur, v), { min: 4, max: 64 })

  /** Redimensionne sans jeter ce qui tient encore dans la nouvelle grille. */
  const redimensionner = (l: number, h: number): void => {
    if (partie) return
    const cases = new Array(l * h).fill(-1)
    for (let y = 0; y < Math.min(h, niveau.hauteur); y++) {
      for (let x = 0; x < Math.min(l, niveau.largeur); x++) {
        cases[y * l + x] = niveau.cases[y * niveau.largeur + x]
      }
    }
    niveau = { ...niveau, largeur: l, hauteur: h, cases }
    dimensionner()
    peindreGrille()
    dire()
  }

  const remplir = (role: Role): void => {
    const i = roles.indexOf(role)
    if (i < 0) { showToast(`Aucune tuile n'a le rôle « ${role} »`, 'error'); return }
    niveau.cases.fill(i)
    peindreGrille()
    dire()
  }

  const body = el('div', { class: 'niv-corps' },
    el('p', { class: 'form-note', style: { margin: '0 0 10px', lineHeight: '1.6' } },
      'Chaque frame de ce sprite est une tuile. Dites ce qu\'elle fait, peignez la '
      + 'grille — clic droit pour effacer — et jouez. Le moteur est celui de la '
      + 'démo : ce que vous voyez ici est ce que vous obtiendrez.'),
    el('div', { class: 'niv-plan' },
      el('div', { class: 'niv-colonne' },
        el('div', { class: 'form-section' }, 'Tuiles'),
        palette,
      ),
      el('div', { class: 'niv-colonne large' },
        scene,
        el('div', { class: 'niv-barre' },
          el('label', null, 'Largeur'), largeur,
          el('label', null, 'Hauteur'), hauteur,
          el('button', { class: 'btn ghost sm', onclick: () => remplir('sol') }, 'Tout en sol'),
          el('button', { class: 'btn ghost sm', onclick: () => remplir('mur') }, 'Tout en mur'),
          el('span', { class: 'spacer', style: { flex: '1' } }),
          boutonJouer,
        ),
        info,
      ),
    ),
  )

  dimensionner()
  peindreGrille()
  rendrePalette()
  dire()

  const garder = (): void => {
    ed.run('Niveau', () => {
      sprite.niveau = {
        largeur: niveau.largeur, hauteur: niveau.hauteur, tuile: niveau.tuile,
        cases: [...niveau.cases], roles: [...roles],
      }
    })
  }

  openModal({
    title: 'Éditeur de niveau',
    icon: 'grid',
    body,
    wide: true,
    actions: [
      { label: 'Fermer' },
      {
        label: 'Exporter le niveau',
        onClick: () => {
          downloadText(serialiser(niveau, roles), `${safeName(sprite.name)}-niveau.json`, 'application/json')
          showToast('Niveau exporté', 'success')
          return false
        },
      },
    ],
    onClose: () => {
      partie?.arreter()
      garder()
    },
  })
}
