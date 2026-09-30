#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo "  InfraLab — Self-Hosted Docker Deployment"
echo "========================================================"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/"
  exit 1
fi

if [ ! -f .env ]; then
  echo "[INFO] Creating default .env configuration..."
  RAND_KEY=$(openssl rand -hex 24 2>/dev/null || echo "infralab-aes256-gcm-master-secret-key-2026")
  RAND_PG=$(openssl rand -hex 12 2>/dev/null || echo "infralab_secret")
  cat > .env <<EOF
APP_PORT=3000
POSTGRES_USER=infralab
POSTGRES_PASSWORD=${RAND_PG}
POSTGRES_DB=infralab
ENCRYPTION_KEY=${RAND_KEY}
PROMETHEUS_RETENTION=15d
VITE_GOOGLE_MAPS_API_KEY=
EOF
  echo "[OK] Generated .env with random PostgreSQL password and AES-256-GCM encryption key."
fi

echo "[INFO] Building and starting InfraLab stack (PostgreSQL + Prometheus + InfraLab App & Agent)..."
docker compose up -d --build

echo ""
echo "========================================================"
echo "  InfraLab is running!"
echo "  Web UI & API:        http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):3000"
echo "  Prometheus TSDB:     http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):9090"
echo "  Linux Agent Binary:  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):3000/downloads/infralab-agent"
echo "========================================================"
