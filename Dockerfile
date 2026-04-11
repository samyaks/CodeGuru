# Stage 1: Install all dependencies and build the React client
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace root and lockfile first (cache layer)
COPY package.json package-lock.json ./

# Copy workspace package.json files so npm can resolve workspace links
COPY packages/auth/package.json packages/auth/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/sse/package.json packages/sse/package.json
COPY packages/railway/package.json packages/railway/package.json
COPY app/package.json app/package.json
COPY app/client/package.json app/client/package.json

RUN npm ci --include=dev

# Bust Docker layer cache (change this value to force full rebuild)
ARG CACHE_DATE=2026-04-11

# Copy source code
COPY packages/ packages/
COPY app/ app/

# Install client dependencies (not a workspace member) and build
RUN cd app/client && npm install && npm run build

# Stage 2: Production image — server + built client
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
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

# Create data directory for SQLite (mount a volume here for persistence)
RUN mkdir -p app/server/data

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

WORKDIR /app/app
CMD ["node", "server/app.js"]
