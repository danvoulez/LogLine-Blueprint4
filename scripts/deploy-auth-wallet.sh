#!/bin/bash
set -e

# Deploy Auth & Wallet System to AWS
# Usage: ./scripts/deploy-auth-wallet.sh [environment]

ENVIRONMENT=${1:-dev}
AWS_REGION=${AWS_REGION:-us-east-1}

echo "🚀 Deploying LogLineOS Auth & Wallet System"
echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo ""

# Check AWS credentials
if ! aws sts get-caller-identity > /dev/null 2>&1; then
  echo "❌ AWS credentials not configured. Run 'aws configure' first."
  exit 1
fi

echo "✅ AWS credentials configured"
echo ""

# Step 1: Create DynamoDB tables
echo "📦 Step 1: Creating DynamoDB tables..."
cd terraform

terraform init
terraform plan -var="environment=$ENVIRONMENT" -out=tfplan
terraform apply tfplan

echo "✅ DynamoDB tables created"
echo ""

# Step 2: Create secrets
echo "🔐 Step 2: Creating secrets..."

# Generate pepper if doesn't exist
PEPPER_SECRET_NAME="loglineos-token-pepper"
if ! aws secretsmanager describe-secret --secret-id "$PEPPER_SECRET_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
  PEPPER=$(openssl rand -hex 64)
  aws secretsmanager create-secret \
    --name "$PEPPER_SECRET_NAME" \
    --secret-string "{\"pepper\":\"$PEPPER\"}" \
    --region "$AWS_REGION" \
    --description "Pepper for token hashing"
  echo "✅ Created token pepper secret"
else
  echo "✅ Token pepper secret already exists"
fi

# Get pepper ARN
PEPPER_ARN=$(aws secretsmanager describe-secret --secret-id "$PEPPER_SECRET_NAME" --region "$AWS_REGION" --query 'ARN' --output text)
echo "   Pepper ARN: $PEPPER_ARN"
echo ""

# Step 3: Build and deploy Lambdas
echo "⚙️  Step 3: Building and deploying Lambdas..."

cd ..

# Function to deploy Lambda
deploy_lambda() {
  local FUNCTION_NAME=$1
  local LAMBDA_DIR=$2
  local HANDLER=${3:-index.handler}
  
  echo "   Deploying $FUNCTION_NAME..."
  
  cd "$LAMBDA_DIR"
  
  # Install dependencies
  if [ -f "package.json" ]; then
    npm install --production
  fi
  
  # Create zip
  zip -r "../${FUNCTION_NAME}.zip" . -x "*.git*" "*.md" "*.test.js" "node_modules/.cache/*"
  
  cd ..
  
  # Check if function exists
  if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
    # Update existing
    aws lambda update-function-code \
      --function-name "$FUNCTION_NAME" \
      --zip-file "fileb://${FUNCTION_NAME}.zip" \
      --region "$AWS_REGION" > /dev/null
    
    echo "   ✅ Updated $FUNCTION_NAME"
  else
    echo "   ⚠️  Function $FUNCTION_NAME doesn't exist. Create it manually first:"
    echo "      aws lambda create-function --function-name $FUNCTION_NAME --runtime nodejs18.x --role <ROLE_ARN> --handler $HANDLER --zip-file fileb://${FUNCTION_NAME}.zip"
  fi
  
  rm -f "${FUNCTION_NAME}.zip"
}

# Deploy all Lambdas
deploy_lambda "loglineos-auth-service" "lambda/auth_service"
deploy_lambda "loglineos-wallet-service" "lambda/wallet_service"
deploy_lambda "loglineos-cli-service" "lambda/cli_service"
deploy_lambda "loglineos-auth-authorizer" "lambda/auth_api_key_authorizer"
deploy_lambda "loglineos-onboard-agent" "lambda/onboard_agent"
deploy_lambda "loglineos-email-service" "lambda/email_service"

echo "✅ Lambdas deployed"
echo ""

# Step 4: Update Lambda environment variables
echo "📝 Step 4: Updating Lambda environment variables..."

# Auth Service
aws lambda update-function-configuration \
  --function-name "loglineos-auth-service" \
  --environment "Variables={
    TOKENS_TABLE=auth_api_tokens,
    TOKENS_PEPPER_SECRET_ARN=$PEPPER_ARN,
    AWS_REGION=$AWS_REGION,
    API_GATEWAY_URL=https://api.example.com/$ENVIRONMENT,
    BOOTSTRAP_TOKEN=<BOOTSTRAP_TOKEN>
  }" \
  --region "$AWS_REGION" > /dev/null

# Wallet Service
aws lambda update-function-configuration \
  --function-name "loglineos-wallet-service" \
  --environment "Variables={
    WALLETS_TABLE=wallets,
    NONCE_TABLE=nonces,
    AWS_REGION=$AWS_REGION
  }" \
  --region "$AWS_REGION" > /dev/null

# CLI Service
aws lambda update-function-configuration \
  --function-name "loglineos-cli-service" \
  --environment "Variables={
    STAGE0_FUNCTION_NAME=loglineos-stage0-loader,
    AWS_REGION=$AWS_REGION,
    API_GATEWAY_URL=https://api.example.com/$ENVIRONMENT
  }" \
  --region "$AWS_REGION" > /dev/null

# Authorizer
aws lambda update-function-configuration \
  --function-name "loglineos-auth-authorizer" \
  --environment "Variables={
    TOKENS_TABLE=auth_api_tokens,
    TOKENS_PEPPER_SECRET_ARN=$PEPPER_ARN,
    WALLETS_TABLE=wallets,
    AWS_REGION=$AWS_REGION
  }" \
  --region "$AWS_REGION" > /dev/null

# Onboard Agent
aws lambda update-function-configuration \
  --function-name "loglineos-onboard-agent" \
  --environment "Variables={
    API_GATEWAY_URL=https://api.example.com/$ENVIRONMENT,
    BOOTSTRAP_TOKEN=<BOOTSTRAP_TOKEN>,
    AWS_REGION=$AWS_REGION
  }" \
  --region "$AWS_REGION" > /dev/null

# Email Service
aws lambda update-function-configuration \
  --function-name "loglineos-email-service" \
  --environment "Variables={
    SES_REGION=$AWS_REGION,
    FROM_EMAIL=noreply@loglineos.com,
    VERIFICATION_TABLE=email_verifications,
    VERIFICATION_BASE_URL=https://app.loglineos.com,
    AWS_REGION=$AWS_REGION
  }" \
  --region "$AWS_REGION" > /dev/null

# Update Auth Service with all environment variables
aws lambda update-function-configuration \
  --function-name "loglineos-auth-service" \
  --environment "Variables={
    TOKENS_TABLE=auth_api_tokens,
    TOKENS_PEPPER_SECRET_ARN=$PEPPER_ARN,
    WALLETS_TABLE=wallets,
    MAGIC_LINKS_TABLE=magic_links,
    AWS_REGION=$AWS_REGION,
    API_GATEWAY_URL=https://api.example.com/$ENVIRONMENT,
    BOOTSTRAP_TOKEN=<BOOTSTRAP_TOKEN>,
    EMAIL_SERVICE_URL=https://api.example.com/$ENVIRONMENT
  }" \
  --region "$AWS_REGION" > /dev/null

echo "✅ Environment variables updated"
echo ""

# Step 5: Summary
echo "📊 Deployment Summary"
echo "════════════════════════════════════════════════════════════"
echo "✅ DynamoDB Tables:"
echo "   - auth_api_tokens"
echo "   - wallets"
echo "   - nonces"
echo "   - email_verifications"
echo "   - magic_links"
echo ""
echo "✅ Secrets:"
echo "   - loglineos-token-pepper ($PEPPER_ARN)"
echo ""
echo "✅ Lambdas:"
echo "   - loglineos-auth-service"
echo "   - loglineos-wallet-service"
echo "   - loglineos-cli-service"
echo "   - loglineos-auth-authorizer"
echo "   - loglineos-onboard-agent"
echo "   - loglineos-email-service"
echo ""
echo "⚠️  Next Steps:"
echo "   1. Create IAM roles for Lambdas (if not exists)"
echo "   2. Configure API Gateway with Authorizer"
echo "   3. Update API_GATEWAY_URL in environment variables"
echo "   4. Set BOOTSTRAP_TOKEN for initial admin access"
echo "   5. Test with: node scripts/test-auth-flow.js"
echo ""
echo "✅ Deployment complete!"

