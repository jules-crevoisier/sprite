import { fromHex } from '../core/color'

import { demoBall, demoCharacter, demoGrassBlock } from './demo-content'
import type { App } from './app'
import type { Lesson } from './tutorial'

const q = (selector: string) => (): Element | null => document.querySelector(selector)

/** Les cinq lecons proposees, de la prise en main a l'export moteur. */
export function buildLessons(app: App): Lesson[] {
  const ed = app.ed

  /** Repere l'historique a l'entree d'une etape, pour mesurer une action. */
  let mark = 0
  const setMark = () => { mark = ed.history.depth }

  return [
    {
      id: 'bases',
      title: 'Prise en main',
      hint: 'Dessiner, choisir une couleur, corriger',
      icon: 'pencil',
      setup: () => ed.loadSprite(demoGrassBlock()),
      steps: [
        {
          text: 'Voici une tuile de 16 pixels de cote. La molette zoome, la barre espace deplace la vue. Essayez.',
          target: q('#canvas'),
        },
        {
          text: 'Choisissez une couleur dans la palette, a droite. Un clic la met en couleur principale, un clic droit en secondaire.',
          target: q('[data-panel="palette"]'),
          enter: () => { app.workspace.setVisible('palette', true) },
          done: () => ed.primary !== fromHex('#ffffff'),
        },
        {
          text: 'Dessinez sur la tuile avec le crayon. Le clic droit peint avec la couleur secondaire.',
          target: q('.toolbar'),
          enter: () => { setMark(); app.setTool('pencil') },
          done: () => ed.history.depth > mark,
        },
        {
          text: 'Ctrl+Z annule, Ctrl+Y retablit. L\'historique remonte loin : n\'ayez pas peur d\'essayer.',
          auto: () => { ed.undo() },
          autoLabel: 'Annuler',
        },
      ],
    },

    {
      id: 'animation',
      title: 'Animer',
      hint: 'Frames, pelure d\'oignon, tags',
      icon: 'film',
      setup: () => ed.loadSprite(demoBall()),
      steps: [
        {
          text: 'Cette balle occupe quatre frames. La timeline, en bas, montre une colonne par frame. Cliquez-en une pour vous y placer.',
          target: q('#timeline'),
          enter: () => { app.workspace.setTimelineVisible(true) },
        },
        {
          text: 'Lancez la lecture. Le rendu s\'anime aussi sur la toile, pas seulement dans l\'apercu.',
          target: q('#timeline button[title*="Lecture"]'),
          auto: () => { app.playback.play() },
          autoLabel: 'Lire',
          done: () => ed.playing,
        },
        {
          text: 'Arretez la lecture, puis activez la pelure d\'oignon : les frames voisines apparaissent en transparence, teintees rouge pour le passe et bleu pour le futur.',
          target: q('#timeline button[title*="oignon"]'),
          enter: () => app.playback.stop(),
          auto: () => { app.runCommand('frame.onion') },
          autoLabel: 'Activer',
          done: () => ed.onion.enabled,
        },
        {
          text: 'Le bouton + ajoute une frame en reprenant le dessin courant : on repart du precedent et on le modifie. Le bouton voisin cree une frame vide.',
          target: q('#timeline button[title*="Nouvelle frame"]'),
          enter: setMark,
          done: () => ed.frameCount > 4,
        },
        {
          text: 'Un tag nomme une plage de frames — idle, run, hit. Ce nom devient celui de l\'animation a l\'export, dans Unity comme dans Godot.',
          target: q('#timeline button[title*="tag"]'),
          auto: () => {
            ed.frameSelection = new Set([0, 1, 2, 3])
            ed.addTag('idle', 0, 3)
          },
          autoLabel: 'Creer le tag idle',
          done: () => ed.sprite.tags.length > 0,
        },
      ],
    },

    {
      id: 'rig',
      title: 'Squelette et pose',
      hint: 'Articuler un personnage au lieu de le redessiner',
      icon: 'rig',
      setup: () => ed.loadSprite(demoCharacter()),
      steps: [
        {
          text: 'Un personnage de face. Pour l\'animer, on ne va pas le redessiner pose par pose : on va lui poser un squelette. Basculez en mode Squelette, en haut de la fenetre.',
          target: q('.topbar .seg'),
          done: () => ed.mode === 'rig',
        },
        {
          text: 'L\'interface a change : la barre d\'outils propose Creer des os, Poser et Ponderer, et le panneau de droite montre la hierarchie. Partez d\'un modele « Humanoide de face ».',
          target: q('[data-panel="rig"]'),
          done: () => ed.sprite.rig.bones.length > 0,
        },
        {
          text: 'Les os apparaissent sur le dessin. Avec l\'outil Creer des os, glissez une extremite en maintenant Alt pour l\'ajuster, ou repartez du bout d\'un os pour en enchainer un nouveau.',
          target: q('.toolbar'),
          enter: () => app.setTool('rig-bone'),
        },
        {
          text: 'Liez maintenant les pixels : chacun rejoint l\'os le plus proche. C\'est cette liaison qui permettra de deformer le dessin.',
          target: q('[data-panel="rig"] button'),
          done: () => !!ed.sprite.rig.rest,
        },
        {
          text: 'Chaque couleur sur la toile montre l\'os qui porte le pixel : rouge le torse, orange la tete, jaune et vert les bras. C\'est la lecture la plus directe de ce qui va bouger avec quoi.',
          enter: () => { ed.showWeights = true; ed.events.emit('settings', undefined) },
        },
        {
          text: 'Passez sur l\'outil Poser et tirez le bout du bras gauche vers le haut, en suivant la fleche. Le membre pivote et les pixels sont regeneres.',
          enter: () => app.setTool('rig-pose'),
          gesture: () => {
            const arm = ed.sprite.rig.bones.find((b) => b.name === 'bras G')
            if (!arm) return null
            return { from: [arm.ex, arm.ey], to: [arm.ex - 6, arm.ey - 12] }
          },
          done: () => ed.sprite.rig.bones.some((b) => Math.abs(b.angle) > 0.08),
        },
        {
          text: 'Si une frontiere tombe mal — un bout d\'epaule qui part avec le bras — choisissez l\'os dans la liste, prenez l\'outil Ponderer et repeignez. Alt retire l\'influence.',
          target: q('.toolbar'),
          enter: () => app.setTool('rig-weight'),
        },
        {
          text: 'Reste a en faire une animation : memorisez la pose de depart, bougez le squelette, puis demandez les frames intermediaires. Le mouvement complet est genere par interpolation.',
          target: q('[data-panel="rig"]'),
          enter: () => { app.setTool('rig-pose'); setMark() },
          done: () => ed.frameCount > 1,
        },
      ],
    },
    {
      id: 'assiste',
      title: 'Detail et variantes',
      hint: 'Texturer et decliner sans repeindre',
      icon: 'smart',
      setup: () => ed.loadSprite(demoGrassBlock()),
      steps: [
        {
          text: 'Une tuile d\'herbe a plat. On va lui donner du relief sans poser un pixel a la main.',
          target: q('#canvas'),
        },
        {
          text: 'Ouvrez « Ajouter du detail » (Ctrl+Maj+D), choisissez la matiere Herbe, puis cliquez Ajouter deux fois : les passes se cumulent. « Varier » relance le tirage.',
          enter: setMark,
          auto: () => { app.runCommand('sprite.detail') },
          autoLabel: 'Ouvrir',
          done: () => ed.history.depth > mark,
        },
        {
          text: 'Le detail ne reprend que les couleurs deja presentes : chaque pixel se decale d\'un cran dans sa propre famille de teintes. Aucune couleur etrangere n\'apparait.',
        },
        {
          text: 'Ouvrez maintenant « Variantes de couleur » (Ctrl+Maj+V). L\'editeur a regroupe les couleurs en familles : verts et bruns.',
          auto: () => { app.runCommand('sprite.variants') },
          autoLabel: 'Ouvrir',
        },
        {
          text: 'Choisissez la famille des verts, une methode, puis appliquez : les variantes deviennent des frames taguees, pretes a partir dans une planche.',
          enter: setMark,
          done: () => ed.frameCount > 1,
        },
      ],
    },

    {
      id: 'export',
      title: 'Exporter vers un moteur',
      hint: 'Planche, Unity, Godot',
      icon: 'download',
      setup: () => ed.loadSprite(demoBall()),
      steps: [
        {
          text: 'Un tag nomme l\'animation. Sans tag, tout le sprite forme une seule animation.',
          auto: () => { ed.addTag('bounce', 0, 3) },
          autoLabel: 'Ajouter le tag bounce',
          done: () => ed.sprite.tags.length > 0,
        },
        {
          text: 'Ouvrez l\'export (Ctrl+E). La planche generee s\'affiche en direct : disposition, espacement, echelle.',
          target: q('.topbar-actions .btn.primary'),
          auto: () => { app.runCommand('file.export') },
          autoLabel: 'Ouvrir l\'export',
          done: () => !!document.querySelector('.modal'),
        },
        {
          text: 'Choisissez Unity : l\'archive contient le PNG, le .meta de decoupe et un AnimationClip par tag. Godot donne une ressource SpriteFrames prete pour AnimatedSprite2D.',
        },
        {
          text: 'Pensez a l\'extrusion si votre moteur filtre les textures : elle duplique les pixels de bord et supprime les lisieres entre tuiles.',
        },
      ],
    },
  ]
}
