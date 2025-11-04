# 🚀 Deploy Guide - Auth & Wallet System

## Prerequisites

1. **AWS CLI** configured (`aws configure`)
2. **Terraform** installed (`brew install terraform` or [terraform.io](https://terraform.io))
3. **Node.js 18+** installed
4. **IAM permissions** to create:
   - DynamoDB tables
   - Lambda functions
   - Secrets Manager secrets
   - IAM roles/policies

## Quick Deploy

```bash
# 1. Setup IAM roles
chmod +x scripts/setup-iam-roles.sh
./scripts/setup-iam-roles.sh

# 2. Deploy everything
chmod +x scripts/deploy-auth-wallet.sh
./scripts/deploy-auth-wallet.sh dev
```

## Step-by-Step Manual Deploy

### Step 1: Create DynamoDB Tables

```bash
cd terraform
terraform init
terraform plan -var="environment=dev"
terraform apply
cd ..
```

**Tables created:**
- `auth_api_tokens` (PK: token_hash, GSI: wallet_id)
- `wallets` (PK: wallet_id)
- `nonces` (PK: k, TTL enabled)

### Step 2: Create Secrets

```bash
# Generate and create pepper
PEPPER=$(openssl rand -hex 64)
aws secretsmanager create-secret \
  --name loglineos-token-pepper \
  --secret-string "{\"pepper\":\"$PEPPER\"}" \
  --region us-east-1 \
  --description "Pepper for token hashing (Argon2id)"
```

### Step 3: Create IAM Roles

```bash
chmod +x scripts/setup-iam-roles.sh
./scripts/setup-iam-roles.sh
```

**Roles created:**
- `loglineos-auth-service-role`
- `loglineos-wallet-service-role`
- `loglineos-cli-service-role`
- `loglineos-auth-authorizer-role`
- `loglineos-onboard-agent-role`

### Step 4: Build and Deploy Lambdas

```bash
# Auth Service
cd lambda/auth_service
npm install --production
zip -r ../../auth-service.zip . -x "*.git*" "*.md"
aws lambda create-function \
  --function-name loglineos-auth-service \
  --runtime nodejs18.x \
  --role arn:aws:iam::ACCOUNT_ID:role/loglineos-auth-service-role \
  --handler index.handler \
  --zip-file fileb://../../auth-service.zip \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={
    TOKENS_TABLE=auth_api_tokens,
    TOKENS_PEPPER_SECRET_ARN=arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:loglineos-token-pepper-XXXXX,
    AWS_REGION=us-east-1
  }"
cd ../..

# Repeat for other Lambdas...
```

**Or use the deploy script:**
```bash
./scripts/deploy-auth-wallet.sh dev
```

### Step 5: Configure API Gateway

1. **Create REST API** (if not exists)
2. **Attach Authorizer** to protected routes:
   ```bash
   aws apigateway create-authorizer \
     --rest-api-id YOUR_API_ID \
     --name loglineos-auth-authorizer \
     --type REQUEST \
     --authorizer-uri arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:ACCOUNT_ID:function:loglineos-auth-authorizer/invocations \
     --identity-source method.request.header.Authorization \
     --authorizer-result-ttl-in-seconds 60
   ```

3. **Configure routes:**
   - `/auth/*` → Auth Service
   - `/wallet/*` → Wallet Service (with Authorizer)
   - `/cli/*` → CLI Service (with Authorizer)
   - `/api/spans` → Stage-0 or API handler (with Authorizer)

### Step 6: Create Bootstrap Token

```bash
# Create first admin wallet manually
aws dynamodb put-item \
  --table-name wallets \
  --item '{
    "wallet_id": {"S": "wlt_admin_bootstrap"},
    "owner_id": {"S": "admin@system"},
    "tenant_id": {"S": "system"},
    "status": {"S": "active"},
    "created_at": {"N": "'$(date +%s)'"},
    "items": {}
  }'

# Issue bootstrap token (via API or manually)
curl -X POST "https://YOUR_API.execute-api.us-east-1.amazonaws.com/dev/auth/keys/issue" \
  -H "Authorization: x-bootstrap-admin" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id": "wlt_admin_bootstrap",
    "tenant_id": "system",
    "scopes": ["wallet.open", "auth.keys.issue", "cli.app.register"],
    "ttl_hours": 8760,
    "description": "Bootstrap admin token"
  }'
```

## Post-Deploy Testing

```bash
# Test auth flow
export API_GATEWAY_URL="https://YOUR_API.execute-api.us-east-1.amazonaws.com/dev"
export ADMIN_TOKEN="tok_live_..."  # Bootstrap token
node scripts/test-auth-flow.js
```

## Environment Variables Reference

### Auth Service
- `TOKENS_TABLE` - DynamoDB table name
- `TOKENS_PEPPER_SECRET_ARN` - ARN do secret do pepper
- `AWS_REGION` - AWS region
- `API_GATEWAY_URL` - Base URL do API Gateway (opcional)
- `BOOTSTRAP_TOKEN` - Token para emitir spans (opcional)

### Wallet Service
- `WALLETS_TABLE` - DynamoDB table name
- `NONCE_TABLE` - DynamoDB table name
- `AWS_REGION` - AWS region

### CLI Service
- `STAGE0_FUNCTION_NAME` - Nome da Lambda Stage-0
- `AWS_REGION` - AWS region
- `API_GATEWAY_URL` - Base URL do API Gateway

### Authorizer
- `TOKENS_TABLE` - DynamoDB table name
- `TOKENS_PEPPER_SECRET_ARN` - ARN do secret do pepper
- `WALLETS_TABLE` - DynamoDB table name (opcional)
- `AWS_REGION` - AWS region

### Onboard Agent
- `API_GATEWAY_URL` - Base URL do API Gateway
- `BOOTSTRAP_TOKEN` - Token para armazenar spans
- `AWS_REGION` - AWS region

## Troubleshooting

### Lambda timeout
- Increase timeout: `aws lambda update-function-configuration --function-name NAME --timeout 60`

### Permission denied
- Check IAM role policies
- Verify Secrets Manager access
- Check DynamoDB table permissions

### Authorizer not working
- Verify Authorizer is attached to route
- Check `identity_source` is `method.request.header.Authorization`
- Verify Lambda permissions for API Gateway

### Token not found
- Check DynamoDB table has token
- Verify pepper secret is correct
- Check token expiration

## Cleanup

```bash
# Delete tables
terraform destroy

# Delete secrets
aws secretsmanager delete-secret --secret-id loglineos-token-pepper --force-delete-without-recovery

# Delete Lambdas
aws lambda delete-function --function-name loglineos-auth-service
aws lambda delete-function --function-name loglineos-wallet-service
# ... repeat for all functions
```

---

**Status:** Ready for deployment  
**Last Updated:** 2025-11-04

