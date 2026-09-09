import React from 'react'
import { Img, continueRender, delayRender, staticFile } from 'remotion'
import { C, POLICES } from './theme'
import { seg } from './mouvement'

/* ------------------------------------------------------------------ */
/* Polices                                                             */
/* ------------------------------------------------------------------ */
/*
 * Les trois polices sont embarquees et chargees avant la premiere image.
 * Sans ce verrou, les premieres images sortent en police de secours puis le
 * texte saute de largeur au milieu du plan : le defaut ne se voit qu'apres
 * l'encodage, quand il est trop tard.
 */
// Delai large : sous charge, plusieurs onglets chargent les polices en meme
// temps et les trente secondes accordees par defaut ne suffisent plus.
const attente = delayRender('polices du film', { timeoutInMilliseconds: 120000 })
const charger = (nom: string, fichier: string, poids: string) =>
  new FontFace(nom, `url(${staticFile(`fonts/${fichier}`)}) format('woff2')`, { weight: poids })
    .load()
    .then((f) => { document.fonts.add(f) })
Promise.all([
  charger('Inter', 'inter.woff2', '100 900'),
  charger('Mono', 'mono.woff2', '400 700'),
  charger('Pixel', 'silk.woff2', '400'),
])
  .then(() => document.fonts.ready)
  .then(() => continueRender(attente))
  .catch(() => continueRender(attente))

/* ------------------------------------------------------------------ */
/* Typographie                                                         */
/* ------------------------------------------------------------------ */

export const Kicker: React.FC<{
  children: React.ReactNode
  couleur?: string
  style?: React.CSSProperties
}> = ({ children, couleur = C.sourdine, style }) => (
  <div style={{
    fontFamily: POLICES.mono, fontWeight: 700, fontSize: 19, letterSpacing: '0.34em',
    textTransform: 'uppercase', color: couleur, whiteSpace: 'nowrap', ...style,
  }}>{children}</div>
)

export const Legende: React.FC<{
  children: React.ReactNode
  couleur?: string
  taille?: number
  style?: React.CSSProperties
}> = ({ children, couleur = '#6d7290', taille = 18, style }) => (
  <div style={{
    fontFamily: POLICES.mono, fontSize: taille, color: couleur,
    letterSpacing: '0.05em', lineHeight: 1.5, ...style,
  }}>{children}</div>
)

/**
 * Mots qui montent l'un apres l'autre depuis un masque.
 *
 * Le decalage entre les mots est ce qui distingue un titre anime d'un titre
 * qui apparait : l'oeil suit la lecture au lieu de recevoir le bloc entier.
 */
export const MotsMontants: React.FC<{
  frame: number
  debut: number
  texte: string
  taille?: number
  couleur?: string
  poids?: number
  espacement?: number
}> = ({ frame, debut, texte, taille = 76, couleur = C.encre, poids = 900, espacement = 5 }) => (
  <div style={{
    fontFamily: POLICES.titre, fontWeight: poids, fontSize: taille,
    letterSpacing: '-0.045em', lineHeight: 1.02, color: couleur, display: 'flex', gap: '0.28em',
  }}>
    {texte.split(' ').map((mot, i) => {
      const p = seg(frame, debut + i * espacement, debut + i * espacement + 20)
      return (
        <span key={`${mot}-${i}`} style={{
          display: 'inline-block', overflow: 'hidden',
          paddingTop: '0.18em', marginTop: '-0.18em',
        }}>
          <span style={{
            display: 'inline-block',
            transform: `translateY(${(1 - p) * 105}%)`,
            opacity: p < 0.02 ? 0 : 1,
          }}>{mot}</span>
        </span>
      )
    })}
  </div>
)

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

/**
 * Sprite du logiciel, agrandi au plus proche voisin.
 *
 * L'echelle est arrondie a l'entier : un facteur fractionnaire donne des
 * colonnes de pixels de largeurs inegales, defaut immediatement visible sur
 * un dessin de quarante-huit pixels de haut.
 */
export const Sprite: React.FC<{
  src: string
  /** Dimensions de la source, en pixels du dessin. */
  w: number
  h: number
  echelle: number
  style?: React.CSSProperties
  entier?: boolean
}> = ({ src, w, h, echelle, style, entier = true }) => {
  const e = entier ? Math.max(1, Math.round(echelle)) : echelle
  return (
    <Img
      src={staticFile(src)}
      style={{
        imageRendering: 'pixelated', display: 'block',
        width: w * e, height: h * e, ...style,
      }}
    />
  )
}

/** Capture d'ecran de l'application, dans un cadre. */
export const Ecran: React.FC<{
  src: string
  largeur: number
  style?: React.CSSProperties
  rayon?: number
}> = ({ src, largeur, style, rayon = 14 }) => (
  <div style={{
    width: largeur, borderRadius: rayon, overflow: 'hidden', background: '#0d0e15',
    border: `1px solid ${C.trait}`,
    boxShadow: '0 50px 120px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.03)',
    ...style,
  }}>
    <Img src={staticFile(src)} style={{ display: 'block', width: '100%' }} />
  </div>
)

/**
 * Hublot sur une capture : une portion de l'image, agrandie.
 *
 * Les barres de l'application font 1600 pixels de large pour quarante de
 * haut. Posees entieres dans le cadre, leurs libelles tombent sous la taille
 * lisible ; on montre donc un morceau, plus gros, plutot que le tout,
 * illisible.
 */
export const Hublot: React.FC<{
  src: string
  /** Largeur native de la capture, en pixels. */
  native: number
  largeur: number
  hauteur: number
  echelle: number
  ox?: number
  oy?: number
  style?: React.CSSProperties
}> = ({ src, native, largeur, hauteur, echelle, ox = 0, oy = 0, style }) => (
  <div style={{
    width: largeur, height: hauteur, overflow: 'hidden', borderRadius: 14,
    border: `1px solid ${C.trait}`, background: '#0d0e15',
    boxShadow: '0 40px 90px rgba(0,0,0,0.6)', ...style,
  }}>
    <Img src={staticFile(src)} style={{
      display: 'block', width: native * echelle,
      marginLeft: -ox, marginTop: -oy, maxWidth: 'none',
    }} />
  </div>
)

/** Pastille d'information : un point de couleur et un mot. */
export const Puce: React.FC<{
  children: React.ReactNode
  couleur?: string
  style?: React.CSSProperties
  taille?: number
}> = ({ children, couleur, style, taille = 21 }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 12,
    padding: '11px 21px 11px 17px', borderRadius: 999,
    background: 'rgba(20,21,32,0.88)', border: `1px solid ${C.trait}`,
    fontFamily: POLICES.titre, fontSize: taille, fontWeight: 600,
    letterSpacing: '-0.01em', color: C.encre, whiteSpace: 'nowrap',
    boxShadow: '0 18px 45px rgba(0,0,0,0.5)', ...style,
  }}>
    {couleur ? (
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: couleur, flex: 'none' }} />
    ) : null}
    {children}
  </div>
)

/** Rampe de couleurs : les tons d'une meme matiere, cote a cote. */
export const Rampe: React.FC<{
  couleurs: string[]
  case_?: number
  hauteur?: number
  revele?: number
  style?: React.CSSProperties
}> = ({ couleurs, case_ = 40, hauteur = 40, revele = 1, style }) => (
  <div style={{ display: 'flex', ...style }}>
    {couleurs.map((c, i) => {
      const p = Math.max(0, Math.min(1, revele * couleurs.length - i))
      return (
        <div key={`${c}-${i}`} style={{
          width: case_, height: hauteur, background: c,
          transform: `scaleY(${0.18 + 0.82 * p})`, opacity: p,
        }} />
      )
    })}
  </div>
)

/** Icone reelle de la barre d'outils, telle que l'application la dessine. */
export const Icone: React.FC<{ markup: string; taille?: number; couleur?: string }> =
  ({ markup, taille = 26, couleur = C.encre }) => (
    <svg
      width={taille} height={taille} viewBox="0 0 24 24" fill="none"
      stroke={couleur} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
