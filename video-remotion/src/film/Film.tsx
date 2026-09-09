import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { C, POLICES } from './theme'
import { DUREE, STATIONS, dans, fenetreStation, s, type PlanVerifiable } from './plan'
import { Decor, Monde, Plaque, Trame } from './Monde'
import { Hero } from './Hero'
import { Pixl } from './Pixl'
import { Signature } from './Signature'
import { fenetre, lin } from './mouvement'
import { Amorce } from './stations/Amorce'
import { Dessin } from './stations/Dessin'
import { Variantes } from './stations/Variantes'
import { Detail } from './stations/Detail'
import { Squelette } from './stations/Squelette'
import { Animation } from './stations/Animation'
import { Mascotte } from './stations/Mascotte'
import { Effets } from './stations/Effets'
import { Ombrage } from './stations/Ombrage'
import { Export } from './stations/Export'
import { Final } from './stations/Final'

const CONTENUS: Record<string, React.FC> = {
  amorce: Amorce,
  dessin: Dessin,
  variantes: Variantes,
  detail: Detail,
  squelette: Squelette,
  animation: Animation,
  mascotte: Mascotte,
  effets: Effets,
  ombrage: Ombrage,
  export: Export,
  final: Final,
}

/**
 * Tuile de grain, calculee une fois pour toutes.
 *
 * La premiere version etait un feTurbulence plein cadre. Mesure fait, ce seul
 * filtre divisait la vitesse de rendu par quatorze : le navigateur recalculait
 * deux millions de pixels de bruit a chaque image, alors que le grain ne bouge
 * jamais. Une tuile de cent vingt-huit pixels, tiree une fois avec un
 * generateur a graine fixe puis repetee, donne le meme resultat et ne coute
 * plus rien — et reste identique d'un rendu a l'autre.
 */
const GRAIN = ((): string => {
  const N = 128
  const toile = document.createElement('canvas')
  toile.width = N
  toile.height = N
  const ctx = toile.getContext('2d')
  if (!ctx) return ''
  const image = ctx.createImageData(N, N)
  let graine = 20240917
  for (let i = 0; i < N * N; i++) {
    graine = (graine * 1103515245 + 12345) & 0x7fffffff
    const v = (graine >> 7) & 255
    image.data[i * 4] = v
    image.data[i * 4 + 1] = v
    image.data[i * 4 + 2] = v
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return toile.toDataURL()
})()

/** Barre de progression discrete : elle donne la duree sans la commenter. */
const Progression: React.FC = () => {
  const frame = useCurrentFrame()
  const opacite = fenetre(frame, dans('dessin', 0.5), dans('final', 1.9), 30, 26)
  const station = STATIONS.filter((st) => frame >= s(st.debut)).slice(-1)[0]
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, opacity: opacite }}>
      <div style={{
        position: 'absolute', left: 118, bottom: 40,
        fontFamily: POLICES.mono, fontSize: 13, letterSpacing: '0.3em',
        color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase',
      }}>{station?.kicker ?? ''}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{
          height: 2, width: `${lin(frame, 0, DUREE) * 100}%`,
          background: `linear-gradient(90deg, ${C.indigo}, ${C.violet}, ${C.rose})`,
        }} />
      </div>
    </div>
  )
}

/**
 * Le film.
 *
 * `plan` n'est pas lu par le rendu : il est declare pour que le verificateur
 * recupere le montage exact par selectComposition, au lieu d'en tenir une
 * copie qui finirait par diverger du film qu'elle est censee controler.
 *
 * Les sequences sont posees une a une plutot qu'avec <Series> ou
 * <TransitionSeries> : celles-ci enchainent des enfants qui ne se recouvrent
 * pas, alors qu'ici chaque station est montee une seconde avant d'etre
 * regardee et demontee une seconde apres. C'est ce recouvrement qui permet de
 * voir la station suivante deja en place pendant le panoramique, au lieu de
 * la voir se construire une fois arrive.
 */
export const Film: React.FC<{ plan: PlanVerifiable }> = () => (
  <AbsoluteFill style={{ background: C.fond, overflow: 'hidden' }}>
    <Trame />
    <Monde>
      <Decor />
      {STATIONS.map((station) => {
        const { from, duree } = fenetreStation(station)
        const Contenu = CONTENUS[station.id]
        return (
          <Sequence key={station.id} layout="none" from={from} durationInFrames={duree} name={station.id}>
            <Plaque monde={station.monde}>
              <Contenu />
            </Plaque>
          </Sequence>
        )
      })}
    </Monde>

    <Hero />
    <Pixl />
    <Signature />
    <Progression />

    {/* Vignette : elle retient le regard au centre pendant les panoramiques. */}
    <AbsoluteFill style={{
      pointerEvents: 'none',
      background: 'radial-gradient(ellipse 80% 70% at 50% 46%, transparent 42%, rgba(0,0,0,0.72) 100%)',
    }} />

    {/* Grain : il casse le lissage des degrades, que le h264 rend sinon par
        bandes visibles dans les grands aplats sombres. */}
    <AbsoluteFill style={{
      backgroundImage: `url(${GRAIN})`,
      opacity: 0.05, mixBlendMode: 'overlay', pointerEvents: 'none',
    }} />
  </AbsoluteFill>
)
