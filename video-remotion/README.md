# Film de présentation

Projet npm autonome. Il a son propre `package.json` et son propre
`node_modules` : le projet racine annonce zéro dépendance d'exécution et le
reste. Rien ici n'est installé à la racine.

```sh
cd video-remotion
npm install
npm run capture     # récolte les images depuis l'application réelle
npm run verifier    # parcourt tout le film sans encoder, et contrôle
npm run rendu       # écrit media/pixelforge-presentation.mp4
```

## Le principe : rien n'est redessiné

`capture.mjs` lance le serveur de développement, ouvre l'éditeur dans Chromium
et le pilote par son API (`window.pixelforge`). Tout ce que le film montre en
sort : les poses viennent du moteur de déformation, les huit effets de calque
du rendu d'effets, les variantes de `generateVariants`, les extraits de
fichiers de la chaîne d'export, les icônes du registre d'outils, les courbes
de `easingPath`. Les captures d'interface sont des photos de l'application qui
tourne. Le montage met en scène, il n'invente pas.

Le résultat va dans `public/`, que Remotion sert via `staticFile()`, et il est
versionné : le film se rend depuis un dépôt frais sans repasser par la
récolte. À relancer quand le logiciel change.

## Le montage

Le film ne coupe pas d'une diapositive à l'autre. Les dix séquences occupent
des positions distinctes dans un plan de quatorze mille pixels de large
(`src/film/plan.ts`) et la caméra s'y déplace : le décor traverse le champ
pendant les panoramiques, ce qui donne la direction et la vitesse du
mouvement. Le personnage, lui, vit en espace écran et ne quitte jamais le
cadre : c'est le fil qui relie les séquences, et chaque fonction du logiciel
se lit sur le même dessin. À la fin, un seul recul montre tout le chemin.

Le zoom reste à 1 sur toutes les stations. Ce n'est pas une timidité : un zoom
fractionnaire étire les pixels du sprite de façon inégale. Les deux seuls
moments où l'on s'en affranchit sont l'ouverture et le recul final, où plus
rien n'a besoin d'être lisible au pixel près.

| Fichier | Rôle |
| --- | --- |
| `src/film/plan.ts` | Le score : stations, caméra, trajet du personnage |
| `src/film/mouvement.ts` | Pistes par images clés, au-dessus de `spring()` et `interpolate()` |
| `src/film/Monde.tsx` | Le plan, la caméra, le décor et le chemin |
| `src/film/Hero.tsx` | Le personnage et ses états successifs |
| `src/film/stations/` | Une séquence par fichier |

## Vérification

`npm run verifier` construit le bundle, parcourt les 5 070 images dans
Chromium **sans rien encoder** (`imageFormat: 'none'`) et exige : durée
supérieure à 60 s, format 1920×1080 à 60 i/s, aucune erreur de page, aucun
trou dans le montage, aucune séquence morte. Il rend ensuite trois images
témoins par séquence et refuse un cadre quasi vide ou trois images
identiques — le défaut qu'aucune vérification de code ne voit.

`node apercu.mjs --secondes 12,35,68` écrit des images fixes aux instants
demandés. C'est ce qui attrape un texte coupé ou un panneau posé sur le
personnage, pour le prix d'une image au lieu d'un rendu complet.

`node mesure.mjs --depuis 2600 --combien 60` chronomètre un extrait sans rien
écrire. C'est lui qui a montré que le grain, un `feTurbulence` plein cadre,
coûtait à lui seul les treize quatorzièmes du temps de rendu, et que la trame
posée dans le monde coûtait le reste : trois heures de rendu sont devenues
trente minutes. Sans mesure, on optimise ce qu'on suppose lourd.

## Déterminisme

Rien n'anime tout seul : pas d'animation CSS, pas de `requestAnimationFrame`,
pas de `Math.random`. Chaque image est une fonction de son numéro. Les polices
sont embarquées et chargées derrière un `delayRender`, sinon les premières
images sortent en police de secours. Le grain de fond est une tuile tirée une
fois avec un générateur à graine fixe. Deux rendus donnent le même fichier.

## Binaires

Chromium est cherché dans `PLAYWRIGHT_BROWSERS_PATH`, ou imposé par
`PW_CHROMIUM`. C'est un Chrome complet et non un « headless shell », d'où le
`chromeMode: 'chrome-for-testing'` : sans lui il refuse de démarrer, l'ancien
mode sans fenêtre ayant été retiré du binaire.

## Polices

`public/fonts/` contient les sous-ensembles latins d'Inter, JetBrains Mono et
Silkscreen, sous licence SIL Open Font License 1.1.
