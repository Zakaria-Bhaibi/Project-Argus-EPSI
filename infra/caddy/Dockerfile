# Build context: repository root. Builds the dashboard, then serves it with Caddy.
FROM node:22-alpine AS dashboard
WORKDIR /build
COPY dashboard/package*.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

FROM caddy:2-alpine
COPY --from=dashboard /build/dist /srv/dashboard
EXPOSE 8443
