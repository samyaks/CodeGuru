# syntax=docker/dockerfile:1
#
# Speed notes:
# - `app/client` is a root npm workspace → one `npm ci` installs client + server deps
#   (no second `npm install` in app/client).
# - Layer order: packages → annotate build → app/client → Vite build, so server-only
#   commits reuse the annotate layer from cache.
# - BuildKit `--mount=type=cache` for npm + Vite speeds rebuilds on Railway/Fly.
# - Do not add `echo $(date)` before the client build — it busts the cache every push.

FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/annotate/package.json packages/annotate/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/sse/package.json packages/sse/package.json
COPY packages/railway/package.json packages/railway/package.json
COPY app/package.json app/package.json
COPY app/client/package.json app/client/package.json

RUN --mount=type=cache,id=npm-dev,target=/root/.npm \
    npm ci --include=dev

COPY packages/ packages/
RUN cd packages/annotate && npm run build:lib

COPY app/client/ app/client/
RUN --mount=type=cache,id=npm-dev,target=/root/.npm \
    --mount=type=cache,id=vite,target=/app/app/client/node_modules/.vite \
    npm run build --prefix app/client

# Stage 2: Production image — server + built client
FROM node:20-slim AS production

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/annotate/package.json packages/annotate/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/sse/package.json packages/sse/package.json
COPY packages/railway/package.json packages/railway/package.json
COPY app/package.json app/package.json
COPY app/client/package.json app/client/package.json

RUN --mount=type=cache,id=npm-prod,target=/root/.npm \
    npm ci --omit=dev && npm cache clean --force

COPY packages/ packages/

COPY app/server/ app/server/
COPY app/package.json app/package.json

COPY --from=builder /app/app/client/dist app/client/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

WORKDIR /app/app
CMD ["sh", "-c", "node server/lib/migrate.js && node server/app.js"]
