#!/usr/bin/env bash
cd /home/jakie/argus/infra
docker compose exec -T decoy python - <<'PY'
import json, urllib.request, urllib.error
tok = open("/run/secrets/decoy_token").read().strip()
body = json.dumps({"source":"decoy","category":"cyber","severity":"info","kind":"decoy_selftest","message":"decoy self-test","data":{}}).encode()
req = urllib.request.Request("http://api:8000/api/v1/alerts", body, {"Content-Type":"application/json","Authorization":"Bearer "+tok})
try:
    print(urllib.request.urlopen(req, timeout=5).status)
except urllib.error.HTTPError as e:
    print(e.code, e.read()[:200])
PY
docker compose exec -T api python -c "
from app.config import Settings; s=Settings(); print('api tokens loaded:', len(s.service_tokens))" 2>&1 | tail -1
