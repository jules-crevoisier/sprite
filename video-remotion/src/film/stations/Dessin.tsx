import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { fenetre, seg } from '../mouvement'
import { Hublot, Icone, Legende, Rampe } from '../atomes'
import { BlocTitre, cascade, tempsStation } from './commun'

const t = tempsStation('dessin')

/**
 * Station « atelier » : les outils, la palette, les rampes.
 *
 * Les icones ne sont pas redessinees pour le film : ce sont celles que la
 * barre d'outils affiche, recuperees dans le registre des outils. Le jour ou
 * un outil change d'icone, le film change avec lui.
 */
export const Dessin: React.FC = () => {
  const frame = useCurrentFrame()
  const outils = D.outils.filter((o) => o.groupe === 'draw')

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.2)} accent={C.cyan}
        kicker="Atelier" titre="Dessiner au pixel"
        legende="Crayon, courbe, degrade, tramage, symetrie. Les outils d'un editeur de sprites, avec le pixel perfect et l'apercu du trait."
        style={{ left: 760, top: 168 }}
      />

      {/* Les outils, en cascade : on lit la barre se remplir. */}
      <div style={{
        position: 'absolute', left: 762, top: 480,
        display: 'grid', gridTemplateColumns: 'repeat(4, 244px)', gap: 12,
      }}>
        {outils.slice(0, 10).map((outil, i) => {
          const p = cascade(frame, t(0.9), i, 3)
          return (
            <div key={outil.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', borderRadius: 12,
              background: 'rgba(20,21,32,0.8)', border: `1px solid ${C.trait}`,
              opacity: p, transform: `translateY(${(1 - p) * 16}px)`,
            }}>
              <Icone markup={outil.icone} taille={22} couleur={i === 0 ? C.cyan : '#c9cddd'} />
              <span style={{
                fontFamily: POLICES.titre, fontSize: 17, fontWeight: 600,
                color: i === 0 ? C.encre : '#a7abc0', flex: 1, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{outil.nom}</span>
              <span style={{
                fontFamily: POLICES.mono, fontSize: 13, color: C.faible,
              }}>{outil.raccourci}</span>
            </div>
          )
        })}
      </div>

      {/* La palette du sprite, case par case. */}
      <div style={{ position: 'absolute', left: 762, top: 762 }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 14 }}>
          PALETTE · {D.palette.length} COULEURS
        </Legende>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 30px)', gap: 4 }}>
          {D.palette.map((couleur, i) => {
            const p = cascade(frame, t(2.4), i, 1.1)
            return (
              <div key={`${couleur}-${i}`} style={{
                width: 30, height: 30, background: couleur, borderRadius: 5,
                opacity: p, transform: `scale(${0.4 + 0.6 * p})`,
              }} />
            )
          })}
        </div>
      </div>

      {/* Les rampes extraites du dessin : chaque matiere et ses tons. */}
      <div style={{ position: 'absolute', left: 1354, top: 762 }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 14 }}>
          RAMPES TROUVEES
        </Legende>
        {D.rampes.map((rampe, i) => {
          const p = seg(frame, t(3.6) + i * 10, t(4.5) + i * 10)
          return (
            <div key={rampe.nom} style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Rampe couleurs={rampe.couleurs} case_={30} hauteur={30} revele={p} />
              <span style={{
                fontFamily: POLICES.mono, fontSize: 15, color: C.sourdine, opacity: p,
              }}>{rampe.nom} · {rampe.pixels} px</span>
            </div>
          )
        })}
      </div>

      {/* La barre d'options, telle qu'elle est a l'ecran. */}
      <div style={{
        position: 'absolute', left: 118, top: 856,
        opacity: fenetre(frame, t(5.2), 1e9, 24, 1),
      }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 14 }}>
          BARRE D&apos;OPTIONS
        </Legende>
        <Hublot
          src="ui/options.png" native={3200} echelle={0.78}
          largeur={560} hauteur={64} oy={-6}
        />
      </div>

      <div style={{ position: 'absolute', left: 118, top: 208, opacity: fenetre(frame, t(6.1), 1e9, 20, 1) }}>
        <Legende taille={17} couleur={C.faible}>
          taille, opacite, tramage, symetrie
          <br />se reglent sans quitter le trait
        </Legende>
      </div>
    </>
  )
}
