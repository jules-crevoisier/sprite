import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { STATIONS } from '../plan'
import { fenetre, seg } from '../mouvement'
import { tempsStation } from './commun'

const t = tempsStation('final')

/**
 * Fin : la camera recule et le chemin parcouru devient lisible.
 *
 * Les reperes sont poses aux coordonnees monde des stations, pas sur une
 * grille inventee. Le dernier plan n'est donc pas un carton : c'est le film
 * lui-meme, vu de loin, avec les noms de ce qui vient d'etre montre.
 */
export const Final: React.FC = () => {
  const frame = useCurrentFrame()
  const etapes = STATIONS.slice(0, -1)

  return (
    <>
      {etapes.map((station, i) => {
        // Les reperes s'effacent quand la signature arrive : le chemin doit
        // rester lisible derriere le nom, pas se battre avec lui.
        const p = fenetre(frame, t(1.6) + i * 4, 1e9, 22, 1)
          * (1 - 0.82 * seg(frame, t(3.9), t(4.9)))
        return (
          <div key={station.id} style={{
            position: 'absolute',
            left: station.monde.x - 6600 + 960 - 950,
            top: station.monde.y - 120 + 540 - 320,
            width: 1900, textAlign: 'center', opacity: p,
          }}>
            <div style={{
              width: 76, height: 76, borderRadius: '50%', margin: '0 auto',
              background: station.accent, boxShadow: `0 0 90px ${station.accent}`,
              transform: `scale(${0.5 + 0.5 * p})`,
            }} />
            <div style={{
              marginTop: 60, fontFamily: POLICES.titre, fontWeight: 800, fontSize: 232,
              letterSpacing: '-0.04em', color: C.encre, lineHeight: 1,
            }}>{station.titre}</div>
            <div style={{
              marginTop: 40, fontFamily: POLICES.mono, fontSize: 96,
              letterSpacing: '0.24em', color: station.accent, textTransform: 'uppercase',
            }}>{station.kicker}</div>
          </div>
        )
      })}
    </>
  )
}
