#!/bin/bash
# cleanup-old-resources.sh
# Remove recursos do projeto antigo (CDK/WebSocket)
# MANTÉM apenas recursos do Blueprint4

set -e

echo "🧹 Cleanup de Recursos Antigos - LogLineOS"
echo "=========================================="
echo ""
echo "⚠️  Este script vai DELETAR recursos do projeto ANTIGO"
echo "✅  Recursos do Blueprint4 serão MANTIDOS"
echo ""
echo "Recursos a DELETAR:"
echo "  - 6 Lambda functions antigas (timeline-*, kernel-executor, etc)"
echo "  - 1 Aurora Serverless cluster"
echo "  - 1 API Gateway WebSocket"
echo "  - 1 DynamoDB table"
echo ""
echo "Recursos que serão MANTIDOS:"
echo "  - loglineos-stage0-loader"
echo "  - loglineos-db-migration"
echo "  - loglineos-diagnostic"
echo "  - loglineos-ledger-dev (RDS)"
echo "  - loglineos-lambda-role (IAM)"
echo ""
read -p "Tem certeza que quer continuar? (digite 'SIM' para confirmar): " confirm

if [ "$confirm" != "SIM" ]; then
    echo "❌ Operação cancelada."
    exit 1
fi

echo ""
echo "🔄 Iniciando limpeza..."
echo ""

# 1. Delete Lambda functions antigas
echo "🗑️  Deletando Lambda functions antigas..."
LAMBDAS_TO_DELETE=(
    "loglineos-timeline-handler"
    "loglineos-kernel-executor"
    "loglineos-timeline-subscribe"
    "loglineos-onboard-agent"
    "loglineos-smoke-runner"
    "loglineos-timeline-disconnect"
)

for lambda in "${LAMBDAS_TO_DELETE[@]}"; do
    echo "  → Deletando $lambda..."
    aws lambda delete-function --function-name "$lambda" 2>/dev/null || echo "    ⚠️  Já deletada ou não encontrada"
done

# 2. Delete API Gateway WebSocket
echo ""
echo "🗑️  Deletando API Gateway WebSocket..."
API_ID="srn6e3ggl7"
aws apigatewayv2 delete-api --api-id "$API_ID" 2>/dev/null || echo "  ⚠️  Já deletado ou não encontrado"

# 3. Delete DynamoDB table
echo ""
echo "🗑️  Deletando DynamoDB table..."
aws dynamodb delete-table --table-name "loglineos-ws-connections-dev" 2>/dev/null || echo "  ⚠️  Já deletada ou não encontrada"

# 4. Delete Aurora Cluster (ATENÇÃO: isso leva tempo)
echo ""
echo "🗑️  Deletando Aurora Serverless cluster..."
echo "  ⚠️  ATENÇÃO: Isto pode levar 5-10 minutos..."
CLUSTER_ID="loglineosstack-prod-loglineosdatabase9229a95f-fkfmbpagswvm"

# Primeiro, delete instâncias do cluster
echo "  → Procurando instâncias do cluster..."
INSTANCES=$(aws rds describe-db-clusters \
    --db-cluster-identifier "$CLUSTER_ID" \
    --query 'DBClusters[0].DBClusterMembers[*].DBInstanceIdentifier' \
    --output text 2>/dev/null || echo "")

if [ -n "$INSTANCES" ]; then
    for instance in $INSTANCES; do
        echo "  → Deletando instância $instance..."
        aws rds delete-db-instance \
            --db-instance-identifier "$instance" \
            --skip-final-snapshot 2>/dev/null || echo "    ⚠️  Erro ao deletar instância"
    done
    echo "  → Aguardando instâncias serem deletadas (pode levar alguns minutos)..."
    sleep 30
fi

# Agora delete o cluster
echo "  → Deletando cluster $CLUSTER_ID..."
aws rds delete-db-cluster \
    --db-cluster-identifier "$CLUSTER_ID" \
    --skip-final-snapshot 2>/dev/null || echo "  ⚠️  Já deletado ou não encontrado"

# 5. Verificação final
echo ""
echo "✅ Limpeza concluída!"
echo ""
echo "📊 Recursos restantes (Blueprint4):"
echo ""
echo "Lambda Functions:"
aws lambda list-functions --query 'Functions[?contains(FunctionName, `loglineos`)].FunctionName' --output text

echo ""
echo "RDS Instances:"
aws rds describe-db-instances --query 'DBInstances[?contains(DBInstanceIdentifier, `loglineos`)].DBInstanceIdentifier' --output text

echo ""
echo "Aurora Clusters:"
aws rds describe-db-clusters --query 'DBClusters[?contains(DBClusterIdentifier, `loglineos`)].DBClusterIdentifier' --output text 2>/dev/null || echo "(nenhum)"

echo ""
echo "DynamoDB Tables:"
aws dynamodb list-tables --query 'TableNames[?contains(@, `loglineos`)]' --output text || echo "(nenhuma)"

echo ""
echo "API Gateway APIs:"
aws apigatewayv2 get-apis --query 'Items[?contains(Name, `loglineos`)].Name' --output text || echo "(nenhuma)"

echo ""
echo "✅ Cleanup finalizado!"
echo ""
echo "⚠️  NOTA: Se o Aurora cluster ainda aparecer, ele está sendo deletado."
echo "   Pode levar até 10 minutos para desaparecer completamente."
