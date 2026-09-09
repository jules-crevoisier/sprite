import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { D } from '../donnees'
import { ENTREE_PIXL, PIXL, STATIONS, dans, pendant, s } from './plan'
import { imageDeCycle, piste, seg } from './mouvement'
import { Sprite } from './atomes'

/**
 * Pixl, la mascotte.
 *
 * Elle traverse le film au lieu d'y figurer. Ses cycles sont poses image par
 * image dans le logiciel — ce ne sont pas des deformations calculees — et
 * c'est justement ce que le film doit montrer : le meme editeur sert au
 * personnage riggue et au sprite anime a la main.
 *
 * Elle reagit a ce qui se passe autour d'elle : elle court pendant les
 * panoramiques, encaisse quand les effets se coupent, saute a la livraison.
 * Une mascotte qui joue son cycle de repos du debut a la fin serait un
 * autocollant.
 */

const T = D.pixl.taille

const clipPixl = (id: string) => D.pixl.clips.find((c) => c.id === id) ?? D.pixl.clips[0]

/** Cycle arme, par identifiant complet (« coup-epee »). */
const clipArme = (id: string) => {
  for (const arme of D.pixl.armes) {
    const trouve = arme.clips.find((c) => c.id === id)
    if (trouve) return trouve
  }
  return D.pixl.armes[0].clips[0]
}

/**
 * Les panoramiques : la camera part a la fin d'une station et se pose sur la
 * suivante. Pixl court pendant ce temps-la, ce qui explique qu'elle soit
 * toujours au cadre a l'arrivee.
 */
const enDeplacement = (frame: number): boolean =>
  STATIONS.slice(1).some((st) => frame >= s(st.debut) - s(0.2) && frame < dans(st.id, 1.3))

/** Ce que joue la mascotte, et a quelle cadence. */
const cycleDuMoment = (frame: number): { images: string[]; ms: number } => {
  // Sa propre station : les six cycles a la main, puis les trois coups armes.
  if (pendant(frame, 'mascotte', 1.4, 10)) {
    const base = D.pixl.clips
    const armes = D.pixl.armes.map((a) => clipArme(`coup-${a.id}`))
    const suite = [...base, ...armes]
    const i = Math.min(suite.length - 1,
      Math.floor(seg(frame, dans('mascotte', 1.4), dans('mascotte', 9.6)) * suite.length))
    return suite[i]
  }
  if (pendant(frame, 'effets', 7.6, 9.2)) return clipPixl('degats')
  if (pendant(frame, 'export', 2.4, 4)) return clipPixl('saut')
  if (pendant(frame, 'animation', 3, 6)) return clipPixl('course')
  if (frame < ENTREE_PIXL + s(1.2) || enDeplacement(frame)) return clipPixl('course')
  if (pendant(frame, 'final', 2.1, 99)) return clipPixl('marche')
  return clipPixl('repos')
}

export const Pixl: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // L'ecart est teste apres les deux crochets : les appeler dans un ordre qui
  // depend de l'image casserait React des la premiere apparition.
  if (frame < ENTREE_PIXL) return null
  const [x, y, echelleBrute] = piste(frame, PIXL, fps)
  const echelle = Math.max(1, Math.round(echelleBrute))
  const cycle = cycleDuMoment(frame)
  const i = imageDeCycle(frame, cycle.images.length, cycle.ms, fps)

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: x - (T * echelle) / 2,
        top: y - (T * echelle) / 2,
        width: T * echelle,
        height: T * echelle,
      }}>
        <Sprite src={cycle.images[i]} w={T} h={T} echelle={echelle} />
      </div>
    </AbsoluteFill>
  )
}
