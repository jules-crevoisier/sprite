import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { D, courbe } from '../../donnees'
import { fenetre, lin, seg } from '../mouvement'
import { Hublot, Legende, Puce } from '../atomes'
import { BlocTitre, Ligne, cascade, tempsStation } from './commun'

const t = tempsStation('animation')

/**
 * Station « animation » : cycles, pelure d'oignon, courbes de vitesse.
 *
 * Les courbes tracees sont echantillonnees par easingPath, la fonction que le
 * logiciel utilise pour les dessiner dans sa propre interface. Une courbe
 * redessinee a la main dirait « depassement » sans montrer le depassement.
 */

const COURBES = ['ease-in-out', 'overshoot', 'bounce', 'anticipate']

const Trace: React.FC<{ id: string; avancement: number; couleur: string }> =
  ({ id, avancement, couleur }) => {
    const c = courbe(id)
    const W = 300
    const H = 168
    const points = c.points.map((p) => `${p.x * W},${H - p.y * H * 0.82 - H * 0.09}`).join(' ')
    const k = Math.min(c.points.length - 1, Math.floor(avancement * (c.points.length - 1)))
    const tete = c.points[k]
    return (
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        <line x1={0} y1={H - H * 0.09} x2={W} y2={H - H * 0.09} stroke={C.trait} strokeWidth={1} />
        <polyline points={points} fill="none" stroke={couleur} strokeWidth={2.6} strokeLinecap="round" />
        <circle
          cx={tete.x * W} cy={H - tete.y * H * 0.82 - H * 0.09}
          r={6} fill={couleur}
        />
      </svg>
    )
  }

export const Animation: React.FC = () => {
  const frame = useCurrentFrame()

  // Le cycle mis en avant suit celui que le personnage joue au meme instant.
  const actif = frame < t(3.6) ? 'walk' : frame < t(6.4) ? 'run' : frame < t(9) ? 'jump' : 'attack'
  const iCourbe = Math.min(COURBES.length - 1, Math.floor(lin(frame, t(4.4), t(10.6)) * COURBES.length))
  const idCourbe = COURBES[iCourbe]

  const jalons: { a: number; b: number; texte: string; couleur: string }[] = [
    { a: 1.7, b: 4.1, texte: 'pelure d\'oignon : les images voisines en fantomes', couleur: C.ambre },
    { a: 4.1, b: 7.4, texte: 'inertie et suivi calcules apres coup', couleur: C.rose },
    { a: 7.4, b: 12, texte: 'un cycle est une courbe par os, pas une suite d\'images', couleur: C.menthe },
  ]

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.2)} accent={C.ambre}
        kicker="Banc de montage" titre="Animer sans tout dessiner"
        legende="Les cycles s'appliquent a tout squelette dont les os portent le bon role. Le pas, la course, le saut et le coup sortent du meme personnage."
        style={{ left: 940, top: 132 }}
        taille={54}
      />

      {/* Les cycles disponibles pour ce squelette. */}
      <div style={{ position: 'absolute', left: 940, top: 452, width: 430 }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 12 }}>
          {D.clips.length} CYCLES APPLICABLES
        </Legende>
        {D.clips.map((clip, i) => {
          const p = cascade(frame, t(0.9), i, 3)
          return (
            <div key={clip.id} style={{ opacity: p, transform: `translateX(${(1 - p) * -14}px)` }}>
              <Ligne
                nom={clip.label}
                valeur={`${clip.images.length} img · ${clip.ms} ms`}
                actif={clip.id === actif}
                couleur={clip.id === actif ? C.ambre : undefined}
              />
            </div>
          )
        })}
      </div>

      {/* Une courbe de vitesse a la fois, avec sa tete de lecture. */}
      <div style={{
        position: 'absolute', left: 1450, top: 452,
        opacity: fenetre(frame, t(4.2), 1e9, 22, 1),
      }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 18 }}>
          COURBE DE VITESSE
        </Legende>
        <Trace
          id={idCourbe} couleur={C.ambre}
          avancement={(frame % 96) / 96}
        />
        <div style={{
          marginTop: 22, fontFamily: POLICES.titre, fontSize: 26, fontWeight: 700,
          color: C.encre, letterSpacing: '-0.02em',
        }}>{courbe(idCourbe).label}</div>
        <Legende taille={15} style={{ marginTop: 10, width: 320 }}>
          {courbe(idCourbe).hint}
        </Legende>
      </div>

      {/* La ligne de temps du logiciel. */}
      <div style={{
        position: 'absolute', left: 120, top: 790,
        opacity: fenetre(frame, t(2.4), 1e9, 26, 1),
      }}>
        <Hublot
          src="ui/timeline.png" native={3200} echelle={0.52}
          largeur={720} hauteur={138}
        />
      </div>

      <div style={{ position: 'absolute', left: 120, top: 92 }}>
        {jalons.map((jalon) => {
          const p = fenetre(frame, t(jalon.a), t(jalon.b), 16, 12)
          if (p < 0.01) return null
          return (
            <div key={jalon.texte} style={{
              position: 'absolute', left: 0, top: 0, width: 520,
              opacity: p, transform: `translateY(${(1 - p) * 14}px)`,
            }}>
              <Puce couleur={jalon.couleur} taille={19}>{jalon.texte}</Puce>
            </div>
          )
        })}
      </div>

      {/* Barre de progression du cycle : le rythme se lit meme a l'arret. */}
      <div style={{ position: 'absolute', left: 120, top: 962, width: 720 }}>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
          <div style={{
            height: 3, borderRadius: 2, background: C.ambre,
            width: `${seg(frame, t(0.4), t(11.6)) * 100}%`,
          }} />
        </div>
      </div>
    </>
  )
}
