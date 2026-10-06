"""ARGUS decoy: looks like a badly secured Sentinel-X, exists only to be attacked.

- :1883  fake plaintext MQTT broker. Accepts any CONNECT, logs client ids, credentials and topics.
- :2323  fake "maintenance console" (telnet-like). Logs every username/password tried.

Each interaction is reported to the API (POST /api/v1/alerts, category=cyber, source=decoy),
so attackers light up the cyber timeline and feed the post-pentest audit report.
Nothing here is real: no data, no shell, no forwarding.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl
import time
import urllib.request

API_URL = os.environ.get("API_URL", "http://api:8000/api/v1/alerts")
TOKEN = os.environ.get("DECOY_TOKEN") or (open(os.environ["DECOY_TOKEN_FILE"]).read().strip()
                                         if os.environ.get("DECOY_TOKEN_FILE") else "")
MQTT_PORT = int(os.environ.get("DECOY_MQTT_PORT", "1883"))
CONSOLE_PORT = int(os.environ.get("DECOY_CONSOLE_PORT", "2323"))
MAX_BYTES = 4096
log = logging.getLogger("decoy")

_last_report: dict[tuple[str, str], float] = {}


def report(kind: str, ip: str, message: str, data: dict, severity: str = "warning") -> None:
    """Fire-and-forget alert to the API, at most one per (ip, kind) every 5 s to survive floods."""
    key = (ip, kind)
    if time.monotonic() - _last_report.get(key, 0) < 5:
        return
    _last_report[key] = time.monotonic()
    log.warning("%s %s %s", kind, ip, data)
    body = json.dumps({"source": "decoy", "category": "cyber", "severity": severity, "kind": kind,
                       "message": message[:256], "data": {"ip": ip, **data}}).encode()
    req = urllib.request.Request(API_URL, body, {"Content-Type": "application/json",
                                                 "Authorization": f"Bearer {TOKEN}"})
    try:
        urllib.request.urlopen(req, timeout=3, context=ssl.create_default_context())
    except Exception as e:  # the decoy must never crash because the API is down
        log.error("report failed: %s", e)


def _mqtt_str(buf: bytes, i: int) -> tuple[str, int]:
    n = int.from_bytes(buf[i:i + 2], "big")
    return buf[i + 2:i + 2 + n].decode(errors="replace")[:64], i + 2 + n


def parse_connect(pkt: bytes) -> dict:
    """Minimal MQTT 3.1.1 CONNECT parser (client id, username, password)."""
    out: dict = {}
    try:
        i = 1
        while pkt[i] & 0x80:  # remaining length varint
            i += 1
        i += 1
        _, i = _mqtt_str(pkt, i)       # protocol name
        i += 1                          # level
        flags = pkt[i]
        i += 3                          # flags + keepalive
        out["client_id"], i = _mqtt_str(pkt, i)
        if flags & 0x04:               # will
            _, i = _mqtt_str(pkt, i)
            _, i = _mqtt_str(pkt, i)
        if flags & 0x80:
            out["username"], i = _mqtt_str(pkt, i)
        if flags & 0x40:
            out["password"], i = _mqtt_str(pkt, i)
    except (IndexError, ValueError):
        out["malformed"] = True
    return out


async def fake_mqtt(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    ip = writer.get_extra_info("peername")[0]
    try:
        pkt = await asyncio.wait_for(reader.read(MAX_BYTES), 15)
        if pkt[:1] == b"\x10":
            info = parse_connect(pkt)
            report("decoy_mqtt_login", ip, f"decoy broker login attempt from {ip} as '{info.get('username', '')}'", info,
                   "critical" if "password" in info else "warning")
            writer.write(b"\x20\x02\x00\x00")  # CONNACK accepted: keep them busy
            await writer.drain()
            for _ in range(20):
                pkt = await asyncio.wait_for(reader.read(MAX_BYTES), 30)
                if not pkt:
                    break
                if pkt[0] >> 4 in (3, 8):  # PUBLISH / SUBSCRIBE: record what they go after
                    topic = pkt[4:4 + int.from_bytes(pkt[2:4], "big")].decode(errors="replace")[:80] if pkt[0] >> 4 == 3 \
                        else pkt[6:6 + int.from_bytes(pkt[4:6], "big")].decode(errors="replace")[:80]
                    report("decoy_mqtt_activity", ip, f"attacker on decoy broker: {'publish' if pkt[0] >> 4 == 3 else 'subscribe'} {topic}",
                           {"topic": topic})
                    if pkt[0] >> 4 == 8:
                        writer.write(b"\x90\x03" + pkt[2:4] + b"\x00")  # SUBACK
                        await writer.drain()
        elif pkt:
            report("decoy_probe", ip, f"non-MQTT probe on decoy :{MQTT_PORT} from {ip}", {"first_bytes": pkt[:24].hex()})
    except (asyncio.TimeoutError, ConnectionError):
        pass
    finally:
        writer.close()


BANNER = (b"\r\nAetherCorp SENTINEL-X maintenance console v2.3.1 (build 2049-11-02)\r\n"
          b"Unauthorized access is prohibited.\r\n\r\n")


async def fake_console(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    ip = writer.get_extra_info("peername")[0]
    report("decoy_console_connect", ip, f"connection to decoy console from {ip}", {})
    try:
        writer.write(BANNER)
        for _ in range(3):
            writer.write(b"login: ")
            await writer.drain()
            user = (await asyncio.wait_for(reader.readline(), 60)).decode(errors="replace").strip()[:64]
            writer.write(b"password: ")
            await writer.drain()
            pw = (await asyncio.wait_for(reader.readline(), 60)).decode(errors="replace").strip()[:64]
            report("decoy_credentials", ip, f"credentials tried on decoy console: '{user}'",
                   {"username": user, "password": pw}, "critical")
            await asyncio.sleep(1.5)  # tarpit
            writer.write(b"Login incorrect\r\n\r\n")
    except (asyncio.TimeoutError, ConnectionError):
        pass
    finally:
        writer.close()


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s decoy %(levelname)s %(message)s")
    s1 = await asyncio.start_server(fake_mqtt, "0.0.0.0", MQTT_PORT, limit=MAX_BYTES)
    s2 = await asyncio.start_server(fake_console, "0.0.0.0", CONSOLE_PORT, limit=MAX_BYTES)
    log.info("decoy listening on :%d (fake MQTT) and :%d (fake console)", MQTT_PORT, CONSOLE_PORT)
    async with s1, s2:
        await asyncio.gather(s1.serve_forever(), s2.serve_forever())


if __name__ == "__main__":
    asyncio.run(main())
