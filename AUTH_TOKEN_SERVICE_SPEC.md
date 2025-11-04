# LogLineOS Token Service — Official Specification

**Status:** Production-ready  
**Scope:** Ledger-native authentication and authorization via API tokens  
**Design tenets:** ledger-only, hash-only storage, scope-based access control, full auditability

---

## 0. Executive Summary

The LogLineOS Token Service provides **ledger-native authentication and authorization** using API tokens. Every token lifecycle event (request, issuance, revocation, rotation, usage) is stored as a **span** in the ledger. Tokens are **never stored in plaintext** — only their BLAKE3 hash is persisted. Authorization is enforced via **Lambda Authorizer** at the API Gateway level, with **scope-based access control** for routes and kernels.

---

## 1. Goals & Non-Goals

**Goals**

* Ledger-native: all token lifecycle events are spans
* Hash-only storage: plaintext tokens never stored in ledger
* Scope-based access control: fine-grained permissions per route/kernel
* Full auditability: every token use logged as `token_use` span
* Zero-downtime rotation: issue new → revoke old
* API Gateway integration: Lambda Authorizer validates tokens

**Non-Goals**

* User authentication (that's handled by your identity provider)
* OAuth2/OIDC flows (tokens are API keys, not OAuth tokens)
* Session management (tokens are stateless)

---

## 2. Data Model

### 2.1 Entity Types

#### `api_token_request`
Request for a new token (before issuance).

```json
{
  "entity_type": "api_token_request",
  "who": "admin",
  "did": "requested",
  "this": "security.token",
  "status": "pending",
  "metadata": {
    "app_id": "minicontratos-gpt",
    "scopes": ["/api/spans:write", "/api/boot:invoke"],
    "ttl_hours": 720
  }
}
```

#### `api_token`
Issued token (hash only in ledger).

```json
{
  "entity_type": "api_token",
  "who": "kernel:token_issuer",
  "did": "issued",
  "this": "security.token",
  "status": "active",
  "metadata": {
    "app_id": "minicontratos-gpt",
    "token_prefix": "tok_acme_",
    "token_hash": "b3:<hex>",
    "scopes": ["/api/spans:write", "/api/boot:invoke"],
    "expires_at": "2025-12-01T00:00:00Z"
  }
}
```

#### `api_token_revoked`
Revocation event (append-only).

```json
{
  "entity_type": "api_token_revoked",
  "who": "kernel:token_revoker",
  "did": "revoked",
  "this": "security.token",
  "status": "revoked",
  "related_to": ["<api_token_id>"],
  "metadata": {
    "reason": "compromised|rotation|expired"
  }
}
```

#### `token_use`
Telemetry span for each token usage.

```json
{
  "entity_type": "token_use",
  "who": "edge:authorizer",
  "did": "used",
  "this": "security.token",
  "status": "ok",
  "metadata": {
    "token_hash": "b3:<hex>",
    "route": "/api/boot",
    "method": "POST",
    "scopes_checked": ["/api/boot:invoke"],
    "trace_id": "<trace_id>"
  }
}
```

---

## 3. Token Format

**Plaintext format:** `tok_{tenant_id}_{random_base64url}`

Example: `tok_acme_AbCdEf123GhIjKlMnOpQrStUvWxYz`

**Hash calculation:** `BLAKE3(plaintext + pepper)`

- Plaintext is shown **once** when issued (not stored)
- Only hash is stored in ledger
- Pepper is stored in AWS Secrets Manager

---

## 4. Scopes

Scopes follow the pattern: `{resource}:{action}`

**Route-level scopes:**
- `/api/spans:read` — Read spans
- `/api/spans:write` — Write spans
- `/api/boot:invoke` — Invoke kernels via boot endpoint
- `/api/memory:read` — Read memories
- `/api/memory:write` — Write memories
- `/api/chat:invoke` — Execute chat prompts

**Kernel-level scopes:**
- `kernel:prompt_fetch:invoke` — Invoke prompt_fetch kernel
- `kernel:memory_store:invoke` — Invoke memory_store kernel
- `kernel:token_issuer:invoke` — Invoke token_issuer kernel

**Scope checking:**
1. Lambda Authorizer checks route-level scope
2. Stage-0 loader checks kernel-level scope (if route is `/api/boot`)

---

## 5. Kernels

### 5.1 token_issuer_kernel

**ID:** `00000000-0000-4000-8000-000000000015`

**Input:**
```json
{
  "tenant_id": "acme",
  "app_id": "minicontratos-gpt",
  "scopes": ["/api/spans:write", "/api/boot:invoke"],
  "ttl_hours": 720
}
```

**Output:**
```json
{
  "ok": true,
  "token": "tok_acme_...",
  "tenant_id": "acme",
  "app_id": "minicontratos-gpt",
  "scopes": [...],
  "expires_at": "2025-12-01T00:00:00Z",
  "token_id": "<uuid>"
}
```

**Behavior:**
1. Generates random token with prefix
2. Computes BLAKE3 hash (token + pepper)
3. Inserts `api_token` span (hash only)
4. Returns plaintext token **once** (not stored)

---

## 6. Lambda Authorizer

**Type:** REQUEST authorizer  
**Location:** `lambda/authorizers/tokenAuthorizer.js`

**Flow:**
1. Extract `Authorization: Bearer <token>` header
2. Compute hash: `BLAKE3(token + pepper)`
3. Query ledger for `api_token` with matching hash
4. Check expiration
5. Check revocation (look for `api_token_revoked` span)
6. Check scope (map route → required scope)
7. Log `token_use` span
8. Return IAM policy with context:
   - `tenant_id`
   - `app_id`
   - `scopes` (JSON string)

**Environment variables:**
- `DB_SECRET_ARN` — ARN of DB credentials secret
- `TOKEN_PEPPER_SECRET_ARN` — ARN of token pepper secret

**Caching:** API Gateway caches authorizer response (TTL: 60s) using `usageIdentifierKey` = token hash

---

## 7. API Gateway Integration

### 7.1 Authorizer Configuration

```hcl
resource "aws_api_gateway_authorizer" "ledger_authz" {
  name                   = "ledger-token-authorizer"
  rest_api_id            = aws_api_gateway_rest_api.loglineos.id
  type                   = "REQUEST"
  authorizer_uri         = aws_lambda_function.token_authorizer.invoke_arn
  identity_source        = "method.request.header.Authorization"
  authorizer_result_ttl_in_seconds = 60
}
```

### 7.2 Method Configuration

```hcl
resource "aws_api_gateway_method" "spans_post" {
  rest_api_id   = aws_api_gateway_rest_api.loglineos.id
  resource_id   = aws_api_gateway_resource.spans.id
  http_method   = "POST"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.ledger_authz.id
}
```

---

## 8. Stage-0 Scope Enforcement

Stage-0 loader checks kernel-level scopes before execution:

```javascript
const scopes = JSON.parse(event.requestContext?.authorizer?.scopes || "[]");
const needs = event.path.includes("/api/boot")
  ? ["kernel:" + kernel_name + ":invoke"]
  : [];

if (needs.length && !needs.some(s => scopes.includes(s))) {
  throw new Error("insufficient_scope_for_kernel");
}
```

---

## 9. Operations

### 9.1 Create Pepper (One-time)

```bash
aws secretsmanager create-secret \
  --name loglineos-token-pepper \
  --secret-string "{\"pepper\":\"$(openssl rand -hex 64)\"}"
```

### 9.2 Issue Token

```bash
curl -X POST "https://api.example.com/dev/api/boot?tenant=acme" \
  -H "Authorization: x-bootstrap-admin" \
  -H "Content-Type: application/json" \
  -d '{
    "boot_function_id": "00000000-0000-4000-8000-000000000015",
    "input": {
      "tenant_id": "acme",
      "app_id": "admin-cli",
      "scopes": ["/api/spans:write", "/api/boot:invoke"],
      "ttl_hours": 720
    }
  }'
```

**Response:**
```json
{
  "token": "tok_acme_AbCdEf123...",
  "expires_at": "2025-12-01T00:00:00Z"
}
```

### 9.3 Use Token

```bash
curl -X POST "https://api.example.com/dev/api/spans" \
  -H "Authorization: Bearer tok_acme_AbCdEf123..." \
  -H "Content-Type: application/json" \
  -d '{...}'
```

### 9.4 Rotate Token

1. Issue new token with same scopes
2. Notify clients
3. Revoke old token:

```json
{
  "entity_type": "api_token_revoked",
  "related_to": ["<old_token_id>"],
  "metadata": {
    "reason": "rotation"
  }
}
```

### 9.5 Revoke Token (Incident)

```json
{
  "entity_type": "api_token_revoked",
  "related_to": ["<token_id>"],
  "metadata": {
    "reason": "compromised"
  }
}
```

Revocation takes effect immediately (next request after cache TTL expires).

---

## 10. Observability

### 10.1 Metrics

**CloudWatch:**
- Authorizer errors (deny rate)
- Authorizer latency (p50, p95, p99)

**Ledger queries:**
```sql
-- Token usage in last 24h
SELECT count(*) FROM ledger.visible_timeline 
WHERE entity_type = 'token_use' 
  AND at > now() - interval '1 day';

-- Active tokens per tenant
SELECT tenant_id, count(*) 
FROM ledger.visible_timeline 
WHERE entity_type = 'api_token' 
  AND status = 'active'
GROUP BY tenant_id;

-- Tokens expiring soon
SELECT tenant_id, app_id, expires_at 
FROM ledger.visible_timeline 
WHERE entity_type = 'api_token' 
  AND status = 'active'
  AND (metadata->>'expires_at')::timestamptz < now() + interval '7 days';
```

---

## 11. Security Checklist

- ✅ Pepper stored in Secrets Manager (never in code)
- ✅ Tokens stored as hash only (BLAKE3 + pepper)
- ✅ Plaintext shown once (not logged)
- ✅ Revocation checked in authorizer
- ✅ Expiration checked in authorizer
- ✅ Scope checking at route and kernel level
- ✅ Token usage logged as spans
- ✅ API Gateway caching enabled (60s TTL)
- ✅ RLS enforced on ledger queries

---

## 12. GPT Actions / iPhone Integration

**Configuration:**
- **Authentication:** API Key
- **Custom header:** `authorization`
- **Key:** `Bearer tok_acme_...`
- **Server URL:** `https://api.example.com/dev`

Every request will:
1. Hit Lambda Authorizer
2. Validate token against ledger
3. Check scopes
4. Inject `tenant_id`, `app_id`, `scopes` into API Gateway context
5. Log `token_use` span

---

## 13. Migration Plan

**Phase 1: Setup**
1. Create pepper secret in Secrets Manager
2. Deploy token_issuer kernel
3. Deploy token_authorizer Lambda
4. Add token_issuer to manifest.allowed_boot_ids

**Phase 2: Issue First Token**
1. Issue admin token via bootstrap endpoint
2. Test token with curl

**Phase 3: Enable Authorizer**
1. Attach authorizer to API Gateway methods
2. Test with token
3. Remove bootstrap authorization bypass

**Phase 4: Cleanup**
1. Revoke legacy API Keys (if any)
2. Monitor authorizer metrics
3. Set up alerts for high deny rate

---

## 14. Appendix

### 14.1 Token Lifecycle Diagram

```
api_token_request → token_issuer_kernel → api_token (hash stored)
                                     ↓
                              plaintext returned (once)
                                     ↓
                              Client uses token
                                     ↓
                              Lambda Authorizer validates
                                     ↓
                              token_use span logged
                                     ↓
                              (eventually) api_token_revoked
```

### 14.2 Scope Examples

**Full access:**
```json
{
  "scopes": [
    "/api/spans:read",
    "/api/spans:write",
    "/api/boot:invoke",
    "/api/memory:read",
    "/api/memory:write",
    "/api/chat:invoke",
    "kernel:prompt_fetch:invoke",
    "kernel:memory_store:invoke"
  ]
}
```

**Read-only:**
```json
{
  "scopes": [
    "/api/spans:read",
    "/api/memory:read"
  ]
}
```

**Single app:**
```json
{
  "scopes": [
    "/api/chat:invoke",
    "kernel:prompt_fetch:invoke"
  ]
}
```

---

**End of Specification**

