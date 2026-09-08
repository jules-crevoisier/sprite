import { fromHex } from '../core/color'
import { RIG_TEMPLATES, applyTemplate } from '../smart/rig-presets'
import { refreshPose, rigState } from '../tools'
import { demoBall, demoCharacter, demoGrassBlock } from './demo-content'
import type { App } from './app'
import type { Lesson } from './tutorial'

const q = (selector: string) => (): Element | null => document.querySelector(selector)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
      hint: 'Poser un personnage au lieu de le redessiner',
      icon: 'rig',
      setup: () => ed.loadSprite(demoCharacter()),
      steps: [
        {
          text: 'Un personnage de face. Plutot que de redessiner chaque pose, on va lui poser un squelette et bouger ses membres.',
          target: q('#canvas'),
          enter: () => { app.workspace.setVisible('rig', true); app.setTool('rig') },
        },
        {
          text: 'Partez d\'un modele : « Humanoide de face » place torse, tete, bras et jambes, ajustes a la taille du dessin.',
          target: q('[data-panel="rig"]'),
          auto: () => {
            const template = RIG_TEMPLATES.find((t) => t.id === 'humanoid-front')!
            const cel = ed.peekCel()
            ed.run('Modele humanoide', () => applyTemplate(ed.sprite.rig, template, cel?.bitmap ?? null, ed.sprite))
            app.rigPanel.render()
          },
          autoLabel: 'Poser le modele',
          done: () => ed.sprite.rig.bones.length > 0,
        },
        {
          text: 'Les os se deplacent a la souris en mode Construction : glissez une extremite avec Alt pour l\'ajuster. Repartir du bout d\'un os en cree un enfant, qui suivra son parent.',
          target: q('#canvas'),
        },
        {
          text: 'Liez les pixels : chaque pixel est attribue a l\'os le plus proche. C\'est ce qui permet ensuite de deformer le dessin.',
          target: q('[data-panel="rig"] button'),
          // Meme chemin que le bouton du panneau.
          auto: () => { app.rigPanel.bind() },
          autoLabel: 'Lier les pixels',
          done: () => !!ed.sprite.rig.rest,
        },
        {
          text: 'Passez en mode Pose et tirez le bout d\'un bras : le membre pivote et les pixels sont regeneres. Tirer une racine deplace l\'os.',
          target: q('#canvas'),
          enter: () => { rigState.mode = 'pose'; app.rigPanel.render() },
          auto: async () => {
            const arm = ed.sprite.rig.bones.find((b) => b.name.includes('bras'))
            if (!arm) return
            ed.runPixels('Pose', [], () => { arm.angle = -1.1 })
            refreshPose(ed)
            await wait(150)
          },
          autoLabel: 'Lever un bras',
          done: () => ed.sprite.rig.bones.some((b) => Math.abs(b.angle) > 0.05),
        },
        {
          text: 'Memorisez cette pose, bougez encore le squelette, puis demandez les frames intermediaires : le mouvement complet est genere par interpolation.',
          target: q('[data-panel="rig"]'),
          enter: setMark,
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
