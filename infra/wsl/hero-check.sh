#!/usr/bin/env bash
cd /home/jakie/argus/infra
docker compose exec -T mosquitto sh -c 'grep -iE "hero|OpenSSL|10\.13|error" /mosquitto/log/mosquitto.log | tail -8' | cut -c1-220
echo "== api events about the hero"
docker compose logs --tail 300 api 2>&1 | grep -i hero | tail -5 | cut -c1-200
