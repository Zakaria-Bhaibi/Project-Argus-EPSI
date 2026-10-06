#!/usr/bin/env bash
# Stack status + recent logs (run as root or a docker-group user).
cd /home/jakie/argus/infra
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
for s in mosquitto api caddy decoy; do echo "== $s"; docker compose logs --tail "${N:-12}" "$s" 2>&1 | cut -c1-220; done
