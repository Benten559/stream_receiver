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
# Runs as root so entrypoint.sh can chown the bind-mounted /data volume,
# then drops to stream user via su-exec.
FROM node:20-alpine AS prod
WORKDIR /app
RUN apk add --no-cache su-exec
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && \
    mkdir -p /data/frames && \
    addgroup -g 1001 -S nodejs && \
    adduser -S stream -u 1001 && \
    chown -R stream:nodejs /app
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:5000/camera/available || exit 1
ENTRYPOINT ["entrypoint.sh"]
CMD ["npm", "start"]
