"""MQTT over mutual TLS: subscribes to all nodes as `argus-api` and publishes signed commands."""
from __future__ import annotations

import logging
import ssl

import paho.mqtt.client as mqtt

from .config import Settings
from .pipeline import Pipeline, proto

log = logging.getLogger("argus.mqtt")


class MqttLink:
    def __init__(self, settings: Settings, pipeline: Pipeline):
        self.pipeline = pipeline
        pki, cid = settings.pki_dir, settings.mqtt_client_id
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=cid, protocol=mqtt.MQTTv311)
        c.tls_set(ca_certs=str(pki / "ca.crt"), certfile=str(pki / cid / f"{cid}.crt"),
                  keyfile=str(pki / cid / f"{cid}.key"), tls_version=ssl.PROTOCOL_TLS_CLIENT)
        c.on_connect = self._on_connect
        c.on_disconnect = self._on_disconnect
        c.on_message = self._on_message
        c.reconnect_delay_set(1, 15)
        self.client, self.host, self.port = c, settings.mqtt_host, settings.mqtt_port

    def start(self) -> None:
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()

    def stop(self) -> None:
        self.client.disconnect()
        self.client.loop_stop()

    @property
    def connected(self) -> bool:
        return self.client.is_connected()

    def _on_connect(self, client, _u, _f, reason_code, _p):
        if reason_code.is_failure:
            log.error("broker refused connection: %s", reason_code)
            return
        log.info("connected to broker %s:%d over mTLS", self.host, self.port)
        for channel in ("telemetry", "events", "status"):
            client.subscribe(f"{proto.TOPIC_ROOT}/+/{channel}", qos=1)

    def _on_disconnect(self, _c, _u, _f, reason_code, _p):
        log.warning("disconnected from broker: %s", reason_code)

    def _on_message(self, _c, _u, msg):
        try:
            self.pipeline.handle_mqtt(msg.topic, msg.payload)
        except Exception:  # never let one bad message kill the network thread
            log.exception("pipeline error on %s", msg.topic)

    def send_command(self, node: str, action: str, value) -> bool:
        info = self.client.publish(proto.topic(node, "cmd"), self.pipeline.sign_command(node, action, value), qos=1)
        return info.rc == mqtt.MQTT_ERR_SUCCESS
