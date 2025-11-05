# 🔐 API Key Issuance - Fluxo Ledger-Native

## Comparação: Híbrido vs Ledger-Native Puro

### ❌ Opção A: Híbrido (Atual)

```
Cliente → /auth/keys/request
    ↓
Auth Service:
  - Cria span api_key_request ✅
  - Cria wallet direto no DynamoDB ❌
  - Emite token direto ❌
  - Retorna token imediatamente ❌
```

**Problemas:**
- Mistura responsabilidades (API cria + executa)
- Não é 100% ledger-native
- Não pode ser governado por laws
- Não é assíncrono

---

### ✅ Opção B: Ledger-Native Puro (Melhor)

```
Cliente → /auth/keys/request
    ↓
Auth Service: APENAS cria span api_key_request no ledger
    ↓
Kernel: api_key_issuer (lê spans pendentes)
    ↓
Kernel: Chama AWS (DynamoDB + Secrets Manager)
    ↓
Kernel: Cria span api_token_issued (com token)
    ↓
Cliente: Consulta span ou recebe via webhook
```

**Vantagens:**
- ✅ Tudo auditável (100% spans)
- ✅ Governado (laws controlam quando emitir)
- ✅ Idempotente (spans garantem)
- ✅ Assíncrono (processa em batch)
- ✅ Constitucional (segue LogLine Constitution v1.1)

---

## Fluxo Detalhado (Ledger-Native Puro)

### 1. Cliente Solicita API Key

**Endpoint:** `POST /auth/keys/request`

**Request:**
```json
{
  "email": "dan@voulezvous.com",
  "tenant_id": "voulezvous",
  "scopes": ["wallet.open", "span.sign"]
}
```

**O que acontece:**
- Auth Service **APENAS** cria span `api_key_request` no ledger
- **NÃO** cria wallet
- **NÃO** emite token
- **NÃO** chama AWS

**Span criado:**
```json
{
  "id": "span:api_key_request:abc123",
  "seq": 0,
  "entity_type": "api_key_request",
  "who": "user:self",
  "did": "requested",
  "this": "security.api_key",
  "status": "pending",
  "tenant_id": "voulezvous",
  "metadata": {
    "email": "dan@voulezvous.com",
    "tenant_id": "voulezvous",
    "requested_scopes": ["wallet.open", "span.sign"],
    "law": {
      "scope": "api_key",
      "targets": ["api_key_issuer:1.0.0"],
      "triage": "auto"
    }
  }
}
```

**Response:**
```json
{
  "ok": true,
  "request_id": "span:api_key_request:abc123",
  "status": "pending",
  "message": "API key request submitted. Check status via /auth/keys/status/{request_id}"
}
```

---

### 2. Kernel: `api_key_issuer`

**ID:** `00000000-0000-4000-8000-000000000021`

**Função:**
1. Lê spans `api_key_request` com `status=pending`
2. Para cada request:
   - Valida request (email, tenant_id, scopes)
   - Cria wallet se não existe (DynamoDB)
   - Gera token (Argon2id hash)
   - Armazena no DynamoDB
   - Cria span `api_token_issued` (com token plaintext)
   - Atualiza request para `status=completed`

**Código do Kernel:**
```javascript
globalThis.default = async function apiKeyIssuer(ctx) {
  const { client } = ctx;
  const { limit = 10 } = ctx.input || {};
  
  // Busca requests pendentes
  const { rows: requests } = await client.query(`
    SELECT * FROM ledger.visible_timeline
    WHERE entity_type = 'api_key_request'
      AND status = 'pending'
    ORDER BY at ASC
    LIMIT $1
  `, [limit]);
  
  const results = [];
  
  for (const req of requests) {
    const meta = req.metadata || {};
    const email = meta.email;
    const tenantId = meta.tenant_id || req.tenant_id;
    const walletId = `wlt_${tenantId}_${email.split('@')[0]}`;
    
    try {
      // 1. Criar wallet se não existe (via DynamoDB)
      await ensureWalletExists(walletId, email, tenantId);
      
      // 2. Gerar token
      const token = await generateApiToken();
      const tokenHash = await calculateTokenHash(token);
      
      // 3. Armazenar no DynamoDB
      await storeTokenInDynamoDB(tokenHash, walletId, tenantId, meta.requested_scopes);
      
      // 4. Criar span api_token_issued (COM TOKEN PLAINTEXT - única vez!)
      const issuedSpanId = require('crypto').randomUUID();
      await client.query(`
        INSERT INTO ledger.universal_registry
          (id, seq, entity_type, who, did, this, at, status, metadata, owner_id, tenant_id, visibility, links)
        VALUES ($1, 0, 'api_token_issued', 'kernel:api_key_issuer', 'issued', 'security.token', NOW(), 'complete', $2, $3, $4, 'tenant', $5)
      `, [
        issuedSpanId,
        JSON.stringify({
          token: token,  // PLAINTEXT - apenas nesta span!
          token_hash: tokenHash,
          wallet_id: walletId,
          scopes: meta.requested_scopes,
          exp: Math.floor(Date.now() / 1000) + (720 * 3600)
        }),
        req.owner_id || email,
        tenantId,
        JSON.stringify({ caused_by: req.id })
      ]);
      
      // 5. Atualizar request (append-only)
      const { rows: seqRows } = await client.query(
        'SELECT COALESCE(MAX(seq), -1) + 1 as next_seq FROM ledger.universal_registry WHERE id = $1',
        [req.id]
      );
      await client.query(`
        INSERT INTO ledger.universal_registry
          (id, seq, entity_type, who, did, this, at, status, metadata)
        VALUES ($1, $2, 'api_key_request', 'kernel:api_key_issuer', 'updated', 'security.api_key', NOW(), 'completed', $3)
      `, [req.id, seqRows[0].next_seq, req.metadata]);
      
      results.push({
        request_id: req.id,
        status: 'success',
        token_span_id: issuedSpanId,
        wallet_id: walletId
      });
      
    } catch (err) {
      // Criar span api_key_request_failed
      await client.query(`
        INSERT INTO ledger.universal_registry
          (id, seq, entity_type, who, did, this, at, status, metadata, links)
        VALUES ($1, 0, 'api_key_request_failed', 'kernel:api_key_issuer', 'failed', 'security.api_key', NOW(), 'failed', $2, $3)
      `, [
        require('crypto').randomUUID(),
        JSON.stringify({ error: err.message, request_metadata: meta }),
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
```

---

### 3. Cliente Consulta Status

**Endpoint:** `GET /auth/keys/status/{request_id}`

**Response:**
```json
{
  "request_id": "span:api_key_request:abc123",
  "status": "completed",
  "token_span_id": "span:api_token_issued:xyz789",
  "wallet_id": "wlt_voulezvous_dan"
}
```

**Cliente busca span `api_token_issued`:**
```json
{
  "id": "span:api_token_issued:xyz789",
  "metadata": {
    "token": "tok_live_AbCdEf123...",  // PLAINTEXT - apenas aqui!
    "token_hash": "argon2id_hash...",
    "wallet_id": "wlt_voulezvous_dan",
    "scopes": ["wallet.open", "span.sign"],
    "exp": 1734048000
  }
}
```

---

## Comparação Final

| Aspecto | Híbrido (Atual) | Ledger-Native (Melhor) |
|---------|----------------|------------------------|
| **Auditabilidade** | Parcial (spans criados, mas execução direta) | Total (tudo no ledger) |
| **Governança** | Não (API executa direto) | Sim (laws controlam kernel) |
| **Idempotência** | Parcial | Total (spans garantem) |
| **Assíncrono** | Não (síncrono) | Sim (kernel processa em batch) |
| **Constitucional** | Não | Sim (segue LogLine Constitution) |
| **Complexidade** | Baixa (direto) | Média (kernel extra) |
| **Latência** | Baixa (imediato) | Média (espera kernel) |

---

## Recomendação: Ledger-Native Puro ✅

**Por quê?**
1. **Constitucional** - Segue LogLine Constitution v1.1
2. **Governado** - Laws podem controlar quando emitir
3. **Auditável** - 100% spans, tudo rastreável
4. **Escalável** - Kernel processa em batch
5. **Consistente** - Mesmo padrão de tudo (deploy, etc)

**Trade-off:**
- Latência um pouco maior (segundos, não horas)
- Kernel extra para manter

**Vale a pena?** Sim! Governança perfeita > latência mínima.

---

## Implementação

1. **Modificar Auth Service** - Apenas criar spans
2. **Criar Kernel `api_key_issuer`** - Processa spans
3. **Atualizar Manifest** - Adicionar kernel aos allowed_boot_ids
4. **Endpoint de Status** - Cliente consulta resultado

**Status:** Pronto para implementar

