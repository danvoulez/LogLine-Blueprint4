#!/bin/bash
# Quick Lambda invocation helpers

ACTION=$1

case "$ACTION" in
  migrate)
    echo "🔧 Running migration..."
    aws lambda invoke \
      --function-name loglineos-db-migration \
      --payload '{"action":"migrate"}' \
      --cli-binary-format raw-in-base64-out \
      response.json
    cat response.json | jq
    ;;
  
  seed)
    echo "🌱 Running seed..."
    aws lambda invoke \
      --function-name loglineos-db-migration \
      --payload '{"action":"seed"}' \
      --cli-binary-format raw-in-base64-out \
      response.json
    cat response.json | jq
    ;;
  
  boot)
    FUNCTION_ID=${2:-"00000000-0000-4000-8000-000000000001"}
    echo "🚀 Booting kernel $FUNCTION_ID..."
    aws lambda invoke \
      --function-name loglineos-stage0-loader \
      --payload "{\"action\":\"boot\",\"boot_function_id\":\"$FUNCTION_ID\",\"input\":{\"message\":\"test\"}}" \
      --cli-binary-format raw-in-base64-out \
      response.json
    cat response.json | jq
    ;;
  
  query)
    echo "📊 Querying ledger..."
    aws lambda invoke \
      --function-name loglineos-db-migration \
      --payload '{"action":"query"}' \
      --cli-binary-format raw-in-base64-out \
      --log-type Tail \
      --query 'LogResult' \
      --output text \
      response.json | base64 -d
    ;;
  
  *)
    echo "Usage: ./invoke.sh [migrate|seed|query|boot] [function_id]"
    echo ""
    echo "Examples:"
    echo "  ./invoke.sh migrate"
    echo "  ./invoke.sh seed"
    echo "  ./invoke.sh query"
    echo "  ./invoke.sh boot"
    echo "  ./invoke.sh boot 00000000-0000-4000-8000-000000000002"
    exit 1
    ;;
esac
