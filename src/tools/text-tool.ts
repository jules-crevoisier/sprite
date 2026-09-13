import type { Editor } from '../core/editor'
import { ICONS } from '../ui/icons'
import { Painter } from './painter'
import { toCss } from '../core/color'
import type { PointerInfo, Tool, OverlayContext } from './types'
import {
  fonteParId, largeurLigne, mesurerTexte, pixelsDeTexte,
  echelleDe, type Fonte, type PoseTexte,
} from '../core/fontes'

/**
 * L'outil TEXTE : on tape sur le dessin, on relit, puis on grave.
 *
 * ## Pourquoi le texte n'est pas grave a la frappe
 *
 * Graver chaque lettre au moment ou on la tape ferait de « bonjour » sept
 * gestes dans l'historique, et corriger une faute obligerait a gommer a la
 * main. Le texte reste donc en ATTENTE — dessine par-dessus le sprite, sans y
 * toucher — jusqu'a ce qu'on le grave. Un seul geste entre alors dans
 * l'historique, et un seul Ctrl+Z le retire en entier.
 *
 * ## Pourquoi changer d'outil GRAVE au lieu d'abandonner
 *
 * Le texte en attente est invisible dans le document : rien ne le sauve. Le
 * perdre parce qu'on a pris la pipette pour verifier une couleur serait le
 * genre de perte qu'on ne pardonne pas a un editeur. Changer d'outil grave
 * donc ce qui est tape ; Echap, qui veut dire « laisse tomber », l'abandonne.
 */

/** Reglages de l'outil, partages avec la barre d'options. */
export const reglagesTexte: PoseTexte & { fonte: string } = {
  fonte: 'cinq-sept',
  echelle: 1,
  alignement: 'gauche',
}

interface Saisie {
  /** Coin haut-gauche du texte, en pixels sprite. */
  x: number
  y: number
  /** Les caracteres tapes, un par element : le curseur compte en LETTRES. */
  lettres: string[]
  /** Position du curseur, entre 0 et lettres.length. */
  caret: number
}

let saisie: Saisie | null = null
/** Deplacement du texte en attente : ecart entre l'ancre et le curseur. */
let glisse: { dx: number; dy: number } | null = null

/** Le texte en attente, pour les tests et la barre d'etat. */
export function texteEnAttente(): { x: number; y: number; texte: string } | null {
  if (!saisie) return null
  return { x: saisie.x, y: saisie.y, texte: saisie.lettres.join('') }
}

function fonteCourante(): Fonte {
  return fonteParId(reglagesTexte.fonte)
}

function pose(): PoseTexte {
  return { echelle: reglagesTexte.echelle, alignement: reglagesTexte.alignement }
}

/** Redessine l'apercu sans rien changer au document. */
function rafraichir(ed: Editor): void {
  ed.events.emit('apercu', undefined)
}

/** La boite occupee par le texte en attente, en pixels sprite. */
export function boiteTexte(): { x: number; y: number; l: number; h: number } | null {
  if (!saisie) return null
  const f = fonteCourante()
  const m = mesurerTexte(f, saisie.lettres.join(''), pose())
  return { x: saisie.x, y: saisie.y, l: Math.max(m.l, echelleDe(pose())), h: m.h }
}

/**
 * Ou se trouve le curseur de frappe, en pixels sprite.
 *
 * On remesure la ligne en cours plutot que de tenir une position a jour : la
 * fonte, l'echelle et l'alignement peuvent changer entre deux frappes, et une
 * position gardee de cote serait alors fausse — le curseur se retrouverait au
 * milieu d'une lettre.
 */
function posCaret(): { x: number; y: number; h: number } | null {
  if (!saisie) return null
  const f = fonteCourante()
  const p = pose()
  const e = echelleDe(p)
  const avant = saisie.lettres.slice(0, saisie.caret).join('')
  const rang = (avant.match(/\n/g) ?? []).length
  const debutLigne = avant.slice(avant.lastIndexOf('\n') + 1)
  const lignes = saisie.lettres.join('').split('\n')
  const m = mesurerTexte(f, saisie.lettres.join(''), p)
  const largeur = largeurLigne(f, lignes[rang] ?? '') * e
  const decalage = p.alignement === 'centre'
    ? Math.floor((m.l - largeur) / 2)
    : p.alignement === 'droite' ? m.l - largeur : 0
  const x = debutLigne.length
    ? (largeurLigne(f, debutLigne) + f.chasse) * e + decalage
    : decalage
  return {
    x: saisie.x + x,
    y: saisie.y + rang * (f.h + f.interligne) * e,
    h: f.h * e,
  }
}

/* ------------------------------------------------------------------ */
/* Gravure                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pose le texte en attente dans la case active, en un seul geste.
 *
 * Rend true si quelque chose a ete grave : l'appelant peut alors le dire.
 */
export function graverTexte(ed: Editor): boolean {
  const s = saisie
  saisie = null
  glisse = null
  if (!s || !s.lettres.length) { rafraichir(ed); return false }

  const texte = s.lettres.join('')
  const f = fonteCourante()
  const points = pixelsDeTexte(f, texte, pose())
  if (!points.length) { rafraichir(ed); return false }

  const cel = ed.beginStroke('Texte')
  if (!cel) { rafraichir(ed); return false }
  const painter = new Painter(cel.bitmap, {
    selection: ed.selection,
    brushSize: 1,
    brushShape: 'square',
    color: ed.primary,
    mode: ed.settings.paintMode === 'erase' ? 'normal' : ed.settings.paintMode,
    opacity: ed.settings.opacity,
    tiled: ed.tiledDrawing,
  })
  painter.beginStroke()
  for (const pt of points) painter.plot(s.x + pt.x, s.y + pt.y)
  painter.endStroke()
  ed.events.emit('doc', undefined)
  ed.commitStroke()
  return true
}

/** Abandonne le texte en attente sans rien graver. */
function abandonner(ed: Editor): void {
  saisie = null
  glisse = null
  rafraichir(ed)
}

/* ------------------------------------------------------------------ */
/* Clavier                                                             */
/* ------------------------------------------------------------------ */

/**
 * La frappe pendant une saisie, avant les raccourcis globaux.
 *
 * Sans cette prise, taper « bonjour » changerait sept fois d'outil : « b »
 * est le crayon, « j » la pose du squelette. Tant qu'un curseur clignote sur
 * le dessin, les lettres appartiennent au texte.
 */
function clavier(ed: Editor, e: KeyboardEvent): boolean {
  const s = saisie
  if (!s) return false
  const ctrl = e.ctrlKey || e.metaKey

  if (e.key === 'Enter' && ctrl) { graverTexte(ed); return true }
  if (e.key === 'Enter') { inserer(ed, '\n'); return true }
  if (e.key === 'Escape') return false // cancel() s'en charge : abandon.

  if (e.key === 'Backspace') {
    if (s.caret > 0) { s.lettres.splice(s.caret - 1, 1); s.caret-- }
    rafraichir(ed)
    return true
  }
  if (e.key === 'Delete') {
    if (s.caret < s.lettres.length) s.lettres.splice(s.caret, 1)
    rafraichir(ed)
    return true
  }
  if (e.key === 'ArrowLeft') { s.caret = Math.max(0, s.caret - 1); rafraichir(ed); return true }
  if (e.key === 'ArrowRight') { s.caret = Math.min(s.lettres.length, s.caret + 1); rafraichir(ed); return true }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { deplacerLigne(ed, e.key === 'ArrowUp' ? -1 : 1); return true }
  if (e.key === 'Home') { s.caret = debutDeLigne(s); rafraichir(ed); return true }
  if (e.key === 'End') { s.caret = finDeLigne(s); rafraichir(ed); return true }

  // Une lettre : `key` vaut le caractere produit, accents et AltGr compris.
  if (!ctrl && !e.altKey && [...e.key].length === 1) { inserer(ed, e.key); return true }
  return false
}

function inserer(ed: Editor, c: string): void {
  const s = saisie
  if (!s) return
  s.lettres.splice(s.caret, 0, c)
  s.caret++
  rafraichir(ed)
}

function debutDeLigne(s: Saisie): number {
  let i = s.caret
  while (i > 0 && s.lettres[i - 1] !== '\n') i--
  return i
}

function finDeLigne(s: Saisie): number {
  let i = s.caret
  while (i < s.lettres.length && s.lettres[i] !== '\n') i++
  return i
}

/** Monte ou descend d'une ligne en gardant la colonne, comme un editeur. */
function deplacerLigne(ed: Editor, sens: -1 | 1): void {
  const s = saisie
  if (!s) return
  const colonne = s.caret - debutDeLigne(s)
  if (sens < 0) {
    const debut = debutDeLigne(s)
    if (debut === 0) { s.caret = 0; rafraichir(ed); return }
    s.caret = debut - 1
    const d = debutDeLigne(s)
    s.caret = Math.min(d + colonne, finDeLigne(s))
  } else {
    const fin = finDeLigne(s)
    if (fin >= s.lettres.length) { s.caret = s.lettres.length; rafraichir(ed); return }
    s.caret = fin + 1
    const d = debutDeLigne(s)
    s.caret = Math.min(d + colonne, finDeLigne(s))
  }
  rafraichir(ed)
}

/* ------------------------------------------------------------------ */
/* Apercu                                                              */
/* ------------------------------------------------------------------ */

function apercu(ed: Editor, o: OverlayContext, p: PointerInfo | null): void {
  const s = saisie
  const ctx = o.ctx
  const z = o.zoom
  const f = fonteCourante()
  const e = echelleDe(pose())

  if (!s) {
    // Rien n'est tapé : on montre au survol la hauteur de la ligne qui naîtra
    // du clic. Sans ce repère, on découvre la taille du texte après l'avoir
    // tapé, et l'on recommence.
    if (!p || p.px < 0 || p.py < 0 || p.px >= ed.sprite.width || p.py >= ed.sprite.height) return
    ctx.save()
    ctx.fillStyle = 'rgba(120,190,255,0.55)'
    ctx.fillRect(p.px, p.py, Math.max(1, e / 2), f.h * e)
    ctx.restore()
    return
  }

  ctx.save()
  // Le texte sort dans la couleur qu'il aura : un aperçu d'une autre teinte
  // ferait juger la lisibilité sur un contraste qui n'est pas le bon.
  //
  // Ce qui DÉBORDE de la toile est dessiné en fantôme. L'aperçu ne connaît pas
  // les bords et peignait joyeusement dans la zone de travail, alors que la
  // gravure, elle, s'arrête au cadre : on voyait un titre entier et l'on
  // obtenait trois lettres. Le fantôme dit lesquelles se perdront, sans les
  // cacher — les cacher laisserait croire à un texte plus court.
  const plein = toCss(ed.primary)
  for (const pt of pixelsDeTexte(f, s.lettres.join(''), pose())) {
    const x = s.x + pt.x, y = s.y + pt.y
    const dedans = x >= 0 && y >= 0 && x < ed.sprite.width && y < ed.sprite.height
    ctx.globalAlpha = dedans ? 1 : 0.22
    ctx.fillStyle = plein
    ctx.fillRect(x, y, 1, 1)
  }
  ctx.globalAlpha = 1

  // La boîte : elle dit où le texte commence même quand il est encore vide.
  const boite = boiteTexte()
  if (boite) {
    ctx.strokeStyle = 'rgba(120,190,255,0.9)'
    ctx.lineWidth = 1 / z
    ctx.setLineDash([3 / z, 3 / z])
    ctx.strokeRect(boite.x - 0.5 / z, boite.y - 0.5 / z, boite.l + 1 / z, boite.h + 1 / z)
    ctx.setLineDash([])
  }

  // Le curseur de frappe. Il ne clignote pas : un clignotement demanderait de
  // redessiner la vue en continu, et l'on verrait la machine chauffer pour une
  // barre qui s'allume. Il est plein, et on le voit tout aussi bien.
  const c = posCaret()
  if (c) {
    ctx.fillStyle = 'rgba(120,190,255,0.95)'
    ctx.fillRect(c.x, c.y, Math.max(1, e / 2), c.h)
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* L'outil                                                             */
/* ------------------------------------------------------------------ */

export const textTool: Tool = {
  id: 'text',
  name: 'Texte',
  shortcut: 'T',
  icon: ICONS.text,
  group: 'shape',
  cursor: 'text',
  hint: 'Tapez ; Entrée saute une ligne, Ctrl+Entrée grave, Échap abandonne. '
    + 'Glissez la boîte pour la déplacer.',
  options: ['texte', 'opacity', 'paintMode'],

  down(ed, p: PointerInfo) {
    const boite = boiteTexte()
    // Un clic DANS la boite deplace le texte ; ailleurs, il grave et repart.
    if (saisie && boite
      && p.x >= boite.x && p.x < boite.x + boite.l
      && p.y >= boite.y && p.y < boite.y + boite.h) {
      glisse = { dx: saisie.x - p.px, dy: saisie.y - p.py }
      return
    }
    if (saisie) graverTexte(ed)
    saisie = { x: p.px, y: p.py, lettres: [], caret: 0 }
    glisse = null
    rafraichir(ed)
  },

  move(ed, p: PointerInfo) {
    if (!saisie || !glisse) return
    saisie.x = p.px + glisse.dx
    saisie.y = p.py + glisse.dy
    rafraichir(ed)
  },

  up() { glisse = null },

  cancel(ed) { abandonner(ed) },

  /** Changer d'outil grave : le texte en attente n'existe nulle part ailleurs. */
  quitter(ed) { graverTexte(ed) },

  overlay(ed, o, p) { apercu(ed, o, p) },

  clavier,
}
