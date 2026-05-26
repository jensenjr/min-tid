FROM node:22-slim AS builder
WORKDIR /app

# Build frontend
COPY package*.json ./
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

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_PATH=/app/data/data.json

EXPOSE 3000
CMD ["node", "server/index.js"]
