#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/dualrag_app_web"
REPO_URL="${1:-}"
BRANCH="${2:-main}"

if [[ -z "$REPO_URL" ]]; then
  echo "Usage: $0 <repo-url> [branch]"
  exit 1
fi

sudo apt-get update -y
sudo apt-get install -y python3.11 python3.11-venv python3-pip git nginx awscli

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo mkdir -p /opt
  sudo chown -R ubuntu:ubuntu /opt
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
fi

cd "$APP_DIR"
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt -r backend/requirements_pipeline.txt

sudo cp deploy/aws/dualrag-backend.service /etc/systemd/system/dualrag-backend.service
sudo cp deploy/aws/nginx-dualrag.conf /etc/nginx/sites-available/dualrag-backend
sudo ln -sf /etc/nginx/sites-available/dualrag-backend /etc/nginx/sites-enabled/dualrag-backend
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable dualrag-backend
sudo systemctl restart dualrag-backend
sudo systemctl restart nginx

echo "EC2 bootstrap complete"
