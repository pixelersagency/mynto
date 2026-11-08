# syntax=docker/dockerfile:1.7

# ============================================================
# mynto scanner : Fastify + workers BullMQ + Playwright (Chromium).
# Build depuis la racine du dépôt :
#   docker build -f apps/scanner/Dockerfile -t mynto/scanner .
# Image de base Playwright officielle : Chromium et ses bibliothèques
# déjà installés. PLAYWRIGHT_VERSION doit rester égale à la version du
# paquet playwright de apps/scanner/package.json (vérifié par la CI).
# Aucun secret dans l'image : tout se lit au démarrage.
# ============================================================

ARG PLAYWRIGHT_VERSION=1.59.1

# ----- base -----
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ----- deps : dépendances de production du scanner seulement -----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/scanner/package.json apps/scanner/
COPY packages/checks/package.json packages/checks/
COPY packages/db/package.json packages/db/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/mcp/package.json packages/mcp/
COPY packages/shared/package.json packages/shared/
COPY packages/templates/package.json packages/templates/
COPY packages/tsconfig/package.json packages/tsconfig/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@mynto/scanner..."

# ----- runtime -----
# Le TypeScript tourne via tsx (même résolution des imports './x.js' que
# en développement), sans étape de compilation.
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    MEDIA_DIR=/data/media \
    TSX_TSCONFIG_PATH=/app/apps/scanner/tsconfig.runtime.json \
    HOME=/home/mynto \
    XDG_CONFIG_HOME=/home/mynto/.config \
    XDG_CACHE_HOME=/home/mynto/.cache
# Utilisateur non root, même UID/GID que le web (volume des médias partagé).
RUN groupadd -g 10001 mynto \
 && useradd -u 10001 -g mynto -m -d /home/mynto -s /usr/sbin/nologin mynto \
 && mkdir -p /data/media /home/mynto/.config /home/mynto/.cache \
 && chown -R mynto:mynto /home/mynto /data/media
COPY --from=deps /app ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/scanner ./apps/scanner
USER 10001:10001
WORKDIR /app/apps/scanner
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Migrations appliquées au démarrage (verrou consultatif Postgres), puis
# serveur HTTP interne et workers.
CMD ["node", "--import", "tsx", "src/index.ts"]
