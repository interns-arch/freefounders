# Kaampilot Assets API (NestJS, npm workspace). Build context: services/assets (see docker-compose.yml).
FROM node:22-slim AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=512
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=optional --ignore-scripts --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Runtime deps only; sharp (@img/sharp-linux-x64) and @node-rs/argon2 pick their linux-x64 binaries here.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
# migrate.js also migrates every company schema (TENANCY=schemas); the seed does nothing in that mode.
CMD ["sh", "-c", "node apps/api/dist/db/migrate.js && exec node apps/api/dist/main.js"]
