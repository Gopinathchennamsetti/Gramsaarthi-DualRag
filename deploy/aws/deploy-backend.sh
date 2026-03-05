#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/dualrag_app_web"
BRANCH="${1:-main}"

cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

source .venv/bin/activate
pip install -r backend/requirements.txt -r backend/requirements_pipeline.txt

sudo systemctl restart dualrag-backend
sudo systemctl status dualrag-backend --no-pager -n 30
