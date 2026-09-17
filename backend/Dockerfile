# syntax=docker/dockerfile:1

# ArcNave backend.
#
# Multi-stage so the runtime image carries compiled JavaScript and production dependencies
# only — no TypeScript, no source maps of the build tooling, no dev dependencies. The build
# stage is where `tsc` lives and it is thrown away.

# ---------------------------------------------------------------------------- deps
# Production dependencies, resolved once and copied into the runtime stage. Separated from the
# build stage so a source-only change does not reinstall node_modules.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------- build
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# tsconfig.build.json excludes *.test.ts and src/test, so no test code reaches the image.
RUN npm run build

# ---------------------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime

# dumb-init reaps zombies and forwards signals, which is what makes the graceful shutdown in
# src/index.ts actually run — PID 1 in Node ignores SIGTERM's default disposition.
RUN apt-get update \
    && apt-get install --no-install-recommends -y dumb-init \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    STORAGE_LOCAL_PATH=/data/uploads

WORKDIR /app

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The migration runner reads these at startup, before the server binds.
COPY drizzle ./drizzle

# The `node` user ships with the image; creating our own would only add a UID to remember.
# The upload volume has to be writable by it, so ownership is set here rather than at runtime
# where a root-owned bind mount would fail the first write.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node

EXPOSE 8080

# /healthz deliberately checks nothing but the process — a readiness probe that fails when the
# database blips would restart a server that is merely waiting. Use /readyz for traffic
# gating; this is liveness.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
# Migrations run in the same container before the server starts, and a failure stops the boot
# rather than leaving a half-migrated database serving traffic.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
