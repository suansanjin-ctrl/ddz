FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY . /app

CMD ["sh", "-c", "python3 server.py --port ${PORT:-8000}"]
