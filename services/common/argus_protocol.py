"""ARGUS wire protocol shared by the API, the simulator and the tests.

Payload on the wire = <body JSON bytes> + b"\\n" + <hex HMAC-SHA256(device_key, body)>
See docs/architecture.md §3.2. The firmware implements the same format in C++.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass

PROTOCOL_VERSION = 1
TOPIC_ROOT = "argus/v1/nodes"
MAX_CLOCK_SKEW_S = 30
MAX_PAYLOAD_BYTES = 2048
MESSAGE_TYPES = {"telemetry", "event", "status", "cmd"}


def topic(node_id: str, channel: str) -> str:
    return f"{TOPIC_ROOT}/{node_id}/{channel}"


def parse_topic(t: str) -> tuple[str, str] | None:
    """'argus/v1/nodes/sentinel-01/telemetry' -> ('sentinel-01', 'telemetry')"""
    parts = t.split("/")
    if len(parts) != 5 or "/".join(parts[:3]) != TOPIC_ROOT:
        return None
    return parts[3], parts[4]


def sign(body: bytes, key: bytes) -> str:
    return hmac.new(key, body, hashlib.sha256).hexdigest()


_last_seq: dict[str, int] = {}


def next_seq(node_id: str) -> int:
    """Unix ms, but strictly increasing per sender: two messages in the same ms must not collide
    (the receiver would rightly reject the second one as a replay)."""
    seq = max(time.time_ns() // 1_000_000, _last_seq.get(node_id, 0) + 1)
    _last_seq[node_id] = seq
    return seq


def encode(node_id: str, msg_type: str, data: dict, key: bytes, seq: int | None = None, ts: int | None = None) -> bytes:
    now_ms = time.time_ns() // 1_000_000
    body = json.dumps(
        {"v": PROTOCOL_VERSION, "node": node_id, "seq": seq if seq is not None else next_seq(node_id),
         "ts": ts if ts is not None else now_ms // 1000, "type": msg_type, "data": data},
        separators=(",", ":"),
    ).encode()
    return body + b"\n" + sign(body, key).encode()


class ProtocolError(Exception):
    """Raised for any message that must be rejected. `reason` feeds the cyber timeline."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


@dataclass
class Message:
    node: str
    seq: int
    ts: int
    type: str
    data: dict


class Verifier:
    """Checks signature, identity binding, freshness and replay for incoming messages."""

    def __init__(self, keys: dict[str, bytes], max_skew_s: int = MAX_CLOCK_SKEW_S):
        self.keys = keys
        self.max_skew_s = max_skew_s
        self.last_seq: dict[str, int] = {}

    def verify(self, payload: bytes, topic_node: str | None = None, now: float | None = None) -> Message:
        if len(payload) > MAX_PAYLOAD_BYTES:
            raise ProtocolError("oversized", f"{len(payload)} bytes")
        body, sep, sig = payload.rpartition(b"\n")
        if not sep:
            raise ProtocolError("unsigned")
        try:
            obj = json.loads(body)
        except (ValueError, UnicodeDecodeError) as e:
            raise ProtocolError("malformed", str(e)[:80])
        if not isinstance(obj, dict):
            raise ProtocolError("malformed", "body is not an object")

        node = obj.get("node")
        key = self.keys.get(node) if isinstance(node, str) else None
        if key is None:
            raise ProtocolError("unknown_node", str(node)[:40])
        if topic_node is not None and topic_node != node:
            raise ProtocolError("identity_mismatch", f"topic={topic_node} body={node}")
        if not hmac.compare_digest(sign(body, key), sig.decode(errors="replace")):
            raise ProtocolError("bad_signature", node)

        # schema (after the signature check: we only parse trusted content further)
        seq, ts, mtype, data = obj.get("seq"), obj.get("ts"), obj.get("type"), obj.get("data")
        if obj.get("v") != PROTOCOL_VERSION or not isinstance(seq, int) or not isinstance(ts, int) \
                or mtype not in MESSAGE_TYPES or not isinstance(data, dict):
            raise ProtocolError("schema", node)

        now = time.time() if now is None else now
        if abs(now - ts) > self.max_skew_s:
            raise ProtocolError("stale", f"{node} skew={int(now - ts)}s")
        if seq <= self.last_seq.get(node, -1):
            raise ProtocolError("replay", f"{node} seq={seq}")
        self.last_seq[node] = seq
        return Message(node=node, seq=seq, ts=ts, type=mtype, data=data)


def load_keys(path: str) -> dict[str, bytes]:
    """Reads infra/pki/out/devices.json -> {node_id: key_bytes}."""
    with open(path) as f:
        return {node: bytes.fromhex(v["hmac_key"]) for node, v in json.load(f).items()}
