#!/usr/bin/env bash
# Network diagnostics for container builds inside WSL.
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'argus|caddy|node|python' || true
echo "== host MTU"; ip -o link | awk '{print $2, $4, $5}' | grep -v lo
echo "== npm from a container (bridge network)"
docker run --rm node:22-alpine sh -c 'npm view react version 2>&1 | tail -2; wget -qO- https://registry.npmjs.org/three 2>&1 | head -c 80; echo; echo "wget exit $?"'
echo "== npm from a container (host network)"
docker run --rm --network host node:22-alpine sh -c 'npm view react version 2>&1 | tail -2'
