# 🔄 CI/CD: GitHub → Ledger

## Fluxo de Dados

```
GitHub Push
    ↓
GitHub Action (transform-to-spans)
    ↓
Arquivos → Spans (NDJSON)
    ↓
GitHub Action (sync-to-ledger)
    ↓
Spans → Ledger (via API ou DB direto)
    ↓
Stage-0 (apenas recebe spans prontos)
```

## Princípios

1. **Stage-0 só recebe spans** - Não processa arquivos brutos
2. **Transformação acontece ANTES** - GitHub Action ou serviço intermediário
3. **Ledger é append-only** - Spans são inseridos, nunca atualizados diretamente
4. **Versionamento via seq** - Mesmo ID pode ter múltiplos seq (append-only)

## Componentes

### 1. GitHub Action Workflow

**Arquivo:** `.github/workflows/sync-to-ledger.yml`

**Jobs:**
- `transform-to-spans`: Transforma arquivos em spans (NDJSON)
- `sync-to-ledger`: Envia spans para o ledger

### 2. Script de Transformação

**Arquivo:** `scripts/github-to-spans.js`

**Função:**
- Lê arquivos de `ROW/` (kernels, prompts, policies, etc.)
- Transforma em spans com metadata do Git
- Gera NDJSON em `.ledger/spans/`

**Entrada:**
- `ROW/kernels/*.ndjson`
- `ROW/prompts/*.ndjson`
- `ROW/policies/*.ndjson`
- `ROW/manifest/*.ndjson`

**Saída:**
- `.ledger/spans/function.ndjson`
- `.ledger/spans/prompt_block.ndjson`
- `.ledger/spans/policy.ndjson`
- `.ledger/spans/manifest.ndjson`

### 3. Script de Sincronização

**Arquivo:** `scripts/sync-spans-to-ledger.js`

**Função:**
- Lê spans NDJSON de `.ledger/spans/`
- Insere no ledger via:
  - **API Gateway** (se `API_GATEWAY_URL` + `API_KEY`)
  - **DB direto** (se `DB_SECRET_ARN` ou env vars)

**Métodos de inserção:**
1. **Via API Gateway** (recomendado):
   ```bash
   export API_GATEWAY_URL="https://api.example.com/dev"
   export API_KEY="tok_live_..."
   node scripts/sync-spans-to-ledger.js
   ```

2. **Via DB direto** (para CI/CD):
   ```bash
   export DB_SECRET_ARN="arn:aws:secretsmanager:..."
   node scripts/sync-spans-to-ledger.js
   ```

## Setup

### 1. Secrets do GitHub

Adicione no GitHub → Settings → Secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `DB_SECRET_ARN` (ou `DB_USER`, `DB_PASS`, etc.)
- `API_GATEWAY_URL` (opcional, se usar API)
- `API_KEY` (opcional, se usar API)

### 2. Trigger do Workflow

O workflow é acionado quando:
- Push para `main` com mudanças em:
  - `ROW/**`
  - `FILES/src/**`
  - `lambda/**`
- Ou manualmente via `workflow_dispatch`

## Execução Local

### Transformar arquivos em spans:

```bash
export GITHUB_SHA="$(git rev-parse HEAD)"
export GITHUB_REF="$(git rev-parse --abbrev-ref HEAD)"
export GITHUB_REPOSITORY="danvoulez/LogLine-Deploy"

node scripts/github-to-spans.js
```

### Sincronizar spans para ledger:

```bash
# Via DB direto
export DB_SECRET_ARN="arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb"
node scripts/sync-spans-to-ledger.js

# Ou via API
export API_GATEWAY_URL="https://api.example.com/dev"
export API_KEY="tok_live_..."
node scripts/sync-spans-to-ledger.js
```

## Fluxo Detalhado

### 1. Developer faz push

```bash
git add ROW/kernels/15-new-kernel.ndjson
git commit -m "Add new kernel"
git push origin main
```

### 2. GitHub Action detecta mudança

- Workflow `sync-to-ledger.yml` é acionado
- Job `transform-to-spans` executa:
  - Lê `ROW/kernels/15-new-kernel.ndjson`
  - Transforma em span com metadata Git
  - Gera `.ledger/spans/function.ndjson`
  - Upload como artifact

### 3. Job `sync-to-ledger` executa

- Download do artifact
- Para cada span NDJSON:
  - Valida estrutura
  - Insere no ledger (via API ou DB)
  - Verifica conflitos (seq)

### 4. Stage-0 recebe span

- Stage-0 **só lê** spans do ledger
- Não processa arquivos brutos
- Executa kernels que estão no manifest

## Verificação

Após sync, verifique:

```bash
# Verificar kernels no banco
node scripts/verify-kernels-in-db.js

# Ou via SQL
psql -h <host> -U ledger_admin -d loglineos -f scripts/verify-kernels.sql
```

## Troubleshooting

### Spans não aparecem no banco

1. Verificar logs do GitHub Action
2. Verificar se DB_SECRET_ARN está correto
3. Verificar se RLS permite inserção
4. Verificar se há conflitos de ID/seq

### Erro "duplicate key"

- Normal - span já existe
- Script tenta incrementar `seq` automaticamente

### Erro de conexão

- Verificar credenciais AWS
- Verificar Security Group do RDS
- Verificar VPC/subnets

## Alternativa: Serviço Intermediário

Se não quiser usar GitHub Actions, pode criar um serviço que:

1. Recebe webhook do GitHub
2. Transforma arquivos em spans
3. Envia para ledger via API

**Exemplo de webhook handler:**

```javascript
// lambda/github-webhook-handler/index.js
exports.handler = async (event) => {
  // Parse GitHub webhook
  const payload = JSON.parse(event.body);
  const files = payload.commits[0].modified;
  
  // Transform to spans
  const spans = await transformFilesToSpans(files);
  
  // Insert via API
  await insertSpansViaAPI(spans);
};
```

## Notas Importantes

- **Stage-0 NUNCA recebe arquivos** - Apenas spans já formatados
- **Transformação é idempotente** - Pode rodar múltiplas vezes
- **Spans são versionados** - `seq` incrementa automaticamente
- **Git metadata é preservado** - SHA, ref, repo nos spans

---

**Status:** Pronto para uso

