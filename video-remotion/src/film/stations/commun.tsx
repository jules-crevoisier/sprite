import React from 'react'
import { C, POLICES } from '../theme'
import { STATIONS, fenetreStation, s } from '../plan'
import { fenetre, seg } from '../mouvement'
import { Kicker, Legende, MotsMontants } from '../atomes'

/**
 * Temps local d'une station : zero quand la camera se pose dessus.
 *
 * Le decalage se calcule a partir de la fenetre reelle de la sequence, jamais
 * de la marge de montage. La premiere station commence a l'image zero et n'a
 * donc pas de marge avant elle : une soustraction fixe decalerait toute son
 * ouverture d'une seconde, et le titre entrerait apres le mouvement qu'il est
 * cense accompagner.
 */
export const tempsStation = (id: string) => {
  const station = STATIONS.find((st) => st.id === id) ?? STATIONS[0]
  const { from } = fenetreStation(station)
  const decalage = s(station.debut) - from
  return (sec: number): number => decalage + s(sec)
}

/**
 * Bloc de titre d'une station.
 *
 * Trois niveaux et pas un de plus : l'etiquette de section, la phrase, la
 * precision technique. Le titre reste petit et decale dans le cadre — un gros
 * titre centre a chaque sequence transforme un film en diaporama.
 */
export const BlocTitre: React.FC<{
  frame: number
  debut: number
  kicker: string
  titre: string
  legende?: string
  accent: string
  taille?: number
  style?: React.CSSProperties
}> = ({ frame, debut, kicker, titre, legende, accent, taille = 62, style }) => {
  const k = seg(frame, debut, debut + 16)
  const l = seg(frame, debut + 26, debut + 44)
  return (
    <div style={{ position: 'absolute', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: k }}>
        <div style={{ width: 8 + 26 * k, height: 3, background: accent, borderRadius: 2 }} />
        <Kicker couleur={accent}>{kicker}</Kicker>
      </div>
      <div style={{ marginTop: 16 }}>
        <MotsMontants frame={frame} debut={debut + 8} texte={titre} taille={taille} />
      </div>
      {legende ? (
        <Legende style={{ marginTop: 18, opacity: l, maxWidth: 560 }}>{legende}</Legende>
      ) : null}
    </div>
  )
}

/** Ligne d'une liste : pastille de couleur, nom, valeur a droite. */
export const Ligne: React.FC<{
  couleur?: string
  nom: string
  valeur?: string
  actif?: boolean
}> = ({ couleur, nom, valeur, actif = false }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '9px 16px', borderRadius: 10,
    background: actif ? 'rgba(255,255,255,0.07)' : 'transparent',
  }}>
    {couleur ? (
      <span style={{ width: 10, height: 10, borderRadius: 3, background: couleur, flex: 'none' }} />
    ) : null}
    <span style={{
      fontFamily: POLICES.titre, fontSize: 22, fontWeight: actif ? 700 : 500,
      color: actif ? C.encre : '#a7abc0', letterSpacing: '-0.01em', flex: 1,
    }}>{nom}</span>
    {valeur ? (
      <span style={{ fontFamily: POLICES.mono, fontSize: 16, color: C.sourdine }}>{valeur}</span>
    ) : null}
  </div>
)

/** Apparition en cascade : le rang decide du retard. */
export const cascade = (frame: number, debut: number, rang: number, pas = 4): number =>
  fenetre(frame, debut + rang * pas, 1e9, 18, 1)
