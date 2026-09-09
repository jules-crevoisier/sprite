import React from 'react'
import { Composition } from 'remotion'
import { Film } from './film/Film'
import { DUREE, FPS, planVerifiable } from './film/plan'

/**
 * Une seule composition : le film entier.
 *
 * Le montage est passe en propriete par defaut plutot que garde de cote. Le
 * verificateur le relit par selectComposition, donc il controle exactement le
 * film qui sera rendu, et non une description tenue a jour a la main.
 */
export const Root: React.FC = () => (
  <Composition
    id="Film"
    component={Film}
    durationInFrames={DUREE}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{ plan: planVerifiable() }}
  />
)
