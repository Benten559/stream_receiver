FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# Dev stage: devDeps intact, source bind-mounted at runtime
FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json ./
COPY public ./public
COPY src ./src
RUN mkdir -p /data/frames
EXPOSE 5000
CMD ["npm", "run", "dev"]

# Builder: compiles server TS to dist/ and client TS to public/js/
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production: compiled output + prod deps only
FROM node:20-alpine AS prod
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
RUN mkdir -p /data/frames && \
    addgroup -g 1001 -S nodejs && \
    adduser -S stream -u 1001 && \
    chown -R stream:nodejs /app /data
USER stream
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:5000/camera/available || exit 1
CMD ["npm", "start"]
