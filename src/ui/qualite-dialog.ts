import type { Editor } from '../core/editor'
import { compositeFrame } from '../render/composite'
import { verifier, type Constat, type Rapport } from '../qualite/verifier'
import { el, clear, checkbox } from './dom'
import { icon } from './icons'
import { openModal } from './overlay'

/**
 * Controle qualite : ce qui cloche dans le dessin, et quoi en faire.
 *
 * Ce n'est pas une note. Une note ne se corrige pas — « 6/10 » ne dit ni ou
 * regarder ni quoi changer. Chaque ligne ici porte un defaut precis, chiffre,
 * et le geste qui le repare.
 *
 * Toutes les regles sont calculees : elles ne varient pas d'un jour a l'autre,
 * elles ne se laissent pas convaincre, et elles coutent zero. Ce qui reste —
 * le gout, le style, l'intention — n'est pas ici, et c'est voulu.
 */

const COULEUR = {
  bloquant: 'var(--danger, #e05252)',
  important: 'var(--warn, #e0a33e)',
  remarque: 'var(--text-faint)',
} as const

const ICONE = { bloquant: 'close', important: 'info', remarque: 'info' } as const

function ligne(c: Constat): HTMLElement {
  return el('div', { class: `qual-ligne ${c.gravite}` },
    el('span', { class: 'qual-puce', html: icon(ICONE[c.gravite], 13), style: { color: COULEUR[c.gravite] } }),
    el('div', null,
      el('div', { class: 'qual-quoi' }, c.quoi),
      c.quoiFaire ? el('div', { class: 'qual-faire' }, c.quoiFaire) : null,
      c.ou?.length
        ? el('div', { class: 'qual-ou' },
          `en ${c.ou.slice(0, 6).map((p) => `${p.x},${p.y}`).join(' · ')}`
          + (c.ou.length > 6 ? ` et ${c.ou.length - 6} autre(s)` : ''))
        : null,
    ),
  )
}

export function qualiteDialog(ed: Editor): void {
  const opts = { palette: false, toutesLesFrames: false }
  const corps = el('div', { class: 'qual-corps' })

  const rendre = (): void => {
    clear(corps)
    const frames = opts.toutesLesFrames
      ? Array.from({ length: ed.sprite.frameCount }, (_, f) => f)
      : [ed.activeFrame]
    const paletteProjet = opts.palette ? ed.sprite.palette.colors : undefined

    let total = 0
    for (const f of frames) {
      const r: Rapport = verifier(compositeFrame(ed.sprite, f), { palette: paletteProjet })
      total += r.constats.length
      const titre = frames.length > 1 ? `Frame ${f + 1}` : null
      const bloc = el('div', { class: 'qual-bloc' })
      if (titre) bloc.appendChild(el('div', { class: 'form-subsection' }, titre))
      if (!r.constats.length) {
        bloc.appendChild(el('div', { class: 'qual-ligne remarque' },
          el('span', { class: 'qual-puce', html: icon('check', 13), style: { color: 'var(--ok, #7cc47f)' } }),
          el('div', { class: 'qual-quoi' }, 'Rien à signaler.')))
      }
      for (const c of r.constats) bloc.appendChild(ligne(c))
      bloc.appendChild(el('div', { class: 'qual-mesures' },
        `${r.mesures.largeur}×${r.mesures.hauteur} · ${r.mesures.pixels} pixels · `
        + `${r.mesures.couleurs} couleurs · silhouette cernée à ${r.mesures.cerne}% · `
        + `trait franc sur ${r.mesures.traitFranc}% · ${r.mesures.aplats}% en aplats`
        + (r.mesures.tuile ? ' · traité comme une tuile' : '')))
      corps.appendChild(bloc)
    }
    resume.textContent = total
      ? `${total} constat(s) sur ${frames.length} frame(s).`
      : `Aucun constat sur ${frames.length} frame(s).`
  }

  const resume = el('p', { class: 'form-note' })

  const body = el('div', null,
    el('p', { class: 'form-note', style: { margin: '0 0 8px', lineHeight: '1.6' } },
      'Des règles calculées, pas un avis : couleurs indiscernables, pixels isolés, '
      + 'silhouette qui se casse en petit, trait qui ne tranche pas. Ce qui relève '
      + 'du goût n\'est pas ici.'),
    el('div', { class: 'form-row', style: { gap: '14px', marginBottom: '8px' } },
      checkbox('Comparer à la palette du projet', false, (v) => { opts.palette = v; rendre() }),
      checkbox('Toutes les frames', false, (v) => { opts.toutesLesFrames = v; rendre() }),
    ),
    corps,
    resume,
  )

  rendre()

  openModal({
    title: 'Contrôle qualité',
    icon: 'check',
    body,
    wide: true,
    actions: [{ label: 'Fermer', primary: true }],
  })
}
