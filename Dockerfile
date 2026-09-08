# syntax=docker/dockerfile:1

# Production image. Multi-stage, so the runtime carries neither the toolchain
# nor the source: Next's standalone output, plus the migration runner and the
# worker bundled to plain JavaScript. Nothing in here needs a TypeScript
# loader at runtime — a build tool present in a runtime image is a dependency
# surface nobody audits.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG BUILD_ID=dev
ENV BUILD_ID=${BUILD_ID}
# NODE_ENV is deliberately not set here: `next build` sets its own, and a build
# run with NODE_ENV=development produces a bundle that will not render.
# The build needs no database and no secret — every route is dynamic.
RUN npm run build && npm run build:node

# Only what the two entrypoints keep external.
FROM node:22-bookworm-slim AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN apt-get update \
 && apt-get install --no-install-recommends -y tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The app.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# The migration runner, the seeder and the worker, as plain JavaScript, with
# the migrations themselves: the container migrates itself on boot. Everything
# they use is bundled except the one native addon, which cannot be.
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=runtime-deps /app/node_modules/@node-rs ./node_modules/@node-rs

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Never root.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["app"]
