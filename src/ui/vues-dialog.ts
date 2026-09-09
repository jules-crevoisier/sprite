import { Bitmap } from '../core/bitmap'
import type { Editor } from '../core/editor'
import { compositeFrame } from '../render/composite'
import { hauteurSuggeree, profilDe, champAuto } from '../smart/depth'
import {
  ELEVATION_ISO_2_1, planchesDeDirections, pivotDesPieces,
  type Direction, type Piece,
} from '../smart/scene'
import { piecesDeLaScene } from '../smart/rig-scene'
import { diagnostiquer, sourcesFaceEtDos } from '../smart/vues'
import { bitmapToPngBlob, download, safeName } from '../export/files'
import { el, clear, select, checkbox } from './dom'
import { openModal, showToast } from './overlay'

/**
 * Planche de directions : un dessin de face, tout le tour du personnage.
 *
 * C'est la raison d'etre de la scene multi-vues, et elle n'etait branchee sur
 * aucun ecran — le travail existait sans que personne puisse s'en servir.
 *
 * Ce que la planche montre honnetement :
 *
 * - de face, c'est le dessin, au pixel pres ;
 * - sur les cotes, le personnage se comprime et son relief fait glisser ses
 *   volumes : une base juste de proportions ;
 * - de dos, c'est le dessin retourne dont on a efface les traits du visage,
 *   parce qu'un dos n'a pas d'yeux. Le reste — cheveux, vetements — est deja
 *   a peu pres bon, un vetement ne changeant pas de couleur en tournant.
 *
 * Chaque direction se pose en frame, ce qui est le point : on reprend au
 * crayon celles qui le meritent, dans l'editeur, avec tous ses outils.
 */

const DEG = Math.PI / 180

const HAUTEURS: { value: string; label: string; elevation: number }[] = [
  { value: 'face', label: 'De face (jeu de plateforme)', elevation: 0 },
  { value: 'legere', label: 'Légère plongée', elevation: 20 * DEG },
  { value: 'iso', label: 'Isométrique 2:1', elevation: ELEVATION_ISO_2_1 },
  { value: 'plongee', label: 'Vue de dessus (RPG)', elevation: 55 * DEG },
]

/**
 * D'ou le dessin est vu.
 *
 * C'est le reglage le plus important de cet ecran, et celui qu'on oublie : la
 * rotation suppose un dessin de FACE. Un sprite de jeu de plateforme est vu de
 * profil, un sprite de jeu vu de dessus est en trois-quarts plongeant. Les
 * faire tourner comme s'ils etaient de face donne un resultat faux d'un quart
 * de tour, sans que rien ne le dise.
 */
const VUES_SOURCE: { value: string; label: string; azimut: number; elevation: number }[] = [
  { value: 'face', label: 'De face', azimut: 0, elevation: 0 },
  { value: 'trois-quarts', label: 'De trois-quarts', azimut: 45 * DEG, elevation: 0 },
  { value: 'profil', label: 'De profil', azimut: 90 * DEG, elevation: 0 },
  { value: 'dos', label: 'De dos', azimut: 180 * DEG, elevation: 0 },
  { value: 'plongee', label: 'En plongée (jeu vu de dessus)', azimut: 0, elevation: 40 * DEG },
]

/** Les pieces a rendre : les morceaux du squelette, ou le dessin entier. */
function piecesDuDocument(
  ed: Editor, dosAuto: boolean, vueSource: string,
): { pieces: Piece[]; relie: boolean; plat: Bitmap } {
  const src = VUES_SOURCE.find((v) => v.value === vueSource) ?? VUES_SOURCE[0]
  const plat = compositeFrame(ed.sprite, ed.activeFrame)
  const relie = ed.sprite.rig.parts.length > 0 && ed.sprite.rig.bones.length > 0
  if (relie) {
    const pieces = piecesDeLaScene(ed.sprite.rig, { dosAuto })
    // La direction declaree s'applique a toutes les sources d'origine : le
    // dos devine, lui, reste a l'oppose.
    for (const p of pieces) {
      for (const s of p.sources) {
        s.azimut += src.azimut
        s.elevation += src.elevation
      }
    }
    if (pieces.length) return { pieces, relie: true, plat }
  }
  const b = plat.trimBounds()
  const relief = { hauteur: hauteurSuggeree(plat), galbe: 0.5 }
  const sources = dosAuto
    ? sourcesFaceEtDos(plat, relief)
    : [{ azimut: 0, elevation: 0, bitmap: plat, champ: champAuto(plat, relief) }]
  for (const s of sources) { s.azimut += src.azimut; s.elevation += src.elevation }
  return {
    pieces: [{
      nom: ed.sprite.name,
      sources,
      pivot: { x: b.x + (b.w - 1) / 2, y: b.y + (b.h - 1) / 2, z: 0 },
      position: { x: b.x + (b.w - 1) / 2, y: b.y + (b.h - 1) / 2, z: 0 },
      rotation: { lacet: 0, tangage: 0, roulis: 0 },
    }],
    relie: false,
    plat,
  }
}

/** Assemble les directions en une planche horizontale. */
function planche(directions: Direction[], l: number, h: number): Bitmap {
  const out = new Bitmap(l * directions.length, h)
  directions.forEach((d, i) => { out.paste(d.rendu.image, i * l, 0) })
  return out
}

export function vuesDialog(ed: Editor): void {
  const etat = {
    nombre: 8,
    hauteur: 'face',
    dosAuto: true,
    vueSource: 'face',
  }

  const grille = el('div', { class: 'vues-grille' })
  const info = el('p', { class: 'form-note' })
  const alertes = el('div', { class: 'vues-alertes' })
  let dernieres: Direction[] = []

  const rendre = (): void => {
    const { pieces, relie, plat } = piecesDuDocument(ed, etat.dosAuto, etat.vueSource)
    const elevation = HAUTEURS.find((x) => x.value === etat.hauteur)?.elevation ?? 0
    dernieres = planchesDeDirections(pieces, etat.nombre, elevation, {
      largeur: ed.sprite.width,
      hauteur: ed.sprite.height,
      centre: { x: ed.sprite.width / 2, y: ed.sprite.height / 2 },
      pivotMonde: pivotDesPieces(pieces),
    })

    clear(grille)
    for (const d of dernieres) {
      const cv = d.rendu.image.toCanvas()
      cv.className = 'vue-vignette'
      const ecart = Math.round((d.rendu.ecartMax * 180) / Math.PI)
      grille.appendChild(el('figure', { class: 'vue-case' },
        cv,
        el('figcaption', null,
          el('b', null, d.nom),
          el('span', {
            class: ecart > 60 ? 'vue-invente' : '',
            title: ecart <= 5
              ? 'Un vrai dessin, ou presque'
              : `Cette direction est a ${ecart}° du dessin le plus proche : `
                + 'plus l\'ecart est grand, plus c\'est une devinette',
          }, ecart <= 5 ? 'dessiné' : `${ecart}° devinés`),
        ),
      ))
    }

    const premiere = dernieres[0]?.rendu
    const profil = premiere ? profilDe(
      pieces[0].sources[0].bitmap, pieces[0].sources[0].champ) : 0
    info.textContent = `${etat.nombre} directions · ${relie ? 'découpé par le squelette' : 'dessin entier'}`
      + ` · profil à ${Math.round(profil * 100)}% de la face`
      + (etat.dosAuto ? ' · dos deviné' : ' · sans vue de dos')

    // Ce qui, dans le dessin lui-meme, va gener la rotation. Dit avant, pas
    // apres avoir passe une heure a se demander pourquoi c'est moche.
    clear(alertes)
    for (const mot of diagnostiquer(plat).avertissements) {
      alertes.appendChild(el('p', { class: 'vues-alerte' }, mot))
    }
  }

  const body = el('div', null,
    el('p', { class: 'form-note', style: { margin: '0 0 10px', lineHeight: '1.6' } },
      'De face, c\'est votre dessin au pixel près. Sur les côtés, le personnage se '
      + 'comprime et son relief fait glisser ses volumes. De dos, c\'est le dessin '
      + 'retourné dont les traits du visage ont été effacés — chaque vignette dit '
      + 'de combien elle devine.'),
    alertes,
    grille,
    el('div', { class: 'form-grid' },
      el('label', { title: 'La rotation part de la direction que vous déclarez ici' },
        'Le dessin est vu'),
      select(VUES_SOURCE.map((v) => ({ value: v.value, label: v.label })), 'face',
        (v) => { etat.vueSource = v; rendre() }),
      el('label', null, 'Directions'),
      select([
        { value: '4', label: '4 — les quatre points cardinaux' },
        { value: '8', label: '8 — le compas complet' },
        { value: '16', label: '16 — rotation fluide' },
      ], '8', (v) => { etat.nombre = Number(v); rendre() }),
      el('label', null, 'Point de vue'),
      select(HAUTEURS.map((h) => ({ value: h.value, label: h.label })), 'face',
        (v) => { etat.hauteur = v; rendre() }),
      el('label', { title: 'Le dessin retourné, sans les yeux' }, 'Vue de dos'),
      checkbox('Deviner le dos', true, (v) => { etat.dosAuto = v; rendre() }),
    ),
    info,
    el('p', { class: 'form-note' },
      'Posez la planche en frames pour reprendre au crayon les directions qui le '
      + 'méritent : ce sont vos images, l\'algorithme ne les regénère pas derrière vous.'),
  )

  rendre()

  openModal({
    title: 'Toutes les directions',
    icon: 'rig',
    body,
    wide: true,
    actions: [
      { label: 'Fermer' },
      {
        label: 'Exporter la planche',
        onClick: () => {
          const img = planche(dernieres, ed.sprite.width, ed.sprite.height)
          void bitmapToPngBlob(img).then((blob) => {
            download(blob, `${safeName(ed.sprite.name)}-${dernieres.length}-directions.png`)
            showToast('Planche exportée', 'success')
          })
          return false
        },
      },
      {
        label: 'Poser en frames',
        primary: true,
        onClick: () => {
          const images = dernieres.map((d) => d.rendu.image.clone())
          const noms = dernieres.map((d) => d.nom)
          ed.run('Planche de directions', () => {
            const s = ed.sprite
            const depart = s.frameCount
            for (let i = 0; i < images.length; i++) {
              s.addFrame(depart + i)
              const cel = s.ensureCel(s.layers.length - 1, depart + i)
              cel.bitmap.copyFrom(images[i])
              // Les autres calques restent vides sur ces frames : la planche
              // est un rendu compose, pas un empilement a refaire.
            }
            s.tags.push({
              id: (s.tags.at(-1)?.id ?? 0) + 1,
              name: 'directions',
              from: depart,
              to: depart + images.length - 1,
              direction: 'forward',
              repeat: 0,
              color: 0xff5b8dee,
            })
          })
          ed.setActiveFrame(ed.sprite.frameCount - images.length)
          showToast(`${images.length} directions posées (${noms.join(', ')})`, 'success')
        },
      },
    ],
  })
}
