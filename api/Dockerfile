# Build context: the REPOSITORY ROOT (the image needs db/migrations):
#   docker build -f api/Dockerfile -t signalroom-api .
# Runs migrations then starts the server (set RUN_MIGRATIONS=false to skip).

FROM node:22-slim AS deps
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci

FROM deps AS build
COPY api/tsconfig.json api/tsconfig.build.json ./
COPY api/src ./src
COPY api/scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=4000 MIGRATIONS_DIR=/app/db/migrations
WORKDIR /app/api
COPY --from=build /app/api/node_modules ./node_modules
COPY --from=build /app/api/dist ./dist
COPY --from=build /app/api/package.json ./
COPY api/scripts/seed-conversations.json ./dist/scripts/seed-conversations.json
COPY db/migrations /app/db/migrations
USER node
EXPOSE 4000
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" != \"false\" ]; then node dist/scripts/migrate.js; fi && exec node dist/src/main.js"]
