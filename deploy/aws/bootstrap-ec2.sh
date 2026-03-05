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
sudo apt-get install -y python3 python3-venv python3-pip git nginx curl unzip

# Install AWS CLI v2 if missing (Ubuntu 24.04 repo may not include awscli package).
if ! command -v aws >/dev/null 2>&1; then
  cd /tmp
  curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip -q -o awscliv2.zip
  sudo ./aws/install --update
fi

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
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip

# Free-tier friendly install: avoid huge CUDA wheels and pip cache growth.
export PIP_NO_CACHE_DIR=1
pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision torchaudio
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements.txt -r backend/requirements_pipeline.txt

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
