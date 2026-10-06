"""Build docs/report/dossier.html into Workshop2026-M1-G<n>-Dossier.pdf with headless Edge/Chrome.

    python tools/build_report.py --group 7 --team "Nom 1, Nom 2, ..."
"""
import argparse
import datetime
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs/report"
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "google-chrome", "chromium", "msedge",
]

ap = argparse.ArgumentParser()
ap.add_argument("--group", default="<n>", help="group number given by the coaches")
ap.add_argument("--team", default="à compléter", help="member names, comma separated")
ap.add_argument("--version", default="v1.0")
a = ap.parse_args()

browser = next((b for b in BROWSERS if Path(b).exists() or shutil.which(b)), None)
if not browser:
    raise SystemExit("no Chrome/Edge found")

with tempfile.TemporaryDirectory() as tmp:
    html = (SRC / "dossier.html").read_text(encoding="utf-8")
    for k, v in {"{{GROUP}}": f"G{a.group}", "{{TEAM}}": a.team, "{{VERSION}}": a.version,
                 "{{DATE}}": datetime.date.today().strftime("%d/%m/%Y")}.items():
        html = html.replace(k, v)
    page = Path(tmp) / "dossier.html"
    page.write_text(html, encoding="utf-8")
    shutil.copy(SRC / "report.css", Path(tmp) / "report.css")
    out = ROOT / "docs" / f"Workshop2026-M1-G{a.group}-Dossier.pdf"
    subprocess.run([browser, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={out}", page.as_uri()], check=True, capture_output=True, timeout=120)
print(f"written {out}")
