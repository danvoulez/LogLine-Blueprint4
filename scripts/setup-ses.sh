#!/bin/bash
set -e

# Setup AWS SES for email sending
# Usage: ./scripts/setup-ses.sh [email] [domain]

AWS_REGION=${AWS_REGION:-us-east-1}
EMAIL=${1:-""}
DOMAIN=${2:-""}

echo "📧 Setting up AWS SES for LogLineOS"
echo "Region: $AWS_REGION"
echo ""

# Check if email or domain provided
if [ -z "$EMAIL" ] && [ -z "$DOMAIN" ]; then
  echo "⚠️  No email or domain provided"
  echo ""
  echo "Usage:"
  echo "  ./scripts/setup-ses.sh email@example.com"
  echo "  ./scripts/setup-ses.sh example.com"
  echo ""
  echo "For sandbox (testing):"
  echo "  ./scripts/setup-ses.sh noreply@loglineos.com"
  echo ""
  echo "For production (domain):"
  echo "  ./scripts/setup-ses.sh loglineos.com"
  echo ""
  exit 1
fi

# Verify email (sandbox mode)
if [ -n "$EMAIL" ]; then
  echo "📧 Verifying email: $EMAIL"
  aws ses verify-email-identity \
    --email-address "$EMAIL" \
    --region "$AWS_REGION"
  
  echo "✅ Verification email sent to $EMAIL"
  echo "   Check your inbox and click the verification link"
  echo ""
fi

# Verify domain (production mode)
if [ -n "$DOMAIN" ]; then
  echo "🌐 Verifying domain: $DOMAIN"
  aws ses verify-domain-identity \
    --domain "$DOMAIN" \
    --region "$AWS_REGION"
  
  echo "✅ Domain verification initiated for $DOMAIN"
  echo "   Add DNS records as shown in AWS Console"
  echo ""
fi

# Check SES sending quota
echo "📊 SES Status:"
aws ses get-send-quota --region "$AWS_REGION" --output json | jq

echo ""
echo "✅ SES setup complete!"
echo ""
echo "⚠️  Important:"
echo "   - Sandbox mode: Can only send to verified emails"
echo "   - To send to any email: Request production access"
echo "   - Production access: AWS Console → SES → Account dashboard → Request production access"
echo ""

