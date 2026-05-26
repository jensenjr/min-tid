FROM node:22-alpine AS builder
WORKDIR /app

# Build frontend
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Install server dependencies
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=80
ENV DB_PATH=/app/data/data.db

EXPOSE 80
CMD ["node", "server/index.js"]
