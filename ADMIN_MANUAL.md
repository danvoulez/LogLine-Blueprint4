# 📚 Manual do Administrador - LogLineOS Blueprint4

**Guia Completo para Operação, Manutenção e Troubleshooting**

---

## 📋 Índice

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [IDs e Chaves do Sistema](#2-ids-e-chaves-do-sistema)
3. [Componentes AWS](#3-componentes-aws)
4. [Operações Administrativas](#4-operações-administrativas)
5. [Monitoramento e Logs](#5-monitoramento-e-logs)
6. [Backup e Recuperação](#6-backup-e-recuperação)
7. [Segurança e Acesso](#7-segurança-e-acesso)
8. [Troubleshooting](#8-troubleshooting)
9. [Manutenção de Rotina](#9-manutenção-de-rotina)
10. [Escalabilidade](#10-escalabilidade)

---

## 1. Visão Geral da Arquitetura

### Stack Tecnológico

```
┌─────────────────────────────────────┐
│         Client Applications          │
│  (VS Code, iOS, Web, CLI, Telegram) │
└────────────────┬────────────────────┘
                 │ HTTPS
                 ▼
┌─────────────────────────────────────┐
│          AWS Lambda                  │
│  ┌──────────────────────────────┐  │
│  │  loglineos-stage0-loader     │  │
│  │  (Executa kernels)           │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  loglineos-db-migration      │  │
│  │  (Migrations + Seed)         │  │
│  └──────────────────────────────┘  │
└────────────────┬────────────────────┘
                 │ VPC Connection
                 ▼
┌─────────────────────────────────────┐
│      PostgreSQL (RDS/Managed)        │
│  ┌──────────────────────────────┐  │
│  │  ledger.universal_registry   │  │
│  │  (Append-only ledger)        │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  ledger.visible_timeline     │  │
│  │  (View for queries)          │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Princípios Fundamentais

1. **Ledger-Only**: Todo código vive no banco como spans
2. **Append-Only**: Dados nunca são modificados/deletados
3. **Stage-0 Loader**: Bootstrap mínimo que carrega kernels do ledger
4. **Manifest Governance**: Whitelist controla quais kernels podem executar
5. **RLS (Row-Level Security)**: Isolamento por tenant/owner

---

## 2. IDs e Chaves do Sistema

### 🔑 Kernels Core (IDs Fixos)

| Kernel | ID | Seq | Função | Status |
|--------|-----|-----|--------|--------|
| **run_code_kernel** | `00000000-0000-4000-8000-000000000001` | 5 | Executa funções user | ✅ Active |
| **observer_bot_kernel** | `00000000-0000-4000-8000-000000000002` | 2 | Observa e agenda spans | ✅ Active |
| **request_worker_kernel** | `00000000-0000-4000-8000-000000000003` | 2 | Processa filas | ✅ Active |
| **policy_agent_kernel** | `00000000-0000-4000-8000-000000000004` | 1 | Aplica políticas | ✅ Active |
| **provider_exec_kernel** | `00000000-0000-4000-8000-000000000005` | 1 | Chama LLMs | ✅ Active |
| **prompt_fetch_kernel** | `00000000-0000-4000-8000-000000000006` | 1 | Busca prompts | ✅ Active |
| **memory_store_kernel** | `00000000-0000-4000-8000-000000000007` | 3 | Memórias CRUD | ✅ Active |
| **app_enrollment_kernel** | `00000000-0000-4000-8000-000000000008` | 1 | Registra apps | ✅ Active |

### 📋 Manifest

| Campo | Valor |
|-------|-------|
| **ID** | `00000000-0000-4000-8000-000000000201` |
| **Seq Atual** | 4 |
| **Entity Type** | `manifest` |
| **Status** | `active` |

**Metadata (allowed_boot_ids):**
```json
[
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
  "00000000-0000-4000-8000-000000000007",
  "00000000-0000-4000-8000-000000000008"
]
```

### 💬 Prompts Disponíveis

| ID | Nome | Tipo | Variáveis |
|----|------|------|-----------|
| `00000000-0000-4000-8000-000000000101` | welcome_message | template | user_name |
| `00000000-0000-4000-8000-000000000102` | error_message | template | error_code, error_detail |
| `00000000-0000-4000-8000-000000000103` | user_greeting | template | user_name, org_name |
| `00000000-0000-4000-8000-000000000104` | system_notification | template | notification_type, content |
| `00000000-0000-4000-8000-000000000105` | data_confirmation | template | action, data_summary |
| `00000000-0000-4000-8000-000000000106` | help_instructions | template | feature_name |

### 🛡️ Políticas Ativas

| ID | Nome | Tipo | Descrição |
|----|------|------|-----------|
| `00000000-0000-4000-8000-000000000401` | slow_exec_policy | watcher | Marca execuções lentas (>5s) |
| `00000000-0000-4000-8000-000000000402` | metrics_exec_duration | collector | Coleta métricas de duração |
| `00000000-0000-4000-8000-000000000403` | daily_exec_rollup | aggregator | Rollup diário de execuções |
| `00000000-0000-4000-8000-000000000404` | error_report_policy | notifier | Notifica erros críticos |
| `00000000-0000-4000-8000-000000000405` | throttle_policy | limiter | Limita execuções por tenant |

### 🌐 Providers Configurados

| ID | Nome | Tipo | Base URL |
|----|------|------|----------|
| `00000000-0000-4000-8000-000000000501` | openai_gpt4 | openai | https://api.openai.com/v1 |
| `00000000-0000-4000-8000-000000000502` | openai_gpt35 | openai | https://api.openai.com/v1 |
| `00000000-0000-4000-8000-000000000503` | ollama_local | ollama | http://localhost:11434 |

---

## 3. Componentes AWS

### Lambda Functions

#### loglineos-stage0-loader

**Função**: Executa kernels do ledger  
**Runtime**: Node.js 18.x  
**Timeout**: 30s  
**Memory**: 512 MB  
**Environment Variables**:
```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SIGNING_KEY_HEX=<optional-ed25519-private-key>
```

**Invocação**:
```bash
aws lambda invoke \
  --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"KERNEL_ID","input":{...}}' \
  response.json
```

#### loglineos-db-migration

**Função**: Migrations e seed  
**Runtime**: Node.js 18.x  
**Timeout**: 60s  
**Memory**: 256 MB  
**Environment Variables**:
```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

**Ações Disponíveis**:
- `migrate`: Executa migrations do schema
- `seed`: Popula kernels, policies, prompts
- `query`: Executa queries diretas

### RDS PostgreSQL

**Instance Type**: db.t3.micro (recomendado: db.t3.small para produção)  
**Engine**: PostgreSQL 14+  
**Storage**: 20GB SSD (auto-scaling habilitado)  
**Backup**: Automático diário (retention: 7 dias)  
**Multi-AZ**: Recomendado para produção

**Connection String Format**:
```
postgresql://username:password@hostname:5432/database_name
```

**Schemas**:
- `ledger` - Tabelas principais (universal_registry, visible_timeline)
- `public` - Funções helper

**Key Tables**:
- `ledger.universal_registry` - Ledger append-only (PK: id + seq)
- `ledger.visible_timeline` - View com alias "when" → "at"

---

## 4. Operações Administrativas

### 4.1 Deploy e Update

#### Deploy Completo (Código + Seed)

```bash
# 1. Build e deploy das Lambdas
cd /path/to/loglineos-blueprint4
bash deploy.sh

# 2. Run migrations (primeira vez ou após mudanças no schema)
bash invoke.sh migrate

# 3. Seed kernels/policies/prompts (primeira vez ou após atualizações)
bash invoke.sh seed
```

#### Update de Kernel Específico

1. Editar arquivo NDJSON em `ROW/kernels/`
2. Incrementar `seq` do kernel
3. Re-seed:

```bash
bash deploy.sh
bash invoke.sh seed
```

O sistema detecta `seq` maior e cria nova versão.

#### Update do Manifest (Adicionar Kernel)

1. Editar `ROW/manifest/03-manifest.ndjson`
2. Incrementar `seq` (ex: 4 → 5)
3. Adicionar novo kernel ID em `allowed_boot_ids`
4. Re-seed:

```bash
bash deploy.sh
bash invoke.sh seed
```

### 4.2 Verificação de Estado

#### Listar Kernels Ativos

```bash
aws lambda invoke \
  --function-name loglineos-db-migration \
  --payload '{"action":"query","sql":"SELECT id, name, seq, status FROM ledger.visible_timeline WHERE entity_type='\''function'\'' ORDER BY name, seq DESC"}' \
  response.json && cat response.json
```

#### Verificar Manifest Atual

```bash
aws lambda invoke \
  --function-name loglineos-db-migration \
  --payload '{"action":"query","sql":"SELECT seq, metadata FROM ledger.visible_timeline WHERE entity_type='\''manifest'\'' ORDER BY seq DESC LIMIT 1"}' \
  response.json && cat response.json
```

#### Contar Spans por Tipo

```bash
aws lambda invoke \
  --function-name loglineos-db-migration \
  --payload '{"action":"query","sql":"SELECT entity_type, count(*) FROM ledger.visible_timeline GROUP BY entity_type ORDER BY count DESC"}' \
  response.json && cat response.json
```

### 4.3 Gestão de Usuários e Tenants

#### Criar Novo Tenant

```sql
-- Não há tabela de tenants explícita
-- Tenants são criados implicitamente ao criar primeiro span
-- Exemplo: criar app registration para novo tenant

INSERT INTO ledger.universal_registry
  (id, seq, entity_type, who, did, this, at, status, owner_id, tenant_id, visibility)
VALUES
  (gen_random_uuid(), 0, 'tenant_setup', 'admin', 'created', 'tenant', now(), 'active', 
   'admin@example.com', 'new_tenant_id', 'private');
```

#### Listar Apps Registrados

```bash
aws lambda invoke \
  --function-name loglineos-db-migration \
  --payload '{"action":"query","sql":"SELECT id, metadata->>'\''app_name'\'' as name, metadata->>'\''app_version'\'' as version, at FROM ledger.visible_timeline WHERE entity_type='\''app_registration'\'' ORDER BY at DESC"}' \
  response.json
```

---

## 5. Monitoramento e Logs

### 5.1 CloudWatch Logs

**Log Groups**:
- `/aws/lambda/loglineos-stage0-loader`
- `/aws/lambda/loglineos-db-migration`

**Queries Úteis** (CloudWatch Insights):

```cloudwatch
# Erros recentes
fields @timestamp, @message
| filter @message like /ERROR/ or @message like /Error:/
| sort @timestamp desc
| limit 50

# Execuções lentas (>1s)
fields @timestamp, @duration
| filter @duration > 1000
| sort @duration desc

# Kernels mais executados
fields @message
| filter @message like /boot_function_id/
| parse @message '"boot_function_id":"*"' as kernel_id
| stats count() by kernel_id
```

### 5.2 Métricas no Ledger

#### Dashboard de Execuções (Últimas 24h)

```sql
SELECT 
  date_trunc('hour', at) as hour,
  status,
  count(*) as executions
FROM ledger.visible_timeline
WHERE entity_type = 'execution'
  AND at > now() - interval '24 hours'
GROUP BY hour, status
ORDER BY hour DESC;
```

#### Memórias por Tenant

```sql
SELECT 
  tenant_id,
  count(*) as memory_count,
  sum(length(metadata->>'content')) as total_bytes
FROM ledger.visible_timeline
WHERE entity_type = 'memory'
GROUP BY tenant_id;
```

#### Apps Ativos por Tenant

```sql
SELECT 
  tenant_id,
  count(DISTINCT id) as app_count
FROM ledger.visible_timeline
WHERE entity_type = 'app_registration'
  AND status = 'active'
GROUP BY tenant_id;
```

### 5.3 Alertas Recomendados

| Métrica | Threshold | Ação |
|---------|-----------|------|
| Lambda Errors | > 10/min | Investigar logs |
| Lambda Duration | > 25s | Possível timeout |
| RDS CPU | > 80% | Scale up |
| RDS Connections | > 90% max | Investigar leaks |
| Ledger Size | > 80% storage | Planejar archiving |

---

## 6. Backup e Recuperação

### 6.1 Estratégia de Backup

**RDS Automatic Backups**:
- Frequência: Diário
- Retention: 7 dias (recomendado: 30 para produção)
- Janela: 03:00-05:00 UTC

**Manual Snapshots** (antes de mudanças críticas):
```bash
aws rds create-db-snapshot \
  --db-instance-identifier loglineos-prod \
  --db-snapshot-identifier loglineos-manual-$(date +%Y%m%d-%H%M)
```

### 6.2 Export do Ledger (Disaster Recovery)

```bash
# Export completo
pg_dump -h hostname -U username -d dbname \
  -t ledger.universal_registry \
  -F c -f ledger_backup_$(date +%Y%m%d).dump

# Export incremental (últimas 24h)
psql -h hostname -U username -d dbname -c \
  "COPY (SELECT * FROM ledger.universal_registry WHERE at > now() - interval '24 hours') 
   TO STDOUT CSV HEADER" > incremental_$(date +%Y%m%d).csv
```

### 6.3 Restore

```bash
# Restore completo
pg_restore -h hostname -U username -d dbname \
  -t ledger.universal_registry \
  ledger_backup_20250103.dump

# Re-seed após restore
bash invoke.sh seed
```

### 6.4 Point-in-Time Recovery (PITR)

```bash
# Restore para timestamp específico (RDS)
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier loglineos-prod \
  --target-db-instance-identifier loglineos-restored \
  --restore-time 2025-01-03T12:00:00Z
```

---

## 7. Segurança e Acesso

### 7.1 IAM Roles e Policies

**Lambda Execution Role** (loglineos-lambda-role):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ],
      "Resource": "*"
    }
  ]
}
```

**Admin Policy** (loglineos-admin):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeFunction",
        "lambda:UpdateFunctionCode",
        "rds:DescribeDBInstances",
        "rds:CreateDBSnapshot"
      ],
      "Resource": [
        "arn:aws:lambda:*:*:function:loglineos-*",
        "arn:aws:rds:*:*:db:loglineos-*"
      ]
    }
  ]
}
```

### 7.2 Database Users

| User | Role | Permissions | Purpose |
|------|------|-------------|---------|
| `admin` | SUPERUSER | ALL | Migrations, admin ops |
| `lambda_exec` | Regular | SELECT, INSERT on ledger.* | Lambda runtime |
| `readonly` | Regular | SELECT on ledger.visible_timeline | Reporting, BI |

**Criar User Lambda**:
```sql
CREATE USER lambda_exec WITH PASSWORD 'secure_password';
GRANT USAGE ON SCHEMA ledger TO lambda_exec;
GRANT SELECT, INSERT ON ledger.universal_registry TO lambda_exec;
GRANT SELECT ON ledger.visible_timeline TO lambda_exec;
```

### 7.3 RLS (Row-Level Security)

**Políticas Ativas**:

```sql
-- SELECT: owner OR tenant OR public
CREATE POLICY ur_select_policy ON ledger.universal_registry
  FOR SELECT USING (
    owner_id = current_setting('app.user_id', true)
    OR visibility = 'public'
    OR (tenant_id = current_setting('app.tenant_id', true) AND visibility IN ('tenant','public'))
  );

-- INSERT: deve ser owner
CREATE POLICY ur_insert_policy ON ledger.universal_registry
  FOR INSERT WITH CHECK (
    owner_id = current_setting('app.user_id', true)
    AND (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true))
  );
```

### 7.4 Rotação de Chaves

**Ed25519 Signing Key** (opcional para provas):

1. Gerar novo par de chaves:
```bash
# Usando OpenSSL ou @noble/ed25519
node -e "
const ed = require('@noble/ed25519');
const priv = ed.utils.randomPrivateKey();
console.log('Private:', Buffer.from(priv).toString('hex'));
ed.getPublicKey(priv).then(pub => 
  console.log('Public:', Buffer.from(pub).toString('hex'))
);
"
```

2. Atualizar `SIGNING_KEY_HEX` na Lambda
3. Registrar nova public key no manifest (opcional)

---

## 8. Troubleshooting

### 8.1 Problemas Comuns

#### ❌ "Boot function not allowed by manifest"

**Causa**: Kernel não está no whitelist do manifest  
**Solução**:
```bash
# 1. Verificar manifest atual
aws lambda invoke --function-name loglineos-db-migration \
  --payload '{"action":"query","sql":"SELECT metadata FROM ledger.visible_timeline WHERE entity_type='\''manifest'\'' ORDER BY seq DESC LIMIT 1"}' \
  response.json

# 2. Adicionar kernel ao manifest (editar ROW/manifest/03-manifest.ndjson)
# 3. Incrementar seq
# 4. Re-deploy e seed
bash deploy.sh && bash invoke.sh seed
```

#### ❌ "Function span not found"

**Causa**: Kernel não foi seeded ou ID incorreto  
**Solução**:
```bash
# Re-seed
bash invoke.sh seed

# Verificar se kernel existe
aws lambda invoke --function-name loglineos-db-migration \
  --payload '{"action":"query","sql":"SELECT id, name, seq FROM ledger.visible_timeline WHERE id='\''KERNEL_ID'\''"}' \
  response.json
```

#### ❌ Lambda Timeout (>30s)

**Causa**: Query lenta ou processamento pesado  
**Soluções**:
1. Aumentar timeout da Lambda (máx 15 min)
2. Adicionar índices no PostgreSQL
3. Otimizar query do kernel
4. Implementar paginação

#### ❌ "Connection timeout" PostgreSQL

**Causa**: RDS inacessível ou VPC config incorreta  
**Checklist**:
- [ ] Lambda está na mesma VPC que RDS?
- [ ] Security Group permite conexões da Lambda?
- [ ] Subnet tem NAT Gateway (se Lambda precisa internet)?
- [ ] DATABASE_URL está correto?

#### ❌ Memórias não aparecem na busca

**Causa**: RLS bloqueando ou tenant diferente  
**Debug**:
```sql
-- Verificar contexto RLS
SELECT current_setting('app.user_id', true), current_setting('app.tenant_id', true);

-- Buscar sem filtro (como admin)
SET app.user_id = 'admin';
SET app.tenant_id = 'system';
SELECT * FROM ledger.visible_timeline WHERE entity_type = 'memory' LIMIT 5;
```

### 8.2 Debug Mode

Habilitar logs detalhados na Lambda:

```javascript
// Em stage0_loader.js, adicionar:
console.log('DEBUG:', {
  boot_function_id: BOOT_FUNCTION_ID,
  input: JSON.stringify(input),
  env: { userId, tenantId }
});
```

Re-deploy e verificar CloudWatch Logs.

### 8.3 Health Checks

**Script de Health Check**:

```bash
#!/bin/bash
# health_check.sh

echo "🔍 LogLineOS Health Check"
echo "========================"

# 1. Lambda reachable
echo -n "Lambda stage0-loader: "
aws lambda get-function --function-name loglineos-stage0-loader > /dev/null 2>&1 && echo "✅" || echo "❌"

# 2. Database connection
echo -n "Database connection: "
psql $DATABASE_URL -c "SELECT 1" > /dev/null 2>&1 && echo "✅" || echo "❌"

# 3. Ledger size
echo -n "Ledger spans: "
psql $DATABASE_URL -t -c "SELECT count(*) FROM ledger.universal_registry"

# 4. Last boot event
echo -n "Last boot: "
psql $DATABASE_URL -t -c "SELECT at FROM ledger.visible_timeline WHERE entity_type='boot_event' ORDER BY at DESC LIMIT 1"

echo "========================"
```

---

## 9. Manutenção de Rotina

### 9.1 Tarefas Diárias

- [ ] Revisar erros no CloudWatch
- [ ] Verificar métricas de execução
- [ ] Monitorar uso de storage RDS

### 9.2 Tarefas Semanais

- [ ] Review de logs de erro acumulados
- [ ] Verificar crescimento do ledger
- [ ] Testar restore de backup
- [ ] Atualizar dependências npm (se houver CVEs)

### 9.3 Tarefas Mensais

- [ ] Audit de acessos (IAM, DB users)
- [ ] Revisão de políticas ativas
- [ ] Limpeza de spans antigos (opcional, com cuidado)
- [ ] Performance tuning (índices, query plans)
- [ ] Atualizar documentação

### 9.4 Tarefas Trimestrais

- [ ] Disaster recovery drill (restore completo)
- [ ] Revisão de custos AWS
- [ ] Atualização de runtime Node.js (se disponível)
- [ ] Security audit completo

---

## 10. Escalabilidade

### 10.1 Limites Atuais

| Componente | Limite Atual | Limite Recomendado (Produção) |
|------------|--------------|-------------------------------|
| Lambda Concurrency | 10 | 100+ |
| RDS Connections | 100 | 500+ (instance maior) |
| Ledger Size | 20 GB | 100 GB+ com archiving |
| Requests/min | ~1000 | 10,000+ com cache |

### 10.2 Scaling Up

#### Lambda

```bash
# Aumentar reserved concurrency
aws lambda put-function-concurrency \
  --function-name loglineos-stage0-loader \
  --reserved-concurrent-executions 100
```

#### RDS

```bash
# Scale vertical (instance maior)
aws rds modify-db-instance \
  --db-instance-identifier loglineos-prod \
  --db-instance-class db.t3.medium \
  --apply-immediately
```

#### Read Replicas (para queries analíticas)

```bash
aws rds create-db-instance-read-replica \
  --db-instance-identifier loglineos-read-replica \
  --source-db-instance-identifier loglineos-prod
```

### 10.3 Archiving (Ledger Antigo)

**Estratégia**: Mover spans antigos para S3/Glacier

```sql
-- Identificar spans para archive (>1 ano)
SELECT count(*), pg_size_pretty(sum(pg_column_size(universal_registry.*)))
FROM ledger.universal_registry
WHERE at < now() - interval '1 year';

-- Export para S3 (via pg_dump ou COPY)
COPY (
  SELECT * FROM ledger.universal_registry 
  WHERE at < now() - interval '1 year'
) TO PROGRAM 'aws s3 cp - s3://loglineos-archive/spans_2024.csv' CSV HEADER;

-- Após confirmar backup, marcar como archived (NÃO deletar!)
UPDATE ledger.universal_registry 
SET metadata = jsonb_set(metadata, '{archived}', 'true')
WHERE at < now() - interval '1 year';
```

---

## 📞 Contatos e Suporte

### Equipe

- **Arquiteto**: Daniel (@danvoulez)
- **DevOps**: [Seu nome]
- **On-call**: [Rotação]

### Recursos

- **Repo**: https://github.com/danvoulez/LogLine-Blueprint4
- **Docs**: README.md, PHASE*.md, Blueprint4.md
- **Slack**: #loglineos-ops
- **Runbook**: Este documento

---

## 📝 Change Log

| Data | Versão | Mudanças |
|------|--------|----------|
| 2025-11-03 | 1.0 | Versão inicial do manual |

---

**Última atualização**: 2025-11-03  
**Autor**: Warp AI + Admin Team  
**Status**: ✅ Production Ready
