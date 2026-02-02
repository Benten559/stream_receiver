FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

# 2. Install global tools
RUN npm install -g typescript ts-node

COPY . .

RUN npm run build

RUN mkdir -p /data/frames && \
    addgroup -g 1001 -S nodejs && \
    adduser -S stream -u 1001 && \
    chown -R stream:nodejs /app /data

RUN npm prune --production

USER stream

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["npm", "start"]
