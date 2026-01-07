# Use Node.js 20 Alpine image optimized for Raspberry Pi (ARM64)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Install TypeScript and ts-node for runtime compilation
RUN npm install -g typescript ts-node

# Copy source code
COPY . .

# Build the TypeScript application
RUN npm run build

# Expose the server port
EXPOSE 8000

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S stream -u 1001

# Change ownership of the app directory
RUN chown -R stream:nodejs /app

# Switch to non-root user
USER stream

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Start the application
CMD ["npm", "start"]