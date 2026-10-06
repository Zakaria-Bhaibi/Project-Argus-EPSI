#!/usr/bin/env bash
# Test accounts for development (passwords in services/api/data/*.pw, gitignored), then restart the api.
#   redteam  viewer    used by tools/redteam/attacks.py --api
#   demo-op  operator  used to drive demo scenarios while developing
set -euo pipefail
cd /home/jakie/argus
python3 - <<'PY'
import json, sys
sys.path.insert(0, "services/api/app")
from passwords import hash_password
data = "/mnt/d/EPSI/Project Argus/services/api/data"
p = "infra/runtime/secrets/users.json"
u = json.load(open(p))
for name, role in (("redteam", "viewer"), ("demo-op", "operator")):
    u[name] = {"role": role, "password": hash_password(open(f"{data}/{name}.pw").read().strip())}
json.dump(u, open(p, "w"), indent=2)
print("users:", list(u))
PY
cd infra && docker compose restart api >/dev/null && echo "api restarted"
