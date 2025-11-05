# 🔐 Deploy Ledger-Native (Constitution v1.1)

## Princípio

**Tudo via ledger!** Deploys não devem ser diretos (GitHub Actions → AWS CLI), mas sim:
1. GitHub Push → Cria **spans de deployment_request**
2. Spans → Ledger (via `/api/spans`)
3. Stage-0 executa **kernel de deploy** (lê spans do ledger)
4. Kernel de deploy → Faz chamadas AWS
5. Tudo auditável e governado

---

## Fluxo Correto

```
GitHub Push
    ↓
GitHub Action (transform-to-spans)
    ↓
Cria spans: deployment_request
    ↓
Spans → Ledger (via /api/spans)
    ↓
Stage-0 executa kernel: deployment_executor
    ↓
Kernel lê spans do ledger
    ↓
Kernel faz deploy na AWS (via AWS SDK)
    ↓
Kernel cria spans: deployment_completed
```

---

## Span: `deployment_request`

```json
{
  "id": "span:deployment:<uuid>",
  "seq": 0,
  "entity_type": "deployment_request",
  "who": "system:github_actions",
  "did": "requested",
  "this": "deployment",
  "at": "2025-11-05T10:00:00Z",
  "status": "pending",
  "tenant_id": "system",
  "visibility": "public",
  "metadata": {
    "target": "lambda",
    "function_name": "loglineos-auth-service",
    "source": "lambda/auth_service",
    "commit_sha": "abc123...",
    "environment": "dev",
    "law": {
      "scope": "deployment",
      "targets": ["deployment_executor:1.0.0"],
      "triage": "auto"
    }
  },
  "sig": {
    "alg": "ed25519-blake3-v1",
    "key_id": "did:logline:...",
    "signature": "..."
  }
}
```

---

## Kernel: `deployment_executor`

**ID:** `00000000-0000-4000-8000-000000000020`

**Função:**
1. Lê spans `deployment_request` com `status=pending`
2. Para cada request:
   - Builda Lambda (npm install + zip)
   - Faz deploy via AWS SDK
   - Cria span `deployment_completed`
   - Atualiza status do request

**Código (kernel):**
```javascript
globalThis.default = async function deploymentExecutor(ctx) {
  const { client } = ctx;
  const { limit = 10 } = ctx.input || {};
  
  // Busca deployment requests pendentes
  const { rows: requests } = await client.query(`
    SELECT * FROM ledger.visible_timeline
    WHERE entity_type = 'deployment_request'
      AND status = 'pending'
    ORDER BY at ASC
    LIMIT $1
  `, [limit]);
  
  const results = [];
  
  for (const req of requests) {
    const meta = req.metadata || {};
    const target = meta.target; // 'lambda', 'terraform', etc.
    
    try {
      if (target === 'lambda') {
        // Deploy Lambda
        const result = await deployLambda(meta);
        
        // Cria span deployment_completed
        await client.query(`
          INSERT INTO ledger.universal_registry
            (id, seq, entity_type, who, did, this, at, status, metadata, links)
          VALUES ($1, 0, 'deployment_completed', 'system:deployment_executor', 'completed', 'deployment', NOW(), 'complete', $2, $3)
        `, [
          require('crypto').randomUUID(),
          JSON.stringify({
            function_name: meta.function_name,
            deployment_id: result.deployment_id,
            status: 'success'
          }),
          JSON.stringify({ caused_by: req.id })
        ]);
        
        // Atualiza request (novo seq)
        const nextSeq = (await client.query('SELECT COALESCE(MAX(seq), -1) + 1 as next FROM ledger.universal_registry WHERE id = $1', [req.id])).rows[0].next;
        await client.query(`
          INSERT INTO ledger.universal_registry
            (id, seq, entity_type, who, did, this, at, status, metadata)
          VALUES ($1, $2, 'deployment_request', 'system:deployment_executor', 'updated', 'deployment', NOW(), 'completed', $3)
        `, [req.id, nextSeq, req.metadata]);
        
        results.push({ request_id: req.id, status: 'success' });
      }
    } catch (err) {
      // Cria span deployment_failed
      await client.query(`
        INSERT INTO ledger.universal_registry
          (id, seq, entity_type, who, did, this, at, status, metadata, links)
        VALUES ($1, 0, 'deployment_failed', 'system:deployment_executor', 'failed', 'deployment', NOW(), 'failed', $2, $3)
      `, [
        require('crypto').randomUUID(),
        JSON.stringify({
          function_name: meta.function_name,
          error: err.message
        }),
        JSON.stringify({ caused_by: req.id })
      ]);
      
      results.push({ request_id: req.id, status: 'failed', error: err.message });
    }
  }
  
  return {
    status: 'complete',
    processed: requests.length,
    results: results
  };
};

async function deployLambda(meta) {
  const { LambdaClient, UpdateFunctionCodeCommand } = require('@aws-sdk/client-lambda');
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  
  // Build Lambda
  const sourceDir = meta.source;
  process.chdir(sourceDir);
  execSync('npm install --production', { stdio: 'inherit' });
  const zipPath = path.join('..', `${meta.function_name}.zip`);
  execSync(`zip -r ${zipPath} . -x "*.git*" "*.md"`, { stdio: 'inherit' });
  
  // Deploy via AWS SDK
  const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const zipBuffer = fs.readFileSync(zipPath);
  
  await lambda.send(new UpdateFunctionCodeCommand({
    FunctionName: meta.function_name,
    ZipFile: zipBuffer
  }));
  
  return { deployment_id: require('crypto').randomUUID() };
}
```

---

## GitHub Action Atualizado

```yaml
name: Request Deployment via Ledger

on:
  push:
    branches: [main]

jobs:
  create-deployment-spans:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Create deployment request spans
        run: |
          node scripts/create-deployment-spans.js
          
      - name: Send spans to ledger
        run: |
          node scripts/sync-spans-to-ledger.js
        env:
          API_GATEWAY_URL: ${{ secrets.API_GATEWAY_URL }}
          API_KEY: ${{ secrets.API_KEY }}
```

---

## Script: `create-deployment-spans.js`

```javascript
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

// Detecta Lambdas que mudaram
const lambdaDirs = [
  'lambda/auth_service',
  'lambda/wallet_service',
  'lambda/cli_service',
  'lambda/auth_api_key_authorizer',
  'lambda/email_service',
  'lambda/onboard_agent'
];

const spans = [];

for (const dir of lambdaDirs) {
  if (!fs.existsSync(dir)) continue;
  
  const functionName = `loglineos-${path.basename(dir).replace('_', '-')}`;
  
  spans.push({
    id: `span:deployment:${randomBytes(16).toString('hex')}`,
    seq: 0,
    entity_type: 'deployment_request',
    who: 'system:github_actions',
    did: 'requested',
    this: 'deployment',
    at: new Date().toISOString(),
    status: 'pending',
    tenant_id: 'system',
    visibility: 'public',
    metadata: {
      target: 'lambda',
      function_name: functionName,
      source: dir,
      commit_sha: process.env.GITHUB_SHA,
      environment: 'dev',
      law: {
        scope: 'deployment',
        targets: ['deployment_executor:1.0.0'],
        triage: 'auto'
      }
    }
  });
}

// Salva spans
fs.mkdirSync('.ledger/spans', { recursive: true });
fs.writeFileSync(
  '.ledger/spans/deployment_request.ndjson',
  spans.map(s => JSON.stringify(s)).join('\n')
);
```

---

## Governança (Law)

Criar `midnight_deployment.law`:

```
law midnight_deployment:1.0.0:
  scope: deployment
  clock: midnight Europe/Paris

  if ok: status == "pending" AND approved == true
  then: deploy, append_ledger

  if doubt: status == "pending" AND approved == false
  then: hold(hours=24), notify(role=ops), append_ledger

  if not: status == "pending" AND deadline_at < now
  then: terminate(reason=timeout), append_ledger
```

---

## Benefícios

✅ **Auditável** - Tudo no ledger  
✅ **Governado** - Laws controlam quando deployar  
✅ **Idempotente** - Spans garantem não duplicar  
✅ **Traceável** - `trace_id` e `links.caused_by`  
✅ **Constitucional** - Segue LogLine Constitution v1.1

---

**Status:** Arquitetura proposta  
**Próximo passo:** Implementar kernel `deployment_executor` e atualizar GitHub Actions

