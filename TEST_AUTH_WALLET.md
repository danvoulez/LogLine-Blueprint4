# 🧪 Test Auth & Wallet Services

## Prerequisites

1. **AWS Credentials** configured (`aws configure` or environment variables)
2. **DynamoDB Tables** created:
   - `auth_api_tokens`
   - `wallets`
   - `nonces`
3. **Secrets Manager** secrets:
   - `loglineos-token-pepper` (or set `TOKENS_PEPPER_SECRET_ARN`)
   - Ed25519 keys (for wallet tests)
4. **Environment Variables**:
   ```bash
   export AWS_REGION=us-east-1
   export TOKENS_TABLE=auth_api_tokens
   export WALLETS_TABLE=wallets
   export NONCE_TABLE=nonces
   export TOKENS_PEPPER_SECRET_ARN=arn:aws:secretsmanager:...:secret:loglineos-token-pepper
   ```

## Test Scripts

### 1. Test Authorizer (Unit Test)

Tests the Authorizer Lambda logic directly:

```bash
node scripts/test-authorizer.js
```

**What it tests:**
- Token hash calculation (Argon2id)
- DynamoDB lookup
- Expiration check
- Scope validation
- Policy generation

**Expected output:**
```
✅ Token validated successfully
✅ Invalid token correctly rejected
✅ Missing token correctly rejected
```

### 2. Test Wallet Service (Unit Test)

Tests the Wallet Service Lambda logic directly:

```bash
node scripts/test-wallet-service.js
```

**What it tests:**
- Wallet creation
- Span signing (Ed25519 + BLAKE3)
- HTTP request signing
- Key management

**Expected output:**
```
✅ Wallet session opened
✅ Span signed
✅ Tests completed
```

### 3. Test Auth Flow (Integration Test)

Tests the complete flow through API Gateway:

```bash
export API_GATEWAY_URL="https://your-api.execute-api.us-east-1.amazonaws.com/dev"
export ADMIN_TOKEN="tok_admin_..."  # Optional, for first-time setup

node scripts/test-auth-flow.js
```

**What it tests:**
1. Issue token via `/auth/keys/issue`
2. Open wallet via `/wallet/open`
3. Sign span via `/wallet/sign/span`
4. Sign HTTP via `/wallet/sign/http`
5. Authorizer validation via protected endpoint

**Expected output:**
```
✅ Token issued
✅ Wallet session opened
✅ Span signed
✅ HTTP request signed
✅ Authorizer processed request
✅ All tests passed!
```

## Manual Testing with cURL

### 1. Issue Token

```bash
curl -X POST "$API_GATEWAY_URL/auth/keys/issue" \
  -H "Authorization: ApiKey $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id": "wlt_test_123",
    "tenant_id": "test",
    "scopes": ["wallet.open", "span.sign", "memory.*"],
    "ttl_hours": 24,
    "description": "Test token"
  }'
```

**Response:**
```json
{
  "token": "tok_live_...",
  "exp": 1734048000
}
```

### 2. Open Wallet

```bash
TOKEN="tok_live_..."  # From step 1

curl -X POST "$API_GATEWAY_URL/wallet/open" \
  -H "Authorization: ApiKey $TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "wallet_session": "wss_...",
  "wallet_id": "wlt_test_123",
  "exp": 1730740831
}
```

### 3. Sign Span

```bash
curl -X POST "$API_GATEWAY_URL/wallet/sign/span" \
  -H "Authorization: ApiKey $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kid": "kid_ed25519_main",
    "span": {
      "id": "span_123",
      "entity_type": "memory",
      "who": "test",
      "did": "stored",
      "this": "memory",
      "at": "2025-01-01T12:00:00Z",
      "status": "active",
      "content": {"text": "Test"}
    }
  }'
```

**Response:**
```json
{
  "payload_hash": "b3:...",
  "sig": {
    "alg": "ed25519-blake3-v1",
    "key_id": "did:logline:...",
    "kid": "kid_ed25519_main",
    "ts": 1730740831000,
    "nonce": "...",
    "signature": "..."
  }
}
```

### 4. Test Authorizer (Protected Endpoint)

```bash
curl -X POST "$API_GATEWAY_URL/wallet/open" \
  -H "Authorization: ApiKey $TOKEN" \
  -H "Content-Type: application/json"
```

If token is valid → `200 OK`  
If token is invalid → `401 Unauthorized` or `403 Forbidden`

## Troubleshooting

### Authorizer returns "Deny" for valid token

1. Check DynamoDB table has the token hash
2. Verify pepper secret exists and is correct
3. Check token expiration (`exp` field)
4. Verify token status is `active`

### Wallet Service returns 404

1. Check wallet exists in DynamoDB
2. Verify wallet status is `active`
3. Check key item (`kid`) exists in wallet
4. Verify key status is `active`

### Span signing fails

1. Check Ed25519 key exists in Secrets Manager
2. Verify key has `sign.span` capability
3. Check secret ARN is correct in wallet item
4. Verify private key format (hex string)

### Provider invoke fails

1. Check provider key exists in wallet
2. Verify API key in Secrets Manager
3. Check provider name matches (anthropic/openai)
4. Verify network connectivity to provider API

## Next Steps

After successful tests:

1. **Deploy to AWS**:
   ```bash
   cd lambda/wallet_service && zip -r wallet-service.zip . && aws lambda update-function-code ...
   cd lambda/auth_api_key_authorizer && zip -r authorizer.zip . && aws lambda update-function-code ...
   ```

2. **Configure API Gateway**:
   - Attach Authorizer to protected routes
   - Set up usage plans and rate limiting
   - Configure CORS if needed

3. **Monitor**:
   - CloudWatch Logs for errors
   - DynamoDB metrics for token lookups
   - Lambda metrics for performance

---

**Status:** Ready for testing  
**Last Updated:** 2025-01-XX

