# Build context: repository root
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
RUN pip install "paho-mqtt>=2.1,<3"
COPY services/common services/common
COPY services/simulator services/simulator
RUN useradd --uid 10002 --no-create-home --shell /usr/sbin/nologin sim
USER 10002
WORKDIR /srv/services/simulator
CMD ["python", "fleet.py"]
