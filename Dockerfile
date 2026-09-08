# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Etape 1 : construction du site statique.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Playwright n'est utile qu'au test de bout en bout : inutile de telecharger
# les navigateurs pendant la construction de l'image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    CI=true

# Les dependances changent moins souvent que le code : couche separee, donc
# reconstruite seulement quand le lockfile bouge.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# `npm run build` verifie aussi les types : une erreur casse la construction
# de l'image plutot que d'atterrir en production.
RUN npm run build

# Pre-compression : nginx sert directement le .gz, sans compresser a chaque
# requete. -k garde l'original pour les clients qui ne gerent pas gzip.
RUN find dist -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.html' \
         -o -name '*.svg' -o -name '*.json' -o -name '*.map' \) \
      -exec gzip -9 -k {} +

# ---------------------------------------------------------------------------
# Etape 2 : image finale. Seuls nginx et les fichiers construits subsistent :
# ni Node, ni node_modules, ni sources.
# ---------------------------------------------------------------------------
FROM nginx:1.29-alpine-slim AS runtime

COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/default.conf          /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist       /usr/share/nginx/html

# Pour tourner sans droits root, nginx doit ecrire son pid et ses fichiers
# temporaires dans un repertoire qui lui appartient. La directive `user`
# devient inutile (le processus maitre n'est deja plus root) et n'emettrait
# qu'un avertissement au demarrage.
RUN set -eux; \
    sed -i 's|^pid .*|pid /var/cache/nginx/nginx.pid;|' /etc/nginx/nginx.conf; \
    sed -i '/^user  *nginx;/d' /etc/nginx/nginx.conf; \
    chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html; \
    rm -f /usr/share/nginx/html/50x.html; \
    nginx -t; \
    rm -f /var/cache/nginx/nginx.pid

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider --tries=1 http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
