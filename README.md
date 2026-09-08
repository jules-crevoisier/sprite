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

## Déploiement

L'image finale ne contient que nginx et les fichiers construits : **21,5 Mo**,
dont 288 Ko de site. Ni Node, ni `node_modules`, ni sources. Elle tourne en
utilisateur non privilégié sur le port **8080**.

### Dokploy

Le `Dockerfile` et le `docker-compose.yml` sont à la racine, les deux types
d'application fonctionnent.

**Application (le plus court)**

1. **Create Application** → source **GitHub**, ce dépôt, branche `main`.
2. Build Type : **Dockerfile** (détecté tout seul).
3. **Port : `8080`** — l'image n'écoute pas sur 80, c'est ce qui lui permet
   de tourner sans droits root.
4. **Domains** → domaine + HTTPS → **Deploy**.

**Docker Compose**

Pointer sur `docker-compose.yml`, puis onglet **Domains** : Host = votre
domaine, Service = `pixelforge`, Container Port = `8080`.

Ce fichier ne publie **aucun port sur l'hôte** : Traefik joint le conteneur
par le réseau interne `dokploy-network`. C'est ce que Dokploy attend, et cela
évite le conflit `port is already allocated` si un autre service occupe déjà
le port sur la machine.

Aucune variable d'environnement n'est requise : l'application est entièrement
statique et ne parle à aucun service.

### Docker, sans Dokploy

Le second fichier publie le port sur l'hôte :

```bash
docker compose -f docker-compose.local.yml up -d --build   # http://localhost:8080
PIXELFORGE_PORT=8090 docker compose -f docker-compose.local.yml up -d   # autre port
```

```bash
# ou sans compose
docker build -t pixelforge .
docker run -d -p 8080:8080 --name pixelforge pixelforge
```

Les deux fichiers appliquent le même durcissement, vérifié au lancement :
système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`,
et les fichiers temporaires de nginx en mémoire.

### Ce que fait l'image

- **Construction en deux étapes** : Node compile puis disparaît. Les
  dépendances sont dans une couche distincte du code, donc un changement de
  source ne réinstalle rien.
- **Le typage est vérifié pendant le build** : une erreur casse l'image au
  lieu d'arriver en production.
- **Compression au build** : les fichiers sont pré-compressés en gzip et
  servis tels quels via `gzip_static`. Le bundle passe de 180 Ko à 58 Ko sans
  aucun travail à chaque requête.
- **Cache** : les assets ont un nom haché, donc `immutable` pendant un an ;
  `index.html` est en `no-cache`, ce qui évite qu'un déploiement laisse des
  navigateurs sur l'ancienne version.
- **En-têtes** : CSP stricte (`default-src 'self'`, aucune ressource
  externe — `blob:` et `data:` restent autorisés pour les exports),
  `nosniff`, `no-referrer`, `frame-ancestors 'none'`.
- **Sonde `/healthz`** utilisée par le `HEALTHCHECK` du conteneur et
  exploitable par l'orchestrateur.

### Hébergement statique

`npm run build` produit un `dist/` autonome en chemins relatifs : il se dépose
tel quel sur Netlify, Vercel, GitHub Pages, Cloudflare Pages ou un simple
bucket, sans configuration.

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

### Effets de calque

Les effets se posent sur un **calque**, pas sur des pixels : ils sont
recalculés au moment de composer l'image. On règle donc une ombre en la
regardant bouger, on la coupe d'un clic, on revient en arrière sans perte —
et le dessin d'origine reste intact sur toutes les frames.

Huit effets : **ombre portée**, **ombre interne**, **lueur externe**,
**lueur interne**, **contour**, **biseau**, **teinte**, **dégradé**. La
section EFFETS du panneau Calques les liste ; le menu Calque les pose aussi
d'un coup.

Un point les sépare de leurs équivalents en maquette : **il n'y a pas de
flou gaussien**. Un flou fabriquerait des centaines de couleurs et casserait
le pixel art. L'atténuation se règle sur trois positions :

| Bord | Ce qu'il fait | Couleurs ajoutées |
| --- | --- | --- |
| **Net** | l'effet s'arrête franchement | 1 |
| **Paliers** | 2 à 6 niveaux d'opacité | autant que de paliers |
| **Trame** | un motif de Bayer régulier remplace le dégradé | 1 |

La distance au bord est mesurée par une transformée exacte, pas approchée :
une lueur tramée dessine de vrais anneaux ronds, pas des losanges.

Le **retrait** existe pour les dessins déjà cernés d'un contour sombre : il
fait démarrer un biseau ou une lueur interne quelques pixels plus loin, sur
la matière, au lieu de délaver le trait.

Les effets partent tels quels dans la planche, le GIF et les exports moteur.
`Calque > Graver les effets` les inscrit dans les pixels quand on veut les
retoucher à la main.

### Travailler avec l'assistant

Trois fonctions s'appuient sur une analyse du dessin plutôt que sur des
réglages aveugles. Les couleurs du sprite sont d'abord regroupées en
**familles** — les teintes d'une même gamme classées de l'ombre à la
lumière. C'est l'unité de travail naturelle du pixel art : un vêtement, une
peau, un feuillage sont chacun une famille.

![Le personnage au repos, la carte des os, puis quatre poses](docs/rig.png)

*De gauche à droite : le dessin de repos, la carte des os — une couleur par
os, qui montre à qui appartient chaque pixel — puis quatre poses.*

**Squelette et pose** (`Maj+K`). Six modèles prêts à l'emploi — humanoïde de face
et de profil, quadrupède, oiseau, arbre, membre simple — se calent sur la
boîte des pixels opaques, donc ils tombent juste quelle que soit la taille du
sprite. On peut aussi tracer les os soi-même.

Un personnage se rigge d'autant mieux que ses membres se distinguent du
corps : le personnage de démonstration écarte les bras du torse de trois
pixels, ce qui laisse une colonne libre entre les deux contours. La liaison
sépare alors le bras du corps au lieu de couper au milieu d'une masse
continue. On lie ensuite les
pixels : chacun est attribué à l'os le plus proche. Tirer une
extrémité fait pivoter le membre et l'image est régénérée : le parcours va
du pixel d'arrivée vers sa source, donc aucun trou n'apparaît là où la
matière s'étire, et les fissures d'articulation sont refermées par une
recherche locale puis un comblement majoritaire. Les os s'enchaînent — une
rotation d'épaule entraîne tout le bras — et les pixels qu'aucun os ne porte
restent en place, ce qui permet de ne rigger qu'une partie du dessin.
Mémorisez une pose, déplacez le squelette, et les frames intermédiaires sont
générées par interpolation.

**Variantes de couleur** (`Ctrl+Maj+V`). On choisit une famille et l'éditeur
en propose des déclinaisons : tour du cercle chromatique, teintes voisines,
complémentaire, ou strictement dans la palette du projet. Les rapports
d'ombre et de lumière sont conservés, donc le modelé survit au changement de
teinte. Les variantes retenues deviennent des frames taguées, des calques,
ou remplacent le sprite.

![Bloc d'herbe brut, deux passes de détail, puis une variante de couleur](docs/detail.png)

**Ajouter du détail** (`Ctrl+Maj+D`). Grain, taches, touffes, ombre des
bords, lumière du haut, volume tramé — avec des enchaînements prêts pour
l'herbe, la pierre, la terre, le tissu et le métal. Chaque pixel se décale
d'un cran dans sa propre famille, si bien que la texture **n'introduit
aucune couleur étrangère**. Une graine fait varier le tirage, et « Ajouter »
fige la passe courante pour en préparer une autre : le détail se cumule.

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

## Apprendre

`Maj+F1` ouvre les tutoriels, et la visite est proposée au tout premier
lancement. Chaque leçon charge un document de démonstration et se déroule
**dans l'éditeur** : la zone concernée est mise en avant, l'étape se valide
d'elle-même dès que le geste est fait, et un bouton l'exécute à votre place
si vous préférez voir le résultat d'abord.

![Une leçon en cours dans l'éditeur](docs/tutoriel.png)

Six leçons : prise en main, animer, squelette et pose, détail et variantes,
effets de calque, export vers un moteur.

La leçon du squelette ne fait rien à votre place : elle attend que vous
basculiez de mode, que vous posiez le modèle, que vous liiez les pixels et
que vous tiriez le bras — une flèche animée sur la toile montre exactement
le geste à faire.

## Deux modes de travail

L'éditeur bascule entre **Dessin** et **Squelette** depuis la barre du haut,
et l'interface entière suit : barre d'outils, panneaux, réglages. On ne
cherche pas un crayon quand on articule un personnage.

![Le mode Squelette : outils, hiérarchie des os et influence en couleur](docs/mode-squelette.png)

En mode Squelette, trois outils : **Créer des os**, **Poser** et
**Pondérer**. Chaque couleur sur la toile montre l'os qui porte le pixel —
la lecture la plus directe de ce qui va bouger avec quoi — et le pinceau
Pondérer corrige les frontières quand un bout d'épaule part avec le bras.
Les couleurs suivent le membre quand il bouge : elles sont recalculées dans
l'espace de la pose, pas du repos.

Chaque mode garde sa propre disposition de panneaux.

## Espace de travail

Les panneaux ne sont pas figés. Chacun se déplace entre le dock gauche et le
dock droit par glisser-déposer sur son en-tête, se réordonne, se plie ou se
masque ; les docks se redimensionnent au séparateur et la timeline s'affiche
ou se cache. Cinq dispositions couvrent les façons de travailler courantes —
complet, dessin, animation, deux colonnes, minimal — et la disposition
courante est restaurée au chargement suivant.

## Raccourcis

`F1` affiche la liste complète, `Ctrl+K` ouvre la palette de commandes.

| | |
|---|---|
| Outils | `B` crayon · `E` gomme · `G` pot · `I` pipette · `L` ligne · `U` rectangle · `Maj+U` ellipse · `Q` contour · `R` dégradé · `D` ombrage · `M` sélection · `W` baguette · `V` déplacer · `Z` loupe |
| Pinceau | `[` `]` taille · **Alt + molette** sur la toile · le curseur de la barre d'options se tire jusqu'au bout |
| Aperçus des dialogues | molette : zoom · glisser : déplacer · double-clic : ajuster |
| Souris | clic droit = couleur secondaire · `Alt`+clic = pipette · `Espace`+glisser = déplacer la vue · molette = zoom |
| Pendant un tracé | `Maj` contraint à 45° · `Alt` dessine depuis le centre |
| Sélection | `Maj` ajoute · `Alt` soustrait · `Ctrl` intersecte · flèches déplacent les pixels |
| Animation | `,` `.` frame précédente/suivante · `Entrée` lecture · `Alt+N` nouvelle frame · `Ctrl+T` tag |
| Assistant | `Maj+K` mode squelette · `Ctrl+Maj+V` variantes · `Ctrl+Maj+D` détail |
| Mode squelette | `K` créer des os · `J` poser · `N` pondérer |
| Aide | `Maj+F1` tutoriels · `F1` raccourcis · `Ctrl+K` commandes |
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
  smart/       analyse des familles de couleurs, variantes, détail, squelette
  io/          sauvegarde du projet et import d'images
  ui/          panneaux, menus, dialogues, raccourcis
docker/        configuration nginx de l'image de production
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
- Le squelette déforme au plus proche voisin : une rotation faible sur un
  petit sprite reste anguleuse, comme toute rotation de pixel art.
- Pas de lecture ni d'écriture du format `.aseprite` binaire ; l'échange passe
  par le PNG et le JSON.
- Le mode couleur est RGBA : pas d'indexé strict, mais l'alignement sur la
  palette permet de s'y contraindre.
