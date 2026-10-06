#!/usr/bin/env bash
cd /home/jakie/argus/infra
echo "== decoy"; docker compose logs --tail 8 decoy 2>&1 | cut -c1-200
echo "== mosquitto log: denied / sentinel-0 lines"; docker compose exec -T mosquitto sh -c 'grep -iE "denied|sentinel-0[13]" /mosquitto/log/mosquitto.log | tail -12' | cut -c1-200
echo "== api errors"; docker compose logs --tail 200 api 2>&1 | grep -iE "error|exception|denied" | tail -5 | cut -c1-200
