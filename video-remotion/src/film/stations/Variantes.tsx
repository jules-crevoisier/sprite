import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { spring } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { fenetre } from '../mouvement'
import { RESSORT_VIF } from '../mouvement'
import { Ecran, Legende, Rampe, Sprite } from '../atomes'
import { BlocTitre, tempsStation } from './commun'

const t = tempsStation('variantes')

/**
 * Station « variantes » : la meme silhouette, six palettes.
 *
 * Les six dessins sortent de generateVariants : le film ne recolorie rien
 * lui-meme, il affiche le resultat de la meme fonction que le bouton du
 * logiciel, rampe par rampe.
 */
export const Variantes: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const n = D.variantes.length

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.2)} accent={C.violet}
        kicker="Assiste" titre="Six declinaisons"
        legende="Chaque rampe est decalee en teinte sans toucher au modele : l'ombrage du dessin reste exactement celui d'origine."
        style={{ left: 120, top: 152 }}
        taille={58}
      />

      {/* Arc de variantes autour du personnage : elles arrivent en eventail. */}
      {D.variantes.map((variante, i) => {
        const p = spring({
          frame: frame - t(1.5) - i * 5, fps, config: RESSORT_VIF, durationInFrames: 34,
        })
        // Trois a gauche, trois a droite : le personnage reste au centre et
        // l'oeil compare deux a deux au lieu de balayer une file.
        const cote = i < n / 2 ? -1 : 1
        const rang = i % Math.ceil(n / 2)
        const x = 960 + cote * (300 + rang * 232) - 108
        const y = 300 + rang * 106
        return (
          <div key={variante.label} style={{
            position: 'absolute', left: x, top: y,
            opacity: p, transform: `scale(${0.72 + 0.28 * p})`,
          }}>
            <Sprite src={variante.image} w={D.sprite.w} h={D.sprite.h} echelle={4} />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
              <Rampe couleurs={variante.rampe} case_={26} hauteur={14} revele={p} />
            </div>
            <div style={{
              marginTop: 10, textAlign: 'center', fontFamily: POLICES.mono,
              fontSize: 15, color: C.sourdine,
            }}>{variante.label}</div>
          </div>
        )
      })}

      {/* Les strategies reellement proposees par le dialogue. */}
      <div style={{
        position: 'absolute', left: 120, top: 852, display: 'flex', gap: 10, flexWrap: 'wrap',
        width: 900,
      }}>
        {D.strategies.map((strategie, i) => {
          const p = fenetre(frame, t(3.6) + i * 5, 1e9, 16, 1)
          const actif = strategie.id === 'hue'
          return (
            <div key={strategie.id} style={{
              padding: '10px 18px', borderRadius: 999,
              border: `1px solid ${actif ? C.violet : C.trait}`,
              background: actif ? `${C.violet}22` : 'rgba(20,21,32,0.7)',
              fontFamily: POLICES.titre, fontSize: 18, fontWeight: 600,
              color: actif ? C.encre : '#9298ae',
              opacity: p, transform: `translateY(${(1 - p) * 12}px)`,
            }}>{strategie.label}</div>
          )
        })}
      </div>

      <Ecran
        src="ui/dlg-variantes.png" largeur={520}
        style={{
          position: 'absolute', right: 118, bottom: 96,
          opacity: fenetre(frame, t(4.6), 1e9, 24, 1),
        }}
      />

      <Legende
        taille={16} couleur={C.faible}
        style={{ position: 'absolute', left: 120, top: 786, letterSpacing: '0.3em' }}
      >
        STRATEGIES DISPONIBLES
      </Legende>
    </>
  )
}
