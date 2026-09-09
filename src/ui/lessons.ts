import { fromHex } from '../core/color'
import { isBound } from '../smart/rig'

import { demoCharacter, demoGrassBlock } from './demo-content'
import { spritePixl } from './mascot-clips'
import type { App } from './app'
import type { Lesson } from './tutorial'

const q = (selector: string) => (): Element | null => document.querySelector(selector)

/**
 * Vrai quand LE dialogue attendu est a l'ecran.
 *
 * Chercher « un dialogue » ne suffit pas : celui de l'etape precedente, reste
 * ouvert, validait la suivante avant qu'on ait rien ouvert du tout.
 */
const estOuvert = (titre: string): boolean =>
  [...document.querySelectorAll('.modal-head h2')].some((h) => h.textContent?.trim() === titre)

/** Les cinq lecons proposees, de la prise en main a l'export moteur. */
export function buildLessons(app: App): Lesson[] {
  const ed = app.ed

  /**
   * Repere l'historique a l'entree d'une etape, pour mesurer une action.
   *
   * On compte les commandes empilees et non la taille de la pile : apres une
   * annulation, un nouveau trait ecrase la branche defaite et `depth` revient
   * a sa valeur d'avant. L'etape « dessinez un trait » qui suit le Ctrl+Z
   * attendait donc un chiffre qui ne montait jamais.
   */
  let mark = 0
  const setMark = () => { mark = ed.history.pushes }
  // Reperes pris a l'entrée d'une etape : chaque etape se valide en comparant
  // l'état courant a celui d'avant, plutot qu'a une valeur figee.
  let zoomDepart = 0
  let profondeur = 0
  let etendue = ''
  let relies = 0
  let couleurDepart = 0
  let epaisseur = 1
  let bord = 'tramage'

  return [
    {
      id: 'bases',
      title: 'Prise en main',
      hint: 'Dessiner, choisir une couleur, corriger',
      icon: 'pencil',
      setup: () => ed.loadSprite(demoGrassBlock()),
      steps: [
        {
          text: 'Voici une tuile de 16 pixels de cote. La molette zoome, la barre espace déplace la vue. Essayez : changez le zoom.',
          target: q('#canvas'),
          enter: () => { zoomDepart = ed.view.zoom },
          done: () => ed.view.zoom !== zoomDepart,
        },
        {
          text: 'Choisissez une couleur dans la palette, a droite. Un clic la met en couleur principale, un clic droit en secondaire.',
          target: q('[data-panel="palette"]'),
          enter: () => { app.workspace.setVisible('palette', true); couleurDepart = ed.primary },
          done: () => ed.primary !== couleurDepart,
        },
        {
          text: 'Dessinez sur la tuile avec le crayon. Le clic droit peint avec la couleur secondaire.',
          target: q('#canvas'),
          enter: () => { setMark(); app.setTool('pencil') },
          done: () => ed.history.pushes > mark,
        },
        {
          text: 'Ctrl+Z annulé, Ctrl+Y retablit. L\'historique remonte loin : n\'ayez pas peur d\'essayer. Annulez votre trait.',
          enter: () => { profondeur = ed.history.position },
          done: () => ed.history.position < profondeur,
        },
        {
          text: 'Deux réglages de la barre du haut se ressemblent sans faire la même chose. '
            + 'La FORME du pinceau decide quels pixels sont poses a chaque point du trait : '
            + 'ronde, carrée, losange, ou une simple ligne. Montez la taille a 6 et changez de forme — '
            + 'l\'aperçu, a cote, dessine le trait tel qu\'il sortira.',
          target: q('#optionsbar'),
          enter: () => {
            app.setTool('pencil')
            ed.updateSettings({ brushSize: 6, brushShape: 'circle', ditherPattern: 'none' })
          },
          done: () => ed.settings.brushShape !== 'circle',
        },
        {
          text: 'Le TRAMAGE, lui, ne change pas la forme : il decide quelle couleur reçoit chaque pixel pose. '
            + 'Le motif alterne la principale et la secondaire pour simuler une teinte intermediaire absente de la palette. '
            + 'Choisissez d\'abord une couleur secondaire au clic droit dans la palette, sinon il ne mélange rien : il troue le trait.',
          target: q('#optionsbar'),
          enter: () => {
            // On prepare la couleur secondaire — sans elle le tramage troue
            // le trait — mais surtout pas le motif : le poser ici validait
            // l'étape avant même qu'on ait lu la consigne.
            ed.setSecondary(fromHex('#6488f4'))
            ed.updateSettings({ ditherPattern: 'none', ditherRatio: 0.5 })
          },
          auto: () => { ed.updateSettings({ ditherPattern: 'bayer4', ditherRatio: 0.5 }) },
          autoLabel: 'Poser un tramage',
          done: () => ed.settings.ditherPattern !== 'none',
        },
        {
          text: 'En resume : la forme dit OU les pixels tombent, le tramage dit AVEC QUOI ils sont peints. '
            + 'Dessinez un trait pour voir les deux agir ensemble.',
          enter: setMark,
          done: () => ed.history.pushes > mark,
        },
      ],
    },

    {
      id: 'animation',
      title: 'Animer',
      hint: 'Frames, pelure d\'oignon, tags',
      icon: 'film',
      setup: () => {
        ed.loadSprite(spritePixl())
        // On entre par le cycle de marche : c'est le plus long et celui ou
        // la pelure d'oignon sert le plus.
        const marche = ed.sprite.tags.find((t) => t.name === 'Marche')
        if (marche) ed.setActiveFrame(marche.from)
      },
      steps: [
        {
          text: 'Voici Pixl, la mascotte, et ses six cycles : repos, marche, course, saut, attaque, dégâts. '
            + 'La timeline montre une colonne par image et une bande par cycle. Cliquez une autre image pour vous y placer.',
          target: q('#timeline'),
          enter: () => { app.workspace.setTimelineVisible(true); zoomDepart = ed.activeFrame },
          done: () => ed.activeFrame !== zoomDepart,
        },
        {
          text: 'Lancez la lecture. Le rendu s\'anime aussi sur la toile, pas seulement dans l\'aperçu.',
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
          text: 'Le bouton + ajoute une frame en reprenant le dessin courant : on repart du précédent et on le modifie. Le bouton voisin créé une frame vide.',
          target: q('#timeline button[title*="Nouvelle frame"]'),
          enter: () => { profondeur = ed.frameCount },
          done: () => ed.frameCount > profondeur,
        },
        {
          text: 'Chaque bande coloree est un tag : il nomme une plage d\'images. Ce nom devient celui de '
            + 'l\'animation a l\'export, dans Unity comme dans Godot. Ajoutez-en un de plus sur les images '
            + 'de votre choix.',
          target: q('#timeline button[title*="tag"]'),
          enter: () => { profondeur = ed.sprite.tags.length },
          done: () => ed.sprite.tags.length > profondeur,
        },
        {
          text: 'Le tag se manipule a la souris : glissez-le pour le déplacer, tirez ses bords pour l\'étendre. Essayez — deux tags qui se chevauchent s\'empilent sur deux bandes.',
          target: q('.tl-tag'),
          enter: () => { etendue = ed.sprite.tags.map((t) => `${t.from}-${t.to}`).join() },
          done: () => ed.sprite.tags.map((t) => `${t.from}-${t.to}`).join() !== etendue,
        },
        {
          text: 'La durée se réglé par frame, et le bouton voisin l\'applique a toutes d\'un coup — c\'est le cas le plus courant : une seule cadence pour l\'animation entière. Appliquez-la.',
          target: q('#timeline button[title^="Appliquer cette duree"]'),
          enter: () => { ed.sprite.frameDurations = ed.sprite.frameDurations.map((_, i) => 80 + i * 40); profondeur = ed.history.pushes },
          done: () => ed.history.pushes > profondeur && new Set(ed.sprite.frameDurations).size === 1,
        },
        {
          text: 'La courbe de vitesse, a cote, repartit le temps autrement. Choisissez « Arrivee douce » puis appliquez-la : les dernières images durent plus longtemps, le mouvement se pose. La durée totale ne change pas.',
          target: q('#timeline select'),
          enter: () => { etendue = ed.sprite.frameDurations.join(); ed.easing = 'ease-out' },
          auto: () => {
            const btn = document.querySelector<HTMLElement>('#timeline button[title^="Repartir les durees"]')
            btn?.click()
          },
          autoLabel: 'Répartir les durées',
          done: () => ed.sprite.frameDurations.join() !== etendue
            && new Set(ed.sprite.frameDurations).size > 1,
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
          text: 'Un personnage de face. Pour l\'animer, on ne va pas le redessiner pose par pose : on va lui poser un squelette. Basculez en mode Squelette, en haut de la fenêtre.',
          target: q('.topbar .seg'),
          auto: () => ed.setMode('rig'),
          autoLabel: 'Basculer',
          done: () => ed.mode === 'rig',
        },
        {
          text: 'L\'interface a change : la barre d\'outils propose Créer des os, Poser et Pondérer, et le panneau de droite montre la hierarchie. Partez d\'un modèle « Humanoide de face ».',
          target: q('[data-panel="rig"]'),
          done: () => ed.sprite.rig.bones.length > 0,
        },
        {
          text: 'Les os apparaissent sur le dessin. Avec l\'outil Créer des os, glissez une extremite en maintenant Alt pour l\'ajuster, ou repartez du bout d\'un os pour en enchainer un nouveau.',
          target: q('.toolbar'),
          enter: () => app.setTool('rig-bone'),
        },
        {
          text: 'Reliez maintenant le calque du personnage : chaque pixel rejoint l\'os le plus proche. Un projet a plusieurs calques ? Cochez-les tous, ils suivront ensemble.',
          target: q('[data-panel="rig"] button'),
          done: () => isBound(ed.sprite.rig),
        },
        {
          text: 'Chaque couleur sur la toile montre l\'os qui porte le pixel : rouge le torse, orange la tête, jaune et vert les bras. C\'est la lecture la plus directe de ce qui va bouger avec quoi.',
          enter: () => { ed.showWeights = true; ed.events.emit('settings', undefined) },
        },
        {
          text: 'Passez sur l\'outil Poser et tirez le bout du bras gauche vers le haut, en suivant la fleche. Le membre pivote et les pixels sont regeneres.',
          enter: () => {
            // La carte d'influence a joue son role : on rend le dessin.
            ed.showWeights = false
            app.setTool('rig-pose')
          },
          gesture: () => {
            const arm = ed.sprite.rig.bones.find((b) => b.name === 'bras G')
            if (!arm) return null
            return { from: [arm.ex, arm.ey], to: [arm.ex - 6, arm.ey - 12] }
          },
          done: () => ed.sprite.rig.bones.some((b) => Math.abs(b.angle) > 0.08),
        },
        {
          text: 'Si une frontière tombe mal — un bout d\'épaule qui part avec le bras — choisissez l\'os dans la liste, prenez l\'outil Pondérer et repeignez. Alt retire l\'influence.',
          target: q('.toolbar'),
          enter: () => app.setTool('rig-weight'),
        },
        {
          text: 'La pose ne fige rien : repassez en mode Dessin, retouchez le bras leve au crayon, puis revenez au Squelette. La retouche est reprise dans le repos — inutile de relier les pixels a nouveau.',
          target: q('.topbar .seg'),
          auto: () => ed.setMode('draw'),
          autoLabel: 'Passer en Dessin',
          done: () => ed.mode === 'draw',
        },
        {
          text: 'Revenez au mode Squelette : le dessin corrige suit désormais l\'os, et la prochaine pose en tiendra compte.',
          target: q('.topbar .seg'),
          auto: () => ed.setMode('rig'),
          autoLabel: 'Revenir au Squelette',
          done: () => ed.mode === 'rig',
        },
        {
          text: 'Reste a en faire une animation : memorisez la pose de depart, bougez le squelette, puis demandez les frames intermediaires. Le mouvement complet est généré par interpolation.',
          target: q('[data-panel="rig"]'),
          enter: () => { app.setTool('rig-pose'); profondeur = ed.frameCount },
          done: () => ed.frameCount > profondeur,
        },
        {
          text: 'Plus rapide encore : la liste « Animations toutes faites ». Un cycle n\'est pas une suite d\'images figees mais une courbe par fonction d\'os — il s\'applique donc a n\'importe quel squelette qui porte les bons os. Lancez « Marche ».',
          target: q('[data-panel="rig"]'),
          enter: () => { app.runCommand('frame.first'); setMark() },
          done: () => ed.sprite.tags.some((t) => t.name === 'marche'),
        },
        {
          text: 'Huit frames et un tag, d\'un clic. Les poses restent modifiables : le cycle est une base, pas un verrou. Lancez la lecture pour juger le résultat.',
          target: q('#timeline button[title*="Lecture"]'),
          done: () => ed.playing,
        },
        {
          text: 'Arretez la lecture. Un personnage tient rarement sur un calque : dans « Calques reliés », un clic relié ou detache un calque. Corps, arme et cape suivent alors les mêmes os, chacun avec sa propre carte de poids.',
          enter: () => { app.playback.stop(); relies = ed.sprite.rig.parts.length },
          target: q('[data-panel="rig"]'),
          done: () => ed.sprite.rig.parts.length !== relies,
        },
        {
          text: 'Enfin, choisissez un os et montez sa souplesse — pensez a une cape, une queue, une meche. Il cesse alors de suivre le corps a l\'image près : il traine derrière, dépasse a l\'arret, puis se stabilise. Ce retard se dessinait a la main ; ici il se calcule.',
          target: q('[data-panel="rig"]'),
          done: () => ed.sprite.rig.bones.some((b) => b.softness > 0),
        },
      ],
    },
    {
      id: 'assiste',
      title: 'Dessin assisté',
      hint: 'Rampes, ombrage, détail et variantes',
      icon: 'smart',
      setup: () => ed.loadSprite(demoGrassBlock()),
      steps: [
        {
          text: 'Une tuile d\'herbe a plat. Les quatre outils qui suivent font le travail ingrat : '
            + 'trouver des tons, poser des ombres, texturer, decliner. Aucun n\'invente de couleur '
            + 'qui ne soit déjà dans le dessin. Prenez la pipette et prelevez le vert de l\'herbe.',
          target: q('.toolbar'),
          enter: () => { app.setTool('eyedropper'); couleurDepart = ed.primary },
          done: () => ed.primary !== couleurDepart,
        },
        {
          text: 'D\'abord les tons. Une ombre obtenue en baissant seulement la luminosite donne du gris : '
            + 'les vraies ombres glissent vers le bleu, les lumières vers le jaune. '
            + '« Rampe de couleurs » (Ctrl+Maj+G) fabrique la famille complète autour de la couleur courante.',
          enter: setMark,
          auto: () => { app.runCommand('sprite.ramp') },
          autoLabel: 'Ouvrir la rampe',
          done: () => ed.history.pushes > mark,
        },
        {
          text: 'Maintenant l\'ombrage. La silhouette suffit a deviner l\'orientation des surfaces : '
            + 'un pixel près du bord gauche appartient a une paroi tournee vers la gauche. '
            + 'Ouvrez « Ombrage automatique » (Ctrl+Maj+O) et tirez dans le cadran de lumière.',
          enter: setMark,
          auto: () => { app.runCommand('sprite.shade') },
          autoLabel: 'Ouvrir l\'ombrage',
          done: () => ed.history.pushes > mark,
        },
        {
          text: 'Chaque pixel a pris un autre ton de sa propre famille : la palette reste la votre, '
            + 'et la silhouette n\'a pas bouge. Le curseur « Adoucir » casse en plus les marches '
            + 'd\'escalier des diagonales, avec la même réglé.',
        },
        {
          text: 'Ouvrez « Ajouter du détail » (Ctrl+Maj+D), choisissez la matière Herbe, puis cliquez Ajouter deux fois : les passes se cumulent. « Varier » relance le tirage.',
          enter: setMark,
          auto: () => { app.runCommand('sprite.detail') },
          autoLabel: 'Ouvrir',
          done: () => ed.history.pushes > mark,
        },
        {
          text: 'Le détail ne reprend que les couleurs déjà presentes : chaque pixel se décale d\'un cran dans sa propre famille de teintes. Aucune couleur etrangere n\'apparait.',
        },
        {
          text: 'Ouvrez maintenant « Variantes de couleur » (Ctrl+Maj+V). L\'éditeur a regroupe les couleurs en familles : verts et bruns.',
          auto: () => { app.runCommand('sprite.variants') },
          autoLabel: 'Ouvrir',
          done: () => estOuvert('Variantes de couleur'),
        },
        {
          text: 'Choisissez la famille des verts, une methode, puis appliquez : les variantes deviennent des frames taguees, pretes a partir dans une planche.',
          enter: () => { profondeur = ed.frameCount },
          done: () => ed.frameCount > profondeur,
        },
      ],
    },

    {
      id: 'effets',
      title: 'Effets de calque',
      hint: 'Ombre, contour, biseau, teinte — sans toucher aux pixels',
      icon: 'shading',
      setup: () => ed.loadSprite(spritePixl()),
      steps: [
        {
          text: 'Les effets de calque se posent par-dessus le dessin sans jamais le modifier : '
            + 'ils sont recalcules au moment d\'afficher. On peut donc les régler en les regardant, '
            + 'et changer d\'avis. Ouvrez le panneau Calques, en bas a droite.',
          target: q('[data-panel="layers"]'),
          // Ouvrir le panneau ici, c'etait faire le geste a la place de
          // l'utilisateur : la consigne s'effacait avant d'etre lue.
          enter: () => { app.workspace.setVisible('layers', false) },
          auto: () => { app.workspace.setVisible('layers', true) },
          autoLabel: 'Ouvrir le panneau',
          done: () => !!document.querySelector('.fx-head'),
        },
        {
          text: 'Cliquez le + de la section EFFETS et choisissez « Contour ». '
            + 'Un liseré se pose autour de la silhouette, sur toutes les frames a la fois.',
          target: q('.fx-head'),
          done: () => ed.layer.effects.some((f) => f.kind === 'contour'),
        },
        {
          text: 'Cliquez le nom de l\'effet pour ouvrir ses réglages, puis tirez « Épaisseur ». '
            + 'Le dessin suit le curseur : rien n\'est calcule d\'avance.',
          target: q('.fx-row'),
          enter: () => { epaisseur = ed.layer.effects.find((f) => f.kind === 'contour')?.size ?? 1 },
          done: () => (ed.layer.effects.find((f) => f.kind === 'contour')?.size ?? 1) !== epaisseur,
        },
        {
          text: 'Ajoutez maintenant une « Ombre portee ». L\'angle dit d\'ou vient la lumière, '
            + 'la distance de combien de pixels l\'ombre s\'écarté.',
          target: q('.fx-head'),
          done: () => ed.layer.effects.some((f) => f.kind === 'ombre-portee'),
        },
        {
          text: 'Regardez la ligne « Bord ». Un flou ferait exploser le nombre de couleurs et casserait '
            + 'le pixel art : ici l\'attenuation est soit nette, soit découpée en quelques paliers, '
            + 'soit tramee. Essayez les trois.',
          target: q('.fx-body'),
          enter: () => { bord = ed.layer.effects.find((f) => f.kind === 'ombre-portee')?.falloff ?? 'tramage' },
          done: () => (ed.layer.effects.find((f) => f.kind === 'ombre-portee')?.falloff ?? 'tramage') !== bord,
        },
        {
          text: 'Ajoutez « Teinte » : une seule couleur recouvre tout le calque. '
            + 'C\'est le clignotement d\'un personnage touche, ou la couleur d\'une equipe — '
            + 'sans dupliquer une seule frame.',
          target: q('.fx-head'),
          done: () => ed.layer.effects.some((f) => f.kind === 'teinte'),
        },
        {
          text: 'L\'oeil coupé un effet, la corbeille le retire, et vos pixels n\'ont pas bouge d\'un iota. '
            + 'Coupez-en un pour voir.',
          target: q('.fx-row'),
          enter: () => { relies = ed.layer.effects.length },
          done: () => ed.layer.effects.some((f) => !f.enabled) || ed.layer.effects.length < relies,
        },
        {
          text: 'L\'export applique les effets tout seul : planche, GIF, Unity, Godot. '
            + 'Si vous voulez les retoucher a la main, « Calque > Graver les effets » les inscrit '
            + 'dans les pixels une bonne fois.',
        },
      ],
    },

    {
      id: 'export',
      title: 'Exporter vers un moteur',
      hint: 'Planche, Unity, Godot',
      icon: 'download',
      setup: () => ed.loadSprite(spritePixl()),
      steps: [
        {
          text: 'Pixl arrive avec ses six cycles déjà tagues. Un tag nomme une plage d\'images, et c\'est '
            + 'ce nom qui deviendra celui de l\'animation dans le moteur. Sans tag, tout le sprite ne '
            + 'formerait qu\'une seule animation. Cliquez une image dans un autre cycle pour vous y placer.',
          target: q('#timeline'),
          enter: () => { app.workspace.setTimelineVisible(true); zoomDepart = ed.activeFrame },
          done: () => ed.sprite.tags.length >= 6 && ed.activeFrame !== zoomDepart,
        },
        {
          text: 'Ouvrez l\'export (Ctrl+E). La planche générée s\'affiche en direct : disposition, espacement, échelle.',
          target: q('.topbar-actions .btn.primary'),
          auto: () => { app.runCommand('file.export') },
          autoLabel: 'Ouvrir l\'export',
          done: () => estOuvert('Exporter pour le moteur de jeu'),
        },
        {
          text: 'Choisissez Unity : l\'archive contient le PNG, le .meta de découpe et un AnimationClip '
            + 'par tag — donc six clips ici, Repos, Marche, Course, Saut, Attaque, Dégâts, prets a poser '
            + 'sur un Animator. Godot donne une ressource SpriteFrames prete pour AnimatedSprite2D.',
        },
        {
          text: 'Pensez a l\'extrusion si votre moteur filtre les textures : elle duplique les pixels de bord et supprime les lisieres entre tuiles.',
        },
      ],
    },
  ]
}
