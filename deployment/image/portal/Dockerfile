# The Digi portal image (digiworks-portal:release). Same layout as the original build: Next.js standalone output on node:22 Alpine,
# migrations run on every start. Build from this folder:  docker build -t digiworks-portal:release .
FROM node:22.23.3-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22.23.3-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/db ./db
COPY --from=build --chown=app:app /app/trust ./trust
RUN mkdir -p /data && chown app:app /data
ENV DATA_DIR=/data
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["sh", "-c", "node db/migrate.mjs && node db/migrate-studio.mjs && node db/seed-test-stack.mjs && node server.js"]
