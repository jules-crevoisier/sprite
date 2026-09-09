import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { CAMERA, STATIONS } from './plan'
import { piste } from './mouvement'
import { C } from './theme'

/**
 * Le monde et la camera.
 *
 * Les stations ne sont pas des diapositives empilees : elles occupent des
 * positions distinctes dans un plan de quatorze mille pixels de large, et la
 * camera s'y deplace. Le decor traverse donc le champ pendant les
 * panoramiques, ce qui donne la vitesse et la direction du mouvement — ce
 * qu'un fondu enchaine ne peut pas donner.
 */

const useCamera = (): { x: number; y: number; z: number } => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const [x, y, z] = piste(frame, CAMERA, fps)
  // Derive lente : pendant les temps calmes la camera continue de vivre, sans
  // qu'on lise un mouvement. Sans elle, les plans longs paraissent figes.
  const dx = Math.sin(frame / 190) * 11
  const dy = Math.cos(frame / 240) * 7
  return { x: x + dx, y: y + dy, z }
}

/** Conteneur du monde : tout ce qui est dedans est en coordonnees monde. */
export const Monde: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { x, y, z } = useCamera()
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, width: 0, height: 0,
      transform: `translate(${960 - x * z}px, ${540 - y * z}px) scale(${z})`,
      transformOrigin: '0 0',
    }}>
      {children}
    </div>
  )
}

/** Boite de 1920x1080 centree sur un point du monde : une station. */
export const Plaque: React.FC<{
  monde: { x: number; y: number }
  children: React.ReactNode
}> = ({ monde, children }) => (
  <div style={{
    position: 'absolute', left: monde.x - 960, top: monde.y - 540,
    width: 1920, height: 1080,
  }}>
    {children}
  </div>
)

/**
 * Trame du plan, dessinee en espace ecran.
 *
 * Le rendu est celui d'une grille posee dans le monde : elle defile et se
 * resserre exactement comme si elle y etait, puisque le pas et l'origine
 * suivent la camera. Ce qui change, c'est le cout, et l'ecart est enorme.
 *
 * Trois versions ont ete mesurees sur le meme extrait. Posee dans le monde,
 * la grille demandait un element de seize mille sur cinq mille pixels et le
 * rendu tombait a un cinquieme d'image par seconde. Reduite a un fond CSS
 * plein cadre dont la position suit la camera, elle forcait le repeint des
 * degrades sur toute l'image a chaque deplacement. En traits separes, pire
 * encore. La version qui tient, c'est celle-ci : le motif ne change pas d'une
 * image a l'autre, seule une translation bouge, et une translation se compose
 * sans repeindre. Le panneau deborde d'une case de chaque cote pour que le
 * decalage circulaire ne decouvre jamais de bord.
 */
export const Trame: React.FC = () => {
  const { x, y, z } = useCamera()
  const pas = 120 * z
  const modulo = (v: number): number => ((v % pas) + pas) % pas
  // Sous une vingtaine de pixels d'ecart, la trame se referme en un aplat
  // moire ; on la laisse s'effacer plutot que de la montrer sale.
  const opacite = 0.42 * Math.max(0, Math.min(1, (pas - 15) / 26))
  if (opacite <= 0.001) return null
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0,
      width: 1920 + 2 * pas, height: 1080 + 2 * pas,
      backgroundImage:
        `linear-gradient(${C.trait} 1px, transparent 1px),`
        + ` linear-gradient(90deg, ${C.trait} 1px, transparent 1px)`,
      backgroundSize: `${pas}px ${pas}px`,
      transform: `translate(${modulo(960 - x * z) - pas}px, ${modulo(540 - y * z) - pas}px)`,
      opacity: opacite,
    }} />
  )
}

/**
 * Decor du monde : le chemin entre les stations et leurs halos.
 *
 * Le chemin n'est pas decoratif — c'est lui que le recul final revele, et
 * c'est ce qui transforme la derniere image en resume du parcours plutot
 * qu'en enieme carton de fin. Il est trace en segments plutot qu'en SVG : une
 * seule balise couvrant tout le plan force la rasterisation de quatre-vingt-dix
 * millions de pixels a chaque image, pour huit traits.
 */
export const Decor: React.FC = () => {
  const etapes = STATIONS.slice(0, -1)
  return (
    <>
      {etapes.slice(0, -1).map((station, i) => {
        const dx = etapes[i + 1].monde.x - station.monde.x
        const dy = etapes[i + 1].monde.y - station.monde.y
        return (
          <div key={`${station.id}-lien`} style={{
            position: 'absolute',
            left: station.monde.x, top: station.monde.y - 3,
            width: Math.hypot(dx, dy), height: 5,
            background: 'rgba(255,255,255,0.05)',
            transform: `rotate(${Math.atan2(dy, dx)}rad)`,
            transformOrigin: '0 50%',
          }} />
        )
      })}
      {etapes.map((station) => (
        <div key={station.id} style={{
          position: 'absolute',
          left: station.monde.x - 1100, top: station.monde.y - 1100,
          width: 2200, height: 2200, borderRadius: '50%',
          background: `radial-gradient(circle, ${station.accent}22 0%, transparent 62%)`,
        }} />
      ))}
    </>
  )
}
