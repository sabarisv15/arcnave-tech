# syntax=docker/dockerfile:1

# ArcNave frontend: a Vite build served by nginx, which also proxies /v1 to the backend so the
# browser sees a single origin. See nginx.conf for why that matters to the session cookie.

# ---------------------------------------------------------------------------- build
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY . .
# `npm run build` is `tsc -b && vite build`, so a type error fails the image rather than
# shipping a bundle that does not typecheck.
RUN npm run build

# ---------------------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Port 8080 rather than 80 so the container needs no privileged port and can drop to the
# unprivileged user the image already ships.
EXPOSE 8080
USER nginx

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["sh", "-c", "wget --quiet --tries=1 --spider http://127.0.0.1:8080/index.html || exit 1"]
