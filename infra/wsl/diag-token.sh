#!/usr/bin/env bash
cd /home/jakie/argus/infra
echo "runtime files:"; for f in decoy_token vision_token service_tokens; do printf '%-15s %s\n' $f "$(sha256sum runtime/secrets/$f | cut -c1-12) bytes=$(wc -c < runtime/secrets/$f)"; done
echo "decoy sees: $(docker compose exec -T decoy sh -c 'sha256sum /run/secrets/decoy_token' | cut -c1-12)"
echo "api sees:   $(docker compose exec -T api sh -c 'cat /run/secrets/service_tokens' | tr , '\n' | while read t; do printf '%s' "$t" | sha256sum | cut -c1-12; done | tr '\n' ' ')"
echo "decoy token (stripped) hash: $(docker compose exec -T decoy sh -c 'tr -d "\n" < /run/secrets/decoy_token' | sha256sum | cut -c1-12)"
docker compose exec -T api sh -c 'od -c /run/secrets/service_tokens | head -3'
