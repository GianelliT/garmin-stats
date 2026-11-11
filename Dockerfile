FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Utilisateur non-root ; /data contient garmin.db et fit_files/ (les scripts utilisent des chemins relatifs)
RUN useradd --create-home --uid 1000 app \
 && mkdir -p /data /home/app/.config/garmin \
 && chown -R app:app /data /home/app/.config

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt gunicorn

COPY . .

USER app
WORKDIR /data
EXPOSE 4999

# 1 seul worker : l'état de la synchro (syncer.py) vit en mémoire dans le processus
CMD ["gunicorn", "--pythonpath", "/app", "--bind", "0.0.0.0:4999", \
     "--workers", "1", "--threads", "4", "--timeout", "120", "app:app"]
