import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../film/theme'
import { D } from '../donnees'
import { fenetre, seg } from './mouvement'
import { Kicker, Legende } from './atomes'
import { dans } from './plan'

/**
 * Signature de fin, en espace ecran.
 *
 * Elle vient par-dessus le recul de camera plutot qu'a la place : le chemin
 * parcouru reste visible derriere le nom, et le film se termine sur ce qu'il
 * a montre au lieu de le remplacer par un carton.
 */
export const Signature: React.FC = () => {
  const frame = useCurrentFrame()
  const entree = fenetre(frame, dans('final', 4.1), 1e9, 32, 1)
  const ligne = seg(frame, dans('final', 4.8), dans('final', 6.1))

  if (entree < 0.01) return null

  return (
    <>
      {/* Voile sombre au centre : sans lui, le nom se lit par-dessus les
          reperes du chemin et les deux se brouillent. */}
      <div style={{
        position: 'absolute', inset: 0, opacity: entree,
        background: 'radial-gradient(ellipse 56% 52% at 50% 40%, rgba(4,4,8,0.97) 0%, rgba(4,4,8,0.88) 46%, transparent 80%)',
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 268,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        opacity: entree,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[C.indigo, C.violet, C.rose].map((couleur, i) => (
            <div key={couleur} style={{
              width: 22, height: 46, background: couleur, borderRadius: 4,
              transform: `translateY(${(1 - seg(frame, dans('final', 4.1) + i * 4, dans('final', 4.9) + i * 4)) * 40}px)`,
            }} />
          ))}
        </div>
        <div style={{
          fontFamily: POLICES.titre, fontWeight: 900, fontSize: 96,
          letterSpacing: '-0.05em', color: C.encre,
        }}>
          Pixel<span style={{ color: C.indigo }}>Forge</span>
        </div>
      </div>

      <div style={{ marginTop: 30, width: 620 * ligne, height: 2, background: `linear-gradient(90deg, transparent, ${C.violet}, transparent)` }} />

      <Kicker style={{ marginTop: 30, fontSize: 18 }}>
        pixel art · rigging · animation · export moteur
      </Kicker>

      <Legende taille={17} couleur={C.faible} style={{ marginTop: 26, textAlign: 'center' }}>
        {D.clips.length} cycles riggues · {D.pixl.clips.length
          + D.pixl.armes.reduce((n, a) => n + a.clips.length, 0)} cycles dessines
        · {D.effets.length} effets de calque
        <br />chaque image de ce film sort de l&apos;application
      </Legende>
      </div>
    </>
  )
}
