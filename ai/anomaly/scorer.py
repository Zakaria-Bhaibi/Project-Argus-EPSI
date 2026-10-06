"""Runtime scorers used by the API: sensor anomalies and traffic anomalies."""
from __future__ import annotations

import time
from collections import defaultdict
from pathlib import Path

import joblib
import numpy as np

from features import Windows

MODELS_DIR = Path(__file__).resolve().parent / "models"


class _ModelScorer:
    """Wraps a trained bundle {model, lo, thr} into a 0..1 score where 0.5 = alarm level.

    lo = median raw score on normal data, thr = raw score at the 99.7th percentile of normal data.
    """
    threshold = 0.5

    def __init__(self, path: Path):
        b = joblib.load(path)
        self.model, self.lo, self.thr = b["model"], b["lo"], b["thr"]

    def score(self, x: np.ndarray) -> float:
        raw = -float(self.model.decision_function(x.reshape(1, -1))[0])  # higher = more abnormal
        return float(np.clip(0.5 * (raw - self.lo) / (self.thr - self.lo), 0.0, 1.0))


class SensorScorer:
    def __init__(self, models_dir: Path = MODELS_DIR):
        self.windows = Windows()
        self.inner = _ModelScorer(models_dir / "sensor_iforest.joblib")
        self._last_ts: dict[str, float] = {}

    MAX_GAP_S = 10   # a gap means a reboot or an outage: old readings must not mix with new ones

    def reset(self, node: str) -> None:
        self.windows.buf.pop(node, None)

    def update(self, node: str, reading: dict, ts: float | None = None) -> tuple[float, bool] | None:
        """Returns (score 0..1, is_anomaly) once the node's window is full."""
        if ts is not None:
            last = self._last_ts.get(node)
            if last is not None and ts - last > self.MAX_GAP_S:
                self.reset(node)
            self._last_ts[node] = ts
        x = self.windows.push(node, reading)
        if x is None:
            return None
        s = self.inner.score(x)
        return s, s >= self.inner.threshold


TRAFFIC_BUCKET_S = 10
GRACE_MAX_MSGS = 20   # a reboot burst is ~10 msgs; anything bigger is scored even during grace
TRAFFIC_FEATURES = ["msgs", "mean_bytes", "rejected", "distinct_types"]


def traffic_vector(stats: dict) -> np.ndarray:
    """log scale: a 400-message flood and a 7-message burst must not look alike."""
    return np.array([np.log1p(stats["msgs"]), np.log1p(stats["mean_bytes"]),
                     np.log1p(stats["rejected"]), float(stats["distinct_types"])])


class TrafficScorer:
    """Per-node 10 s buckets of MQTT traffic metadata scored by a robust covariance model.

    Isolation Forest cannot extrapolate (a flood far outside the training range lands in the same
    leaf as the busiest normal bucket), so traffic uses a Mahalanobis distance (EllipticEnvelope),
    which grows without bound the further a bucket is from normal.

    Detects floods (DoS), oversized/odd payloads (injection attempts) and bursts of rejected messages.
    """

    def __init__(self, models_dir: Path = MODELS_DIR, clock=time.monotonic):
        self.inner = _ModelScorer(models_dir / "traffic_envelope.joblib")
        self.clock = clock
        self._start = clock()
        self._cur: dict[str, dict] = defaultdict(lambda: {"msgs": 0, "bytes": 0, "rejected": 0, "types": set()})
        self._grace: dict[str, int] = {}

    def grace(self, node: str, buckets: int = 2) -> None:
        """A (re)booting node sends a legit burst (status + boot + backlog): don't score it as a flood.

        Capped at GRACE_MAX_MSGS: "boot" events come from the node itself, so a compromised node could
        otherwise send fake boots to hide a flood (found by tools/redteam/attacks.py on the real stack)."""
        self._grace[node] = buckets

    def observe(self, node: str, size: int, msg_type: str, rejected: bool) -> None:
        b = self._cur[node]
        b["msgs"] += 1
        b["bytes"] += size
        b["rejected"] += int(rejected)
        b["types"].add(msg_type)

    def flush_if_due(self) -> list[tuple[str, float, bool, dict]]:
        """Call regularly; every TRAFFIC_BUCKET_S returns [(node, score, is_anomaly, stats)]."""
        if self.clock() - self._start < TRAFFIC_BUCKET_S:
            return []
        self._start = self.clock()
        out = []
        for node, b in self._cur.items():
            if self._grace.get(node, 0) > 0:
                self._grace[node] -= 1
                if b["msgs"] <= GRACE_MAX_MSGS:
                    continue
            stats = {"msgs": b["msgs"], "mean_bytes": b["bytes"] / max(b["msgs"], 1),
                     "rejected": b["rejected"], "distinct_types": len(b["types"])}
            s = self.inner.score(traffic_vector(stats))
            out.append((node, s, s >= self.inner.threshold, stats))
        self._cur.clear()
        return out
