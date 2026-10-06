"""Physics-like model of one Sentinel-X node (DHT22 + MQ-2 + PIR).

Also used by ai/anomaly/train.py to generate the "normal operation" training set,
so keep it deterministic when given a seeded Random.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

SCENARIOS = ("normal", "gas_leak", "overheat", "intruder", "sensor_fault")


@dataclass
class NodeModel:
    node_id: str
    rng: random.Random = field(default_factory=random.Random)
    base_temp: float = 23.0
    base_hum: float = 45.0
    base_gas: float = 180.0      # ppm, MQ-2 clean-air baseline
    t: float = 0.0               # seconds since start
    scenario: str = "normal"
    scenario_t: float = 0.0      # seconds since the scenario started
    _pir_until: float = -1.0
    _stuck_value: float | None = None

    def set_scenario(self, name: str) -> None:
        if name not in SCENARIOS:
            raise ValueError(f"unknown scenario {name}")
        self.scenario, self.scenario_t, self._stuck_value = name, 0.0, None

    def step(self, dt: float = 2.0) -> dict:
        self.t += dt
        self.scenario_t += dt
        r = self.rng

        # slow "day" cycle (compressed to 10 minutes so it shows in a demo) + sensor noise
        cycle = math.sin(2 * math.pi * self.t / 600.0)
        temp = self.base_temp + 1.5 * cycle + r.gauss(0, 0.15)
        hum = self.base_hum - 4.0 * cycle + r.gauss(0, 0.6)
        gas = self.base_gas + 8.0 * cycle + r.gauss(0, 4.0)
        pir = False

        s, st = self.scenario, self.scenario_t
        if s == "gas_leak":
            # exponential rise: slow at first (the model should catch it early), saturates around +900 ppm
            gas += 900.0 * (1 - math.exp(-st / 90.0))
            hum += 2.0 * (1 - math.exp(-st / 120.0))
        elif s == "overheat":
            # the brief's example: slow temperature rise correlated with a gas micro-deviation
            temp += 0.05 * st
            gas += 0.35 * st + r.gauss(0, 2.0)
            hum -= 0.03 * st
        elif s == "intruder":
            if self.t > self._pir_until and r.random() < 0.35:
                self._pir_until = self.t + r.uniform(2, 8)
        elif s == "sensor_fault":
            if self._stuck_value is None:
                self._stuck_value = temp
            temp = self._stuck_value                       # stuck DHT22
            if r.random() < 0.15:
                gas += r.choice([-1, 1]) * r.uniform(300, 600)  # erratic MQ-2 spikes

        if s == "normal" and r.random() < 0.01:            # rare legit motion (staff, animals)
            self._pir_until = self.t + 2
        pir = self.t <= self._pir_until

        return {
            "temp_c": round(temp, 2),
            "hum_pct": round(min(max(hum, 0.0), 100.0), 1),
            "gas_ppm": round(max(gas, 0.0), 1),
            "pir": pir,
        }
