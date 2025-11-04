# 🔍 Verificar Kernels no Banco de Dados

## Método 1: Script Node.js (Recomendado)

```bash
# Com AWS credentials configuradas
export DB_SECRET_ARN="arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb"
export AWS_REGION="us-east-1"

node scripts/verify-kernels-in-db.js
```

**Ou com variáveis de ambiente diretas:**

```bash
export RDS_ENDPOINT="loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com"
export DB_USER="ledger_admin"
export DB_PASS="<senha>"
export DB_NAME="loglineos"

node scripts/verify-kernels-in-db.js
```

## Método 2: Script SQL Direto

```bash
# Via psql
psql -h loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com \
     -U ledger_admin \
     -d loglineos \
     -f scripts/verify-kernels.sql
```

## Método 3: Via Lambda Diagnostic

Você pode usar a Lambda `loglineos-diagnostic` existente:

```bash
aws lambda invoke \
  --function-name loglineos-diagnostic \
  --payload '{"action": "query", "query": "SELECT COUNT(*) FROM ledger.visible_timeline WHERE entity_type = '\''function'\''"}' \
  response.json

cat response.json
```

## O que o script verifica:

1. ✅ **Estrutura da tabela** - Colunas necessárias existem?
2. ✅ **Contagem de kernels** - Quantos estão no banco?
3. ✅ **Listagem completa** - Todos os kernels com status
4. ✅ **Código armazenado** - Todos têm código válido?
5. ✅ **Sincronização** - Compara com arquivos ROW/kernels/
6. ✅ **Manifest** - Kernels estão no manifest?
7. ✅ **Qualidade** - Código tem tamanho adequado?

## Problemas Comuns

### "SEM CÓDIGO"
- Kernel foi inserido sem o campo `code`
- Solução: Re-executar seed ou inserir manualmente

### "CÓDIGO MUITO CURTO"
- Campo `code` existe mas tem menos de 100 caracteres
- Solução: Verificar arquivo NDJSON original

### "NÃO ESTÁ NO MANIFEST"
- Kernel existe mas não está em `allowed_boot_ids`
- Solução: Atualizar manifest com o ID do kernel

### "NÃO ESTÁ NO BANCO"
- Kernel existe no arquivo NDJSON mas não foi inserido
- Solução: Executar seed: `npm run seed` ou `node FILES/src/seed.js`

## Queries SQL Úteis

### Ver todos os kernels:

```sql
SELECT id, name, status, LENGTH(code) as code_len, at
FROM ledger.visible_timeline
WHERE entity_type = 'function'
ORDER BY at DESC;
```

### Verificar código de um kernel específico:

```sql
SELECT id, name, SUBSTRING(code, 1, 500) as code_preview
FROM ledger.visible_timeline
WHERE id = '00000000-0000-4000-8000-000000000001'
ORDER BY seq DESC
LIMIT 1;
```

### Comparar com arquivos:

```sql
-- Listar IDs esperados
SELECT id, name, seq
FROM ledger.visible_timeline
WHERE entity_type = 'function'
  AND id IN (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000014'
  )
ORDER BY id;
```

