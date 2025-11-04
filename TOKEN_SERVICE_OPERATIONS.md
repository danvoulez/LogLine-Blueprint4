# Token Service - Quick Operations Guide

## Setup (One-time)

### 1. Create Pepper Secret

```bash
aws secretsmanager create-secret \
  --name loglineos-token-pepper \
  --secret-string "{\"pepper\":\"$(openssl rand -hex 64)\"}"
```

### 2. Deploy Token Authorizer

```bash
cd lambda/authorizers
npm install
zip -r tokenAuthorizer.zip . -x "*.git*" "*.md"
aws lambda create-function \
  --function-name loglineos-token-authorizer \
  --runtime nodejs18.x \
  --role <execution-role-arn> \
  --handler tokenAuthorizer.handler \
  --zip-file fileb://tokenAuthorizer.zip \
  --environment Variables="{
    DB_SECRET_ARN=arn:aws:secretsmanager:...:secret:loglineos-db-dev,
    TOKEN_PEPPER_SECRET_ARN=arn:aws:secretsmanager:...:secret:loglineos-token-pepper
  }"
```

### 3. Add Token Issuer to Manifest

After seeding the kernel, ensure `00000000-0000-4000-8000-000000000015` is in `manifest.allowed_boot_ids`.

---

## Daily Operations

### Issue Token

```bash
curl -X POST "https://api.example.com/dev/api/boot?tenant=acme" \
  -H "Authorization: x-bootstrap-admin" \
  -H "Content-Type: application/json" \
  -d '{
    "boot_function_id": "00000000-0000-4000-8000-000000000015",
    "input": {
      "tenant_id": "acme",
      "app_id": "my-app",
      "scopes": [
        "/api/spans:write",
        "/api/boot:invoke",
        "/api/memory:read",
        "/api/memory:write",
        "kernel:prompt_fetch:invoke",
        "kernel:memory_store:invoke"
      ],
      "ttl_hours": 720
    }
  }'
```

**Response:**
```json
{
  "ok": true,
  "token": "tok_acme_AbCdEf123GhIjKlMnOpQrStUvWxYz",
  "tenant_id": "acme",
  "app_id": "my-app",
  "scopes": [...],
  "expires_at": "2025-12-01T00:00:00Z",
  "token_id": "00000000-0000-4000-8000-..."
}
```

**⚠️ IMPORTANT:** Save the token immediately - it's shown only once!

### Use Token

```bash
curl -X POST "https://api.example.com/dev/api/spans" \
  -H "Authorization: Bearer tok_acme_AbCdEf123GhIjKlMnOpQrStUvWxYz" \
  -H "Content-Type: application/json" \
  -d '{
    "entity_type": "memory",
    ...
  }'
```

### Rotate Token

1. Issue new token (same scopes)
2. Update clients/apps with new token
3. Revoke old token (see below)

### Revoke Token

Create a revocation span:

```json
{
  "entity_type": "api_token_revoked",
  "who": "admin",
  "did": "revoked",
  "this": "security.token",
  "status": "revoked",
  "related_to": ["<token_id>"],
  "metadata": {
    "reason": "rotation"
  }
}
```

Or via API:

```bash
curl -X POST "https://api.example.com/dev/api/spans" \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "entity_type": "api_token_revoked",
    "who": "admin",
    "did": "revoked",
    "this": "security.token",
    "status": "revoked",
    "related_to": ["<token_id>"],
    "metadata": {
      "reason": "compromised"
    }
  }'
```

---

## Monitoring

### Check Active Tokens

```sql
SELECT 
  tenant_id,
  (metadata->>'app_id') AS app_id,
  (metadata->>'expires_at')::timestamptz AS expires_at,
  (metadata->'scopes')::jsonb AS scopes,
  at
FROM ledger.visible_timeline
WHERE entity_type = 'api_token'
  AND status = 'active'
ORDER BY at DESC;
```

### Check Token Usage

```sql
SELECT 
  count(*) AS usage_count,
  (metadata->>'route') AS route,
  (metadata->>'method') AS method
FROM ledger.visible_timeline
WHERE entity_type = 'token_use'
  AND at > now() - interval '24 hours'
GROUP BY route, method
ORDER BY usage_count DESC;
```

### Tokens Expiring Soon

```sql
SELECT 
  tenant_id,
  (metadata->>'app_id') AS app_id,
  (metadata->>'expires_at')::timestamptz AS expires_at
FROM ledger.visible_timeline
WHERE entity_type = 'api_token'
  AND status = 'active'
  AND (metadata->>'expires_at')::timestamptz < now() + interval '7 days'
ORDER BY expires_at;
```

---

## Common Scopes

### Full Access
```json
{
  "scopes": [
    "/api/spans:read",
    "/api/spans:write",
    "/api/boot:invoke",
    "/api/memory:read",
    "/api/memory:write",
    "/api/chat:invoke",
    "/api/prompts:read",
    "kernel:prompt_fetch:invoke",
    "kernel:memory_store:invoke",
    "kernel:token_issuer:invoke"
  ]
}
```

### Read-Only
```json
{
  "scopes": [
    "/api/spans:read",
    "/api/memory:read",
    "/api/prompts:read"
  ]
}
```

### Chat App
```json
{
  "scopes": [
    "/api/chat:invoke",
    "/api/memory:read",
    "/api/memory:write",
    "kernel:prompt_fetch:invoke",
    "kernel:memory_store:invoke"
  ]
}
```

---

## Troubleshooting

### Authorizer Denies

Check CloudWatch logs for:
- `token_not_found` → Token not in ledger (wrong hash?)
- `token_expired` → Token past expiration
- `token_revoked` → Token was revoked
- `insufficient_scope` → Token missing required scope

### Token Not Working

1. Verify token hash in ledger:
   ```sql
   SELECT * FROM ledger.visible_timeline
   WHERE entity_type = 'api_token'
     AND metadata->>'token_hash' = 'b3:<your_hash>';
   ```

2. Check if token was revoked:
   ```sql
   SELECT * FROM ledger.visible_timeline
   WHERE entity_type = 'api_token_revoked'
     AND related_to @> ARRAY['<token_id>']::uuid[];
   ```

3. Verify expiration:
   ```sql
   SELECT (metadata->>'expires_at')::timestamptz AS expires_at
   FROM ledger.visible_timeline
   WHERE id = '<token_id>';
   ```

---

## GPT Actions / iPhone Setup

1. Open GPT Actions settings
2. Authentication: **API Key**
3. Custom header: `authorization`
4. Key: `Bearer tok_acme_...`
5. Server URL: `https://api.example.com/dev`

Done! Every request will be authenticated and authorized.

