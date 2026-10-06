"""Argus smoke test: a TLS echo server the simulated ESP32 connects to.

Run:  .venv/Scripts/python tools/smoke_tls_server.py
"""
import socket
import ssl
from pathlib import Path

CERTS = Path(__file__).parent / "smoke-certs"
HOST, PORT = "127.0.0.1", 8883

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.minimum_version = ssl.TLSVersion.TLSv1_2
ctx.load_cert_chain(CERTS / "server.crt", CERTS / "server.key")

with socket.create_server((HOST, PORT)) as srv:
    print(f"[server] TLS listening on {HOST}:{PORT}, waiting for the Wokwi ESP32...")
    while True:
        conn, addr = srv.accept()
        try:
            with ctx.wrap_socket(conn, server_side=True) as tls:
                line = tls.makefile("r").readline().strip()
                print(f"[server] {addr} {tls.version()} {tls.cipher()[0]} -> {line}")
                tls.sendall(b'{"status":"ack","from":"argus-outpost"}\n')
        except (ssl.SSLError, OSError) as e:
            print(f"[server] {addr} handshake/IO error: {e}")
