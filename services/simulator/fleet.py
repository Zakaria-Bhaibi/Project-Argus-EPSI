"""Virtual Sentinel-X fleet: one MQTT-over-mTLS client per node, each with its own certificate.

Env:
  BROKER_HOST / BROKER_PORT   mosquitto address (default localhost:8883)
  PKI_DIR                     infra/pki/out (holds ca.crt, <node>/<node>.crt|.key, devices.json)
  NODES                       comma list, default sentinel-01..04
  INTERVAL_S                  telemetry period (default 2)
"""
from __future__ import annotations

import logging
import os
import random
import signal
import ssl
import sys
import threading
import time
from pathlib import Path

import paho.mqtt.client as mqtt

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
import argus_protocol as proto  # noqa: E402
from sensor_model import NodeModel  # noqa: E402

log = logging.getLogger("fleet")


class VirtualNode:
    def __init__(self, node_id: str, key: bytes, pki: Path, host: str, port: int, interval: float):
        self.id, self.key, self.interval = node_id, key, interval
        # demo pace: the Overheat button should visibly heat up within ~10 s (+0.2 °C/s)
        self.model = NodeModel(node_id, rng=random.Random(node_id), overheat_rate=float(os.environ.get("OVERHEAT_RATE", "0.2")))
        self.verifier = proto.Verifier({node_id: key})
        self.actuators = {"buzzer": False, "led": "green", "display": ""}
        self._last_pir = False
        self._last_cam = 0.0

        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=node_id, protocol=mqtt.MQTTv311)
        c.tls_set(ca_certs=str(pki / "ca.crt"), certfile=str(pki / node_id / f"{node_id}.crt"),
                  keyfile=str(pki / node_id / f"{node_id}.key"), tls_version=ssl.PROTOCOL_TLS_CLIENT)
        c.will_set(proto.topic(node_id, "status"), "offline", qos=1, retain=True)
        c.on_connect = self._on_connect
        c.on_message = self._on_message
        c.reconnect_delay_set(1, 10)
        self.client, self.host, self.port = c, host, port

    def _on_connect(self, client, _userdata, _flags, reason_code, _props):
        if reason_code.is_failure:
            log.error("%s connect refused: %s", self.id, reason_code)
            return
        log.info("%s connected (mTLS)", self.id)
        client.publish(proto.topic(self.id, "status"), "online", qos=1, retain=True)
        client.subscribe(proto.topic(self.id, "cmd"), qos=1)
        self.event("boot", {"fw": "sim-1.0"})

    def _on_message(self, _client, _userdata, msg):
        try:
            m = self.verifier.verify(msg.payload, topic_node=self.id)
        except proto.ProtocolError as e:
            log.warning("%s REJECTED command (%s)", self.id, e)
            self.event("cmd_rejected", {"reason": e.reason})
            return
        action, value = m.data.get("action"), m.data.get("value")
        if action == "scenario":
            self.model.set_scenario(str(value))
        elif action in self.actuators:
            self.actuators[action] = value
        else:
            log.warning("%s unknown action %r", self.id, action)
            return
        log.info("%s %s -> %r", self.id, action, value)
        self.event("ack", {"action": action, "value": value})

    def event(self, kind: str, data: dict | None = None) -> None:
        payload = proto.encode(self.id, "event", {"kind": kind, **(data or {})}, self.key)
        self.client.publish(proto.topic(self.id, "events"), payload, qos=1)

    def start(self) -> None:
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()

    def tick(self) -> None:
        if not self.client.is_connected():
            return
        reading = self.model.step(self.interval)
        reading["scenario"] = self.model.scenario  # ground truth label, ignored by the models
        self.client.publish(proto.topic(self.id, "telemetry"),
                            proto.encode(self.id, "telemetry", reading, self.key), qos=1)
        if reading["pir"] and not self._last_pir:
            self.event("pir", {"value": True})
        self._last_pir = reading["pir"]
        # simulated site camera: confirms the person a moment after the motion sensor, every ~6 s
        if self.model.scenario == "intruder" and reading["pir"] and time.time() - self._last_cam > 6:
            self._last_cam = time.time()
            self.event("camera", {"confidence": round(random.uniform(0.86, 0.97), 2)})

    def stop(self) -> None:
        self.client.publish(proto.topic(self.id, "status"), "offline", qos=1, retain=True).wait_for_publish(2)
        self.client.disconnect()
        self.client.loop_stop()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    pki = Path(os.environ.get("PKI_DIR", Path(__file__).resolve().parents[2] / "infra/pki/out"))
    host = os.environ.get("BROKER_HOST", "localhost")
    port = int(os.environ.get("BROKER_PORT", "8883"))
    interval = float(os.environ.get("INTERVAL_S", "2"))
    names = [n.strip() for n in os.environ.get("NODES", "sentinel-01,sentinel-02,sentinel-03,sentinel-04").split(",") if n.strip()]
    keys = proto.load_keys(str(pki / "devices.json"))

    nodes = [VirtualNode(n, keys[n], pki, host, port, interval) for n in names]
    for n in nodes:
        n.start()

    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    log.info("fleet of %d nodes -> %s:%d every %.1fs", len(nodes), host, port, interval)
    while not stop.wait(interval):
        for n in nodes:
            n.tick()
    for n in nodes:
        n.stop()


if __name__ == "__main__":
    main()
