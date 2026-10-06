"""Tails the Mosquitto log and turns broker-level attacks into cyber events.

These never reach the pipeline as messages (the broker drops them), so the log is the only witness:
TLS handshakes without a valid cert, ACL denials, protocol garbage.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from pathlib import Path

from .pipeline import Pipeline

log = logging.getLogger("argus.logwatch")

RULES = [
    (re.compile(r"OpenSSL Error.*(certificate|handshake|alert)", re.I), "tls_rejected", "warning",
     "TLS handshake rejected (no valid client certificate)"),
    (re.compile(r"Client (\S+) disconnected, not authori[sz]ed", re.I), "not_authorized", "warning",
     "client not authorized"),
    # same certificate identity connecting twice: stolen cert / cloned node / session hijack
    (re.compile(r"Client (\S+) already connected, closing old connection", re.I), "session_takeover", "critical",
     "second connection with the same node identity (stolen certificate?)"),
    (re.compile(r"Denied PUBLISH from (\S+)", re.I), "acl_denied", "critical",
     "ACL denied a publish (node tried to write outside its topics)"),
    (re.compile(r"(protocol error|malformed packet)", re.I), "protocol_error", "warning",
     "MQTT protocol error (fuzzing / injection attempt?)"),
    (re.compile(r"New connection from (\S+?):\d+", re.I), None, None, None),  # remembered for context
]


class LogWatcher(threading.Thread):
    daemon = True

    def __init__(self, path: Path, pipeline: Pipeline):
        super().__init__(name="mosquitto-log")
        self.path, self.pipeline = path, pipeline
        self.last_ip: str | None = None

    def run(self) -> None:
        while True:  # the log may not exist yet or be unreadable for a moment: keep trying, never die
            try:
                self._follow()
            except OSError as e:
                log.error("cannot read %s (%s), retrying in 5 s", self.path, e)
                time.sleep(5)

    def _follow(self) -> None:
        while not self.path.exists():
            time.sleep(2)
        with self.path.open(errors="replace") as f:
            f.seek(0, 2)  # only new lines
            while True:
                line = f.readline()
                if not line:
                    time.sleep(0.3)
                    continue
                self.handle(line.strip())

    def handle(self, line: str) -> None:
        for rx, kind, severity, text in RULES:
            m = rx.search(line)
            if not m:
                continue
            if kind is None:
                self.last_ip = m.group(1)
                return
            who = m.group(1) if m.groups() and kind != "protocol_error" and kind != "tls_rejected" else None
            data = {"ip": self.last_ip, "line": line[-200:]}
            if who and who in self.pipeline.nodes:
                data["node"] = who
            self.pipeline.security_event(kind, severity, "broker", f"{text}" + (f" [{who}]" if who else ""), data)
            return
