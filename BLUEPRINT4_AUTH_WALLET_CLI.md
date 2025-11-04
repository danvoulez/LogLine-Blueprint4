# 🔒 AUTH + 🔐 WALLET + 🛰️ CLI as a Service — Consolidação Final

**Status:** Frozen Design (SST — Single Source of Truth)  
**Version:** 1.0  
**Date:** 2025-01-XX

---

## 0) Decisões Congeladas (SST — Single Source of Truth)

* **Sem senha.** Autenticação padrão por API Key: `Authorization: ApiKey tok_...`

* **Governança e assinatura:** toda mutação relevante gera span assinado (Ed25519+BLAKE3) — a assinatura é feita dentro do Wallet.

* **Wallet (Cofre):** guarda chaves e credenciais; expõe operações seguras (`sign.span`, `sign.http`, `provider.invoke`), nunca devolve segredo.

* **Authorizer:** valida ApiKey (agora) e já fica pronto para aceitar JWT curto e Ed25519 direto depois (modo híbrido).

* **Ledger/Stage-0:** recusa INSERT sem `sig{}` válido. Manifest controla `allowed_boot_ids`.

* **Clientes (Vercel, iOS GPT, CLI):** usam ApiKey; o servidor faz o resto via Wallet.

---

## 1) Mapa de Componentes (AWS)

* **API Gateway (REST):** `/auth/*`, `/wallet/*`, `/cli/*`, `/api/spans`

* **Lambda Authorizer:** `auth_api_key_authorizer` (valida ApiKey, injeta `{wallet_id, tenant_id, scopes}`)

* **Lambda Wallet Service:** `wallet_service` (`/wallet/open|sign.span|sign.http|provider.invoke|key.*`)

* **Lambda CLI Service:** `cli_service` (atalhos HTTP que chamam Stage-0 + Wallet)

* **Lambda Stage-0 Loader:** `stage0_loader` (executa kernels do ledger)

* **RDS Postgres:** `ledger.universal_registry` (+ colunas de assinatura/selo)

* **DynamoDB:** `auth_api_tokens` (tokens), `wallets` (metadados/itens), `nonces` (anti-replay)

* **Secrets Manager + KMS:** Ed25519 priv, keys de provedores, pepper

---

## 2) Modelos & Tabelas

### 2.1 DynamoDB `auth_api_tokens`

```json
{
  "token_hash": "argon2id(hmac(pepper, tok_live_...))",
  "wallet_id": "wlt_voulezvous_dan",
  "tenant_id": "voulezvous",
  "scopes": [
    "wallet.open",
    "span.sign",
    "provider.invoke:anthropic/*",
    "prompt.fetch",
    "memory.*"
  ],
  "exp": 1734048000,
  "status": "active",
  "description": "Token Vercel frontend",
  "created_at": 1730712345,
  "created_by": "admin@voulezvous"
}
```

**PK:** `token_hash` (hash do token)  
**GSI:** `wallet_id` (para listar tokens por wallet)

### 2.2 DynamoDB `wallets`

```json
{
  "wallet_id": "wlt_voulezvous_dan",
  "owner_id": "dan@voulezvous",
  "tenant_id": "voulezvous",
  "items": {
    "kid_ed25519_main": {
      "type": "ed25519",
      "pubkey_hex": "<hex>",
      "secret_ref": "arn:aws:secretsmanager:...:secret:ed25519_main",
      "caps": ["sign.span", "sign.http"],
      "status": "active"
    },
    "kid_provider_anthropic": {
      "type": "provider_key",
      "provider": "anthropic",
      "secret_ref": "arn:...:secret:anthropic_api_key",
      "caps": ["provider.invoke:anthropic/*"],
      "status": "active"
    }
  },
  "status": "active",
  "created_at": 1730712345
}
```

**PK:** `wallet_id`

### 2.3 DynamoDB `nonces`

* **PK:** `k` = `keyid|nonce`
* **TTL:** `ttl` = epoch + 300 (5 min)

Usado para anti-replay quando necessário (p.ex., `sign.http` Ed25519).

### 2.4 Ledger (RDS) — Colunas Extra (se ainda não criou)

```sql
ALTER TABLE ledger.universal_registry
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS sig_alg text,
  ADD COLUMN IF NOT EXISTS sig_key_id text,
  ADD COLUMN IF NOT EXISTS sig_kid text,
  ADD COLUMN IF NOT EXISTS sig_ts timestamptz,
  ADD COLUMN IF NOT EXISTS sig_nonce text,
  ADD COLUMN IF NOT EXISTS signature text;
```

---

## 3) Endpoints (Contratos Estáveis)

### 3.1 AUTH (admin)

**Base:** `/auth/keys/*` (requer ApiKey admin)

#### `POST /auth/keys/issue`

**in:**
```json
{
  "wallet_id": "wlt_voulezvous_dan",
  "tenant_id": "voulezvous",
  "scopes": ["wallet.open", "span.sign", "provider.invoke:anthropic/*"],
  "ttl_hours": 720,
  "description": "Token Vercel frontend"
}
```

**out:**
```json
{
  "token": "tok_live_...",
  "exp": 1734048000
}
```
(mostra uma vez)

#### `POST /auth/keys/revoke`

**in:**
```json
{
  "token_last4": "...",
  "token_hash": "...",
  "wallet_id": "..."
}
```
→ `200 ok`

#### `POST /auth/keys/rotate`

**in:**
```json
{
  "wallet_id": "wlt_voulezvous_dan",
  "scopes": [...],
  "ttl_hours": 720
}
```

**out:**
```json
{
  "token": "tok_live_...",
  "exp": 1734048000
}
```
+ antiga revogada

#### `GET /auth/keys/list`

**out:** lista metadados (nunca o token em claro)

---

### 3.2 WALLET (cofre)

**Base:** `/wallet/*` (usa `Authorization: ApiKey tok_live_...`)

#### `POST /wallet/open`

**out:**
```json
{
  "wallet_session": "wss_...",
  "wallet_id": "wlt_voulezvous_dan",
  "exp": 1730740831000
}
```
(TTL 5–10 min)

#### `POST /wallet/sign/span`

**in:**
```json
{
  "kid": "kid_ed25519_main",
  "span": { /* span sem sig{} */ }
}
```

**out:**
```json
{
  "payload_hash": "b3:<hex>",
  "sig": {
    "alg": "ed25519-blake3-v1",
    "key_id": "did:logline:<b3(pubkey_hex)>",
    "kid": "kid_ed25519_main",
    "ts": 1730740831000,
    "nonce": "<base64url>",
    "signature": "<hex>"
  }
}
```

#### `POST /wallet/sign/http` (opcional)

**in:**
```json
{
  "kid": "kid_ed25519_main",
  "method": "POST",
  "path_with_query": "/api/spans?tenant=acme",
  "body_canon": "<canonical JSON>"
}
```

**out:**
```json
{
  "headers": {
    "X-LL-Alg": "ed25519-blake3-v1",
    "X-LL-KeyID": "did:logline:...",
    "X-LL-KID": "kid_ed25519_main",
    "X-LL-TS": "1730740831000",
    "X-LL-Nonce": "<base64url>",
    "X-LL-Signature": "<hex>"
  }
}
```

#### `POST /wallet/provider/invoke`

**in:**
```json
{
  "kid": "kid_provider_anthropic",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet",
  "input": { "messages": [...] },
  "with_memory": true,
  "byo_key": false
}
```

**out:**
```json
{
  "output": { "text": "..." },
  "usage": { "input_tokens": 100, "output_tokens": 50 },
  "trace_id": "..."
}
```

#### `POST /wallet/key/register|rotate|revoke` (admin do tenant)

---

### 3.3 CLI as a Service

**Base:** `/cli/*` (atalhos que já chamam Wallet e Stage-0)

#### `POST /cli/run`

```json
{
  "boot_function_id": "00000000-0000-4000-8000-000000000001",
  "input": { ... }
}
```

#### `POST /cli/ask`

```json
{
  "text": "Resuma https://voulezvous.pt",
  "model": "claude-3-5-sonnet",
  "with_memory": true,
  "vars": { ... }
}
```
(usa `wallet.provider.invoke`)

#### `POST /cli/memory.add`

```json
{
  "content": "Dan prefere espresso curto",
  "tags": ["perfil", "cafe"],
  "layer": "session"
}
```
(gera span assinado)

#### `POST /cli/memory.search`

```json
{
  "query": "espresso",
  "limit": 10
}
```

#### `POST /cli/prompt.fetch`

```json
{
  "prompt_id": "00000000-0000-4000-8000-000000000101",
  "vars": { "user_name": "Dan" }
}
```

#### `POST /cli/app.register`

```json
{
  "app_id": "writer-bot",
  "intent_set": ["memory.upsert", "prompt_runner.execute"],
  "requires_caps": ["memory.write", "provider.invoke:*"],
  "default_slo": { "p95_ms": 800, "min_quality": 0.7 },
  "memory_contracts": ["basic_memory"],
  "prompt_blocks": ["dialogue_block", "feedback_block"],
  "visibility": "tenant"
}
```
(onboarding via spans)

**Headers padrão de cliente:**

```
Authorization: ApiKey tok_live_...
X-User-Id: danvoulez
X-Tenant-Id: voulezvous
Content-Type: application/json
```

---

## 4) Assinatura de Spans (Ed25519 + BLAKE3 no Vault)

**Forma final persistida:**

```json
{
  "...campos do span...",
  "payload_hash": "b3:<hex(blake3(canonical(span_sem_sig)))>",
  "sig": {
    "alg": "ed25519-blake3-v1",
    "key_id": "did:logline:<b3(pubkey_hex)>",
    "kid": "kid_ed25519_main",
    "ts": 1730740831000,
    "nonce": "<base64url>",
    "signature": "<hex>"
  }
}
```

**Stage-0 / API — regra:** só insere se `sig{}` for válido para `payload_hash` e `key_id` existir/ativo no ledger (spans `logline_id`).

---

## 5) Authorizer (ApiKey) — Comportamento

* Lê `Authorization: ApiKey tok_xxx`
* Calcula `token_hash = argon2id(hmac(pepper, tok_xxx))`
* Busca em `auth_api_tokens`. Verifica `status=active` e `exp>=now`.
* Injeta `principalId = wallet_id`, `context = { wallet_id, tenant_id, scopes_json }`
* (Opcional) Usage plan + rate-limit por token

**Híbrido pronto:** no futuro, também aceitar:

* `Authorization: Bearer <jwt_curto>` (emitido por token_issuer)
* Tráfego Ed25519 direto (headers `X-LL-*`) quando for útil

---

## 6) Variáveis de Ambiente (Nomes Únicos)

### Authorizer

* `TOKENS_TABLE=auth_api_tokens`
* `TOKENS_PEPPER_SECRET_ARN=arn:aws:secretsmanager:...:secret:auth_pepper`
* `WALLETS_TABLE=wallets`

### Wallet Service

* `WALLETS_TABLE=wallets`
* `NONCE_TABLE=nonces`
* `AWS_REGION=us-east-1`
* (acesso a Secrets Manager + KMS por IAM)

### CLI Service

* `STAGE0_FUNCTION_NAME=loglineos-stage0-loader`

### Stage-0 Loader

* `DB_SECRET_ARN=arn:aws:secretsmanager:...:secret:db_loglineos`
* (se for verificar Ed25519 de spans, acesso ao ledger e ao wallets/logline_id)

---

## 7) cURLs — Fumaça de Ponta a Ponta

### 7.1 Emitir token (admin)

```bash
curl -sS -X POST https://…/dev/auth/keys/issue \
  -H "Authorization: ApiKey tok_admin_..." \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id":"wlt_voulezvous_dan",
    "tenant_id":"voulezvous",
    "scopes":["wallet.open","span.sign","provider.invoke:anthropic/*","prompt.fetch","memory.*"],
    "ttl_hours":720,
    "description":"Vercel Frontend"
  }'

# -> { "token":"tok_live_…", "exp":… }
```

### 7.2 Onboarding de app (via CLI as a Service)

```bash
curl -sS -X POST https://…/dev/cli/app.register \
  -H "Authorization: ApiKey tok_live_…" \
  -H "X-User-Id: danvoulez" -H "X-Tenant-Id: voulezvous" \
  -H "Content-Type: application/json" \
  -d '{
    "app_id":"writer-bot",
    "intent_set":["memory.upsert","prompt_runner.execute"],
    "requires_caps":["memory.write","provider.invoke:*"],
    "default_slo":{"p95_ms":800,"min_quality":0.7},
    "memory_contracts":["basic_memory"],
    "prompt_blocks":["dialogue_block","feedback_block"],
    "visibility":"tenant"
  }'
```

### 7.3 Memória: adicionar e buscar

#### add

```bash
curl -sS -X POST https://…/dev/cli/memory.add \
  -H "Authorization: ApiKey tok_live_…" \
  -H "X-User-Id: danvoulez" -H "X-Tenant-Id: voulezvous" \
  -H "Content-Type: application/json" \
  -d '{ "content":"Dan prefere espresso curto", "tags":["perfil","cafe"], "layer":"session" }'
```

#### search

```bash
curl -sS -X POST https://…/dev/cli/memory.search \
  -H "Authorization: ApiKey tok_live_…" \
  -H "X-User-Id: danvoulez" -H "X-Tenant-Id: voulezvous" \
  -H "Content-Type: application/json" \
  -d '{ "query":"espresso", "limit":10 }'
```

### 7.4 Prompt: fetch

```bash
curl -sS -X POST https://…/dev/cli/prompt.fetch \
  -H "Authorization: ApiKey tok_live_…" \
  -H "X-User-Id: danvoulez" -H "X-Tenant-Id: voulezvous" \
  -H "Content-Type: application/json" \
  -d '{ "prompt_id":"00000000-0000-4000-8000-000000000101", "vars":{"user_name":"Dan"} }'
```

### 7.5 Perguntar ao LLM (BYO key por request ou via Wallet)

```bash
curl -sS -X POST https://…/dev/cli/ask \
  -H "Authorization: ApiKey tok_live_…" \
  -H "X-User-Id: danvoulez" -H "X-Tenant-Id: voulezvous" \
  -H "Content-Type: application/json" \
  -d '{ "text":"Resuma https://voulezvous.pt", "with_memory":true, "model":"claude-3-5-sonnet" }'
```

---

## 8) Pipeline de Validação (Onde Cada Coisa Roda)

* **Authorizer:** valida ApiKey → injeta contexto de wallet/tenant/escopos

* **CLI Service:** para spans → chama `wallet.open` + `wallet.sign.span` → envia para Stage-0  
  para LLM → `wallet.provider.invoke`

* **Stage-0:** verifica `sig{}` e `payload_hash` → grava no ledger

---

## 9) IAM (Mínimo)

* **Authorizer:** `dynamodb:GetItem/Query/Scan` em `auth_api_tokens`; `secretsmanager:GetSecretValue` (pepper); read em `wallets`

* **Wallet:** `secretsmanager:GetSecretValue` para cada `secret_ref` do wallet; `kms:Decrypt`; `dynamodb:Get/Put` em `nonces` (se usar), read em `wallets`

* **CLI Service:** `lambda:InvokeFunction` no `stage0_loader`

* **Stage-0:** acesso ao Postgres e leitura de `logline_id`/wallet quando validar assinaturas

---

## 10) Go-Live Checklist (Rápido)

1. ✅ Criar DDB: `auth_api_tokens`, `wallets`, `nonces`(TTL)
2. ✅ Gravar Secrets: `auth_pepper`, `ed25519_main` priv, `anthropic_api_key`…
3. ✅ Deploy Lambdas: `auth_api_key_authorizer`, `wallet_service`, `cli_service`, `stage0_loader`
4. ✅ Plugar Authorizer no API Gateway (`/auth/*`, `/wallet/*`, `/cli/*`, `/api/spans`)
5. ✅ Seed wallets (com `kid_ed25519_main` + provider key) e `logline_id` (pubkey no ledger)
6. ✅ Stage-0: recusar spans sem `sig{}`
7. ✅ Emitir ApiKeys: Vercel, CLI, iOS GPT
8. ✅ Rodar cURLs de fumaça (7.x)
9. ✅ CloudWatch alarms: Lambda errors, RDS CPU/Conns
10. ✅ Documentar o token rotate (mensal) e salvar Runbook

---

## 11) Roadmap (Sem Quebrar Clientes)

* **JWT curto (5–10 min)** como alternativa a ApiKey (para GPT Actions/Edge).
* **Passkeys/WebAuthn** para o painel administrativo emitir tokens em 1 clique.
* **Nitro Enclaves** para operação de chaves "sealed".
* **Ed25519 direto** em UIs que suportem (mantendo ApiKey como fallback).

---

**End of Specification**

