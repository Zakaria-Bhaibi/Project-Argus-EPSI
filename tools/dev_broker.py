"""DEV ONLY: a pure-Python MQTT broker over TLS for testing without Docker/Mosquitto.

It does NOT enforce the per-node ACLs (Mosquitto does that in the real stack).
    .venv/Scripts/python tools/dev_broker.py
"""
import asyncio
import logging
from pathlib import Path

from amqtt.broker import Broker

PKI = Path(__file__).resolve().parents[1] / "infra/pki/out"

CONFIG = {
    "listeners": {
        "default": {
            "type": "tcp",
            "bind": "127.0.0.1:8883",
            "ssl": True,
            "cafile": str(PKI / "ca.crt"),
            "certfile": str(PKI / "mosquitto/mosquitto.crt"),
            "keyfile": str(PKI / "mosquitto/mosquitto.key"),
        }
    },
    "plugins": {"amqtt.plugins.authentication.AnonymousAuthPlugin": {"allow_anonymous": True}},
}


async def main():
    broker = Broker(CONFIG)
    await broker.start()
    print("dev broker (TLS) on 127.0.0.1:8883 - NOT for production")
    await asyncio.Event().wait()


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
