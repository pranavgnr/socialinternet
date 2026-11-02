# syntax=docker/dockerfile:1

# Creators 101 — production image.
#
# The app is a normal Next.js server (`next start`), not a standalone build, so
# node_modules and .next both ship. Docker is not required for development;
# this exists so the same image can run on a small VPS.

FROM node:26-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# ffmpeg is installed because the media reader checks for it on every start.
# whisper.cpp and Swift are deliberately NOT installed: on Linux the deep pass
# is caption-only for V1. A copied scripts/ocr.swift does not make OCR work
# (lib/media.ts only enables it on macOS), so the plan says it read captions.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json

# `npm run migrate` compiles scripts/migrate.ts at runtime with the TypeScript
# in node_modules, so the sources and SQL migrations have to be in the image.
COPY --from=builder --chown=node:node /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=builder --chown=node:node /app/lib ./lib
COPY --from=builder --chown=node:node /app/db ./db

# /app/data holds niche caches, handle caches and per-visitor JSON plans. It is
# a volume in compose and must be a persistent disk in production.
RUN mkdir -p /app/data /app/.tmp-build \
 && chown -R node:node /app/data /app/.tmp-build

USER node
EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
