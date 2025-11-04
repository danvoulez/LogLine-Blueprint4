# 🚀 App Onboarding Flow

## Overview

Yes, we can **issue tokens** and **onboard apps**! Here's the complete flow:

## Flow Diagram

```
1. Bootstrap (Admin)
   ↓
2. Create Wallet (via Wallet Service or manual)
   ↓
3. Issue Token (via Auth Service)
   ↓
4. Register App (via CLI Service)
   ↓
5. Use App (with token)
```

## Step-by-Step

### Step 1: Bootstrap (First-Time Setup)

**Option A: Manual Wallet Creation** (for first admin)

```bash
# Create wallet in DynamoDB manually
aws dynamodb put-item \
  --table-name wallets \
  --item '{
    "wallet_id": {"S": "wlt_voulezvous_admin"},
    "owner_id": {"S": "admin@voulezvous"},
    "tenant_id": {"S": "voulezvous"},
    "status": {"S": "active"},
    "created_at": {"N": "'$(date +%s)'"},
    "items": {"M": {
      "kid_ed25519_main": {
        "M": {
          "type": {"S": "ed25519"},
          "pubkey_hex": {"S": "<hex>"},
          "secret_ref": {"S": "arn:aws:secretsmanager:...:secret:ed25519_main"},
          "caps": {"L": [
            {"S": "sign.span"},
            {"S": "sign.http"}
          ]},
          "status": {"S": "active"}
        }
      }
    }}
  }'
```

**Option B: Use Bootstrap Token** (if you have one)

```bash
# Use existing bootstrap token to issue first admin token
curl -X POST https://api.example.com/dev/auth/keys/issue \
  -H "Authorization: x-bootstrap-admin" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id": "wlt_voulezvous_admin",
    "tenant_id": "voulezvous",
    "scopes": ["wallet.open", "auth.keys.issue", "cli.app.register"],
    "ttl_hours": 720,
    "description": "Admin bootstrap token"
  }'
```

### Step 2: Create Wallet (if not exists)

**Via Wallet Service** (requires token with `wallet.create` scope):

```bash
curl -X POST https://api.example.com/dev/wallet/open \
  -H "Authorization: ApiKey tok_admin_..." \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id": "wlt_voulezvous_dan",
    "owner_id": "dan@voulezvous",
    "tenant_id": "voulezvous"
  }'
```

**Or manually** (for first wallet):

```bash
# Create wallet in DynamoDB
aws dynamodb put-item \
  --table-name wallets \
  --item file://wallet.json
```

### Step 3: Issue Token

**Using Auth Service** (`/auth/keys/issue`):

```bash
curl -X POST https://api.example.com/dev/auth/keys/issue \
  -H "Authorization: ApiKey tok_admin_..." \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id": "wlt_voulezvous_dan",
    "tenant_id": "voulezvous",
    "scopes": [
      "wallet.open",
      "span.sign",
      "provider.invoke:anthropic/*",
      "prompt.fetch",
      "memory.*",
      "cli.app.register"
    ],
    "ttl_hours": 720,
    "description": "Token for writer-bot app"
  }'
```

**Response:**
```json
{
  "token": "tok_live_AbCdEf123GhIjKlMnOpQrStUvWxYz",
  "exp": 1734048000
}
```

⚠️ **IMPORTANT:** Save the token immediately - it's shown only once!

### Step 4: Register App

**Using CLI Service** (`/cli/app.register`):

```bash
curl -X POST https://api.example.com/dev/cli/app.register \
  -H "Authorization: ApiKey tok_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "writer-bot",
    "intent_set": [
      "memory.upsert",
      "prompt_runner.execute"
    ],
    "requires_caps": [
      "memory.write",
      "provider.invoke:*"
    ],
    "default_slo": {
      "p95_ms": 800,
      "min_quality": 0.7
    },
    "memory_contracts": ["basic_memory"],
    "prompt_blocks": ["dialogue_block", "feedback_block"],
    "visibility": "tenant"
  }'
```

**Response:**
```json
{
  "ok": true,
  "app_id": "writer-bot",
  "span_id": "span_1730740831000_abc123"
}
```

The app registration span is:
- Signed with Ed25519 (via Wallet)
- Stored in the ledger
- Available for querying

### Step 5: Use App

Now you can use the token to:

```bash
# Add memory
curl -X POST https://api.example.com/dev/cli/memory.add \
  -H "Authorization: ApiKey tok_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "content": "User prefers short espresso",
    "tags": ["preference", "coffee"],
    "layer": "session"
  }'

# Search memory
curl -X POST https://api.example.com/dev/cli/memory.search \
  -H "Authorization: ApiKey tok_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "query": "espresso",
    "limit": 10
  }'

# Ask LLM
curl -X POST https://api.example.com/dev/cli/ask \
  -H "Authorization: ApiKey tok_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "text": "What did I say about coffee?",
    "model": "claude-3-5-sonnet",
    "with_memory": true
  }'
```

## Current Implementation Status

### ✅ Implemented

- **Auth Service** (`lambda/auth_service/index.js`):
  - `POST /auth/keys/issue` - Issues tokens
  - `POST /auth/keys/revoke` - Revokes tokens
  - `POST /auth/keys/rotate` - Rotates tokens
  - `GET /auth/keys/list` - Lists tokens

- **CLI Service** (`lambda/cli_service/index.js`):
  - `POST /cli/app.register` - Registers apps (creates signed span)
  - `POST /cli/memory.add` - Adds memory
  - `POST /cli/memory.search` - Searches memory
  - `POST /cli/ask` - Asks LLM
  - `POST /cli/prompt.fetch` - Fetches prompts
  - `POST /cli/run` - Runs kernels

### ⚠️ Needs Completion

1. **Wallet Service** (`lambda/wallet_service/index.js`):
   - `POST /wallet/open` - Create/open wallet
   - `POST /wallet/sign/span` - Sign spans
   - `POST /wallet/provider/invoke` - Invoke LLM providers
   - `POST /wallet/key/register` - Register keys

2. **Authorizer** (`lambda/auth_api_key_authorizer/index.js`):
   - Validate tokens from DynamoDB
   - Inject wallet_id, tenant_id, scopes

3. **Span Storage in CLI Service**:
   - `handleAppRegister` creates the span but doesn't store it yet
   - Need to call Stage-0 or direct DB insert

## Quick Test Script

```bash
#!/bin/bash

API_URL="https://api.example.com/dev"
ADMIN_TOKEN="tok_admin_..."  # Bootstrap token

# 1. Issue token
echo "📝 Issuing token..."
TOKEN_RESPONSE=$(curl -sS -X POST "$API_URL/auth/keys/issue" \
  -H "Authorization: ApiKey $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id": "wlt_voulezvous_test",
    "tenant_id": "voulezvous",
    "scopes": ["cli.app.register", "memory.*", "prompt.fetch"],
    "ttl_hours": 720,
    "description": "Test app token"
  }')

TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.token')
echo "✅ Token issued: ${TOKEN:0:20}..."

# 2. Register app
echo "📱 Registering app..."
APP_RESPONSE=$(curl -sS -X POST "$API_URL/cli/app.register" \
  -H "Authorization: ApiKey $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "test-app",
    "intent_set": ["memory.upsert"],
    "requires_caps": ["memory.write"],
    "visibility": "tenant"
  }')

echo "✅ App registered:"
echo $APP_RESPONSE | jq

# 3. Test memory
echo "💾 Adding memory..."
curl -sS -X POST "$API_URL/cli/memory.add" \
  -H "Authorization: ApiKey $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Test memory entry",
    "tags": ["test"],
    "layer": "session"
  }' | jq

echo "✅ Done!"
```

## Next Steps

1. **Complete Wallet Service** - Implement key management and signing
2. **Complete Authorizer** - Validate tokens from DynamoDB
3. **Fix Span Storage** - Store app registration spans in ledger
4. **Add Wallet Creation Endpoint** - Allow creating wallets via API
5. **Add Bootstrap Flow** - First-time setup script

---

**Status:** ✅ Token issuance works, ⚠️ App registration creates span but needs storage fix

