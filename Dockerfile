# Builder: one dev install, build annotate + SPA, then shrink for copy into prod.
# Production: copy pruned node_modules from builder — no second `npm ci` (that was
# often several minutes on Railway cold builders).
#
# Other notes:
# - `app/client` is a root workspace → single `npm ci` for client + server deps.
# - Layer order keeps annotate/client builds cacheable when only server changes.
# - No BuildKit cache mounts: Railway needs id=s/<service-uuid>-<path> (hardcoded).
# - Never `echo $(date)` before a build step — it busts Docker layer cache every push.

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
RUN npm run build --prefix app/client \
  && rm -rf app/client \
  && npm prune --omit=dev \
  && rm -rf node_modules/@takeoff packages/annotate \
  && npm cache clean --force

# Production: slim runtime — reuse pruned node_modules from builder
FROM node:20-slim AS production

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/auth ./packages/auth
COPY --from=builder /app/packages/github ./packages/github
COPY --from=builder /app/packages/railway ./packages/railway
COPY --from=builder /app/packages/sse ./packages/sse

COPY --from=builder /app/app/package.json ./app/package.json
COPY --from=builder /app/app/server ./app/server
COPY --from=builder /app/app/client/dist ./app/client/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

WORKDIR /app/app
CMD ["sh", "-c", "node server/lib/migrate.js && node server/app.js"]
