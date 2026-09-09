import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { fenetre, seg } from '../mouvement'
import { Ecran, Legende, Rampe } from '../atomes'
import { BlocTitre, tempsStation } from './commun'

const t = tempsStation('ombrage')

/**
 * Station « ombrage » : ombrage automatique puis anti-crenelage.
 *
 * Les chiffres affiches sont ceux que la fonction rend — pixels changes,
 * matieres reconnues, pixels lisses. Un compteur invente aurait l'air aussi
 * vrai ; celui-ci varie avec le dessin, ce qui est precisement l'interet.
 */
export const Ombrage: React.FC = () => {
  const frame = useCurrentFrame()
  const secondePasse = frame >= t(3.5)

  const stats: { valeur: number; nom: string; couleur: string; a: number }[] = [
    { valeur: D.ombrage.matieres, nom: 'matieres reconnues', couleur: C.ambre, a: 1.3 },
    { valeur: D.ombrage.touches, nom: 'pixels ombres', couleur: C.rose, a: 1.6 },
    { valeur: D.ombrage.lisses, nom: 'pixels lisses', couleur: C.menthe, a: 3.9 },
  ]

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.1)} accent={C.ambre}
        kicker="Assiste" titre="Ombrer, puis lisser"
        legende="Chaque pixel monte ou descend dans sa propre rampe selon la direction de la lumiere. Rien n'est invente : la palette reste celle du dessin."
        style={{ left: 96, top: 120 }}
        taille={54}
      />

      {/* Les deux etats compares, annonces de part et d'autre du volet. */}
      <div style={{
        position: 'absolute', left: 120, top: 428,
        opacity: fenetre(frame, t(0.8), 1e9, 18, 1),
      }}>
        <div style={{
          fontFamily: POLICES.pixel, fontSize: 26, color: C.faible, letterSpacing: '0.05em',
        }}>avant</div>
        <Legende taille={16} couleur={C.faible} style={{ marginTop: 12 }}>
          aplats sortis du crayon
        </Legende>
      </div>

      <div style={{
        position: 'absolute', right: 120, top: 428, textAlign: 'right',
        opacity: fenetre(frame, t(1.2), 1e9, 18, 1),
      }}>
        <div style={{
          fontFamily: POLICES.pixel, fontSize: 26,
          color: secondePasse ? C.menthe : C.ambre, letterSpacing: '0.05em',
        }}>{secondePasse ? 'anti-crenele' : 'ombre'}</div>
        <Legende taille={16} couleur={C.faible} style={{ marginTop: 12 }}>
          {secondePasse ? 'les marches d\'escalier adoucies' : 'volume rendu dans la meme palette'}
        </Legende>
      </div>

      {/* Les chiffres rendus par les deux fonctions. */}
      <div style={{ position: 'absolute', left: 120, top: 556 }}>
        {stats.map((stat) => {
          const p = seg(frame, t(stat.a), t(stat.a + 0.9))
          return (
            <div key={stat.nom} style={{ opacity: p, marginBottom: 26 }}>
              <div style={{
                fontFamily: POLICES.titre, fontWeight: 900, fontSize: 62,
                color: stat.couleur, letterSpacing: '-0.05em', lineHeight: 1,
              }}>{Math.round(stat.valeur * p)}</div>
              <Legende taille={15} couleur={C.faible} style={{ marginTop: 10 }}>{stat.nom}</Legende>
            </div>
          )
        })}
      </div>

      {/* Les rampes dans lesquelles les tons ont ete pris. */}
      <div style={{
        position: 'absolute', left: 120, top: 938,
        opacity: fenetre(frame, t(2.3), 1e9, 22, 1),
      }}>
        <Legende taille={14} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 12 }}>
          TONS DISPONIBLES
        </Legende>
        <div style={{ display: 'flex', gap: 18 }}>
          {D.rampes.map((rampe) => (
            <Rampe key={rampe.nom} couleurs={rampe.couleurs} case_={22} hauteur={22} />
          ))}
        </div>
      </div>

      <Ecran
        src="ui/dlg-ombrage.png" largeur={380}
        style={{
          position: 'absolute', right: 118, top: 540,
          opacity: fenetre(frame, t(2.8), 1e9, 24, 1),
        }}
      />
    </>
  )
}
