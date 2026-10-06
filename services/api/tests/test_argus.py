"""Security-focused tests for the protocol, the pipeline and the API.

    .venv/Scripts/python -m pytest services/api/tests -q
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

API = Path(__file__).resolve().parents[1]
ROOT = API.parents[1]
sys.path[:0] = [str(API), str(ROOT / "services/common")]

import argus_protocol as proto  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.passwords import hash_password  # noqa: E402

K1, K2 = b"\x01" * 32, b"\x02" * 32
READING = {"temp_c": 23.0, "hum_pct": 45.0, "gas_ppm": 180.0, "pir": False}


# ------------------------------------------------------------------ protocol
def test_valid_message_roundtrip():
    v = proto.Verifier({"n1": K1})
    m = v.verify(proto.encode("n1", "telemetry", READING, K1), topic_node="n1")
    assert m.node == "n1" and m.data == READING


@pytest.mark.parametrize("mutate,reason", [
    (lambda p: p.replace(b"23.0", b"99.0"), "bad_signature"),               # tampered value
    (lambda p: p.rsplit(b"\n", 1)[0], "unsigned"),                          # signature stripped
    (lambda p: b"{not json\n00", "malformed"),
    (lambda p: b"x" * 5000, "oversized"),
])
def test_tampered_messages_are_rejected(mutate, reason):
    v = proto.Verifier({"n1": K1})
    with pytest.raises(proto.ProtocolError) as e:
        v.verify(mutate(proto.encode("n1", "telemetry", READING, K1)), topic_node="n1")
    assert e.value.reason == reason


def test_replay_is_rejected():
    v = proto.Verifier({"n1": K1})
    p = proto.encode("n1", "telemetry", READING, K1)
    v.verify(p, topic_node="n1")
    with pytest.raises(proto.ProtocolError, match="replay"):
        v.verify(p, topic_node="n1")


def test_stale_message_is_rejected():
    v = proto.Verifier({"n1": K1})
    old = int(time.time()) - 120
    with pytest.raises(proto.ProtocolError, match="stale"):
        v.verify(proto.encode("n1", "telemetry", READING, K1, ts=old), topic_node="n1")


def test_node_cannot_impersonate_another():
    v = proto.Verifier({"n1": K1, "n2": K2})
    # n2 signs correctly with its own key but publishes on n1's topic
    with pytest.raises(proto.ProtocolError, match="identity_mismatch"):
        v.verify(proto.encode("n2", "telemetry", READING, K2), topic_node="n1")
    # n2 claims to be n1 in the body but only has its own key
    with pytest.raises(proto.ProtocolError, match="bad_signature"):
        v.verify(proto.encode("n1", "telemetry", READING, K2), topic_node="n1")


# ------------------------------------------------------------------ API + pipeline
@pytest.fixture
def client(tmp_path):
    devices = tmp_path / "devices.json"
    devices.write_text(json.dumps({"n1": {"hmac_key": K1.hex()}, "n2": {"hmac_key": K2.hex()}}))
    users = tmp_path / "users.json"
    users.write_text(json.dumps({
        "op": {"role": "operator", "password": hash_password("operator-pass")},
        "view": {"role": "viewer", "password": hash_password("viewer-pass")},
    }))
    s = Settings(database_url=f"sqlite:///{tmp_path / 'db.sqlite'}", devices_json=devices, mqtt_enabled=False,
                 users_file=users, service_tokens={"svc-token"}, jwt_secret="test-secret")
    app = create_app(s, start_background=False)
    with TestClient(app) as c:
        c.pipeline = app.state.pipeline
        yield c


def login(c, user, pw):
    r = c.post("/api/v1/auth/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_read_endpoints_require_auth(client):
    for path in ("/api/v1/nodes", "/api/v1/events", "/api/v1/telemetry?node=n1"):
        assert client.get(path).status_code == 401
    assert client.get("/api/v1/health").status_code == 200


def test_wrong_password_is_logged_as_cyber_event(client):
    assert client.post("/api/v1/auth/login", json={"username": "op", "password": "nope"}).status_code == 401
    h = login(client, "view", "viewer-pass")
    ev = client.get("/api/v1/events?category=cyber", headers=h).json()
    assert ev[0]["kind"] == "login_failed"


def test_login_is_rate_limited(client):
    codes = [client.post("/api/v1/auth/login", json={"username": "x", "password": "y"}).status_code for _ in range(8)]
    assert 429 in codes


def test_viewer_cannot_send_commands(client):
    h = login(client, "view", "viewer-pass")
    r = client.post("/api/v1/nodes/n1/commands", json={"action": "buzzer", "value": True}, headers=h)
    assert r.status_code == 403


def test_command_validation(client):
    h = login(client, "op", "operator-pass")
    r = client.post("/api/v1/nodes/n1/commands", json={"action": "led", "value": "purple"}, headers=h)
    assert r.status_code == 422
    r = client.post("/api/v1/nodes/n1/commands", json={"action": "rm -rf", "value": True}, headers=h)
    assert r.status_code == 422


def test_alerts_need_service_token(client):
    body = {"source": "vision", "category": "intrusion", "severity": "warning", "kind": "person",
            "message": "person in restricted zone", "data": {"confidence": 0.91}}
    assert client.post("/api/v1/alerts", json=body).status_code == 401
    assert client.post("/api/v1/alerts", json=body, headers={"Authorization": "Bearer wrong"}).status_code == 401
    r = client.post("/api/v1/alerts", json=body, headers={"Authorization": "Bearer svc-token"})
    assert r.status_code == 201 and r.json()["category"] == "intrusion"


def test_pipeline_stores_valid_and_flags_attacks(client):
    p = client.pipeline
    t = proto.topic("n1", "telemetry")
    good = proto.encode("n1", "telemetry", READING, K1)
    p.handle_mqtt(t, good)
    p.handle_mqtt(t, good)                                                     # replay
    p.handle_mqtt(t, proto.encode("n1", "telemetry", READING, K2))             # forged with n2's key
    p.handle_mqtt(proto.topic("n2", "telemetry"), proto.encode("n1", "telemetry", READING, K1))  # wrong topic

    h = login(client, "view", "viewer-pass")
    assert len(client.get("/api/v1/telemetry?node=n1", headers=h).json()) == 1
    kinds = {e["kind"] for e in client.get("/api/v1/events?category=cyber", headers=h).json()}
    assert {"replay", "bad_signature", "identity_mismatch"} <= kinds


def test_correlation_escalates_to_critical(client):
    p = client.pipeline
    p.handle_mqtt(proto.topic("n1", "events"), proto.encode("n1", "event", {"kind": "pir", "value": True}, K1))
    p.external_alert("vision", "intrusion", "warning", "person", "person detected", {"node": "n1"})
    p.handle_mqtt(proto.topic("n1", "telemetry"), proto.encode("n1", "telemetry", READING, K2))  # + cyber
    h = login(client, "view", "viewer-pass")
    incidents = [e for e in client.get("/api/v1/events", headers=h).json() if e["kind"] == "incident"]
    assert incidents and incidents[0]["severity"] == "critical"
    assert {"pir", "camera_person", "cyber"} <= set(incidents[0]["data"]["signals"])


def test_websocket_rejects_bad_token_and_streams_events(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/api/v1/ws?token=bad") as ws:
            ws.receive_json()
    token = login(client, "view", "viewer-pass")["Authorization"].split()[1]
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        assert ws.receive_json()["kind"] == "hello"
        client.pipeline.external_alert("decoy", "cyber", "warning", "decoy_hit", "scan on decoy", {})
        assert ws.receive_json()["event"]["kind"] == "decoy_hit"


def test_back_to_back_messages_are_not_replays():
    # regression: telemetry + event emitted in the same millisecond used to share a seq
    v = proto.Verifier({"n1": K1})
    for _ in range(50):
        v.verify(proto.encode("n1", "telemetry", READING, K1), topic_node="n1")
        v.verify(proto.encode("n1", "event", {"kind": "pir"}, K1), topic_node="n1")


def test_traffic_model_flags_flood_but_not_reboot_burst():
    sys.path.insert(0, str(ROOT / "ai/anomaly"))
    from scorer import TrafficScorer
    now = [0.0]
    t = TrafficScorer(clock=lambda: now[0])
    t.grace("rebooting")
    for _ in range(10):
        t.observe("rebooting", 215, "telemetry", False)   # legit reboot burst
    for _ in range(5):
        t.observe("normal", 215, "telemetry", False)
    for _ in range(300):
        t.observe("flooder", 215, "telemetry", False)
    now[0] = 11
    flagged = {node: anomaly for node, _, anomaly, _ in t.flush_if_due()}
    assert flagged == {"normal": False, "flooder": True}


def test_fake_boot_cannot_hide_a_flood():
    # regression (found on the real stack): a compromised node sent "boot" to get a grace period
    sys.path.insert(0, str(ROOT / "ai/anomaly"))
    from scorer import TrafficScorer
    now = [0.0]
    t = TrafficScorer(clock=lambda: now[0])
    t.grace("flooder")
    for _ in range(300):
        t.observe("flooder", 215, "telemetry", False)
    now[0] = 11
    assert [a for n, _, a, _ in t.flush_if_due() if n == "flooder"] == [True]


def test_log_watcher_flags_session_takeover(client):
    from app.log_watch import LogWatcher
    w = LogWatcher(Path("unused"), client.pipeline)
    w.handle("2026-10-06T11:40:04: Client n1 already connected, closing old connection.")
    w.handle("2026-10-06T11:40:05: OpenSSL Error[0]: error:0A0000C7:SSL routines::peer did not return a certificate")
    h = login(client, "view", "viewer-pass")
    kinds = [e["kind"] for e in client.get("/api/v1/events?category=cyber", headers=h).json()]
    assert "session_takeover" in kinds and "tls_rejected" in kinds


def test_telemetry_without_gas_during_warmup_is_accepted(client):
    p = client.pipeline
    p.handle_mqtt(proto.topic("n1", "telemetry"),
                  proto.encode("n1", "telemetry", {"temp_c": 23.0, "hum_pct": 45.0, "pir": False}, K1))
    h = login(client, "view", "viewer-pass")
    pts = client.get("/api/v1/telemetry?node=n1", headers=h).json()
    assert len(pts) == 1 and pts[0]["gas_ppm"] is None
    assert not [e for e in client.get("/api/v1/events?category=cyber", headers=h).json() if e["kind"] == "schema"]


def test_command_to_offline_node_is_refused(client):
    h = login(client, "op", "operator-pass")
    r = client.post("/api/v1/nodes/n1/commands", json={"action": "buzzer", "value": True}, headers=h)
    assert r.status_code == 409 and "can't receive commands" in r.json()["detail"]


def test_camera_sighting_escalates_and_triggers_automatic_response(client):
    p = client.pipeline
    sent = []
    p.send_command = lambda node, action, value: sent.append((node, action, value)) or True
    p.nodes["n1"]["status"] = "online"
    p.handle_mqtt(proto.topic("n1", "events"), proto.encode("n1", "event", {"kind": "pir", "value": True}, K1))
    p.handle_mqtt(proto.topic("n1", "events"), proto.encode("n1", "event", {"kind": "camera", "confidence": 0.93}, K1))
    h = login(client, "view", "viewer-pass")
    kinds = [e["kind"] for e in client.get("/api/v1/events", headers=h).json()]
    assert "person_in_zone" in kinds and "incident" in kinds and "auto_response" in kinds
    assert ("n1", "led", "red") in sent


def test_sensor_window_is_reset_after_a_gap():
    sys.path.insert(0, str(ROOT / "ai/anomaly"))
    from scorer import SensorScorer
    sc = SensorScorer()
    r = {"temp_c": 23.0, "hum_pct": 45.0, "gas_ppm": 180.0, "pir": False}
    for i in range(14):
        sc.update("n", r, ts=1000 + 2 * i)
    assert len(sc.windows.buf["n"]) == 14
    sc.update("n", r, ts=1000 + 2 * 14 + 60)       # one minute of silence: start over
    assert len(sc.windows.buf["n"]) == 1
