# Build context: repository root. Builds the dashboard, then serves it with Caddy.
FROM node:22-alpine AS dashboard
WORKDIR /build
COPY dashboard/package*.json ./
RUN npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=60000 --maxsockets=4
COPY dashboard/ ./
RUN npm run build

FROM caddy:2-alpine
COPY --from=dashboard /build/dist /srv/dashboard
EXPOSE 8443
