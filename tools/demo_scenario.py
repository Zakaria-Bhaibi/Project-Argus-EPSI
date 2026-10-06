"""Drive demo scenarios on the simulated nodes through the real API (operator account).

    ARGUS_USER=demo-op ARGUS_PASS=... python tools/demo_scenario.py sentinel-02=gas_leak sentinel-04=overheat
    python tools/demo_scenario.py all=normal
"""
import json
import os
import ssl
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = os.environ.get("ARGUS_API", "https://localhost/api/v1")
CTX = ssl.create_default_context(cafile=str(ROOT / "infra/pki/out/ca.crt"))
SIMULATED = ["sentinel-01", "sentinel-02", "sentinel-03", "sentinel-04"]


def call(path, body, token=None):
    req = urllib.request.Request(API + path, json.dumps(body).encode(),
                                 {"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    return json.load(urllib.request.urlopen(req, context=CTX, timeout=5))


user = os.environ.get("ARGUS_USER", "demo-op")
pw = os.environ.get("ARGUS_PASS") or (ROOT / f"services/api/data/{user}.pw").read_text().strip()
token = call("/auth/login", {"username": user, "password": pw})["token"]
for arg in sys.argv[1:]:
    node, scenario = arg.split("=")
    for n in SIMULATED if node == "all" else [node]:
        call(f"/nodes/{n}/commands", {"action": "scenario", "value": scenario}, token)
        print(f"{n}: {scenario}")
