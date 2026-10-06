# Project ARGUS: Sentinel-X Virtual Twin

EPSI Workshop BAC+4 2026, Mission Sentinel-X, built as **Option C, "Virtual Twin"**: a fleet of
virtual Sentinel-X nodes (one running real C++ firmware on an emulated ESP32, the others simulated),
supervised and defended by a hardened, containerised outpost server.

Architecture, data flows, IP plan, security layers and threat model: [`docs/architecture.md`](docs/architecture.md).

| Folder | What it is | Owner |
|---|---|---|
| `firmware/sentinel-node` | ESP32 C++ firmware: DHT22, MQ-2, PIR, tamper switch, OLED, siren, LEDs; MQTT over mTLS, signed messages | DEV |
| `services/api` | FastAPI: ingest, verification, REST + WebSocket, security events, correlation | DEV |
| `services/simulator` | Virtual node fleet with physical sensor models and demo scenarios | DEV |
| `services/common` | Wire protocol (envelope, HMAC signing, anti-replay), shared by all Python code | DEV |
| `dashboard` | React + Three.js console: 3D site twin, threat timeline, live charts, controls, camera | DEV |
| `ai/anomaly` | Isolation Forest (sensors) + EllipticEnvelope (MQTT traffic), training and evaluation | IA |
| `ai/vision` | Webcam person detection (YOLOv8n / OpenCV HOG), restricted zone, face blurring | IA |
| `infra` | docker-compose, Mosquitto, Caddy, PKI, CrowdSec, VM hardening | INFRA |
| `services/decoy` | Honeypot: fake plaintext broker + fake maintenance console | INFRA / security |
| `tools/redteam` | Self-pentest kit: verifies each defence and that the dashboard sees it | INFRA / security |

## Measured results (from this repo)

- Sensor model vs the naive threshold (`if temp > 40 or gas > 600`), from `python ai/anomaly/train.py`:

  | Scenario | Model detects after | Threshold fires after |
  |---|---|---|
  | Gas leak | 4 s | 58 s |
  | Slow overheat + gas micro-deviation (the brief's example) | 32 s | 278 s |
  | Stuck / erratic sensor | 2 s | 212 s |

  False positive rate on normal data: 0.34 %. Traffic model: 0 % false positives. Floods of 30 and 400 msgs,
  oversized payloads and rejected messages are all flagged.
- Vision: OpenCV HOG fallback runs at about 35 ms per 640×480 frame on a laptop CPU (brief: < 100 ms).
- Firmware: 74.6 % flash, 14.4 % RAM on an ESP32 DevKit.
- Tests: `python -m pytest services/api/tests` (19 tests: signatures, replay, impersonation, roles, rate limiting, correlation).

## Quick start (development, one laptop, no Docker)

Requirements: Python 3.12+, Node 20+, Git Bash (Windows) or any POSIX shell.

```bash
python -m venv .venv && .venv/Scripts/pip install -r services/api/requirements.txt amqtt httpx pytest
#   (Linux/macOS: .venv/bin/pip …)

# 1. PKI: CA, broker/server certs, one cert + HMAC key per node (written to infra/pki/out, gitignored)
cd infra/pki
./pki.sh init
./pki.sh server mosquitto "DNS:outpost,DNS:mosquitto,DNS:host.wokwi.internal,DNS:localhost,IP:192.168.10.10,IP:127.0.0.1"
./pki.sh server outpost "DNS:outpost,DNS:localhost,IP:192.168.10.10,IP:127.0.0.1"
./pki.sh client argus-api
for n in sentinel-01 sentinel-02 sentinel-03 sentinel-04 sentinel-hero; do ./pki.sh device $n; done
cd ../..

# 2. Train the anomaly models (≈15 s)
.venv/Scripts/python ai/anomaly/train.py

# 3. A dashboard user (stored as a scrypt hash)
.venv/Scripts/python services/api/manage_users.py services/api/data/users.dev.json alice operator

# 4. Run each in its own terminal
.venv/Scripts/python tools/dev_broker.py                      # DEV ONLY broker (no ACLs, no client-cert check)
JWT_SECRET=$(openssl rand -hex 32) USERS_FILE=services/api/data/users.dev.json SERVICE_TOKENS=dev-svc-token \
  .venv/Scripts/python -m uvicorn app.main:app --app-dir services/api --port 8000
(cd services/simulator && ../../.venv/Scripts/python fleet.py)
(cd dashboard && npm install && npm run dev)                   # http://127.0.0.1:5173
```

The dev broker exists so the team can work without Docker. **Security claims are only valid on the
real stack** (Mosquitto enforces client certificates and ACLs; the dev broker does not).

### Hero node in Wokwi (free licence, open-source project)

1. Install the Wokwi extension in VS Code / Antigravity, then F1 → "Wokwi: Request a New License".
2. `BROKER_HOST=host.wokwi.internal infra/pki/firmware-secrets.sh sentinel-hero` (for a broker on another
   laptop use its DNS name from the mosquitto cert SANs).
3. `cd firmware/sentinel-node && pio run`, open the folder, F1 → "Wokwi: Start Simulator".
4. Drive the sensors from the Wokwi UI: DHT22 sliders, gas sensor ppm, "Simulate motion" on the PIR,
   the red TAMPER button.

## Production: the Outpost VM

```bash
# on the VM (Ubuntu 24.04), with infra/pki/out copied over SSH
sudo ADMIN_IP=192.168.10.20 ADMIN_USER=argus infra/hardening/harden-outpost.sh
cd infra && sudo ./setup-runtime.sh
python3 ../services/api/manage_users.py runtime/secrets/users.json alice operator
docker compose up -d --build                 # + --profile sim | detect | monitoring
```

Then on the command-center laptop:
```bash
pip install -r ai/vision/requirements.txt
python ai/vision/vision.py --api https://192.168.10.10/api/v1/alerts --ca infra/pki/out/ca.crt \
  --token-file vision_token      # copied from infra/runtime/secrets/vision_token on the VM
```

## Self-pentest

```bash
ARGUS_USER=alice ARGUS_PASS=... python tools/redteam/attacks.py --host 192.168.10.10 \
  --api https://192.168.10.10/api/v1 all
```
Each line says whether the attack was blocked **and** whether the dashboard saw it.

## Secrets

Nothing secret is committed (brief §6). Keys, certificates, HMAC keys, `secrets.h`, `users*.json`, `.env`
and `infra/runtime/` are gitignored. Containers read secrets from Docker secrets (`*_FILE` variables).
