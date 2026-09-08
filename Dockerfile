# syntax=docker/dockerfile:1

# Production image. Multi-stage so the runtime carries neither the toolchain
# nor the source: Next's standalone output plus the worker's compiled files.

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
# The build must not need a database or a secret: pages are all dynamic.
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Tesseract is in the worker's path for OCR (M7); it costs little to have the
# binary present, and the alternative is sending handbooks off-premises.
RUN apt-get update \
 && apt-get install --no-install-recommends -y tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migrations and their runner ship with the image: the container migrates itself.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=build /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=build /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Never root.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["app"]
