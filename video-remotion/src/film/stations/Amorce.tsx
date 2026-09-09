import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { FIN_RECUL } from '../plan'
import { fenetre, seg } from '../mouvement'
import { Kicker, Legende } from '../atomes'
import { avancementGrille, pixelsAllumes } from '../Hero'
import { tempsStation } from './commun'

const t = tempsStation('amorce')

/**
 * Ouverture : un dessin de quarante-huit pixels s'allume, et la signature
 * arrive une fois le mouvement retombe.
 *
 * L'instant ou la signature entre n'est pas choisi a la main : il suit la fin
 * du recul, mesuree sur le ressort qui l'execute. Regle en secondes, ce
 * chiffre se decalerait des qu'on retouche le ressort et la signature
 * entrerait alors que le personnage bouge encore.
 */
export const Amorce: React.FC = () => {
  const frame = useCurrentFrame()
  const pose = FIN_RECUL + 14
  const signature = fenetre(frame, pose, 1e9, 22, 1)
  const chiffres = fenetre(frame, pose + 26, 1e9, 20, 1)
  const halo = seg(frame, t(0), FIN_RECUL)

  return (
    <>
      {/* Halo qui s'ouvre au rythme du dessin : le fond respire avec lui. */}
      <div style={{
        position: 'absolute', left: 960 - 900, top: 540 - 900, width: 1800, height: 1800,
        borderRadius: '50%', opacity: 0.5 * halo,
        background: `radial-gradient(circle, ${C.indigo}30 0%, transparent 58%)`,
      }} />

      {/* La signature est a droite parce que le personnage part a gauche : au
          centre ou a gauche, il lui passe dessus juste apres son apparition. */}
      <div style={{
        position: 'absolute', right: 118, top: 660, opacity: signature,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {[C.indigo, C.violet, C.rose].map((couleur, i) => (
              <div key={couleur} style={{
                width: 15, height: 30, background: couleur, borderRadius: 3,
                transform: `translateY(${(1 - seg(frame, pose + i * 3, pose + 20 + i * 3)) * 26}px)`,
              }} />
            ))}
          </div>
          <div style={{
            fontFamily: POLICES.titre, fontWeight: 900, fontSize: 52, letterSpacing: '-0.045em',
            color: C.encre,
          }}>
            Pixel<span style={{ color: C.indigo }}>Forge</span>
          </div>
        </div>
        <Kicker style={{ marginTop: 14, fontSize: 17 }}>
          editeur de sprites &amp; d&apos;animation
        </Kicker>
      </div>

      <div style={{
        position: 'absolute', right: 118, top: 812, opacity: chiffres,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      }}>
        <div style={{
          width: 300 * chiffres, height: 2,
          background: `linear-gradient(270deg, ${C.indigo}, transparent)`,
        }} />
        <Legende style={{ marginTop: 16 }}>
          {D.grille.w} × {D.grille.h} pixels · {D.palette.length} couleurs · {D.rampes.length} matieres reconnues
        </Legende>
      </div>

      <div style={{ position: 'absolute', left: 118, top: 918, opacity: signature }}>
        <Legende taille={17} couleur={C.faible}>
          tout ce qui suit sort du logiciel
          <br />aucune image n&apos;a ete redessinee
        </Legende>
      </div>

      {/* Le compte des pixels allumes, tant que le dessin se remplit. */}
      <div style={{
        position: 'absolute', right: 120, top: 240,
        opacity: 1 - seg(frame, FIN_RECUL, FIN_RECUL + 42), textAlign: 'right',
      }}>
        <div style={{
          fontFamily: POLICES.mono, fontSize: 15, color: C.faible, letterSpacing: '0.3em',
        }}>PIXELS ALLUMES</div>
        <div style={{
          fontFamily: POLICES.pixel, fontSize: 46, color: C.encre, marginTop: 10,
        }}>
          {pixelsAllumes(avancementGrille(frame))}
        </div>
      </div>
    </>
  )
}
