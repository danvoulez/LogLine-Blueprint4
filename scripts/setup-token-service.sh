#!/bin/bash
# Setup Token Service - One-time setup script
# Creates pepper secret and deploys token authorizer

set -e

# Configuration from AWS_INFRASTRUCTURE_INVENTORY.md
ACCOUNT_ID="611572147468"
REGION="us-east-1"
DB_SECRET_ARN="arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb"
PEPPER_SECRET_NAME="loglineos-token-pepper"
LAMBDA_ROLE_ARN="arn:aws:iam::611572147468:role/loglineos-lambda-role"
FUNCTION_NAME="loglineos-token-authorizer"

echo "🔐 Setting up LogLineOS Token Service..."
echo ""

# Step 1: Create Pepper Secret
echo "📝 Step 1: Creating pepper secret..."
PEPPER=$(openssl rand -hex 64)
PEPPER_JSON="{\"pepper\":\"$PEPPER\"}"

# Check if secret already exists
if aws secretsmanager describe-secret --secret-id "$PEPPER_SECRET_NAME" --region "$REGION" 2>/dev/null; then
    echo "⚠️  Secret $PEPPER_SECRET_NAME already exists. Updating..."
    aws secretsmanager update-secret \
        --secret-id "$PEPPER_SECRET_NAME" \
        --secret-string "$PEPPER_JSON" \
        --region "$REGION" > /dev/null
    echo "✅ Pepper secret updated"
else
    aws secretsmanager create-secret \
        --name "$PEPPER_SECRET_NAME" \
        --description "Token pepper for LogLineOS API tokens" \
        --secret-string "$PEPPER_JSON" \
        --region "$REGION" > /dev/null
    echo "✅ Pepper secret created"
fi

PEPPER_SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$PEPPER_SECRET_NAME" --region "$REGION" --query 'ARN' --output text)
echo "   ARN: $PEPPER_SECRET_ARN"
echo ""

# Step 2: Build Lambda Authorizer
echo "📦 Step 2: Building Lambda Authorizer package..."
cd lambda/authorizers
npm install --production
zip -r tokenAuthorizer.zip . -x "*.git*" "*.md" "node_modules/.bin/*" > /dev/null
cd ../..
echo "✅ Package built: lambda/authorizers/tokenAuthorizer.zip"
echo ""

# Step 3: Deploy Lambda Function
echo "🚀 Step 3: Deploying Lambda Authorizer..."
LAMBDA_CODE=$(base64 -i lambda/authorizers/tokenAuthorizer.zip)

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null; then
    echo "⚠️  Function $FUNCTION_NAME already exists. Updating code..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://lambda/authorizers/tokenAuthorizer.zip \
        --region "$REGION" > /dev/null
    
    echo "   Updating environment variables..."
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --environment "Variables={DB_SECRET_ARN=$DB_SECRET_ARN,TOKEN_PEPPER_SECRET_ARN=$PEPPER_SECRET_ARN}" \
        --region "$REGION" > /dev/null
    
    echo "✅ Function updated"
else
    echo "   Creating new function..."
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime nodejs18.x \
        --role "$LAMBDA_ROLE_ARN" \
        --handler tokenAuthorizer.handler \
        --zip-file fileb://lambda/authorizers/tokenAuthorizer.zip \
        --timeout 10 \
        --memory-size 256 \
        --environment "Variables={DB_SECRET_ARN=$DB_SECRET_ARN,TOKEN_PEPPER_SECRET_ARN=$PEPPER_SECRET_ARN}" \
        --region "$REGION" > /dev/null
    
    echo "✅ Function created"
fi

FUNCTION_ARN=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" --query 'Configuration.FunctionArn' --output text)
echo "   ARN: $FUNCTION_ARN"
echo ""

# Step 4: Add permission for API Gateway
echo "🔑 Step 4: Adding API Gateway invoke permission..."
aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "apigateway-invoke" \
    --action "lambda:InvokeFunction" \
    --principal "apigateway.amazonaws.com" \
    --region "$REGION" 2>/dev/null || echo "   Permission already exists (or will be added via Terraform)"
echo ""

echo "✅ Token Service setup complete!"
echo ""
echo "📋 Summary:"
echo "   Pepper Secret: $PEPPER_SECRET_ARN"
echo "   Lambda Function: $FUNCTION_ARN"
echo "   DB Secret ARN: $DB_SECRET_ARN"
echo ""
echo "📝 Next steps:"
echo "   1. Add token_issuer kernel (00000000-0000-4000-8000-000000000015) to manifest.allowed_boot_ids"
echo "   2. Seed the kernel: npm run seed (or run seed script)"
echo "   3. Connect authorizer to API Gateway (see terraform/apigateway.tf or create manually)"
echo "   4. Issue first token via /api/boot endpoint"
echo ""

