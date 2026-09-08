# PixelForge

Éditeur de sprites et d'animation pixel art dans le navigateur, pensé pour le
game dev. Dessin, timeline, tags d'animation, et surtout des exports qui
tombent directement dans un projet Unity ou Godot sans retouche.

Tout tourne côté client : aucun compte, aucun serveur, aucune donnée envoyée.
Le document vit dans l'onglet et une sauvegarde automatique reste dans le
stockage local du navigateur.

![Interface de PixelForge](docs/apercu.png)

## Démarrer

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # génère dist/ (site statique, déployable tel quel)
npm run preview  # sert le build
```

## Ce qu'on peut faire

### Dessiner

20 outils : crayon, gomme, pot de peinture, pipette, ligne, courbe de Bézier,
rectangle, ellipse, contour libre, dégradé, ombrage, flou, aérographe, les
quatre modes de sélection (rectangle, ellipse, lasso, baguette magique),
déplacement, main et loupe.

- **Pixel perfect** : le filtre anti-coins d'Aseprite, actif par défaut sur les
  traits de 1 px.
- **Brosses** ronde, carrée, losange et lignes, de 1 à 64 px.
- **Modes de pose** : normal, derrière, alpha verrouillé.
- **Tramage** : Bayer 2/4/8, damier, lignes, bruit, avec ratio réglable — le
  dégradé peut lui aussi être tramé plutôt qu'interpolé.
- **Symétrie** X et Y en direct, **mode tuile** où le trait se replie sur les
  bords opposés (avec aperçu 3×3 pour vérifier le raccord).
- **Ombrage** : éclaircit au clic gauche, assombrit au clic droit, et
  réaligne le résultat sur la palette du sprite.
- 19 modes de fusion de calque, opacité par calque et par case.

### Animer

- Timeline calques × frames avec vignettes, durée par frame, réordonnancement.
- **Tags d'animation** (`idle`, `run`, `hit`…) avec sens de lecture avant,
  arrière, aller-retour, et nombre de répétitions.
- **Pelure d'oignon** jusqu'à 3 frames avant et après, teintées rouge/bleu.
- Lecture en direct sur la toile, limitée au tag courant si besoin.

### Exporter

La fenêtre d'export montre la planche générée en direct et produit une archive
prête à déposer dans le projet.

![Fenêtre d'export](docs/export.png)

| Cible | Contenu de l'archive |
|---|---|
| **Générique** | `sprite.png` + `sprite.json` au format Aseprite (lu tel quel par Phaser, PixiJS, LibGDX, Defold, MonoGame…) |
| **Unity** | `sprite.png` + `sprite.png.meta` (découpe, pivot, filtre Point, sans compression) + un `.anim` par tag + le JSON |
| **Godot 4** | `sprite.png` + `sprite_frames.tres` (SpriteFrames avec une AtlasTexture par frame, prêt pour `AnimatedSprite2D`) + le JSON, et un `TileSet` en option |

Dispositions de planche : une ligne, une colonne, grille à N colonnes, une
ligne par tag, ou empaquetage compact. Avec **extrusion** des bords
(anti-bleeding en filtrage bilinéaire), espacement, marge, rognage par frame,
contrainte puissance de deux et carré, et agrandissement entier ×1 à ×8.

Autres sorties : PNG de la frame, PNG de chaque frame en `.zip`, **GIF animé**
(encodeur écrit pour le projet, durées et transparence conservées), palette
`.gpl`, et le projet `.pixelforge` rechargeable sans perte.

Quelques détails qui comptent à l'import :

- Unity attend une origine en bas à gauche : les rectangles du `.meta` sont
  inversés en Y, et les identifiants internes sont stables d'un export à
  l'autre, donc les références des `.anim` ne cassent pas.
- Une zone 9-slice définit la propriété *Border* du sprite Unity.
- Godot exprime la vitesse en images par seconde plus un multiplicateur par
  frame : la frame la plus courte sert de référence, ce qui reproduit
  exactement les durées d'origine.

### Importer

Glisser une image ou un `.pixelforge` sur la zone de dessin, ou coller une
image depuis le presse-papiers. Une planche existante peut être redécoupée en
frames en indiquant la taille des cases, l'espacement et la marge.

### Palettes

11 palettes intégrées (DawnBringer 32, PICO-8, Sweetie 16, Endesga 32, Vinik
24, Game Boy, NES, CGA…), extraction par median cut depuis le sprite, import
`.gpl` et `.hex` (Lospec), tri par luminosité ou par teinte. Remplacer une
couleur de la palette la remplace dans tout le sprite.

## Raccourcis

`F1` affiche la liste complète, `Ctrl+K` ouvre la palette de commandes.

| | |
|---|---|
| Outils | `B` crayon · `E` gomme · `G` pot · `I` pipette · `L` ligne · `U` rectangle · `Maj+U` ellipse · `Q` contour · `R` dégradé · `D` ombrage · `M` sélection · `W` baguette · `V` déplacer · `Z` loupe |
| Souris | clic droit = couleur secondaire · `Alt`+clic = pipette · `Espace`+glisser = déplacer la vue · molette = zoom |
| Pendant un tracé | `Maj` contraint à 45° · `Alt` dessine depuis le centre |
| Sélection | `Maj` ajoute · `Alt` soustrait · `Ctrl` intersecte · flèches déplacent les pixels |
| Animation | `,` `.` frame précédente/suivante · `Entrée` lecture · `Alt+N` nouvelle frame · `Ctrl+T` tag |
| Divers | `X` permute les couleurs · `[` `]` taille de brosse · `Échap` annule le geste puis désélectionne |

## Sous le capot

Aucune dépendance à l'exécution : TypeScript strict et l'API Canvas.

```
src/
  core/        modèle et état
    bitmap      surface RGBA, vue Uint32 pour les opérations en masse
    color       couleurs packées, HSV, distance perceptuelle
    blend       19 modes de fusion (spécification W3C, comme Aseprite)
    document    Sprite / Layer / Cel / Tag / Slice
    selection   masque binaire, combinaisons, contour des fourmis marcheuses
    history     annulation par diff de région, snapshots de structure
    operations  transformations, presse-papiers, effets
    editor      état central et point d'entrée des mutations
  tools/       algorithmes (Bresenham, ellipse, remplissage par lignes,
               pixel perfect, tramage) et les 20 outils
  render/      composition des calques et viewport (zoom, grilles, onion skin)
  export/      planches, JSON, Unity, Godot, GIF, ZIP
  io/          sauvegarde du projet et import d'images
  ui/          panneaux, menus, dialogues, raccourcis
```

Deux choix structurants :

- **Les cases occupent toute la toile.** Les outils, la sélection et les
  transformations n'ont donc jamais à gérer d'offset. La mémoire reste
  raisonnable en pixel art, et la sérialisation passe les pixels en PNG.
- **L'historique stocke des différences de région.** Un trait n'enregistre que
  le rectangle réellement modifié ; les opérations de structure prennent un
  instantané qui partage les bitmaps par référence, donc quasi gratuit.

## Tests

```bash
npm run typecheck
npm run test:smoke   # nécessite Chromium : npx playwright install chromium
```

Le test de bout en bout ouvre l'application dans un vrai navigateur et vérifie
le dessin, l'historique, les cinq dispositions de planche (aucun chevauchement,
pixels identiques aux frames source), l'extrusion, le JSON, le `.meta` Unity et
son inversion en Y, les `AnimationClip`, la ressource Godot, le GIF relu par le
décodeur du navigateur, la signature du ZIP et l'aller-retour du projet.

## Limites connues

- Pas de groupes de calques ni de cases liées.
- Pas de lecture ni d'écriture du format `.aseprite` binaire ; l'échange passe
  par le PNG et le JSON.
- Le mode couleur est RGBA : pas d'indexé strict, mais l'alignement sur la
  palette permet de s'y contraindre.
