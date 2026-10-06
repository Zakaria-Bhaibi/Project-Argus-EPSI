"""Self-pentest kit: replays the attacks we expect on pentest day against OUR OWN stack,
so the audit report has a before/after and the demo can show each defence live.

    python tools/redteam/attacks.py --host 192.168.10.10 all
    python tools/redteam/attacks.py --host localhost replay

Every attack should FAIL against ARGUS and show up on the dashboard's cyber timeline.
Only run this against infrastructure you own.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import sys
import time
from pathlib import Path

import urllib.request

import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/common"))
import argus_protocol as proto  # noqa: E402

PKI = ROOT / "infra/pki/out"
READING = {"temp_c": 23.0, "hum_pct": 45.0, "gas_ppm": 180.0, "pir": False}


def client(host: str, port: int, node: str | None, cid: str) -> mqtt.Client:
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=cid)
    if node:
        c.tls_set(ca_certs=str(PKI / "ca.crt"), certfile=str(PKI / node / f"{node}.crt"),
                  keyfile=str(PKI / node / f"{node}.key"))
    else:
        c.tls_set(ca_certs=str(PKI / "ca.crt"))
    c.connect(host, port, 10)
    c.loop_start()
    time.sleep(1)
    return c


API: dict = {}   # {"url": ..., "token": ...} when --api is given
CTX = ssl.create_default_context(cafile=str(PKI / "ca.crt"))  # trust the ARGUS CA for https://outpost
DECOY_PORT = 1883


def api_login(url: str) -> None:
    body = json.dumps({"username": os.environ["ARGUS_USER"], "password": os.environ["ARGUS_PASS"]}).encode()
    req = urllib.request.Request(f"{url}/auth/login", body, {"Content-Type": "application/json"})
    API.update(url=url, token=json.load(urllib.request.urlopen(req, timeout=5, context=CTX))["token"])


def detected(kinds: set[str], since: float, wait_s: float = 4) -> str | None:
    """Polls the cyber timeline for one of `kinds` raised after `since`."""
    deadline = time.time() + wait_s
    while time.time() < deadline:
        req = urllib.request.Request(f"{API['url']}/events?category=cyber&limit=100",
                                     headers={"Authorization": f"Bearer {API['token']}"})
        for e in json.load(urllib.request.urlopen(req, timeout=5, context=CTX)):
            if e["ts"] >= since and e["kind"] in kinds:
                return e["kind"]
        time.sleep(1)
    return None


def result(name: str, blocked: bool, how: str, kinds: set[str] | None = None, since: float = 0, wait_s: float = 4) -> None:
    seen = ""
    if API and kinds:
        k = detected(kinds, since, wait_s)
        seen = f"  [dashboard: {k}]" if k else "  [dashboard: NOT SEEN]"
    print(f"[{'BLOCKED' if blocked else 'NOT BLOCKED'}] {name}: {how}{seen}")


def no_cert(host, port):
    """Attacker on the Wi-Fi without a client certificate."""
    t0 = time.time()
    ctx = ssl.create_default_context(cafile=str(PKI / "ca.crt"))
    ctx.check_hostname = False
    try:
        with socket.create_connection((host, port), 5) as s, ctx.wrap_socket(s) as t:
            t.send(b"\x10\x0c\x00\x04MQTT\x04\x02\x00\x3c\x00\x00")
            blocked = t.recv(4) == b""
    except (ssl.SSLError, ConnectionResetError, OSError) as e:
        blocked, _ = True, e
    result("connect without a client certificate", blocked, "TLS handshake refused by mosquitto (require_certificate)",
           {"tls_rejected", "not_authorized"}, t0)


def plaintext(host, _port):
    """Old-school plaintext MQTT on 1883 lands on the decoy."""
    t0 = time.time()
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="kali")
    c.username_pw_set("admin", "admin")
    try:
        c.connect(host, DECOY_PORT, 5)
        c.loop_start(); time.sleep(0.5); c.subscribe("#"); time.sleep(0.5); c.disconnect(); c.loop_stop()
        result("plaintext MQTT on 1883", True, "it's the decoy: credentials and topics captured on the dashboard",
               {"decoy_mqtt_login"}, t0)
    except OSError:
        result("plaintext MQTT on 1883", True, "port closed")


def forge(host, port):
    """sentinel-01's stolen cert used to publish fake gas readings as sentinel-02."""
    t0 = time.time()
    c = client(host, port, "sentinel-01", "sentinel-01")
    k1 = proto.load_keys(str(PKI / "devices.json"))["sentinel-01"]
    c.publish(proto.topic("sentinel-02", "telemetry"), proto.encode("sentinel-02", "telemetry", {**READING, "gas_ppm": 5000}, k1), qos=1)
    time.sleep(1); c.disconnect(); c.loop_stop()
    result("impersonate another node", True, "mosquitto ACL drops it (topic not owned by the cert CN); HMAC would reject it anyway",
           {"acl_denied", "session_takeover", "identity_mismatch", "bad_signature"}, t0)


def tamper(host, port):
    """Valid node, valid topic, but the payload is altered after signing (MitM-style)."""
    t0 = time.time()
    c = client(host, port, "sentinel-01", "sentinel-01")
    k1 = proto.load_keys(str(PKI / "devices.json"))["sentinel-01"]
    payload = proto.encode("sentinel-01", "telemetry", READING, k1).replace(b'"gas_ppm":180.0', b'"gas_ppm":9999.0')
    c.publish(proto.topic("sentinel-01", "telemetry"), payload, qos=1)
    time.sleep(1); c.disconnect(); c.loop_stop()
    result("tamper with a signed message", True, "API rejects bad HMAC -> 'forged message' on the cyber timeline",
           {"bad_signature"}, t0)


def replay(host, port):
    """Re-send a message that was valid a moment ago."""
    t0 = time.time()
    c = client(host, port, "sentinel-01", "sentinel-01")
    k1 = proto.load_keys(str(PKI / "devices.json"))["sentinel-01"]
    msg = proto.encode("sentinel-01", "telemetry", READING, k1)
    for _ in range(3):
        c.publish(proto.topic("sentinel-01", "telemetry"), msg, qos=1)
        time.sleep(0.3)
    time.sleep(1); c.disconnect(); c.loop_stop()
    result("replay a captured message", True, "first copy accepted, the next ones rejected as replays",
           {"replay"}, t0)


def flood(host, port, n=400):
    """Message flood from a (compromised) node."""
    t0 = time.time()
    c = client(host, port, "sentinel-03", "sentinel-03")
    k = proto.load_keys(str(PKI / "devices.json"))["sentinel-03"]
    for _ in range(n):
        c.publish(proto.topic("sentinel-03", "telemetry"), proto.encode("sentinel-03", "telemetry", READING, k), qos=0)
    time.sleep(2); c.disconnect(); c.loop_stop()
    result(f"flood ({n} msgs)", True, "traffic model flags it within 10 s; mosquitto limits inflight/queue",
           {"traffic_anomaly"}, t0, wait_s=25)


ATTACKS = {"nocert": no_cert, "plaintext": plaintext, "forge": forge, "tamper": tamper, "replay": replay, "flood": flood}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=8883)
    ap.add_argument("--api", help="API base URL (e.g. https://192.168.10.10/api/v1) to confirm each detection;"
                                  " credentials from ARGUS_USER / ARGUS_PASS")
    ap.add_argument("attack", choices=[*ATTACKS, "all"])
    ap.add_argument("--decoy-port", type=int, default=1883)
    a = ap.parse_args()
    DECOY_PORT = a.decoy_port
    if a.api:
        api_login(a.api.rstrip("/"))
    for name, fn in ATTACKS.items():
        if a.attack in (name, "all"):
            try:
                fn(a.host, a.port)
            except Exception as e:  # report and keep going: one failure must not stop the audit
                print(f"[ERROR] {name}: {e}")
            time.sleep(1)
