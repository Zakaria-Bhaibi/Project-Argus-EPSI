from __future__ import annotations

import time
from pathlib import Path

from sqlalchemy import JSON, Boolean, Float, Integer, String, create_engine, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class Telemetry(Base):
    __tablename__ = "telemetry"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    node: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[float] = mapped_column(Float, index=True)
    temp_c: Mapped[float] = mapped_column(Float)
    hum_pct: Mapped[float] = mapped_column(Float)
    gas_ppm: Mapped[float | None] = mapped_column(Float, nullable=True)  # None while the MQ-2 warms up
    pir: Mapped[bool] = mapped_column(Boolean)
    anomaly: Mapped[float | None] = mapped_column(Float, nullable=True)


class Event(Base):
    """Unified timeline: environmental, intrusion, cyber and system events."""
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[float] = mapped_column(Float, index=True)
    category: Mapped[str] = mapped_column(String(16), index=True)   # environmental|intrusion|cyber|system
    severity: Mapped[str] = mapped_column(String(8))                # info|warning|critical
    source: Mapped[str] = mapped_column(String(32))                 # node id, vision, decoy, broker, api, correlation
    kind: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(String(256))
    data: Mapped[dict] = mapped_column(JSON, default=dict)

    def as_dict(self) -> dict:
        return {"id": self.id, "ts": self.ts, "category": self.category, "severity": self.severity,
                "source": self.source, "kind": self.kind, "message": self.message, "data": self.data}


class Database:
    def __init__(self, url: str):
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
            self.engine = create_engine(url, connect_args={"check_same_thread": False})
        else:
            self.engine = create_engine(url, pool_pre_ping=True)
        Base.metadata.create_all(self.engine)
        if self.engine.dialect.name == "postgresql":  # tiny migration for databases created before v0.2
            with self.engine.begin() as c:
                c.execute(text("ALTER TABLE telemetry ALTER COLUMN gas_ppm DROP NOT NULL"))
        self.session = sessionmaker(self.engine, expire_on_commit=False)

    def add(self, obj: Base) -> Base:
        with self.session() as s:
            s.add(obj)
            s.commit()
            return obj

    def telemetry(self, node: str, minutes: int) -> list[dict]:
        since = time.time() - minutes * 60
        with self.session() as s:
            rows = s.scalars(select(Telemetry).where(Telemetry.node == node, Telemetry.ts >= since)
                             .order_by(Telemetry.ts)).all()
        return [{"ts": r.ts, "temp_c": r.temp_c, "hum_pct": r.hum_pct, "gas_ppm": r.gas_ppm,
                 "pir": r.pir, "anomaly": r.anomaly} for r in rows]

    def events(self, category: str | None, limit: int) -> list[dict]:
        with self.session() as s:
            q = select(Event).order_by(Event.ts.desc()).limit(limit)
            if category:
                q = q.where(Event.category == category)
            return [e.as_dict() for e in s.scalars(q).all()]


__all__ = ["Database", "Event", "Session", "Telemetry"]
