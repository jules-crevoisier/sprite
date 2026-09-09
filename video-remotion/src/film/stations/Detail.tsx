import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { fenetre, lin } from '../mouvement'
import { Ecran, Legende, Sprite } from '../atomes'
import { BlocTitre, tempsStation } from './commun'

const t = tempsStation('detail')

/**
 * Station « matieres » : le generateur de detail, passe par passe.
 *
 * Le bloc d'herbe est celui du logiciel, et chaque etape affichee est le
 * resultat d'un appel a addDetail avec les reglages de l'enchainement
 * « Herbe ». Montrer les passes une a une plutot que le seul resultat final
 * est ce qui explique l'outil : on voit d'ou vient chaque grain.
 */
export const Detail: React.FC = () => {
  const frame = useCurrentFrame()
  const etapes = D.detail.etapes
  const taille = D.detail.taille
  const echelle = 24
  const i = Math.min(etapes.length - 1, Math.floor(lin(frame, t(0.9), t(3.4)) * etapes.length))
  const noms = ['dessin nu', ...D.detail.modes]

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.1)} accent={C.menthe}
        kicker="Generateur" titre="La matiere, passe par passe"
        legende="Chaque pixel se decale d'un cran dans sa propre rampe : le detail s'ajoute sans jamais introduire une couleur qui n'etait pas la."
        style={{ left: 120, top: 148 }}
        taille={56}
      />

      {/* Le bloc en cours de traitement. */}
      <div style={{ position: 'absolute', left: 168, top: 486 }}>
        <Sprite src={etapes[i]} w={taille} h={taille} echelle={echelle} />
        <div style={{
          marginTop: 22, fontFamily: POLICES.mono, fontSize: 19, color: C.menthe,
          letterSpacing: '0.08em',
        }}>
          passe {i} · {noms[i]}
        </div>
      </div>

      {/* Les passes deja faites, en petit : la progression reste lisible. */}
      <div style={{ position: 'absolute', left: 664, top: 486, display: 'flex', gap: 22 }}>
        {etapes.map((src, k) => {
          const p = fenetre(frame, t(0.9) + k * 22, 1e9, 14, 1)
          const fait = k <= i
          return (
            <div key={src} style={{ opacity: p * (fait ? 1 : 0.25) }}>
              <div style={{
                border: `2px solid ${k === i ? C.menthe : 'transparent'}`,
                borderRadius: 8, padding: 4,
              }}>
                <Sprite src={src} w={taille} h={taille} echelle={7} />
              </div>
              <div style={{
                marginTop: 10, textAlign: 'center', fontFamily: POLICES.mono,
                fontSize: 14, color: k === i ? C.encre : C.faible,
              }}>{k}</div>
            </div>
          )
        })}
      </div>

      {/* Un autre enchainement sur le meme bloc : la pierre. */}
      <div style={{
        position: 'absolute', left: 664, top: 690,
        opacity: fenetre(frame, t(4.1), 1e9, 22, 1),
      }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 16 }}>
          MEME BLOC, ENCHAINEMENT « PIERRE »
        </Legende>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <Sprite src={etapes[0]} w={taille} h={taille} echelle={9} />
          <div style={{ fontFamily: POLICES.mono, fontSize: 26, color: C.faible }}>→</div>
          <Sprite src={D.detail.pierre} w={taille} h={taille} echelle={9} />
          <Legende taille={17} style={{ marginLeft: 12 }}>
            taches, ombre des bords, grain
            <br />trois reglages, un seul geste
          </Legende>
        </div>
      </div>

      <Ecran
        src="ui/dlg-detail.png" largeur={392}
        style={{
          position: 'absolute', left: 1420, top: 468,
          opacity: fenetre(frame, t(2.6), 1e9, 24, 1),
        }}
      />
    </>
  )
}
