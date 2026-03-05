# AWS Deployment Guide (us-east-1, Free-tier Friendly)

## Architecture
- Frontend: S3 (private) + CloudFront
- Backend: EC2 (free-tier eligible) + Nginx + Uvicorn
- Cache metadata: DynamoDB table

## 1) Create DynamoDB table
```bash
aws dynamodb create-table \
  --region us-east-1 \
  --table-name dualrag_reports \
  --attribute-definitions AttributeName=hash_key,AttributeType=S \
  --key-schema AttributeName=hash_key,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

## 2) Create S3 bucket for frontend
Bucket name must be globally unique.
```bash
aws s3api create-bucket --bucket <YOUR_BUCKET_NAME> --region us-east-1
aws s3api put-public-access-block \
  --bucket <YOUR_BUCKET_NAME> \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## 3) Create CloudFront distribution
- Origin 1: S3 bucket (with OAC)
- Origin 2: EC2 public DNS for `/api/*` behavior
- Default root object: `index.html`

## 4) Launch EC2 instance (t2.micro / t3.micro free-tier eligible)
- AMI: Ubuntu 22.04
- Key pair: `gramsaarthidualrag`
- Security Group inbound:
  - 22 from your current IP only
  - 80 from 0.0.0.0/0
  - 443 from 0.0.0.0/0 (if using TLS later)

Find your IP:
```bash
curl https://checkip.amazonaws.com
```

## 5) Bootstrap EC2
SSH into EC2 and run:
```bash
cd /tmp
curl -O https://raw.githubusercontent.com/<YOUR_GITHUB_USER>/<YOUR_REPO>/main/deploy/aws/bootstrap-ec2.sh
chmod +x bootstrap-ec2.sh
./bootstrap-ec2.sh https://github.com/<YOUR_GITHUB_USER>/<YOUR_REPO>.git main
```

## 6) Backend env vars on EC2
In `/opt/dualrag_app_web/backend/.env` ensure these exist:
```env
AWS_REGION=us-east-1
CACHE_BACKEND=hybrid
DYNAMODB_TABLE=dualrag_reports
```
Keep your existing LLM keys here too.

Restart backend:
```bash
sudo systemctl restart dualrag-backend
sudo systemctl status dualrag-backend --no-pager
```

## 7) GitHub Secrets for CI/CD
Set in repository settings:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`
- `EC2_HOST` (public IPv4 or DNS)
- `EC2_SSH_PRIVATE_KEY` (contents of your private key)

Workflow file:
- `.github/workflows/deploy-aws.yml`

## 8) Cost guardrails (important)
- Do **not** create NAT Gateway.
- Do **not** use ALB for now.
- Keep EC2 as single instance.
- Keep CloudFront invalidations minimal (usually `/*` on deploy only).
- Use DynamoDB `PAY_PER_REQUEST`.
