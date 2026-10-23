# Kaampilot Platform API (NestJS). Build context: services/platform (see docker-compose.yml).
FROM node:22-slim AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=512
COPY package.json package-lock.json ./
# Type-check/compile only: no install scripts, no optional native binaries (embedded Postgres, argon2) needed here.
RUN npm ci --omit=optional --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p .

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Runtime deps only; @node-rs/argon2 picks its linux-x64-gnu binary here.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
USER node
EXPOSE 4000
# Migrations are idempotent and run on every start; the first company is created once by hand (README.md).
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/main.js"]
