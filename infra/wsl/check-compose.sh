#!/usr/bin/env bash
# Validates infra/docker-compose.yml with dummy secrets (no daemon, no sudo needed).
set -euo pipefail
T=$(mktemp -d)
cp -r "/mnt/d/EPSI/Project Argus/infra/." "$T/"
mkdir -p "$T/runtime/secrets"
for f in jwt_secret service_tokens decoy_token db_password users.json devices.json; do echo x > "$T/runtime/secrets/$f"; done
cd "$T" && docker compose --profile sim --profile detect --profile monitoring config -q && echo COMPOSE_OK
rm -rf "$T"
