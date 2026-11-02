FROM node:22-slim AS builder
WORKDIR /app

# Build frontend
COPY package*.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build

# Install server dependencies (pure JS, no native modules)
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

# Accounts live in /app/data/data.json. Mount a persistent volume there (Railway: add a
# Volume with mount path /app/data — the server also follows RAILWAY_VOLUME_MOUNT_PATH),
# otherwise every redeploy starts with no accounts. JWT_SECRET must be set at runtime.
RUN mkdir -p /app/data && chown node:node /app/data && chmod +x /app/server/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
# The entrypoint fixes ownership of the data volume, then runs CMD as the
# unprivileged "node" user (never as root).
ENTRYPOINT ["/app/server/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
