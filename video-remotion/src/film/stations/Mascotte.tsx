import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { fenetre, imageDeCycle, seg } from '../mouvement'
import { Ecran, Legende, Sprite } from '../atomes'
import { BlocTitre, Ligne, cascade, tempsStation } from './commun'

const t = tempsStation('mascotte')

/**
 * Station « mascotte » : Pixl, ses six cycles et ses trois armes.
 *
 * Elle n'est pas la pour faire joli. C'est le seul endroit du film ou l'on
 * voit un sprite anime image par image et non deforme par un squelette : le
 * meme editeur sert aux deux, et c'est ce que la station met cote a cote.
 *
 * Les armes sont montrees seules a cote du cycle arme, parce que c'est ainsi
 * qu'elles sont faites — une couche par-dessus les memes poses, pas une
 * deuxieme animation. Une arme qu'on ne reconnait pas a sa silhouette ne sert
 * a rien dans un jeu, donc on la donne a voir isolee.
 */
export const Mascotte: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const T = D.pixl.taille
  const suite = [...D.pixl.clips.map((c) => c.id), ...D.pixl.armes.map((a) => `coup-${a.id}`)]
  const rang = Math.min(suite.length - 1,
    Math.floor(seg(frame, t(1.4), t(9.6)) * suite.length))
  const actif = suite[rang]

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.2)} accent={C.violet}
        kicker="Mascotte" titre="Pixl"
        legende="Six cycles poses image par image, trente-deux pixels de cote, une seule palette. Le meme editeur que le personnage riggue — sauf qu'ici, chaque pose est dessinee."
        style={{ left: 900, top: 128 }}
        taille={72}
      />

      {/* Les six cycles a la main, avec leur cadence reelle. */}
      <div style={{ position: 'absolute', left: 900, top: 424, width: 430 }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 12 }}>
          {D.pixl.clips.length} CYCLES DESSINES
        </Legende>
        {D.pixl.clips.map((clip, i) => {
          const p = cascade(frame, t(0.9), i, 3)
          return (
            <div key={clip.id} style={{ opacity: p, transform: `translateX(${(1 - p) * -14}px)` }}>
              <Ligne
                nom={clip.nom}
                valeur={`${clip.images.length} img · ${clip.ms} ms`}
                actif={clip.id === actif}
                couleur={clip.id === actif ? C.violet : undefined}
              />
            </div>
          )
        })}
      </div>

      {/* Les trois armes : la silhouette seule, puis ce qu'elle change. */}
      <div style={{ position: 'absolute', left: 1394, top: 424, width: 420 }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 12 }}>
          {D.pixl.armes.length} ARMES, UNE COUCHE PAR-DESSUS
        </Legende>
        {D.pixl.armes.map((arme, i) => {
          const p = fenetre(frame, t(3.4) + i * 14, 1e9, 20, 1)
          const coup = arme.clips.find((c) => c.id === `coup-${arme.id}`) ?? arme.clips[0]
          const vise = actif === `coup-${arme.id}`
          return (
            <div key={arme.id} style={{
              display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10,
              padding: '10px 14px', borderRadius: 12,
              background: vise ? 'rgba(168,85,247,0.14)' : 'rgba(20,21,32,0.6)',
              border: `1px solid ${vise ? `${C.violet}66` : C.trait}`,
              opacity: p, transform: `translateX(${(1 - p) * 20}px)`,
            }}>
              <Sprite src={coup.seule} w={T} h={T} echelle={2} />
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: POLICES.titre, fontSize: 20, fontWeight: 700,
                  color: vise ? C.encre : '#a7abc0', letterSpacing: '-0.01em',
                }}>{arme.nom}</div>
                <Legende taille={13} couleur={C.faible} style={{ marginTop: 6 }}>
                  {arme.pitch}
                </Legende>
              </div>
            </div>
          )
        })}
      </div>

      {/* Le cycle arme en cours, joue en petit a cote de la grande vue. */}
      <div style={{
        position: 'absolute', left: 900, top: 792,
        opacity: fenetre(frame, t(5.6), 1e9, 22, 1),
        display: 'flex', gap: 28, alignItems: 'flex-end',
      }}>
        {D.pixl.armes.map((arme) => {
          const coup = arme.clips.find((c) => c.id === `coup-${arme.id}`) ?? arme.clips[0]
          const i = imageDeCycle(frame, coup.images.length, coup.ms, fps)
          return (
            <div key={arme.id}>
              <Sprite src={coup.images[i]} w={T} h={T} echelle={4} />
              <div style={{
                marginTop: 12, fontFamily: POLICES.mono, fontSize: 14,
                color: C.sourdine, letterSpacing: '0.06em',
              }}>coup · {arme.nom.toLowerCase()}</div>
            </div>
          )
        })}
      </div>

      {/* La planche de modele, telle que l'application la montre. */}
      <Ecran
        src="ui/dlg-pixl.png" largeur={500}
        style={{
          position: 'absolute', left: 120, top: 730,
          opacity: fenetre(frame, t(6.6), 1e9, 24, 1),
        }}
      />

      <div style={{
        position: 'absolute', left: 120, top: 200,
        opacity: fenetre(frame, t(1.4), 1e9, 20, 1),
      }}>
        <div style={{
          fontFamily: POLICES.pixel, fontSize: 30, color: C.violet, letterSpacing: '0.04em',
        }}>32 × 32</div>
        <Legende taille={16} couleur={C.faible} style={{ marginTop: 12 }}>
          pas de squelette ici
          <br />chaque pose est posee a la main
        </Legende>
      </div>
    </>
  )
}
