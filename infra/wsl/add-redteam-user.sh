#!/usr/bin/env bash
# Adds/updates a read-only "redteam" viewer (password from services/api/data/redteam.pw) and restarts the api.
set -euo pipefail
cd /home/jakie/argus
PW="$(cat "/mnt/d/EPSI/Project Argus/services/api/data/redteam.pw")"
python3 - "$PW" <<'PY'
import json, sys
sys.path.insert(0, "services/api/app")
from passwords import hash_password
p = "infra/runtime/secrets/users.json"
u = json.load(open(p))
u["redteam"] = {"role": "viewer", "password": hash_password(sys.argv[1])}
json.dump(u, open(p, "w"), indent=2)
print("users:", list(u))
PY
cd infra && docker compose restart api >/dev/null && echo "api restarted"
