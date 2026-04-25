# syntax=docker/dockerfile:1
#
# Speed notes:
# - `app/client` is a root npm workspace → one `npm ci` installs client + server deps
#   (no second `npm install` in app/client).
# - Layer order: packages → annotate build → app/client → Vite build, so server-only
#   commits reuse the annotate layer from cache.
# - Production stage uses `npm ci -w …` for server + @codeguru/* only — not the
#   client/annotate workspaces — so cold builds skip installing React/Vite/Tailwind
#   twice (builder already did for the static bundle).
# - No `RUN --mount=type=cache` here: Railway requires
#   id=s/<service-uuid>-<target> (hardcoded; ARG not allowed). Plain RUN works
#   on Railway, Fly, and local Docker.
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

RUN npm ci --include=dev

COPY packages/ packages/
RUN cd packages/annotate && npm run build:lib

COPY app/client/ app/client/
RUN npm run build --prefix app/client

# Stage 2: Production image — server + built client
#
# Only install workspaces the Node server actually loads (see app/server requires).
# Skipping codeguru-client + @takeoff/annotate avoids a second full Vite/React tree
# (~minutes of npm + disk). SPA assets come from builder dist only.
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

RUN npm ci --omit=dev \
      -w codeguru-app \
      -w @codeguru/auth \
      -w @codeguru/github \
      -w @codeguru/railway \
      -w @codeguru/sse \
    && npm cache clean --force

COPY packages/auth/ packages/auth/
COPY packages/github/ packages/github/
COPY packages/railway/ packages/railway/
COPY packages/sse/ packages/sse/

COPY app/server/ app/server/
COPY app/package.json app/package.json

COPY --from=builder /app/app/client/dist app/client/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

WORKDIR /app/app
CMD ["sh", "-c", "node server/lib/migrate.js && node server/app.js"]
