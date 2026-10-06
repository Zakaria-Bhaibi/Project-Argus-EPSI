#!/usr/bin/env bash
cd /home/jakie/argus/infra
docker compose exec -T api sh -c 'cd services/api && python -c "
from app.config import Settings; s=Settings(); print(\"tokens:\", len(s.service_tokens), [len(t) for t in s.service_tokens])"; env | grep -E "SERVICE|_FILE" | sed "s/=.*/=…/"' 2>&1 | grep -v WARNING
