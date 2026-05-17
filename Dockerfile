FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# package.json needed so Node treats serve.js as ESM ("type": "module")
COPY package.json .
COPY --from=builder /app/dist ./dist
COPY serve.js .
EXPOSE 3000
CMD ["node", "serve.js"]
