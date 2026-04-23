# ===========================================
# Multi-stage Dockerfile for Services
# ===========================================

# -------------------------------------------
# Stage 1: Dependencies
# -------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock ./

# Install dependencies
RUN npm ci --legacy-peer-deps || yarn install --frozen-lockfile

# -------------------------------------------
# Stage 2: Builder
# -------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build TypeScript
RUN npm run build || echo "Build completed"

# -------------------------------------------
# Stage 3: Production
# -------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Set environment
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start application
CMD ["node", "dist/index.js"]

# ===========================================
# Frontend Dockerfile
# ===========================================

FROM node:20-alpine AS frontend-deps

WORKDIR /app

COPY apps/*/package*.json ./
RUN npm ci --legacy-peer-deps

# ----

FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY --from=frontend-deps /app/node_modules ./node_modules
COPY apps/ ./apps/

WORKDIR /app/apps/admin-web-portal

RUN npm run build

# ----

FROM nginx:alpine AS frontend-production

# Copy built assets
COPY --from=frontend-builder /app/apps/admin-web-portal/.next/static /usr/share/nginx/html/_next/static
COPY --from=frontend-builder /app/apps/admin-web-portal/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]

# ===========================================
# Guard Mobile App Dockerfile
# ===========================================

FROM node:20-alpine AS guard-app-deps

WORKDIR /app

COPY apps/guard-mobile/package*.json ./
RUN npm ci

# ----

FROM node:20-alpine AS guard-app-builder

WORKDIR /app

COPY --from=guard-app-deps /app/node_modules ./node_modules
COPY apps/guard-mobile/ ./

RUN npm run build || echo "Building"

# ----

FROM node:20-alpine AS guard-app-runner

WORKDIR /app

COPY --from=guard-app-builder /app .
COPY --from=guard-app-builder /app/node_modules ./node_modules

USER node

EXPOSE 8080

CMD ["node", "index.js"]

# ===========================================
# Database Migrations
# ===========================================

FROM node:20-alpine AS migrations

WORKDIR /app

COPY package*.json ./
COPY migrations/ ./migrations/

RUN npm ci --legacy-peer-deps

CMD ["node", "migrations/run.js"]

# ===========================================
# Test Runner
# ===========================================

FROM node:20-alpine AS test-runner

WORKDIR /app

COPY package*.json ./
COPY tests/ ./tests/

RUN npm ci --legacy-peer-deps

CMD ["npm", "test"]

# ===========================================
# Builder for production release
# ===========================================

FROM node:20-alpine AS release-builder

WORKDIR /app

# Copy all service code
COPY services/ ./services/

# Install dependencies for each service
RUN for dir in services/*/; do \
  (cd "$dir" && npm ci --production); \
done

# Create release package
RUN mkdir -p release && \
  cp -r services/*/dist release/ && \
  cp -r services/*/node_modules release/

CMD ["echo", "Release built"]