import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { fenetre, lin } from '../mouvement'
import { Ecran, Legende, Puce, Sprite } from '../atomes'
import { BlocTitre, cascade, tempsStation } from './commun'

const t = tempsStation('effets')

/**
 * Station « effets de calque » : huit effets non destructifs.
 *
 * Chaque vignette est le rendu de renderEffects avec les reglages par defaut
 * de l'effet, sur le meme dessin. Poser les huit cote a cote sur une source
 * identique est la seule facon de les comparer : sur huit dessins differents
 * on ne compare plus que les dessins.
 */
export const Effets: React.FC = () => {
  const frame = useCurrentFrame()
  const pile = D.pile.noms
  // La pile se monte au meme rythme que le personnage l'empile a l'ecran.
  const monte = frame < t(1.9) ? 0
    : Math.min(pile.length, Math.floor(lin(frame, t(1.9), t(6.1)) * pile.length) + 1)
  const coupe = frame >= t(7.9) && frame < t(8.9)

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.2)} accent={C.indigo}
        kicker="Effets de calque" titre="Non destructifs"
        legende="Ombre portee, lueur, contour, biseau, teinte, degrade : regles en direct au-dessus du calque. Les pixels du dessin ne changent jamais."
        style={{ left: 952, top: 132 }}
        taille={56}
      />

      {/* Les huit effets, sur le meme dessin. */}
      <div style={{
        position: 'absolute', left: 952, top: 404,
        display: 'grid', gridTemplateColumns: 'repeat(4, 196px)', gap: 12,
      }}>
        {D.effets.map((effet, i) => {
          const p = cascade(frame, t(0.9), i, 3.5)
          return (
            <div key={effet.id} style={{
              opacity: p, transform: `translateY(${(1 - p) * 18}px) scale(${0.9 + 0.1 * p})`,
              background: 'rgba(20,21,32,0.7)', border: `1px solid ${C.trait}`,
              borderRadius: 12, padding: '12px 12px 14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Sprite src={effet.image} w={D.sprite.w} h={D.sprite.h} echelle={3} />
              </div>
              <div style={{
                marginTop: 10, textAlign: 'center', fontFamily: POLICES.titre,
                fontSize: 15, fontWeight: 600, color: '#b9bdd0', letterSpacing: '-0.01em',
              }}>{effet.label}</div>
            </div>
          )
        })}
      </div>

      {/* La pile posee sur le personnage, en cinq crans. */}
      <div style={{ position: 'absolute', left: 120, top: 108 }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 18 }}>
          PILE DU CALQUE
        </Legende>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {pile.map((nom, i) => {
            const actif = i < monte && !coupe
            const p = fenetre(frame, t(1.9) + i * 12, 1e9, 14, 1)
            return (
              <React.Fragment key={nom}>
                {i > 0 ? (
                  <div style={{
                    width: 16, height: 1, background: actif ? C.indigo : C.faible, opacity: p * 0.7,
                  }} />
                ) : null}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 15px', borderRadius: 999, opacity: p,
                  background: actif ? 'rgba(91,108,255,0.16)' : 'rgba(255,255,255,0.035)',
                  border: `1px solid ${actif ? `${C.indigo}77` : 'transparent'}`,
                  transform: `translateY(${(1 - p) * 10}px)`,
                }}>
                  <span style={{
                    width: 13, height: 13, borderRadius: 4, flex: 'none',
                    background: actif ? C.indigo : 'transparent',
                    border: `1.5px solid ${actif ? C.indigo : C.faible}`,
                  }} />
                  <span style={{
                    fontFamily: POLICES.titre, fontSize: 17, fontWeight: 600,
                    color: actif ? C.encre : C.faible, letterSpacing: '-0.01em',
                    whiteSpace: 'nowrap',
                  }}>{nom.replace('-', ' ')}</span>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>

      <div style={{
        position: 'absolute', left: 120, top: 902,
        opacity: fenetre(frame, t(7.6), 1e9, 14, 1),
      }}>
        <Puce couleur={coupe ? C.menthe : C.indigo}>
          {coupe ? 'effets coupes : le dessin est intact' : 'huit effets, zero pixel modifie'}
        </Puce>
      </div>

      <Ecran
        src="ui/effets.png" largeur={420}
        style={{
          position: 'absolute', left: 952, top: 826,
          opacity: fenetre(frame, t(4.2), 1e9, 24, 1),
        }}
      />

      <Legende
        taille={15} couleur={C.faible}
        style={{ position: 'absolute', left: 1404, top: 852, letterSpacing: '0.24em', width: 330 }}
      >
        LE PANNEAU D&apos;EFFETS,
        <br />TEL QU&apos;IL EST DANS L&apos;APPLICATION
      </Legende>
    </>
  )
}
