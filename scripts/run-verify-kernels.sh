#!/bin/bash
# Script para executar verificação de kernels no banco
# Suporta tanto via Node.js quanto via psql direto

set -e

echo "🔍 Verificando kernels no banco de dados..."
echo ""

# Opção 1: Via Node.js (usa Secrets Manager)
if command -v node &> /dev/null; then
  echo "📝 Usando Node.js script..."
  
  # Check if AWS credentials are available
  if aws sts get-caller-identity &> /dev/null; then
    export DB_SECRET_ARN="${DB_SECRET_ARN:-arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb}"
    export AWS_REGION="${AWS_REGION:-us-east-1}"
    
    cd "$(dirname "$0")/.."
    node scripts/verify-kernels-in-db.js
  else
    echo "⚠️  AWS credentials não configuradas. Tentando via psql..."
    # Fall through to psql option
  fi
fi

# Opção 2: Via psql direto (se Node.js não funcionar)
if command -v psql &> /dev/null; then
  echo ""
  echo "📝 Alternativa: Execute o script SQL diretamente:"
  echo ""
  echo "  psql -h loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com \\"
  echo "       -U ledger_admin \\"
  echo "       -d loglineos \\"
  echo "       -f scripts/verify-kernels.sql"
  echo ""
  echo "Ou use o script SQL interativo:"
  echo "  psql -h <host> -U ledger_admin -d loglineos < scripts/verify-kernels.sql"
fi

