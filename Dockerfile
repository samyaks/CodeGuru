# Stage 1: Install all dependencies and build the React client
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace root and lockfile first (cache layer)
COPY package.json package-lock.json ./

# Copy workspace package.json files so npm can resolve workspace links
COPY packages/annotate/package.json packages/annotate/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/sse/package.json packages/sse/package.json
COPY packages/railway/package.json packages/railway/package.json
COPY app/package.json app/package.json
COPY app/client/package.json app/client/package.json

RUN npm ci --include=dev

# Copy source code
COPY packages/ packages/
COPY app/ app/

# Build the annotate package first (client depends on it)
RUN cd packages/annotate && npm run build:lib

# Install client deps and build
RUN cd app/client && npm install && echo "build:$(date +%s)" && npm run build

# Stage 2: Production image — server + built client
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/annotate/package.json packages/annotate/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/sse/package.json packages/sse/package.json
COPY packages/railway/package.json packages/railway/package.json
COPY app/package.json app/package.json
COPY app/client/package.json app/client/package.json

RUN npm ci --omit=dev && npm cache clean --force

# Copy workspace packages (server uses them at runtime)
COPY packages/ packages/

# Copy server code
COPY app/server/ app/server/
COPY app/package.json app/package.json

# Copy built client from builder stage
COPY --from=builder /app/app/client/dist app/client/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# No Docker HEALTHCHECK: Railway (and Fly) probe /health themselves via the
# platform config (railway.toml / fly.toml). A container-local HEALTHCHECK
# that fetches process.env.API_URL races against platform routing during
# rolling deploys and can mark a freshly-booted replica "unhealthy" even
# when the app is fine.

WORKDIR /app/app
# Run migrations before starting the server (idempotent — skips already applied)
CMD ["sh", "-c", "node server/lib/migrate.js && node server/app.js"]
