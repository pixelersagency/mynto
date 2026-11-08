# syntax=docker/dockerfile:1.7

# ============================================================
# mynto web : Next.js 15 (sortie standalone), monorepo pnpm.
# Build depuis la racine du dépôt :
#   docker build -f apps/web/Dockerfile -t mynto/web .
# Aucune variable n'est figée dans l'image : tout se lit au démarrage
# (PUBLIC_URL, DATABASE_URL, secrets...). Ne passe aucun secret en
# --build-arg.
# ============================================================

ARG NODE_VERSION=22

# ----- base -----
FROM node:${NODE_VERSION}-alpine AS base
# libc6-compat suit la version d'Alpine de l'image node : pas d'épinglage.
# hadolint ignore=DL3018
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ----- deps : uniquement les manifestes, pour garder le cache -----
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
    pnpm install --frozen-lockfile --ignore-scripts --filter "@mynto/web..."

# ----- builder -----
FROM base AS builder
COPY --from=deps /app ./
COPY tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/web ./apps/web
ENV NODE_ENV=production
RUN pnpm --filter @mynto/web build

# ----- runner -----
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MEDIA_DIR=/data/media
# Même UID/GID que le scanner : le volume des médias est partagé.
RUN addgroup -S -g 10001 mynto \
 && adduser -S -D -H -u 10001 -G mynto mynto \
 && mkdir -p /data/media \
 && chown mynto:mynto /data/media
COPY --from=builder --chown=mynto:mynto /app/apps/web/.next/standalone ./
COPY --from=builder --chown=mynto:mynto /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=mynto:mynto /app/apps/web/public ./apps/web/public
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
