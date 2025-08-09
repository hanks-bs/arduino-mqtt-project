#############################################
# Multi‑stage build for Arduino API (Express)
# Result: minimal production image without dev deps
#############################################
# syntax=docker/dockerfile:1

ARG NODE_VERSION=22-alpine

#############################
# 1. Dependencies (prod only)
#############################
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./
RUN set -eux; \
  if [ -f yarn.lock ]; then corepack enable && yarn install --frozen-lockfile --production=true --ignore-scripts; \
  elif [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install --frozen-lockfile --prod --ignore-scripts; \
  else echo "Lockfile not found" && exit 1; fi

#############################
# 2. Build (needs dev deps)
#############################
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./
RUN set -eux; \
  if [ -f yarn.lock ]; then corepack enable && yarn install --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install --frozen-lockfile; \
  else echo "Lockfile not found" && exit 1; fi

# Copy tsconfig and sources
COPY tsconfig.json ./
COPY src ./src
RUN set -eux; \
  if [ -f yarn.lock ]; then yarn build; \
  elif [ -f package-lock.json ]; then npm run build; \
  else pnpm run build; fi

#############################
# 3. Runtime
#############################
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production

# Add non‑root user
RUN addgroup -S app && adduser -S app -G app

# Copy production node_modules and build output
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./

# Optional: create writable directory for logs (if used)
RUN mkdir -p logs && chown app:app logs
USER app

EXPOSE 5000

# Health: container considered healthy if process is running (external compose HC can curl /api/arduino-data)
CMD ["node","dist/src/app.js"]

# Notes:
# - .env is NOT baked into the image; pass env vars at runtime.
# - If you need serial device: add --device /dev/ttyUSB0 when running or configure in compose.
# - Build context MUST be the api/ directory.
