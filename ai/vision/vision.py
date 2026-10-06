"""ARGUS vision: USB webcam -> person detection -> restricted-zone alerts + annotated MJPEG stream.

    python ai/vision/vision.py --api https://192.168.10.10/api/v1/alerts --ca infra/pki/out/ca.crt \\
        --token-file infra/runtime/secrets/vision_token

- Frames are captured at 640x480 (brief: < 100 ms per frame); the processing time is drawn on screen.
- Detector: YOLOv8n (ultralytics) if installed, else OpenCV HOG people detector (no GPU, no download).
- Privacy by design (GDPR): the head area of every detected person is blurred *before* the frame is
  streamed or shown. Raw frames never leave this process and nothing is recorded.
- A person whose feet are inside the restricted polygon raises an intrusion alert (debounced).
- Annotated stream: http://127.0.0.1:8081/stream.mjpg (localhost only), shown by the dashboard.
"""
from __future__ import annotations

import argparse
import json
import logging
import ssl
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger("vision")
W, H = 640, 480
# restricted zone, normalised (x, y) in [0, 1]: the lower-right half of the frame by default
DEFAULT_ZONE = [(0.45, 0.35), (1.0, 0.35), (1.0, 1.0), (0.3, 1.0)]
INK, ALERT, OK = (53, 42, 27), (91, 24, 194), (91, 125, 46)  # BGR versions of the dashboard palette


# ------------------------------------------------------------------ detectors
class YoloDetector:
    name = "YOLOv8n"

    def __init__(self, weights: str, conf: float):
        from ultralytics import YOLO  # optional heavy dependency
        self.model, self.conf = YOLO(weights), conf

    def __call__(self, frame) -> list[tuple[int, int, int, int, float]]:
        r = self.model.predict(frame, imgsz=W, conf=self.conf, classes=[0], verbose=False)[0]
        return [(*map(int, b.xyxy[0].tolist()), float(b.conf[0])) for b in r.boxes]


class HogDetector:
    name = "OpenCV HOG"

    def __init__(self, conf: float):
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        self.conf = conf

    def __call__(self, frame):
        rects, weights = self.hog.detectMultiScale(frame, winStride=(8, 8), padding=(8, 8), scale=1.05)
        return [(x, y, x + w, y + h, float(s)) for (x, y, w, h), s in zip(rects, np.ravel(weights)) if s >= self.conf]


# ------------------------------------------------------------------ helpers
def in_zone(box, zone_px: np.ndarray) -> bool:
    x1, _, x2, y2 = box[:4]
    feet = (float((x1 + x2) / 2), float(y2))
    return cv2.pointPolygonTest(zone_px, feet, False) >= 0


def blur_heads(frame, boxes) -> None:
    """Pixelate the top ~22% of each person box (head and face), in place."""
    for x1, y1, x2, y2, _ in boxes:
        hy = y1 + max(12, int((y2 - y1) * 0.22))
        x1, y1, x2, hy = max(0, x1), max(0, y1), min(W, x2), min(H, hy)
        roi = frame[y1:hy, x1:x2]
        if roi.size:
            small = cv2.resize(roi, (max(1, roi.shape[1] // 12), max(1, roi.shape[0] // 12)))
            frame[y1:hy, x1:x2] = cv2.resize(small, (roi.shape[1], roi.shape[0]), interpolation=cv2.INTER_NEAREST)


class Alerter:
    def __init__(self, url: str | None, token: str, ca: str | None, node: str, debounce_s: float = 10):
        self.url, self.token, self.node, self.debounce_s = url, token, node, debounce_s
        self.ctx = ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()
        self.last = 0.0

    def person_in_zone(self, count: int, best_conf: float) -> None:
        if not self.url or time.monotonic() - self.last < self.debounce_s:
            return
        self.last = time.monotonic()
        body = {"source": "vision", "category": "intrusion", "severity": "warning", "kind": "person_in_zone",
                "message": f"{count} person(s) in the restricted zone (camera)",
                "data": {"node": self.node, "count": count, "confidence": round(best_conf, 2)}}
        threading.Thread(target=self._post, args=(body,), daemon=True).start()

    def _post(self, body: dict) -> None:
        req = urllib.request.Request(self.url, json.dumps(body).encode(),
                                     {"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"})
        try:
            urllib.request.urlopen(req, timeout=3, context=self.ctx)
            log.info("alert sent: %s", body["message"])
        except Exception as e:
            log.error("alert failed: %s", e)


class Stream:
    """Latest annotated JPEG, served as MJPEG to the dashboard (localhost only)."""

    def __init__(self):
        self.jpeg, self.cond = b"", threading.Condition()

    def publish(self, frame) -> None:
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            with self.cond:
                self.jpeg = buf.tobytes()
                self.cond.notify_all()

    def serve(self, port: int) -> None:
        stream = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if not self.path.startswith("/stream.mjpg"):
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                try:
                    while True:
                        with stream.cond:
                            stream.cond.wait(timeout=2)
                            jpeg = stream.jpeg
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *_):
                pass

        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        log.info("annotated stream on http://127.0.0.1:%d/stream.mjpg", port)


def annotate(frame, boxes, zone_px, intruders, ms, detector_name) -> None:
    cv2.polylines(frame, [zone_px.astype(np.int32)], True, ALERT if intruders else INK, 2)
    cv2.putText(frame, "restricted zone", (int(zone_px[0][0]) + 6, int(zone_px[0][1]) + 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, INK, 1, cv2.LINE_AA)
    for b in boxes:
        hit = in_zone(b, zone_px)
        cv2.rectangle(frame, b[:2], b[2:4], ALERT if hit else OK, 2)
        cv2.putText(frame, f"person {b[4]:.2f}", (b[0], max(14, b[1] - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    ALERT if hit else OK, 1, cv2.LINE_AA)
    color = OK if ms < 100 else ALERT
    cv2.putText(frame, f"{detector_name}  {ms:.0f} ms/frame  faces blurred", (8, H - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--camera", default="0", help="camera index or video file")
    ap.add_argument("--api", help="POST /api/v1/alerts URL (omit for offline mode)")
    ap.add_argument("--token-file", help="file holding the vision service token")
    ap.add_argument("--ca", help="ARGUS CA certificate to verify the API's TLS certificate")
    ap.add_argument("--node", default="sentinel-hero", help="node this camera is attached to (correlation)")
    ap.add_argument("--weights", default="yolov8n.pt")
    ap.add_argument("--conf", type=float, default=0.45)
    ap.add_argument("--hog", action="store_true", help="force the OpenCV HOG detector")
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--show", action="store_true", help="also open a local preview window")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s vision %(levelname)s %(message)s")

    detector = None
    if not args.hog:
        try:
            detector = YoloDetector(args.weights, args.conf)
        except ImportError:
            log.warning("ultralytics not installed: falling back to the OpenCV HOG detector")
    detector = detector or HogDetector(conf=0.5)

    token = Path(args.token_file).read_text().strip() if args.token_file else ""
    alerter = Alerter(args.api, token, args.ca, args.node)
    zone_px = np.array([(x * W, y * H) for x, y in DEFAULT_ZONE], dtype=np.float32)
    stream = Stream()
    stream.serve(args.port)

    cap = cv2.VideoCapture(int(args.camera) if args.camera.isdigit() else args.camera)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, H)
    if not cap.isOpened():
        raise SystemExit(f"cannot open camera {args.camera}")
    log.info("detector: %s, camera %s", detector.name, args.camera)

    while True:
        ok, frame = cap.read()
        if not ok:
            if not args.camera.isdigit():  # video file: loop it
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            time.sleep(0.1)
            continue
        t0 = time.perf_counter()
        frame = cv2.resize(frame, (W, H))
        boxes = detector(frame)
        blur_heads(frame, boxes)              # privacy first: before anything is drawn or streamed
        intruders = [b for b in boxes if in_zone(b, zone_px)]
        ms = (time.perf_counter() - t0) * 1000
        if intruders:
            alerter.person_in_zone(len(intruders), max(b[4] for b in intruders))
        annotate(frame, boxes, zone_px, intruders, ms, detector.name)
        stream.publish(frame)
        if args.show:
            cv2.imshow("ARGUS vision", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break


if __name__ == "__main__":
    main()
