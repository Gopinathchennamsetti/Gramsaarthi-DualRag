#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <s3-bucket-name> <cloudfront-distribution-id>"
  exit 1
fi

S3_BUCKET="$1"
CF_DIST_ID="$2"

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR/frontend"

npm ci
npm run build

aws s3 sync dist/ "s3://${S3_BUCKET}" --delete
aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths "/*"

echo "Frontend deployed to s3://${S3_BUCKET} and CloudFront invalidated"
