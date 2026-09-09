# Film de présentation (première version)

> **Remplacée.** Le film livré dans `media/` est désormais monté avec Remotion
> dans `video-remotion/`. Cette version-ci enchaînait des panneaux qui
> apparaissaient et disparaissaient sur place : la matière était bonne, mais
> le résultat se regardait comme une suite de diapositives. La nouvelle
> déplace une caméra dans un plan et garde le personnage à l'écran d'un bout
> à l'autre. Le code ci-dessous reste en place pour ses scripts npm
> (`npm run film`) et pour référence ; il n'est plus la source du film publié.

Le film est rendu image par image à partir de l'application réelle. Rien n'y
est redessiné à la main : les cycles d'animation sortent du moteur de
déformation, les captures d'interface sortent de l'éditeur qui tourne.

## Deux passes

| Passe | Fichier | Ce qu'elle fait |
| --- | --- | --- |
| Récolte | `capture.mjs` | Lance l'app, monte un squelette, produit les images de chaque cycle, l'avant/après de l'ombrage, les rampes, la géométrie des os et les captures d'écran. |
| Rendu | `render.mjs` | Sert `film.html`, appelle `FILM.seek(t)` pour chaque image, photographie, et pousse le flux dans ffmpeg. |

```sh
npm run film            # les deux passes
npm run film:verifier   # parcourt le montage sans encoder, et vérifie
```

## Pourquoi image par image

Un enregistrement d'écran dépend de la charge machine : dès que le navigateur
peine, des images sont sautées et le mouvement se met à claquer. Ici la page
n'anime rien toute seule — pas de CSS animé, pas de `requestAnimationFrame`.
Elle expose une position dans le temps ; le rendu la déplace d'un
soixantième de seconde et photographie. Le résultat est identique à chaque
passage, et le rendu peut être dix fois plus lent que le temps réel sans
qu'une image manque.

## Réglages

- `--fps 60`, `--depuis` et `--jusqua` (en secondes) pour ne rendre qu'un extrait.
- `PW_CHROMIUM` pour imposer un binaire Chromium ; sinon il est cherché dans
  `PLAYWRIGHT_BROWSERS_PATH`.
- ffmpeg est pris dans le système, ou à défaut celui livré avec Playwright.

## Polices

`fonts/` contient les sous-ensembles latins d'Inter, JetBrains Mono et
Silkscreen, sous licence SIL Open Font License 1.1. Elles sont embarquées
pour que le film se rende à l'identique sans accès réseau.
