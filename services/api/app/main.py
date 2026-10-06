"""ARGUS API: REST + WebSocket in front of the ingest pipeline.

Run from source:  uvicorn app.main:app --app-dir services/api
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .config import Settings
from .db import Database
from .log_watch import LogWatcher
from .pipeline import Pipeline, proto
from .security import RateLimiter, Tokens, UserStore, rate_limit, require, require_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("argus.api")


# ---------------------------------------------------------------- request bodies
class Login(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class Alert(BaseModel):
    source: str = Field(pattern=r"^[a-z0-9_-]{2,32}$")
    category: Literal["environmental", "intrusion", "cyber", "system"]
    severity: Literal["info", "warning", "critical"]
    kind: str = Field(pattern=r"^[a-z0-9_]{2,32}$")
    message: str = Field(max_length=256)
    data: dict = Field(default_factory=dict)

    @field_validator("data")
    @classmethod
    def small(cls, v: dict) -> dict:
        if len(str(v)) > 2048:
            raise ValueError("data too large")
        return v


class Command(BaseModel):
    action: Literal["buzzer", "led", "display", "scenario"]
    value: bool | str = Field(...)

    @field_validator("value")
    @classmethod
    def check(cls, v, info):
        action = info.data.get("action")
        if action == "buzzer" and not isinstance(v, bool):
            raise ValueError("buzzer expects true/false")
        if action == "led" and v not in ("green", "orange", "red", "off"):
            raise ValueError("led expects green|orange|red|off")
        if action == "display" and (not isinstance(v, str) or len(v) > 40):
            raise ValueError("display expects a string <= 40 chars")
        if action == "scenario" and v not in ("normal", "gas_leak", "overheat", "intruder", "sensor_fault"):
            raise ValueError("unknown scenario")
        return v


class Hub:
    """Fan-out of live messages to WebSocket clients. emit() is safe to call from any thread."""

    def __init__(self):
        self.clients: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def emit(self, msg: dict) -> None:
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(self._fanout, msg)

    def _fanout(self, msg: dict) -> None:
        for q in list(self.clients):
            if q.qsize() < 500:  # slow client: drop rather than grow memory
                q.put_nowait(msg)


def create_app(settings: Settings | None = None, start_background: bool = True) -> FastAPI:
    settings = settings or Settings()
    db = Database(settings.database_url)
    keys = proto.load_keys(str(settings.devices_json)) if settings.devices_json.exists() else {}
    pipeline = Pipeline(db, keys, settings.models_dir, settings.camera_node)
    hub = Hub()
    pipeline.emit = hub.emit

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        link = None
        if start_background and settings.mqtt_enabled:
            from .mqtt_client import MqttLink
            link = MqttLink(settings, pipeline)
            link.start()
            pipeline.send_command = link.send_command
        app.state.mqtt = link
        if start_background and settings.mosquitto_log:
            LogWatcher(settings.mosquitto_log, pipeline).start()

        async def ticker():
            while True:
                await asyncio.sleep(1)
                await asyncio.to_thread(pipeline.tick)
        task = asyncio.create_task(ticker()) if start_background else None
        log.info("ARGUS API up: %d registered nodes", len(keys))
        yield
        if task:
            task.cancel()
        if link:
            link.stop()

    app = FastAPI(title="ARGUS API", version="0.1.0", lifespan=lifespan,
                  docs_url="/api/v1/docs", openapi_url="/api/v1/openapi.json", redoc_url=None)
    app.state.settings, app.state.db, app.state.pipeline = settings, db, pipeline
    app.state.tokens = Tokens(settings.jwt_secret, settings.jwt_ttl_s)
    app.state.users = UserStore(settings.users_file)
    app.state.limiter = RateLimiter()
    app.state.hub = hub
    app.state.mqtt = None
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                           allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Cache-Control"] = "no-store"
        return resp

    # ---------------------------------------------------------------- auth
    @app.post("/api/v1/auth/login", dependencies=[Depends(rate_limit("login", 0.2, 5))])
    def login(body: Login, request: Request):
        role = app.state.users.authenticate(body.username, body.password)
        if role is None:
            pipeline.security_event("login_failed", "warning", "api", f"failed login for '{body.username[:32]}'",
                                    {"ip": request.client.host if request.client else None})
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
        return {"token": app.state.tokens.issue(body.username, role), "role": role}

    # ---------------------------------------------------------------- read side
    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "mqtt": bool(app.state.mqtt and app.state.mqtt.connected), "time": time.time()}

    @app.get("/api/v1/nodes")
    def nodes(_=Depends(require("viewer"))):
        return list(pipeline.nodes.values())

    @app.get("/api/v1/telemetry")
    def telemetry(node: str, minutes: int = Query(10, ge=1, le=240), _=Depends(require("viewer"))):
        if node not in pipeline.nodes:
            raise HTTPException(404, "unknown node")
        return db.telemetry(node, minutes)

    @app.get("/api/v1/events")
    def events(category: Literal["environmental", "intrusion", "cyber", "system"] | None = None,
               limit: int = Query(100, ge=1, le=500), _=Depends(require("viewer"))):
        return db.events(category, limit)

    # ---------------------------------------------------------------- external alerts (brief: POST /api/v1/alerts)
    @app.post("/api/v1/alerts", status_code=201, dependencies=[Depends(rate_limit("alerts", 20, 40))])
    def alerts(body: Alert, _=Depends(require_service)):
        return pipeline.external_alert(body.source, body.category, body.severity, body.kind, body.message, body.data)

    # ---------------------------------------------------------------- actuators
    @app.post("/api/v1/nodes/{node}/commands", status_code=202, dependencies=[Depends(rate_limit("cmd", 2, 10))])
    def command(node: str, body: Command, user=Depends(require("operator"))):
        if node not in pipeline.nodes:
            raise HTTPException(404, "unknown node")
        if pipeline.nodes[node]["status"] != "online":
            # don't pretend: a command to a node that isn't connected would silently go nowhere
            raise HTTPException(409, f"{node} is {pipeline.nodes[node]['status']}: it can't receive commands right now")
        if not app.state.mqtt or not app.state.mqtt.send_command(node, body.action, body.value):
            raise HTTPException(503, "broker unavailable")
        pipeline.event("system", "info", "api", "command",
                       f"{user['sub']} -> {node}: {body.action}={body.value}",
                       {"node": node, "user": user["sub"], "action": body.action, "value": body.value})
        return {"queued": True}

    # ---------------------------------------------------------------- live
    @app.websocket("/api/v1/ws")
    async def ws(websocket: WebSocket, token: str = ""):
        try:
            claims = app.state.tokens.decode(token)
        except HTTPException:
            await websocket.close(code=4401)
            return
        await websocket.accept()
        q: asyncio.Queue = asyncio.Queue()
        hub.clients.add(q)
        try:
            await websocket.send_json({"kind": "hello", "user": claims["sub"], "role": claims["role"],
                                       "nodes": list(pipeline.nodes.values())})
            while True:
                await websocket.send_json(await q.get())
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            hub.clients.discard(q)

    return app


app = create_app()
