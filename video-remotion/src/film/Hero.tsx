import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { D, clip } from '../donnees'
import { FIN_RECUL, HERO, dans, pendant, s } from './plan'
import { fenetre, imageDeCycle, lin, piste, seg } from './mouvement'
import { Sprite } from './atomes'
import { C } from './theme'

/**
 * Le personnage, seul element present d'un bout a l'autre du film.
 *
 * Il vit en espace ecran et non dans le monde : les panoramiques passent
 * derriere lui. C'est ce qui donne la continuite — le decor change de station,
 * le personnage, lui, se transforme sans jamais disparaitre, et chaque
 * fonction du logiciel se lit sur le meme dessin.
 */

const W = D.sprite.w
const H = D.sprite.h

/** Bruit stable par pixel : le rendu doit etre identique a chaque passage. */
const brouillage = (i: number): number => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Seuil d'apparition de chaque pixel de la grille.
 *
 * Il est calcule sur les lignes reellement occupees, et non sur la hauteur de
 * la toile : le dessin ne commence qu'au dixieme pixel, si bien qu'un balayage
 * cale sur la toile entiere laisserait l'ecran vide pendant presque une
 * seconde avant que quoi que ce soit s'allume.
 */
const SEUILS: number[] = (() => {
  const { w, h, cases } = D.grille
  let yMin = h
  let yMax = 0
  cases.forEach((idx, i) => {
    if (idx < 0) return
    const y = (i / w) | 0
    if (y < yMin) yMin = y
    if (y > yMax) yMax = y
  })
  const etendue = Math.max(1, yMax - yMin)
  return cases.map((idx, i) => {
    if (idx < 0) return Infinity
    const x = i % w
    const y = (i / w) | 0
    // Balayage de haut en bas, brouille juste assez pour que la ligne de front
    // ne se lise pas comme une regle qui descend.
    return ((y - yMin) / etendue) * 0.62 + brouillage(i) * 0.3 + (x / w) * 0.05
  })
})()

// Le dessin finit de s'allumer six images avant que le recul se pose : la
// derniere case s'eclaire pendant qu'on s'eloigne encore, sinon les deux
// mouvements s'arretent ensemble et le plan a l'air de buter.
const OUVERTURE = { debut: s(0.05), fin: FIN_RECUL - 6 }

/** Progression de l'allumage, entre 0 et un peu plus de 1. */
export const avancementGrille = (frame: number): number =>
  lin(frame, OUVERTURE.debut, OUVERTURE.fin) * 1.0

/** Nombre exact de pixels allumes : le compteur affiche ne bluffe pas. */
export const pixelsAllumes = (avancement: number): number =>
  SEUILS.reduce((n, seuil) => (seuil <= avancement ? n + 1 : n), 0)

/**
 * L'ouverture : le dessin s'allume pixel par pixel, a la vraie grille.
 *
 * Les cases sont posees une a une en absolu, et celles qui sont vides ou pas
 * encore allumees ne sont pas posees du tout. Une grille CSS complete
 * demanderait deux mille trois cents noeuds a chaque image ; sur une machine
 * modeste, plusieurs onglets de rendu qui font cela en meme temps depassent le
 * delai accorde a une image et font echouer le rendu entier.
 */
const Grille: React.FC<{ avancement: number; echelle: number }> = ({ avancement, echelle }) => {
  const { w, h, couleurs, cases } = D.grille
  const c = Math.round(echelle)
  const cellules: React.ReactNode[] = []
  for (let i = 0; i < cases.length; i++) {
    const idx = cases[i]
    if (idx < 0) continue
    const p = Math.max(0, Math.min(1, (avancement - SEUILS[i]) / 0.05))
    if (p <= 0) continue
    cellules.push(
      <div key={i} style={{
        position: 'absolute',
        left: (i % w) * c, top: ((i / w) | 0) * c, width: c, height: c,
        background: couleurs[idx],
        opacity: p,
        transform: p < 1 ? `scale(${0.55 + 0.45 * p})` : undefined,
      }} />,
    )
  }
  return <div style={{ position: 'relative', width: w * c, height: h * c }}>{cellules}</div>
}

/** Pelure d'oignon : les images voisines, en fantomes, derriere la courante. */
const Pelure: React.FC<{ images: string[]; index: number; echelle: number }> =
  ({ images, index, echelle }) => (
    <>
      {[3, 2, 1].map((recul) => {
        const i = (index - recul + images.length * 2) % images.length
        return (
          <div key={recul} style={{
            position: 'absolute', inset: 0, opacity: 0.34 - recul * 0.09,
            filter: `saturate(0.25) brightness(${1.5 - recul * 0.15})`,
          }}>
            <Sprite src={images[i]} w={W} h={H} echelle={echelle} />
          </div>
        )
      })}
    </>
  )

/**
 * Volet qui glisse : le meme dessin avant et apres un traitement.
 *
 * Le trait de separation s'efface aux deux extremites. Laisse visible, il
 * reste plante au bord du sprite une fois la comparaison finie et se lit
 * comme une barre oubliee au milieu du cadre.
 */
const Volet: React.FC<{ avant: string; apres: string; position: number; echelle: number }> =
  ({ avant, apres, position, echelle }) => (
    <>
      <Sprite src={avant} w={W} h={H} echelle={echelle} />
      <div style={{
        position: 'absolute', inset: 0,
        clipPath: `inset(0 0 0 ${position * 100}%)`,
      }}>
        <Sprite src={apres} w={W} h={H} echelle={echelle} />
      </div>
      <div style={{
        position: 'absolute', top: -14, bottom: -14, left: `${position * 100}%`,
        width: 2, background: C.ambre, boxShadow: `0 0 22px ${C.ambre}`,
        opacity: Math.min(1, Math.min(position, 1 - position) * 5),
      }} />
    </>
  )

/** Ossature reelle, tracee par-dessus le dessin. */
const Os: React.FC<{ avancement: number; echelle: number }> = ({ avancement, echelle }) => (
  <svg
    width={W * echelle} height={H * echelle} viewBox={`0 0 ${W} ${H}`}
    style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
  >
    {D.os.map((os, i) => {
      // Les os apparaissent dans l'ordre de la hierarchie : la racine d'abord,
      // pour qu'on lise l'arbre et pas un tas de segments.
      const p = Math.max(0, Math.min(1, (avancement - i * 0.055) / 0.2))
      if (p <= 0) return null
      return (
        <g key={os.nom}>
          <line
            x1={os.x} y1={os.y}
            x2={os.x + (os.ex - os.x) * p} y2={os.y + (os.ey - os.y) * p}
            stroke={os.couleur} strokeWidth={1.1} strokeLinecap="round" opacity={0.95}
          />
          <circle cx={os.x} cy={os.y} r={1.5} fill={os.couleur} opacity={p} />
          {p > 0.98 ? <circle cx={os.ex} cy={os.ey} r={1} fill="#fff" opacity={0.9} /> : null}
        </g>
      )
    })}
  </svg>
)

export const Hero: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const [x, y, echelleBrute] = piste(frame, HERO, fps)
  const echelle = Math.max(1, Math.round(echelleBrute))
  // Respiration : trois pixels de flottement suffisent a empecher le plan de
  // se figer pendant les temps calmes, sans qu'on lise un mouvement.
  const flottement = Math.sin(frame / 46) * 3

  const marche = clip('walk')
  const course = clip('run')
  const saut = clip('jump')
  const coup = clip('attack')
  const repos = 'sprite/repos.png'

  const contenu = (): React.ReactNode => {
    /* --- ouverture : la grille s'allume, puis devient le sprite --- */
    if (frame < dans('amorce', 5.9)) {
      const bascule = lin(frame, dans('amorce', 5.1), dans('amorce', 5.8))
      return (
        <>
          <div style={{ opacity: 1 - bascule }}>
            <Grille avancement={avancementGrille(frame)} echelle={echelle} />
          </div>
          <div style={{ position: 'absolute', inset: 0, opacity: bascule }}>
            <Sprite src={repos} w={W} h={H} echelle={echelle} />
          </div>
        </>
      )
    }

    /* --- variantes : le personnage passe en revue ses declinaisons --- */
    if (pendant(frame, 'variantes', 4.8, 6.4)) {
      const n = D.variantes.length
      const i = Math.min(n - 1,
        Math.floor(lin(frame, dans('variantes', 4.8), dans('variantes', 6.1)) * n))
      return <Sprite src={D.variantes[i].image} w={W} h={H} echelle={echelle} />
    }

    /* --- squelette : ossature, poids, deformation, demi-tour --- */
    if (pendant(frame, 'squelette', 2.2, 10)) {
      const os = fenetre(frame, dans('squelette', 2.2), dans('squelette', 6.4), 26, 22)
      const poids = fenetre(frame, dans('squelette', 4.4), dans('squelette', 6.6), 22, 18)
      if (frame < dans('squelette', 6.6)) {
        return (
          <>
            <Sprite src={repos} w={W} h={H} echelle={echelle} />
            {/* La carte des poids ne couvre pas tout a fait : le dessin doit
                rester devinable dessous, sinon on montre un aplat de couleurs
                et plus un sprite. */}
            <div style={{ position: 'absolute', inset: 0, opacity: poids * 0.86 }}>
              <Sprite src="sprite/poids.png" w={W} h={H} echelle={echelle} />
            </div>
            <div style={{ opacity: os }}>
              <Os avancement={seg(frame, dans('squelette', 2.4), dans('squelette', 4.2))} echelle={echelle} />
            </div>
          </>
        )
      }
      // La deformation, pose par pose : on avance lentement dans le pas pour
      // que la matiere qui s'etire se voie, puis le demi-tour enchaine. Le pas
      // plutot que le coup : sur un coup, le bras qui part vite se disloque le
      // temps de deux images, et c'est cela qu'on lirait au lieu du principe.
      if (frame < dans('squelette', 9)) {
        const im = marche.images
        const i = Math.min(im.length - 1,
          Math.floor(lin(frame, dans('squelette', 6.8), dans('squelette', 8.6)) * im.length))
        return <Sprite src={im[i]} w={W} h={H} echelle={echelle} />
      }
      const t = D.tour
      const i = imageDeCycle(frame - dans('squelette', 9), t.length, 70, fps)
      return <Sprite src={t[i]} w={W} h={H} echelle={echelle} />
    }

    /* --- animation : quatre cycles, avec la pelure sur le premier --- */
    if (pendant(frame, 'animation', 1, 10.5)) {
      const choix = frame < dans('animation', 4) ? marche
        : frame < dans('animation', 6.6) ? course
          : frame < dans('animation', 8.8) ? saut : coup
      const i = imageDeCycle(frame - dans('animation', 1), choix.images.length, choix.ms, fps)
      const pelure = fenetre(frame, dans('animation', 2), dans('animation', 4.2), 20, 16)
      return (
        <>
          {pelure > 0.01 ? (
            <div style={{ opacity: pelure }}>
              <Pelure images={choix.images} index={i} echelle={echelle} />
            </div>
          ) : null}
          <Sprite src={choix.images[i]} w={W} h={H} echelle={echelle} />
        </>
      )
    }

    /* --- mascotte : il s'efface, mais il continue de respirer --- */
    if (pendant(frame, 'mascotte', 1, 10)) {
      const attente = clip('idle')
      const i = imageDeCycle(frame, attente.images.length, attente.ms, fps)
      return <Sprite src={attente.images[i]} w={W} h={H} echelle={echelle} />
    }

    /* --- effets : la pile se monte, puis se coupe pour montrer le dessous --- */
    if (pendant(frame, 'effets', 1.7, 9.5)) {
      const etapes = D.pile.etapes
      // Coupure volontaire a la fin : les effets s'eteignent et le dessin
      // revient intact. C'est la demonstration meme du non destructif.
      if (pendant(frame, 'effets', 7.9, 8.9)) {
        return <Sprite src={repos} w={W} h={H} echelle={echelle} />
      }
      const i = Math.min(etapes.length - 1,
        Math.floor(lin(frame, dans('effets', 1.9), dans('effets', 6.1)) * etapes.length))
      return <Sprite src={etapes[i]} w={W} h={H} echelle={echelle} />
    }

    /* --- ombrage : deux volets sur le meme dessin --- */
    if (pendant(frame, 'ombrage', 1.1, 6)) {
      if (frame < dans('ombrage', 3.9)) {
        return (
          <Volet
            avant="sprite/ombre-avant.png" apres="sprite/ombre-apres.png"
            position={1 - seg(frame, dans('ombrage', 1.4), dans('ombrage', 3.4))} echelle={echelle}
          />
        )
      }
      return (
        <Volet
          avant="sprite/ombre-apres.png" apres="sprite/ombre-lisse.png"
          position={1 - seg(frame, dans('ombrage', 4.1), dans('ombrage', 5.9))} echelle={echelle}
        />
      )
    }

    /* --- livraison et final : le cycle de marche, celui qui part dans le jeu --- */
    if (frame >= dans('export', 0.6)) {
      const i = imageDeCycle(frame - dans('export', 0.6), marche.images.length, marche.ms, fps)
      return <Sprite src={marche.images[i]} w={W} h={H} echelle={echelle} />
    }

    return <Sprite src={repos} w={W} h={H} echelle={echelle} />
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: x - (W * echelle) / 2,
        top: y - (H * echelle) / 2 + flottement,
        width: W * echelle,
        height: H * echelle,
      }}>
        {contenu()}
      </div>
    </AbsoluteFill>
  )
}
