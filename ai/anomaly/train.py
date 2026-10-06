"""Train the anomaly models and evaluate them against the naive-threshold baseline.

    python ai/anomaly/train.py

Outputs ai/anomaly/models/{sensor_iforest,traffic_envelope}.joblib and models/report.json.
- Sensors: Isolation Forest on 30 s windows (level, kinetics, volatility, temp/gas coupling).
- Traffic: EllipticEnvelope (robust Mahalanobis distance) on log-scaled 10 s buckets.
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.covariance import EllipticEnvelope
from sklearn.ensemble import IsolationForest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "services" / "simulator"))
sys.path.insert(0, str(ROOT / "services" / "common"))
sys.path.insert(0, str(HERE))

import argus_protocol as proto  # noqa: E402
from features import WINDOW, Windows  # noqa: E402
from scorer import TRAFFIC_FEATURES, _ModelScorer, traffic_vector  # noqa: E402
from sensor_model import NodeModel  # noqa: E402

MODELS = HERE / "models"
DT = 2.0


def make_node(i: int, seed: int) -> NodeModel:
    r = random.Random(seed * 1000 + i)
    return NodeModel(f"train-{i}", rng=r, base_temp=r.uniform(18, 28), base_hum=r.uniform(35, 60),
                     base_gas=r.uniform(140, 230))


def normal_windows(n_nodes: int, steps: int, seed: int) -> np.ndarray:
    xs = []
    for i in range(n_nodes):
        node, w = make_node(i, seed), Windows()
        for _ in range(steps):
            x = w.push(node.node_id, node.step(DT))
            if x is not None:
                xs.append(x)
    return np.array(xs)


def bundle(model, x: np.ndarray) -> dict:
    raw = -model.decision_function(x)
    return {"model": model, "lo": float(np.percentile(raw, 50)), "thr": float(np.percentile(raw, 99.7))}


def save(b: dict, name: str) -> _ModelScorer:
    MODELS.mkdir(exist_ok=True)
    joblib.dump(b, MODELS / name)
    return _ModelScorer(MODELS / name)


def scores(scorer: _ModelScorer, x: np.ndarray) -> np.ndarray:
    raw = -scorer.model.decision_function(x)
    return np.clip(0.5 * (raw - scorer.lo) / (scorer.thr - scorer.lo), 0, 1)


def detection_delay(scorer: _ModelScorer, scenario: str, seed: int, warmup_s: int = 300, run_s: int = 900) -> dict:
    """Seconds after scenario start until the model (2 consecutive flags) and the naive threshold fire."""
    node, w = make_node(999, seed), Windows()
    xs, ts, naive_at = [], [], None
    for k in range(int((warmup_s + run_s) / DT)):
        if k * DT == warmup_s:
            node.set_scenario(scenario)
        r = node.step(DT)
        t = k * DT - warmup_s
        x = w.push(node.node_id, r)
        if x is not None and t >= 0:
            xs.append(x)
            ts.append(t)
        # baseline the brief forbids as a detector; used here only as the reference point
        if t >= 0 and naive_at is None and (r["temp_c"] > 40 or r["gas_ppm"] > 600):
            naive_at = t
    flags = scores(scorer, np.array(xs)) >= scorer.threshold
    model_at = next((ts[i] for i in range(1, len(flags)) if flags[i] and flags[i - 1]), None)
    return {"scenario": scenario, "model_detects_after_s": model_at, "naive_threshold_after_s": naive_at}


def traffic_buckets(n: int, seed: int) -> list[dict]:
    """Normal 10 s buckets: 5 telemetry msgs (2 s period) +/- jitter, occasional events."""
    r = random.Random(seed)
    key = b"k" * 32
    node = make_node(0, seed)
    out = []
    for _ in range(n):
        msgs = 5 + r.choice([-1, 0, 0, 0, 1])
        events = 1 if r.random() < 0.1 else 0
        sizes = [len(proto.encode("sentinel-01", "telemetry", node.step(DT), key)) for _ in range(msgs)]
        sizes += [len(proto.encode("sentinel-01", "event", {"kind": "pir", "value": True}, key))] * events
        out.append({"msgs": msgs + events, "mean_bytes": float(np.mean(sizes)), "rejected": 0,
                    "distinct_types": 1 + int(events > 0)})
    return out


def traffic_matrix(buckets: list[dict], jitter: float = 0.0, seed: int = 0) -> np.ndarray:
    x = np.array([traffic_vector(b) for b in buckets])
    if jitter:  # keeps the covariance non-singular ("rejected" is always 0 in normal traffic)
        x = x + np.random.default_rng(seed).normal(0, jitter, x.shape)
    return x


def main() -> None:
    print("training sensor model (Isolation Forest) on normal operation ...")
    x = normal_windows(n_nodes=30, steps=1500, seed=1)
    sensor = save(bundle(IsolationForest(n_estimators=200, random_state=1).fit(x), x), "sensor_iforest.joblib")

    print("training traffic model (EllipticEnvelope) ...")
    xt = traffic_matrix(traffic_buckets(5000, seed=2), jitter=0.05, seed=2)
    traffic = save(bundle(EllipticEnvelope(support_fraction=1.0, random_state=2).fit(xt), xt), "traffic_envelope.joblib")

    def tscore(b: dict) -> float:
        return round(traffic.score(traffic_vector(b)), 3)

    report = {
        "sensor": {
            "model": "IsolationForest", "train_windows": int(len(x)), "window_readings": WINDOW,
            "false_positive_rate": float(np.mean(scores(sensor, normal_windows(10, 900, seed=7)) >= 0.5)),
            "scenarios": [detection_delay(sensor, s, seed=11) for s in ("gas_leak", "overheat", "sensor_fault")],
        },
        "traffic": {
            "model": "EllipticEnvelope", "features": TRAFFIC_FEATURES,
            "false_positive_rate": float(np.mean(scores(traffic, traffic_matrix(traffic_buckets(2000, seed=9))) >= 0.5)),
            "normal_bucket": tscore({"msgs": 5, "mean_bytes": 215, "rejected": 0, "distinct_types": 1}),
            "flood_400_msgs": tscore({"msgs": 400, "mean_bytes": 215, "rejected": 0, "distinct_types": 1}),
            "flood_30_msgs": tscore({"msgs": 30, "mean_bytes": 215, "rejected": 0, "distinct_types": 1}),
            "big_payloads": tscore({"msgs": 6, "mean_bytes": 1900, "rejected": 0, "distinct_types": 1}),
            "one_rejected": tscore({"msgs": 5, "mean_bytes": 215, "rejected": 1, "distinct_types": 1}),
            "silent_node": tscore({"msgs": 1, "mean_bytes": 215, "rejected": 0, "distinct_types": 1}),
        },
    }
    (MODELS / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
