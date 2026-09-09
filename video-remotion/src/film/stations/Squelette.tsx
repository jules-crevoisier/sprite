import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { fenetre } from '../mouvement'
import { Hublot, Legende, Puce } from '../atomes'
import { BlocTitre, Ligne, cascade, tempsStation } from './commun'

const t = tempsStation('squelette')

/**
 * Station « squelette » : os, liaison, deformation, demi-tour.
 *
 * La liste d'os affichee est celle du modele applique au sprite, avec les
 * couleurs que le logiciel attribue a chaque os. C'est la meme table que la
 * carte des poids projetee sur le personnage : le spectateur peut relier une
 * ligne de la liste a une zone du dessin.
 */
export const Squelette: React.FC = () => {
  const frame = useCurrentFrame()

  /** Les etiquettes suivent ce que le personnage est en train de faire. */
  const jalons: { a: number; b: number; texte: string; couleur: string }[] = [
    { a: 0.8, b: 3.2, texte: 'modele humanoide pose sur le dessin', couleur: C.rose },
    { a: 3.0, b: 5.2, texte: 'liaison automatique : un os par pixel', couleur: C.ambre },
    { a: 5.2, b: 7.6, texte: 'deformation pixel, membres a deux segments', couleur: C.menthe },
    { a: 7.4, b: 11, texte: 'demi-tour pseudo-3D', couleur: C.cyan },
  ]

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.2)} accent={C.rose}
        kicker="Squelette" titre="Rigger un sprite"
        legende="Un modele d'os, une liaison automatique, et le dessin se deforme au pixel. Les membres portent deux segments : epaule-coude, coude-main."
        style={{ left: 984, top: 152 }}
        taille={58}
      />

      {/* Les os du modele, dans l'ordre de la hierarchie. */}
      <div style={{ position: 'absolute', left: 984, top: 452, width: 470 }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 12 }}>
          {D.os.length} OS · {D.modeleOs.label.toUpperCase()}
        </Legende>
        {D.os.map((os, i) => {
          const p = cascade(frame, t(1.1), i, 3)
          return (
            <div key={os.nom} style={{ opacity: p, transform: `translateX(${(1 - p) * -16}px)` }}>
              <Ligne
                couleur={os.couleur}
                nom={`${os.parent === null ? '' : '— '}${os.nom}`}
                valeur={os.role}
              />
            </div>
          )
        })}
      </div>

      {/* Le panneau reel, pour montrer que la liste sort de l'interface. */}
      <div style={{
        position: 'absolute', left: 1520, top: 452,
        opacity: fenetre(frame, t(2.2), 1e9, 24, 1),
      }}>
        <Hublot
          src="ui/panneau-os.png" native={574} echelle={0.62}
          largeur={296} hauteur={470}
        />
        <Legende taille={14} couleur={C.faible} style={{ marginTop: 14, letterSpacing: '0.2em' }}>
          PANNEAU SQUELETTE
        </Legende>
      </div>

      {/* Ce que le personnage montre a cet instant. */}
      <div style={{ position: 'absolute', left: 120, top: 916 }}>
        {jalons.map((jalon) => {
          const p = fenetre(frame, t(jalon.a), t(jalon.b), 16, 12)
          if (p < 0.01) return null
          return (
            <div key={jalon.texte} style={{
              position: 'absolute', left: 0, top: 0,
              opacity: p, transform: `translateY(${(1 - p) * 14}px)`,
            }}>
              <Puce couleur={jalon.couleur}>{jalon.texte}</Puce>
            </div>
          )
        })}
      </div>

      <div style={{
        position: 'absolute', left: 120, top: 208,
        opacity: fenetre(frame, t(5.4), t(7.4), 20, 14),
      }}>
        <div style={{
          fontFamily: POLICES.pixel, fontSize: 30, color: C.menthe, letterSpacing: '0.04em',
        }}>2 segments</div>
        <Legende taille={16} couleur={C.faible} style={{ marginTop: 12 }}>
          cuisse → tibia
          <br />bras → avant-bras
        </Legende>
      </div>
    </>
  )
}
