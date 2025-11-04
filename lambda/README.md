# Lambda Functions - Auth/Wallet/CLI Services

## Structure

```
lambda/
├── auth_api_key_authorizer/    # API Gateway Authorizer
│   ├── index.js
│   └── package.json
├── auth_service/                # Auth Service (issue/revoke/rotate tokens)
│   ├── index.js
│   └── package.json
├── wallet_service/             # Wallet Service (key management, signing)
│   ├── index.js
│   └── package.json
├── cli_service/                 # CLI as a Service (simplified endpoints)
│   ├── index.js
│   └── package.json
└── README.md                    # This file
```

## Deployment

### Build & Package

```bash
# Authorizer
cd lambda/auth_api_key_authorizer
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

### Deploy to AWS

```bash
# Authorizer
aws lambda create-function \
  --function-name loglineos-auth-api-key-authorizer \
  --runtime nodejs18.x \
  --role <execution-role-arn> \
  --handler index.handler \
  --zip-file fileb://authorizer.zip \
  --environment Variables="{
    TOKENS_TABLE=auth_api_tokens,
    TOKENS_PEPPER_SECRET_ARN=arn:aws:secretsmanager:...:secret:auth_pepper,
    WALLETS_TABLE=wallets,
    AWS_REGION=us-east-1
  }"

# Wallet Service
aws lambda create-function \
  --function-name loglineos-wallet-service \
  --runtime nodejs18.x \
  --role <execution-role-arn> \
  --handler index.handler \
  --zip-file fileb://wallet.zip \
  --environment Variables="{
    WALLETS_TABLE=wallets,
    NONCE_TABLE=nonces,
    AWS_REGION=us-east-1
  }"

# CLI Service
aws lambda create-function \
  --function-name loglineos-cli-service \
  --runtime nodejs18.x \
  --role <execution-role-arn> \
  --handler index.handler \
  --zip-file fileb://cli.zip \
  --environment Variables="{
    STAGE0_FUNCTION_NAME=loglineos-stage0-loader,
    WALLET_SERVICE_URL=https://api.example.com/dev,
    AWS_REGION=us-east-1
  }"
```

## Environment Variables

### Authorizer
- `TOKENS_TABLE` - DynamoDB table for tokens
- `TOKENS_PEPPER_SECRET_ARN` - Secrets Manager ARN for pepper
- `WALLETS_TABLE` - DynamoDB table for wallets (optional)
- `AWS_REGION` - AWS region

### Auth Service
- `TOKENS_TABLE` - DynamoDB table for tokens
- `TOKENS_PEPPER_SECRET_ARN` - Secrets Manager ARN for pepper
- `AWS_REGION` - AWS region

### Wallet Service
- `WALLETS_TABLE` - DynamoDB table for wallets
- `NONCE_TABLE` - DynamoDB table for nonces
- `AWS_REGION` - AWS region

### CLI Service
- `STAGE0_FUNCTION_NAME` - Stage-0 Lambda function name
- `WALLET_SERVICE_URL` - Wallet Service API Gateway URL
- `AWS_REGION` - AWS region

## IAM Permissions

### Authorizer
- `dynamodb:GetItem` on `auth_api_tokens`
- `secretsmanager:GetSecretValue` on pepper secret
- `dynamodb:GetItem` on `wallets` (optional)

### Auth Service
- `dynamodb:PutItem`, `UpdateItem`, `Query` on `auth_api_tokens`
- `secretsmanager:GetSecretValue` on pepper secret

### Wallet Service
- `dynamodb:GetItem` on `wallets`
- `dynamodb:PutItem` on `nonces` (if using)
- `secretsmanager:GetSecretValue` on key secrets
- `kms:Decrypt` (if using KMS)

### CLI Service
- `lambda:InvokeFunction` on Stage-0
- Network access to Wallet Service (if via API Gateway)

## Testing

See `BLUEPRINT4_AUTH_WALLET_CLI.md` section 7 for cURL examples.

