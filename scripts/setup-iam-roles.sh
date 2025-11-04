#!/bin/bash
set -e

# Setup IAM roles for Lambda functions
# Usage: ./scripts/setup-iam-roles.sh

AWS_REGION=${AWS_REGION:-us-east-1}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "🔐 Setting up IAM roles for Lambda functions"
echo "Account ID: $ACCOUNT_ID"
echo "Region: $AWS_REGION"
echo ""

# Trust policy for Lambda
TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}'

# Function to create role
create_role() {
  local ROLE_NAME=$1
  local POLICY_DOC=$2
  
  echo "Creating role: $ROLE_NAME"
  
  # Create role
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Role for $ROLE_NAME Lambda" \
    2>/dev/null || echo "  Role already exists"
  
  # Attach basic Lambda execution policy
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" \
    2>/dev/null || echo "  Basic execution policy already attached"
  
  # Create and attach custom policy
  POLICY_ARN=$(aws iam create-policy \
    --policy-name "${ROLE_NAME}-policy" \
    --policy-document "$POLICY_DOC" \
    --query 'Policy.Arn' \
    --output text \
    2>/dev/null || aws iam list-policies --query "Policies[?PolicyName=='${ROLE_NAME}-policy'].Arn" --output text | head -1)
  
  if [ -n "$POLICY_ARN" ]; then
    aws iam attach-role-policy \
      --role-name "$ROLE_NAME" \
      --policy-arn "$POLICY_ARN" \
      2>/dev/null || echo "  Custom policy already attached"
    echo "  ✅ Policy ARN: $POLICY_ARN"
  fi
  
  ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
  echo "  ✅ Role ARN: $ROLE_ARN"
  echo ""
}

# Auth Service policy
AUTH_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/auth_api_tokens"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:${AWS_REGION}:${ACCOUNT_ID}:secret:loglineos-token-pepper-*"
    }
  ]
}
EOF
)

# Wallet Service policy
WALLET_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/wallets",
        "arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/nonces"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:${AWS_REGION}:${ACCOUNT_ID}:secret:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*"
    }
  ]
}
EOF
)

# CLI Service policy
CLI_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:function:loglineos-stage0-loader"
    }
  ]
}
EOF
)

# Authorizer policy
AUTHORIZER_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/auth_api_tokens",
        "arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/auth_api_tokens/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:${AWS_REGION}:${ACCOUNT_ID}:secret:loglineos-token-pepper-*"
    }
  ]
}
EOF
)

# Onboard Agent policy
ONBOARD_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem"
      ],
      "Resource": "arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/*"
    }
  ]
}
EOF
)

# Create roles
create_role "loglineos-auth-service-role" "$AUTH_POLICY"
create_role "loglineos-wallet-service-role" "$WALLET_POLICY"
create_role "loglineos-cli-service-role" "$CLI_POLICY"
create_role "loglineos-auth-authorizer-role" "$AUTHORIZER_POLICY"
create_role "loglineos-onboard-agent-role" "$ONBOARD_POLICY"

echo "✅ IAM roles created"
echo ""
echo "📋 Role ARNs (use these when creating Lambda functions):"
aws iam list-roles --query "Roles[?contains(RoleName, 'loglineos')].{Name:RoleName, ARN:Arn}" --output table

