FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY decoy.py .
RUN useradd --uid 10003 --no-create-home --shell /usr/sbin/nologin decoy
USER 10003
EXPOSE 1883 2323
CMD ["python", "decoy.py"]
