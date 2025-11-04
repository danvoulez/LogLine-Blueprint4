# 🚀 Deploy Auth/Wallet/CLI Services - Quick Guide

## Prerequisites

1. DynamoDB tables created:
   - `auth_api_tokens` (PK: `token_hash`, GSI: `wallet_id`)
   - `wallets` (PK: `wallet_id`)
   - `nonces` (PK: `k`, TTL: `ttl`)

2. Secrets Manager secrets:
   - `auth_pepper` (JSON: `{"pepper":"<64-byte-hex>"}`)
   - Ed25519 keys (JSON: `{"private_key_hex":"<hex>"}`)
   - Provider API keys (JSON: `{"api_key":"<key>"}`)

3. RDS columns added (see `BLUEPRINT4_AUTH_WALLET_CLI.md` section 2.4)

## Build & Deploy

### 1. Build Packages

```bash
cd lambda

# Auth API Key Authorizer
cd auth_api_key_authorizer
npm install --production
zip -r ../../authorizer.zip . -x "*.git*" "*.md"

# Auth Service
cd ../auth_service
npm install --production
zip -r ../../auth.zip . -x "*.git*" "*.md"

# Wallet Service
cd ../wallet_service
npm install --production
zip -r ../../wallet.zip . -x "*.git*" "*.md"

# CLI Service
cd ../cli_service
npm install --production
zip -r ../../cli.zip . -x "*.git*" "*.md"
```

### 2. Deploy Lambda Functions

```bash
# Authorizer
aws lambda create-function \
  --function-name loglineos-auth-api-key-authorizer \
  --runtime nodejs18.x \
  --role arn:aws:iam::611572147468:role/loglineos-lambda-role \
  --handler index.handler \
  --zip-file fileb://authorizer.zip \
  --timeout 10 \
  --memory-size 256 \
  --environment Variables="{
    TOKENS_TABLE=auth_api_tokens,
    TOKENS_PEPPER_SECRET_ARN=arn:aws:secretsmanager:us-east-1:611572147468:secret:auth_pepper,
    WALLETS_TABLE=wallets,
    AWS_REGION=us-east-1
  }"

# Auth Service
aws lambda create-function \
  --function-name loglineos-auth-service \
  --runtime nodejs18.x \
  --role arn:aws:iam::611572147468:role/loglineos-lambda-role \
  --handler index.handler \
  --zip-file fileb://auth.zip \
  --timeout 30 \
  --memory-size 512 \
  --environment Variables="{
    TOKENS_TABLE=auth_api_tokens,
    TOKENS_PEPPER_SECRET_ARN=arn:aws:secretsmanager:us-east-1:611572147468:secret:auth_pepper,
    AWS_REGION=us-east-1
  }"

# Wallet Service
aws lambda create-function \
  --function-name loglineos-wallet-service \
  --runtime nodejs18.x \
  --role arn:aws:iam::611572147468:role/loglineos-lambda-role \
  --handler index.handler \
  --zip-file fileb://wallet.zip \
  --timeout 30 \
  --memory-size 512 \
  --environment Variables="{
    WALLETS_TABLE=wallets,
    NONCE_TABLE=nonces,
    AWS_REGION=us-east-1
  }"

# CLI Service
aws lambda create-function \
  --function-name loglineos-cli-service \
  --runtime nodejs18.x \
  --role arn:aws:iam::611572147468:role/loglineos-lambda-role \
  --handler index.handler \
  --zip-file fileb://cli.zip \
  --timeout 60 \
  --memory-size 512 \
  --environment Variables="{
    STAGE0_FUNCTION_NAME=loglineos-stage0-loader,
    WALLET_SERVICE_URL=https://api.example.com/dev,
    AWS_REGION=us-east-1
  }"
```

### 3. Configure API Gateway

```bash
# Create authorizer
aws apigateway create-authorizer \
  --rest-api-id <api-id> \
  --name ledger-auth-apikey \
  --type REQUEST \
  --authorizer-uri arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/$(aws lambda get-function --function-name loglineos-auth-api-key-authorizer --query 'Configuration.FunctionArn' --output text)/invocations \
  --identity-source method.request.header.Authorization \
  --authorizer-result-ttl-in-seconds 60

# Add permission for API Gateway to invoke authorizer
aws lambda add-permission \
  --function-name loglineos-auth-api-key-authorizer \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com
```

### 4. Create DynamoDB Tables

```bash
# auth_api_tokens
aws dynamodb create-table \
  --table-name auth_api_tokens \
  --attribute-definitions \
    AttributeName=token_hash,AttributeType=S \
    AttributeName=wallet_id,AttributeType=S \
  --key-schema \
    AttributeName=token_hash,KeyType=HASH \
  --global-secondary-indexes \
    IndexName=wallet_id-index,KeySchema=[{AttributeName=wallet_id,KeyType=HASH}],Projection={ProjectionType=ALL} \
  --billing-mode PAY_PER_REQUEST

# wallets
aws dynamodb create-table \
  --table-name wallets \
  --attribute-definitions \
    AttributeName=wallet_id,AttributeType=S \
  --key-schema \
    AttributeName=wallet_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# nonces
aws dynamodb create-table \
  --table-name nonces \
  --attribute-definitions \
    AttributeName=k,AttributeType=S \
  --key-schema \
    AttributeName=k,KeyType=HASH \
  --time-to-live-specification \
    AttributeName=ttl,Enabled=true \
  --billing-mode PAY_PER_REQUEST
```

### 5. Create Secrets

```bash
# Auth pepper
aws secretsmanager create-secret \
  --name auth_pepper \
  --secret-string "{\"pepper\":\"$(openssl rand -hex 64)\"}"

# Ed25519 key (example)
aws secretsmanager create-secret \
  --name ed25519_main \
  --secret-string "{\"private_key_hex\":\"$(openssl rand -hex 32)\"}"

# Anthropic API key (example)
aws secretsmanager create-secret \
  --name anthropic_api_key \
  --secret-string "{\"api_key\":\"sk-ant-...\"}"
```

## Initial Setup

### 1. Seed Wallet

```bash
aws dynamodb put-item \
  --table-name wallets \
  --item '{
    "wallet_id": {"S": "wlt_voulezvous_dan"},
    "owner_id": {"S": "dan@voulezvous"},
    "tenant_id": {"S": "voulezvous"},
    "items": {
      "M": {
        "kid_ed25519_main": {
          "M": {
            "type": {"S": "ed25519"},
            "pubkey_hex": {"S": "<hex>"},
            "secret_ref": {"S": "arn:aws:secretsmanager:us-east-1:611572147468:secret:ed25519_main"},
            "caps": {"L": [{"S": "sign.span"}, {"S": "sign.http"}]},
            "status": {"S": "active"}
          }
        },
        "kid_provider_anthropic": {
          "M": {
            "type": {"S": "provider_key"},
            "provider": {"S": "anthropic"},
            "secret_ref": {"S": "arn:aws:secretsmanager:us-east-1:611572147468:secret:anthropic_api_key"},
            "caps": {"L": [{"S": "provider.invoke:anthropic/*"}]},
            "status": {"S": "active"}
          }
        }
      }
    },
    "status": {"S": "active"},
    "created_at": {"N": "1730712345"}
  }'
```

### 2. Issue First Token (Admin)

```bash
curl -X POST https://api.example.com/dev/auth/keys/issue \
  -H "Authorization: ApiKey tok_admin_..." \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id": "wlt_voulezvous_dan",
    "tenant_id": "voulezvous",
    "scopes": ["wallet.open", "span.sign", "provider.invoke:anthropic/*", "prompt.fetch", "memory.*"],
    "ttl_hours": 720,
    "description": "Admin token"
  }'
```

## Testing

See `BLUEPRINT4_AUTH_WALLET_CLI.md` section 7 for complete cURL examples.

## IAM Permissions

Ensure Lambda execution role has:

- **Authorizer:** `dynamodb:GetItem`, `secretsmanager:GetSecretValue`
- **Auth Service:** `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:Query`, `secretsmanager:GetSecretValue`
- **Wallet Service:** `dynamodb:GetItem`, `dynamodb:PutItem`, `secretsmanager:GetSecretValue`, `kms:Decrypt`
- **CLI Service:** `lambda:InvokeFunction`

## Next Steps

1. Update Stage-0 to validate signatures
2. Add signature columns to RDS
3. Connect API Gateway routes
4. Test with cURLs from blueprint

