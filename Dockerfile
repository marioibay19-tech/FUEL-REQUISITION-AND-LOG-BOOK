# FUELTRACK — single container serving the API and the built web client.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/
RUN DATABASE_URL=postgresql://build:build@localhost/build npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost/build npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads
COPY --from=build /app /app
RUN mkdir -p /data/uploads && chown -R node:node /data /app/server
USER node
WORKDIR /app/server
EXPOSE 4000
# Apply pending migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
