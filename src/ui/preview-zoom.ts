import type { Bitmap } from '../core/bitmap'
import { el, iconButton } from './dom'
import { icon } from './icons'

/**
 * Cadre d'apercu zoomable, partage par les boites de dialogue.
 *
 * Un apercu de 190 pixels ne suffit pas a juger d'un ombrage ou d'un
 * anti-crenelage : il faut aller voir le pixel. Le cadre se zoome a la
 * molette autour du pointeur, se deplace en le tirant, et surtout garde son
 * cadrage quand le contenu est remplace — sinon chaque nouveau reglage
 * ramenerait au plan large et il faudrait tout refaire.
 */

/** Paliers de zoom : entiers au-dela de 1, pour que le pixel reste carre. */
const PALIERS = [0.25, 0.5, 0.75, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32]

const palierSuivant = (z: number, sens: 1 | -1): number => {
  if (sens > 0) return PALIERS.find((p) => p > z + 1e-6) ?? PALIERS[PALIERS.length - 1]
  const dessous = PALIERS.filter((p) => p < z - 1e-6)
  return dessous.length ? dessous[dessous.length - 1] : PALIERS[0]
}

export interface ZoomablePreview {
  /** A poser dans le dialogue. */
  node: HTMLElement
  /** Remplace le contenu ; le cadrage est conserve si l'utilisateur l'a regle. */
  show(source: HTMLCanvasElement | Bitmap): void
  /** Reviens au cadrage automatique. */
  fit(): void
}

export function zoomablePreview(opts: { hauteur?: number } = {}): ZoomablePreview {
  const hauteur = opts.hauteur ?? 210
  const scene = el('div', { class: 'apercu-scene' })
  const cadre = el('div', { class: 'apercu-zoom', style: { height: `${hauteur}px` } }, scene)

  let zoom = 1
  let x = 0, y = 0
  /** Vrai des que l'utilisateur a zoome ou deplace : on ne le recadre plus. */
  let regleALaMain = false
  let contenu: HTMLCanvasElement | null = null

  const badge = el('span', { class: 'apercu-zoom-valeur' }, '1×')

  const poser = (): void => {
    scene.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${zoom})`
    badge.textContent = zoom >= 1 ? `${Math.round(zoom)}×` : `${Math.round(zoom * 100)}%`
  }

  const ajuster = (): void => {
    if (!contenu) return
    const l = cadre.clientWidth - 16, h = cadre.clientHeight - 16
    const brut = Math.min(l / contenu.width, h / contenu.height)
    // On descend au palier inferieur plutot que de choisir une echelle
    // quelconque : un pixel a 3,7 fois sa taille n'est plus un carre.
    zoom = brut >= 1
      ? (PALIERS.filter((p) => p <= brut).pop() ?? 1)
      : Math.max(PALIERS[0], brut)
    x = (cadre.clientWidth - contenu.width * zoom) / 2
    y = (cadre.clientHeight - contenu.height * zoom) / 2
    poser()
  }

  const zoomerVers = (facteur: number, cx: number, cy: number): void => {
    const avant = zoom
    zoom = facteur
    if (zoom === avant) return
    // Le point sous le pointeur ne doit pas bouger.
    x = cx - (cx - x) * (zoom / avant)
    y = cy - (cy - y) * (zoom / avant)
    regleALaMain = true
    poser()
  }

  cadre.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = cadre.getBoundingClientRect()
    zoomerVers(palierSuivant(zoom, e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top)
  }, { passive: false })

  let tire: { px: number; py: number } | null = null
  cadre.addEventListener('pointerdown', (e) => {
    tire = { px: e.clientX, py: e.clientY }
    cadre.setPointerCapture(e.pointerId)
    cadre.classList.add('tire')
  })
  cadre.addEventListener('pointermove', (e) => {
    if (!tire) return
    x += e.clientX - tire.px
    y += e.clientY - tire.py
    tire = { px: e.clientX, py: e.clientY }
    regleALaMain = true
    poser()
  })
  const lacher = (e: PointerEvent) => {
    if (!tire) return
    tire = null
    cadre.releasePointerCapture(e.pointerId)
    cadre.classList.remove('tire')
  }
  cadre.addEventListener('pointerup', lacher)
  cadre.addEventListener('pointercancel', lacher)
  cadre.addEventListener('dblclick', () => { regleALaMain = false; ajuster() })

  const barre = el('div', { class: 'apercu-barre' },
    iconButton(icon('zoom-out', 13), 'Reduire', () => {
      zoomerVers(palierSuivant(zoom, -1), cadre.clientWidth / 2, cadre.clientHeight / 2)
    }, { className: 'ghost sm icon-only' }),
    badge,
    iconButton(icon('zoom-in', 13), 'Agrandir', () => {
      zoomerVers(palierSuivant(zoom, 1), cadre.clientWidth / 2, cadre.clientHeight / 2)
    }, { className: 'ghost sm icon-only' }),
    iconButton(icon('fit', 13), 'Ajuster (double-clic dans l\'apercu)', () => {
      regleALaMain = false
      ajuster()
    }, { className: 'ghost sm icon-only' }),
    el('span', { class: 'apercu-aide' }, 'molette : zoom · glisser : deplacer'),
  )

  const node = el('div', { class: 'apercu-bloc' }, cadre, barre)

  return {
    node,
    show(source) {
      const canvas = 'toCanvas' in source ? source.toCanvas() : source
      canvas.style.width = `${canvas.width}px`
      canvas.style.height = `${canvas.height}px`
      contenu = canvas
      scene.replaceChildren(canvas)
      // Le cadre n'a pas de taille tant qu'il n'est pas dans la page.
      if (!regleALaMain) requestAnimationFrame(() => { if (!regleALaMain) ajuster() })
      else poser()
    },
    fit() { regleALaMain = false; ajuster() },
  }
}
