"""The ingest pipeline: verify -> store -> score -> correlate -> broadcast.

Transport-agnostic (the MQTT client and the REST routes both call into it), so it is unit-testable.
Every rejected message becomes a *cyber* event: attacks are a sensor like the others.
"""
from __future__ import annotations

import logging
import sys
import threading
import time
from pathlib import Path
from typing import Callable

from .db import Database, Event, Telemetry

ROOT = Path(__file__).resolve().parents[3]
for p in ("services/common", "ai/anomaly"):
    sys.path.insert(0, str(ROOT / p))
import argus_protocol as proto  # noqa: E402

log = logging.getLogger("argus.pipeline")

REJECT_SEVERITY = {
    "bad_signature": "critical", "identity_mismatch": "critical", "replay": "critical",
    "unknown_node": "warning", "stale": "warning", "schema": "warning",
    "malformed": "warning", "unsigned": "warning", "oversized": "warning",
}
REJECT_TEXT = {
    "bad_signature": "forged message (bad HMAC signature)",
    "identity_mismatch": "node tried to speak as another node",
    "replay": "replayed message (sequence already seen)",
    "unknown_node": "message from an unknown node",
    "stale": "stale message (clock skew > 30 s)",
    "schema": "invalid message schema",
    "malformed": "malformed payload",
    "unsigned": "unsigned payload",
    "oversized": "oversized payload",
}


SIGNAL_WORDS = {"pir": "motion", "camera_person": "a person on camera", "sensor_anomaly": "abnormal sensor readings",
                "cyber": "a network attack", "decoy": "a decoy hit"}


class Correlator:
    """Fuses signals from all sources within a time window into escalating incidents.

    Weights apply to *model and sensor outputs*, not to raw values (no static thresholds).
    """
    WINDOW_S = 30
    WEIGHTS = {"pir": 1, "camera_person": 2, "sensor_anomaly": 2, "cyber": 1, "decoy": 1}
    COOLDOWN_S = 45

    def __init__(self):
        self.signals: dict[str, dict[str, float]] = {}
        self.last_incident: dict[tuple[str, str], float] = {}

    def add(self, node: str, signal: str, now: float) -> tuple[str, int, list[str]] | None:
        sig = self.signals.setdefault(node, {})
        sig[signal] = now
        active = [s for s, t in sig.items() if now - t <= self.WINDOW_S]
        score = sum(self.WEIGHTS[s] for s in active)
        level = "critical" if score >= 4 else "warning" if score >= 3 else None
        if level is None or len(active) < 2:
            return None
        if now - self.last_incident.get((node, level), 0) < self.COOLDOWN_S:
            return None
        self.last_incident[(node, level)] = now
        return level, score, sorted(active)


class Pipeline:
    def __init__(self, db: Database, keys: dict[str, bytes], models_dir: Path, camera_node: str):
        self.db = db
        self.keys = keys
        self.verifier = proto.Verifier(keys)
        self.correlator = Correlator()
        self.camera_node = camera_node
        self.nodes: dict[str, dict] = {n: {"id": n, "status": "unknown", "last": None, "anomaly": None,
                                           "last_seen": None, "actuators": {}} for n in keys}
        self.emit: Callable[[dict], None] = lambda msg: None
        self._lock = threading.RLock()  # re-entrant: events are raised from inside handlers
        self.sensor_scorer = self.traffic_scorer = None
        try:
            from scorer import SensorScorer, TrafficScorer
            self.sensor_scorer = SensorScorer(models_dir)
            self.traffic_scorer = TrafficScorer(models_dir)
        except (FileNotFoundError, ImportError) as e:
            log.warning("anomaly models unavailable (%s): run ai/anomaly/train.py", e)

    # ---- events ------------------------------------------------------------------------------
    def event(self, category: str, severity: str, source: str, kind: str, message: str, data: dict | None = None) -> dict:
        with self._lock:
            return self._event(category, severity, source, kind, message, data)

    def _event(self, category: str, severity: str, source: str, kind: str, message: str, data: dict | None) -> dict:
        e = self.db.add(Event(ts=time.time(), category=category, severity=severity, source=source,
                              kind=kind, message=message, data=data or {}))
        d = e.as_dict()
        self.emit({"kind": "event", "event": d})
        return d

    def security_event(self, kind: str, severity: str, source: str, message: str, data: dict | None = None) -> dict:
        with self._lock:
            d = self.event("cyber", severity, source, kind, message, data)
            node = (data or {}).get("node")
            if node in self.nodes:
                self._correlate(node, "cyber")
            return d

    # ---- MQTT ingest -------------------------------------------------------------------------
    def handle_mqtt(self, topic: str, payload: bytes) -> None:
        with self._lock:
            self._handle_mqtt(topic, payload)

    def _handle_mqtt(self, topic: str, payload: bytes) -> None:
        parsed = proto.parse_topic(topic)
        if parsed is None:
            return
        topic_node, channel = parsed

        if channel == "status":  # Last Will: authenticated by mTLS + ACL only (can't be freshly signed)
            status = payload.decode(errors="replace")[:16]
            if topic_node in self.nodes and status in ("online", "offline"):
                self.nodes[topic_node]["status"] = status
                self.emit({"kind": "node", "node": self.nodes[topic_node]})
                self.event("system", "info" if status == "online" else "warning", topic_node,
                           f"node_{status}", f"{topic_node} is {status}")
            return

        try:
            m = self.verifier.verify(payload, topic_node=topic_node)
        except proto.ProtocolError as e:
            self._observe_traffic(topic_node, len(payload), "?", rejected=True)
            self.security_event(e.reason, REJECT_SEVERITY.get(e.reason, "warning"), "api",
                                f"{REJECT_TEXT.get(e.reason, e.reason)} on {topic_node}",
                                {"node": topic_node, "detail": e.detail})
            return
        self._observe_traffic(m.node, len(payload), m.type, rejected=False)

        node = self.nodes[m.node]
        node["last_seen"] = time.time()
        if node["status"] != "online":
            node["status"] = "online"
        if m.type == "telemetry":
            self._telemetry(m)
        elif m.type == "event":
            self._node_event(m)

    def _telemetry(self, m: proto.Message) -> None:
        d = m.data
        try:
            reading = {"temp_c": float(d["temp_c"]), "hum_pct": float(d["hum_pct"]),
                       "gas_ppm": float(d["gas_ppm"]), "pir": bool(d["pir"])}
        except (KeyError, TypeError, ValueError):
            self.security_event("schema", "warning", "api", f"invalid telemetry fields on {m.node}", {"node": m.node})
            return

        score = None
        if self.sensor_scorer:
            r = self.sensor_scorer.update(m.node, reading)
            if r:
                score, is_anomaly = r
                prev = self.nodes[m.node]["anomaly"]
                if is_anomaly and (prev is None or prev < self.sensor_scorer.inner.threshold):
                    self.event("environmental", "warning", m.node, "sensor_anomaly",
                               f"abnormal sensor dynamics on {m.node} (score {score:.2f})",
                               {"node": m.node, "score": round(score, 3), **reading})
                    self._correlate(m.node, "sensor_anomaly")
                self.nodes[m.node]["anomaly"] = score

        self.db.add(Telemetry(node=m.node, ts=m.ts, anomaly=score, **reading))
        self.nodes[m.node]["last"] = {**reading, "ts": m.ts}
        self.emit({"kind": "telemetry", "node": m.node, "ts": m.ts, "anomaly": score, **reading})

    def _node_event(self, m: proto.Message) -> None:
        kind = str(m.data.get("kind", "?"))[:32]
        if kind == "pir":
            self.event("intrusion", "warning", m.node, "pir", f"motion detected by {m.node}", {"node": m.node})
            self._correlate(m.node, "pir")
        elif kind == "ack":
            self.nodes[m.node]["actuators"][str(m.data.get("action"))] = m.data.get("value")
            self.emit({"kind": "node", "node": self.nodes[m.node]})
        elif kind == "cmd_rejected":
            self.security_event("cmd_forged", "critical", m.node,
                                f"{m.node} rejected a forged command", {"node": m.node, **m.data})
        elif kind == "boot":
            if self.traffic_scorer:
                self.traffic_scorer.grace(m.node)
            self.event("system", "info", m.node, "boot", f"{m.node} booted", {"node": m.node, **m.data})
        elif kind == "tamper":
            self.event("intrusion", "critical", m.node, "tamper", f"tamper detected on {m.node}", {"node": m.node})
            self._correlate(m.node, "pir")

    def _observe_traffic(self, node: str, size: int, mtype: str, rejected: bool) -> None:
        if self.traffic_scorer and node in self.nodes:
            self.traffic_scorer.observe(node, size, mtype, rejected)

    def tick(self) -> None:
        """Called every second by the app: flushes traffic buckets, marks silent nodes offline."""
        with self._lock:
            if self.traffic_scorer:
                for node, score, is_anomaly, stats in self.traffic_scorer.flush_if_due():
                    self.emit({"kind": "traffic", "node": node, "score": score, **stats})
                    if is_anomaly:
                        self.security_event("traffic_anomaly", "warning", "ai",
                                            f"abnormal MQTT traffic from {node} (score {score:.2f})",
                                            {"node": node, "score": round(score, 3), **stats})
            now = time.time()
            for n in self.nodes.values():
                if n["status"] == "online" and n["last_seen"] and now - n["last_seen"] > 15:
                    n["status"] = "silent"
                    self.emit({"kind": "node", "node": n})
                    self.event("system", "warning", n["id"], "node_silent", f"{n['id']} stopped reporting")

    # ---- external alerts (POST /alerts: vision, decoy, ...) ------------------------------------
    def external_alert(self, source: str, category: str, severity: str, kind: str, message: str, data: dict) -> dict:
        with self._lock:
            d = self.event(category, severity, source, kind, message, data)
            node = data.get("node") or (self.camera_node if source == "vision" else None)
            if node in self.nodes:
                signal = {"vision": "camera_person", "decoy": "decoy"}.get(source, "cyber" if category == "cyber" else None)
                if signal:
                    self._correlate(node, signal)
            return d

    def _correlate(self, node: str, signal: str) -> None:
        r = self.correlator.add(node, signal, time.time())
        if r:
            level, score, active = r
            words = [SIGNAL_WORDS[a] for a in active]
            what = ", ".join(words[:-1]) + " and " + words[-1]
            self.event("intrusion" if {"pir", "camera_person"} & set(active) else "environmental", level,
                       "correlation", "incident",
                       f"{'Critical' if level == 'critical' else 'Warning'}: {what} at {node}",
                       {"node": node, "score": score, "signals": active})

    # ---- commands ------------------------------------------------------------------------------
    def sign_command(self, node: str, action: str, value) -> bytes:
        return proto.encode(node, "cmd", {"action": action, "value": value}, self.keys[node])
