# Build context: repository root (see infra/docker-compose.yml)
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
COPY services/api/requirements.txt services/api/requirements.txt
RUN pip install -r services/api/requirements.txt

COPY services/common services/common
COPY services/simulator/sensor_model.py services/simulator/sensor_model.py
COPY ai/anomaly ai/anomaly
# models are trained at build time from the simulator's physics (reproducible, no binaries in git)
RUN python ai/anomaly/train.py > /dev/null && rm -rf /root/.cache

COPY services/api/app services/api/app
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin argus
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health')"
CMD ["uvicorn", "app.main:app", "--app-dir", "services/api", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
