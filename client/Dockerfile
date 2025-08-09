#############################################
# Optimized Dockerfile for Next.js client
# Uses standalone output to minimize final image size
#############################################
# syntax=docker/dockerfile:1

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
ENV NODE_ENV=development
COPY package.json yarn.lock* .npmrc* ./
RUN set -eux; \
    if [ -f yarn.lock ]; then corepack enable && yarn install --frozen-lockfile; \
    else echo 'yarn.lock missing' && exit 1; fi

FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN set -eux; yarn build

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Copy only the minimal standalone server output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
