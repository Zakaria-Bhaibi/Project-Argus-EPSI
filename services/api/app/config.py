"""All configuration comes from the environment (docker-compose / .env). No secrets in code."""
from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # repo root when running from source
log = logging.getLogger("argus.config")


def _env(name: str, default: str | None = None) -> str | None:
    """VAR or VAR_FILE (Docker secrets convention)."""
    file = os.environ.get(f"{name}_FILE")
    if file:
        return Path(file).read_text().strip()
    return os.environ.get(name, default)


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", f"sqlite:///{ROOT / 'services/api/data/argus.db'}"))
    pki_dir: Path = field(default_factory=lambda: Path(_env("PKI_DIR", str(ROOT / "infra/pki/out"))))
    devices_json: Path | None = None
    mqtt_enabled: bool = field(default_factory=lambda: _env("MQTT_ENABLED", "1") == "1")
    mqtt_host: str = field(default_factory=lambda: _env("MQTT_HOST", "localhost"))
    mqtt_port: int = field(default_factory=lambda: int(_env("MQTT_PORT", "8883")))
    mqtt_client_id: str = "argus-api"
    jwt_secret: str = field(default_factory=lambda: _env("JWT_SECRET") or "")
    jwt_ttl_s: int = 8 * 3600
    users_file: Path | None = field(default_factory=lambda: Path(p) if (p := _env("USERS_FILE")) else None)
    service_tokens: set[str] = field(default_factory=lambda: {t for t in (_env("SERVICE_TOKENS", "") or "").split(",") if t})
    mosquitto_log: Path | None = field(default_factory=lambda: Path(p) if (p := _env("MOSQUITTO_LOG")) else None)
    models_dir: Path = field(default_factory=lambda: Path(_env("MODELS_DIR", str(ROOT / "ai/anomaly/models"))))
    camera_node: str = field(default_factory=lambda: _env("CAMERA_NODE", "sentinel-hero"))
    cors_origins: list[str] = field(default_factory=lambda: [o for o in (_env("CORS_ORIGINS", "") or "").split(",") if o])

    def __post_init__(self):
        if self.devices_json is None:
            self.devices_json = Path(_env("DEVICES_JSON", str(self.pki_dir / "devices.json")))
        if not self.jwt_secret:
            self.jwt_secret = secrets.token_hex(32)
            log.warning("JWT_SECRET not set: using a random one (tokens die on restart)")
