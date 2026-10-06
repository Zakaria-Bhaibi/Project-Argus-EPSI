"""Feature extraction over a sliding window of readings (one window per node).

No static thresholds here (forbidden by the brief): the window is turned into
features describing level, trend (kinetics), volatility and temp/gas coupling,
and the Isolation Forest decides what is abnormal.
"""
from __future__ import annotations

from collections import deque

import numpy as np

WINDOW = 15  # readings, i.e. 30 s at the default 2 s period

FEATURE_NAMES = [
    "temp", "hum", "gas",
    "temp_slope", "hum_slope", "gas_slope",
    "temp_std", "gas_std",
    "temp_gas_corr", "pir_rate",
]


def _slope(y: np.ndarray) -> float:
    x = np.arange(len(y), dtype=float)
    x -= x.mean()
    return float((x * (y - y.mean())).sum() / (x * x).sum())


def window_features(rows: list[dict]) -> np.ndarray:
    temp = np.array([r["temp_c"] for r in rows], dtype=float)
    hum = np.array([r["hum_pct"] for r in rows], dtype=float)
    gas = np.array([r["gas_ppm"] for r in rows], dtype=float)
    pir = np.array([1.0 if r["pir"] else 0.0 for r in rows])
    if temp.std() < 1e-6 or gas.std() < 1e-6:
        corr = 0.0
    else:
        corr = float(np.corrcoef(temp, gas)[0, 1])
    return np.array([
        temp.mean(), hum.mean(), gas.mean(),
        _slope(temp), _slope(hum), _slope(gas),
        temp.std(), gas.std(),
        corr, pir.mean(),
    ])


class Windows:
    """Keeps the last WINDOW readings per node."""

    def __init__(self, size: int = WINDOW):
        self.size = size
        self.buf: dict[str, deque] = {}

    def push(self, node: str, reading: dict) -> np.ndarray | None:
        d = self.buf.setdefault(node, deque(maxlen=self.size))
        d.append(reading)
        return window_features(list(d)) if len(d) == self.size else None
