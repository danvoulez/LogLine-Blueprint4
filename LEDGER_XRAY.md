# 🔍 Ledger X-Ray - Análise Completa do Ledger na AWS

## O que é?

Script completo para fazer um **raio-X** do ledger na AWS, verificando:

- ✅ Estrutura do banco (tabelas, colunas, índices)
- ✅ Kernels persistidos
- ✅ Estatísticas de spans por tipo
- ✅ Políticas RLS (Row-Level Security)
- ✅ Assinaturas e integridade
- ✅ Atividade recente
- ✅ Performance e tamanho

---

## Como Usar

### Opção 1: Via NPM Script

```bash
npm run ledger:xray
```

### Opção 2: Direto

```bash
node scripts/ledger-xray.js
```

---

## Configuração

### Via Secrets Manager (Recomendado)

```bash
export DB_SECRET_ARN="arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb"
export AWS_REGION="us-east-1"
npm run ledger:xray
```

### Via Variáveis de Ambiente

```bash
export DB_HOST="loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com"
export DB_PORT="5432"
export DB_USER="ledger_admin"
export DB_PASSWORD="sua-senha"
export DB_NAME="loglineos"
npm run ledger:xray
```

---

## O que o Script Verifica

### 1. 📊 Estrutura do Schema
- Verifica se schema `ledger` existe
- Verifica se tabela `universal_registry` existe
- Lista todas as colunas e tipos
- Lista índices criados
- Destaque para colunas críticas (signatures, metadata, etc.)

### 2. 🔒 Políticas RLS
- Verifica se RLS está habilitado
- Lista políticas RLS configuradas
- Alerta se RLS estiver desabilitado

### 3. ⚙️ Kernels Persistidos
- Conta total de kernels ativos
- Lista todos os kernels com nome, seq, status
- Verifica manifest e kernels permitidos

### 4. 📊 Estatísticas de Spans
- Top 20 tipos de spans (por quantidade)
- Total geral de spans
- Spans por status (active, completed, error, etc.)
- Top 10 tenants (por quantidade de spans)

### 5. 🔐 Assinaturas
- Conta spans assinados vs não assinados
- Verifica presença de `payload_hash`
- Verifica presença de `sig_key_id`
- Percentual de spans com assinatura

### 6. 🔍 Integridade dos Dados
- Verifica versionamento (spans com seq > 0)
- Spans órfãos (sem owner_id)
- Metadata válido (não vazio)

### 7. ⏰ Atividade Recente
- Spans criados nas últimas 24h
- Spans criados na última semana
- Últimos 10 spans criados

### 8. ⚡ Performance & Tamanho
- Tamanho total da tabela
- Tamanho da tabela (sem índices)
- Tamanho dos índices
- Estimativa de linhas

---

## Exemplo de Saída

```
🔍 LEDGER X-RAY - Análise Completa do Ledger na AWS

✅ Conectado ao banco de dados

============================================================
📊 1. ESTRUTURA DO SCHEMA
============================================================
✅ Schema "ledger" existe
✅ Tabela "ledger.universal_registry" existe

📋 Colunas da tabela:
🔑 id                    uuid                    (NOT NULL)
🔑 seq                   integer                 (NOT NULL)
🔑 entity_type           text                    (NOT NULL)
🔑 who                   text                    (NOT NULL)
🔑 did                   text                    (NOT NULL)
🔑 this                  text                    (NOT NULL)
🔑 at                    timestamp with time zone (NOT NULL)
🔑 status                text                    (NOT NULL)
🔑 metadata              jsonb                   (nullable)
🔑 owner_id              text                    (nullable)
🔑 tenant_id             text                    (nullable)
🔑 visibility            text                    (nullable)
🔑 payload_hash           text                    (nullable)
🔑 sig_alg                text                    (nullable)
🔑 sig_key_id             text                    (nullable)
🔑 signature              text                    (nullable)

📇 Índices:
   ur_idx_id_seq_unique
   ur_idx_entity_type
   ur_idx_at
   ur_idx_tenant_id

============================================================
🔒 2. POLÍTICAS RLS (Row-Level Security)
============================================================
RLS Status: ✅ HABILITADO

📜 Políticas RLS:
   policy_tenant_isolation (SELECT)
   policy_owner_access (SELECT)

============================================================
⚙️  3. KERNELS PERSISTIDOS
============================================================
Total de kernels ativos: 12

📦 Kernels:
   00000000-0000-4000-8000-000000000001
      Nome: run_code_kernel (seq=3, status=active) - Execute user functions
   00000000-0000-4000-8000-000000000002
      Nome: observer_bot_kernel (seq=2, status=active) - Monitor and schedule
   ...

============================================================
📊 4. ESTATÍSTICAS DE SPANS
============================================================
📈 Top 20 tipos de spans:
   function                              45 spans (12 únicos)
   execution                             120 spans (120 únicos)
   memory                                38 spans (38 únicos)
   ...

📊 Total geral: 523 spans

📊 Spans por status:
   complete                              380 spans
   active                                120 spans
   error                                 23 spans

============================================================
🔐 5. ASSINATURAS (Signatures)
============================================================
Total de spans verificáveis: 45
Assinados: 38 (84.4%)
Com hash: 40 (88.9%)
Com key_id: 38 (84.4%)

============================================================
🔍 6. INTEGRIDADE DOS DADOS
============================================================
✅ Versionamento: 12 spans têm versões (seq > 0)
✅ Todos os spans têm owner_id
✅ Metadata válido em todos os spans

============================================================
⏰ 7. ATIVIDADE RECENTE
============================================================
Últimas 24h: 23 spans criados
Última semana: 156 spans criados

📝 Últimos 10 spans:
   [05/01/2025 14:23:45] memory - user:dan stored
   [05/01/2025 14:22:10] execution - kernel:run_code executed
   ...

============================================================
⚡ 8. PERFORMANCE & TAMANHO
============================================================
Tamanho total: 2.5 MB
Tabela: 1.8 MB
Índices: 700 KB
Estimativa de linhas: 523

============================================================
✅ ANÁLISE COMPLETA
============================================================
Todos os checks foram executados com sucesso!
```

---

## Troubleshooting

### Erro: "Could not connect to database"

1. Verifique se `DB_SECRET_ARN` está correto
2. Verifique se `AWS_REGION` está correto
3. Verifique se tem permissão para acessar Secrets Manager
4. Tente usar variáveis de ambiente diretas

### Erro: "relation does not exist"

1. Verifique se o schema `ledger` foi criado
2. Verifique se a tabela `universal_registry` existe
3. Execute migrations se necessário

### Erro: "permission denied"

1. Verifique se o usuário do banco tem permissões
2. Verifique políticas RLS (podem estar bloqueando)

---

## Próximos Passos

Após o raio-X, você pode:

1. **Verificar kernels específicos:**
   ```bash
   npm run verify:kernels
   ```

2. **Sincronizar spans do GitHub:**
   ```bash
   npm run spans:sync
   ```

3. **Ver logs no CloudWatch** (se houver problemas)

---

**Status:** Pronto para uso! 🚀

