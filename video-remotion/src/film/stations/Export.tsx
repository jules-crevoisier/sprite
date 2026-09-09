import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, POLICES } from '../theme'
import { D } from '../../donnees'
import { fenetre, lin, seg } from '../mouvement'
import { Ecran, Legende, Sprite } from '../atomes'
import { BlocTitre, tempsStation } from './commun'

const t = tempsStation('export')

/**
 * Station « livrer » : planche, GIF, Unity, Godot.
 *
 * Les extraits de fichiers ne sont pas des exemples ecrits pour le film : ce
 * sont les premieres lignes rendues par buildAsepriteJson, buildUnityMeta et
 * buildGodotSpriteFrames sur le cycle de marche construit juste avant. Un
 * faux extrait passerait a l'ecran ; celui-ci compile dans un vrai projet.
 */

const FICHIERS = [
  { nom: 'perso_marche.json', cle: 'json' as const, hint: 'Phaser, PixiJS, LibGDX, Defold', couleur: C.cyan },
  { nom: 'perso_marche.png.meta', cle: 'unity' as const, hint: 'Unity : decoupe et clips prets', couleur: C.menthe },
  { nom: 'perso_marche_frames.tres', cle: 'godot' as const, hint: 'Godot : SpriteFrames', couleur: C.violet },
]

export const Export: React.FC = () => {
  const frame = useCurrentFrame()
  const planche = D.export.planche
  const echelle = 2

  return (
    <>
      <BlocTitre
        frame={frame} debut={t(0.2)} accent={C.menthe}
        kicker="Export moteur" titre="Livrer dans le jeu"
        legende="Une planche, ses metadonnees, et les fichiers que le moteur attend deja ecrits. Le sprite entre dans le projet sans etape intermediaire."
        style={{ left: 120, top: 132 }}
        taille={54}
      />

      {/* Les trois fichiers de l'archive, avec leurs vraies premieres lignes. */}
      <div style={{ position: 'absolute', left: 1054, top: 132, width: 748 }}>
        {FICHIERS.map((fichier, i) => {
          const p = fenetre(frame, t(0.9) + i * 14, 1e9, 20, 1)
          const lignes = D.export[fichier.cle]
          // Le texte se remplit ligne a ligne : on lit un fichier qui s'ecrit,
          // pas un bloc de code pose la.
          const visibles = Math.round(lin(frame, t(1.4) + i * 14, t(4.2) + i * 14) * lignes.length)
          return (
            <div key={fichier.nom} style={{
              marginBottom: 18, padding: '16px 20px', borderRadius: 14,
              background: 'rgba(13,14,22,0.9)', border: `1px solid ${C.trait}`,
              opacity: p, transform: `translateX(${(1 - p) * 24}px)`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: fichier.couleur }} />
                <span style={{
                  fontFamily: POLICES.mono, fontSize: 17, color: C.encre, letterSpacing: '0.02em',
                }}>{fichier.nom}</span>
                <span style={{
                  marginLeft: 'auto', fontFamily: POLICES.titre, fontSize: 15, color: C.faible,
                }}>{fichier.hint}</span>
              </div>
              <div style={{ marginTop: 12, height: 128, overflow: 'hidden' }}>
                {lignes.slice(0, 6).map((ligne, k) => (
                  <div key={k} style={{
                    fontFamily: POLICES.mono, fontSize: 14, lineHeight: '21px',
                    color: k === 0 ? '#9fb4d8' : '#6d7290', whiteSpace: 'pre',
                    opacity: k < visibles ? 1 : 0,
                  }}>{ligne || ' '}</div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* La planche, avec le decoupage tel que l'export l'ecrit. */}
      <div style={{ position: 'absolute', left: 120, top: 820 }}>
        <Legende taille={15} couleur={C.faible} style={{ letterSpacing: '0.3em', marginBottom: 16 }}>
          PLANCHE · {planche.w} × {planche.h} · {D.export.images} IMAGES
        </Legende>
        <div style={{ position: 'relative', width: planche.w * echelle, height: planche.h * echelle }}>
          <div style={{
            position: 'absolute', inset: 0, overflow: 'hidden',
            width: planche.w * echelle * seg(frame, t(2.2), t(4.4)),
          }}>
            <Sprite src="sprite/planche.png" w={planche.w} h={planche.h} echelle={echelle} />
          </div>
          {planche.cases.map((c, i) => {
            const p = fenetre(frame, t(4.2) + i * 3, 1e9, 10, 1)
            return (
              <div key={i} style={{
                position: 'absolute', left: c.x * echelle, top: c.y * echelle,
                width: c.w * echelle, height: c.h * echelle,
                border: `1px solid ${C.menthe}88`, opacity: p * 0.9,
              }} />
            )
          })}
        </div>
      </div>

      {/* Le GIF : sa taille reelle, encodee par le logiciel. */}
      <div style={{
        position: 'absolute', left: 640, top: 716,
        opacity: fenetre(frame, t(5.2), 1e9, 20, 1),
      }}>
        <div style={{
          fontFamily: POLICES.titre, fontWeight: 900, fontSize: 54, color: C.encre,
          letterSpacing: '-0.05em',
        }}>{(D.export.gifOctets / 1024).toFixed(1)} ko</div>
        <Legende taille={16} couleur={C.faible} style={{ marginTop: 10 }}>
          le GIF anime des {D.export.images} images
        </Legende>
      </div>

      <Ecran
        src="ui/dlg-export.png" largeur={240}
        style={{
          position: 'absolute', left: 640, top: 440,
          opacity: fenetre(frame, t(6.2), 1e9, 24, 1),
        }}
      />
    </>
  )
}
