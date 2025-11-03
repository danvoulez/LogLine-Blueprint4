#!/bin/bash
set -e

echo "🎯 LogLineOS Blueprint4 - Lambda Deploy"
echo "========================================"
echo ""

# Remove old zip
rm -f deploy.zip

# Create deployment package
echo "📦 Packaging Lambda..."
zip -r deploy.zip \
  index.js \
  handler.js \
  migrate.js \
  seed.js \
  stage0_loader.js \
  query.js \
  db.js \
  crypto.js \
  schema.sql \
  ROW/ \
  node_modules/ \
  package.json \
  -x "*.DS_Store" \
  -q

ZIPSIZE=$(du -h deploy.zip | cut -f1)
echo "✅ Created deploy.zip ($ZIPSIZE)"
echo ""

# Deploy to both Lambda functions
echo "🚀 Deploying to Lambda functions..."
echo ""

# Function 1: DB Migration (also handles seed + stage0)
echo "→ loglineos-db-migration"
aws lambda update-function-code \
  --function-name loglineos-db-migration \
  --zip-file fileb://deploy.zip \
  --no-cli-pager > /dev/null
echo "  ✅ Updated"

# Function 2: Stage0 Loader (now unified handler)
echo "→ loglineos-stage0-loader"
aws lambda update-function-code \
  --function-name loglineos-stage0-loader \
  --zip-file fileb://deploy.zip \
  --no-cli-pager > /dev/null
echo "  ✅ Updated"

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Run migration: aws lambda invoke --function-name loglineos-db-migration --payload '{\"action\":\"migrate\"}' response.json"
echo "  2. Run seed:      aws lambda invoke --function-name loglineos-db-migration --payload '{\"action\":\"seed\"}' response.json"
echo "  3. Test boot:     aws lambda invoke --function-name loglineos-stage0-loader --payload '{\"action\":\"boot\",\"boot_function_id\":\"00000000-0000-4000-8000-000000000001\",\"input\":{\"message\":\"Hello\"}}' response.json"
echo ""
