# 👤 Fluxo de Onboarding de Pessoas

## Visão Geral

O onboarding de pessoas segue um fluxo **seguro e auditável** onde cada passo gera um **span assinado** no ledger. O objetivo é provar que a pessoa **controla a chave privada Ed25519** antes de emitir qualquer token.

---

## 🔄 Fluxo Completo (Passo a Passo)

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENTE (Frontend/CLI)                                      │
└─────────────────────────────────────────────────────────────┘
         │
         │ 1. Gera chaves Ed25519 localmente
         │    - privateKey = randomBytes(32)
         │    - publicKey = ed25519.getPublicKey(privateKey)
         │    - kid = blake3(publicKey) → "b3:abc123..."
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  2. POST /auth/identity/register                            │
│     - Envia span identity_registration ASSINADO             │
│     - Inclui: kid, pubkey_hex, display_name, email           │
└─────────────────────────────────────────────────────────────┘
         │
         │ ✅ Backend valida assinatura
         │ ✅ Retorna nonce para attestation
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  3. POST /auth/attest                                        │
│     - Assina nonce com chave privada                        │
│     - Envia: kid, nonce, signature                          │
└─────────────────────────────────────────────────────────────┘
         │
         │ ✅ Backend verifica assinatura do nonce
         │ ✅ Cria span key_attestation
         │ ✅ Prova que pessoa controla a chave
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Wallet Service cria wallet_opened                        │
│     - Armazena chave privada no Secrets Manager             │
│     - Cria wallet_id = "wlt_tenant_user"                    │
│     - Gera span wallet_opened                                │
└─────────────────────────────────────────────────────────────┘
         │
         │ ✅ Wallet criado
         │ ✅ Chave privada segura (nunca exposta)
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Auth Service emite token                                 │
│     - POST /auth/keys/issue                                  │
│     - Gera tok_live_...                                      │
│     - Armazena hash no DynamoDB                              │
│     - EMITE span api_token_issued                            │
└─────────────────────────────────────────────────────────────┘
         │
         │ ✅ Token emitido (mostrado UMA VEZ)
         │ ✅ Span api_token_issued no ledger
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  6. (Opcional) BYO Provider Keys                             │
│     - POST /wallet/key/register                              │
│     - Armazena ANTHROPIC_API_KEY no Secrets Manager          │
│     - Vincula ao wallet                                      │
└─────────────────────────────────────────────────────────────┘
         │
         │ ✅ Provider keys seguras
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  7. Consent/ToS (Opcional)                                   │
│     - Cria span consent.accepted                             │
│     - Assinado com Ed25519                                   │
└─────────────────────────────────────────────────────────────┘
         │
         │ ✅ Consentimento auditável
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  ✅ ONBOARDING COMPLETO                                       │
│     - Pessoa pode usar token para todas operações           │
│     - Wallet guarda chaves seguramente                       │
│     - Tudo auditável no ledger                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 📝 Detalhamento de Cada Passo

### Passo 1: Cliente Gera Chaves (Local)

**Onde:** Cliente (browser, app, CLI)

**O que acontece:**
```javascript
// 1. Gera par de chaves Ed25519
const privateKey = randomBytes(32);
const publicKey = ed25519.getPublicKey(privateKey);

// 2. Calcula KID (Key ID)
const pubkeyBytes = Buffer.from(publicKey, 'hex');
const kidHash = blake3(pubkeyBytes);
const kid = `b3:${Buffer.from(kidHash).toString('hex')}`;
// Resultado: "b3:abc123def456..."

// 3. Chave privada NUNCA sai do cliente
// Chave pública e KID são enviados
```

**Resultado:** Chaves geradas, KID calculado, chave privada permanece local.

---

### Passo 2: Identity Registration

**Endpoint:** `POST /auth/identity/register`

**Request:**
```json
{
  "kid": "b3:abc123def456...",
  "pubkey_hex": "a1b2c3d4e5f6...",
  "display_name": "Dan Voulez",
  "email": "dan@voulezvous.com",
  "tenant_id": "voulezvous",
  "span": {
    "id": "identity_123",
    "entity_type": "identity_registration",
    "who": "user:self",
    "did": "registered",
    "this": "identity.user",
    "metadata": {
      "kid": "b3:abc123...",
      "display_name": "Dan Voulez",
      "email": "dan@voulezvous.com"
    },
    "sig": {
      "alg": "ed25519-blake3-v1",
      "kid": "b3:abc123...",
      "signature": "hex_signature..."
    }
  }
}
```

**O que acontece no backend:**
1. Valida que o span está assinado (`sig` presente)
2. Valida formato da assinatura (Ed25519-blake3-v1)
3. Gera **nonce** aleatório (16 bytes, base64url)
4. Retorna nonce para o cliente

**Response:**
```json
{
  "ok": true,
  "identity_span": { /* span completo */ },
  "attestation_nonce": "xYz123AbC456...",
  "next_step": "POST /auth/attest with signed nonce"
}
```

**Por que isso é seguro?** O span já está assinado, provando que o cliente tem a chave privada. Mas ainda precisa provar que controla a chave **agora** (não foi comprometida).

---

### Passo 3: Key Attestation (Prova de Controle)

**Endpoint:** `POST /auth/attest`

**O que acontece no cliente:**
```javascript
// 1. Recebe nonce do passo anterior
const nonce = "xYz123AbC456...";

// 2. Assina nonce com chave privada
const nonceBytes = new TextEncoder().encode(nonce);
const signature = ed25519.sign(nonceBytes, privateKey);

// 3. Envia attestation
```

**Request:**
```json
{
  "kid": "b3:abc123def456...",
  "nonce": "xYz123AbC456...",
  "signature": "hex_signature_of_nonce",
  "attestation_hash": "b3:hash_of_nonce_and_signature"
}
```

**O que acontece no backend:**
1. Busca `pubkey_hex` do `identity_registration` (pelo `kid`)
2. Verifica assinatura do nonce usando `pubkey_hex`
3. Se válido → cria span `key_attestation` com status `verified`
4. Marca `identity_registration` como `active` (não mais `pending`)

**Response:**
```json
{
  "ok": true,
  "attestation_span": { /* span key_attestation */ },
  "next_step": "Wallet will be opened and token issued"
}
```

**Por que isso é seguro?** O nonce é único e aleatório. Se o cliente consegue assiná-lo, prova que:
- Tem a chave privada
- A chave não foi comprometida (não é replay)
- Pode assinar requisições futuras

---

### Passo 4: Wallet Opened

**Onde:** Wallet Service (automatizado após attestation)

**O que acontece:**
1. Wallet Service cria wallet no DynamoDB:
   ```json
   {
     "wallet_id": "wlt_voulezvous_dan",
     "owner_id": "dan@voulezvous.com",
     "tenant_id": "voulezvous",
     "items": {
       "kid_ed25519_main": {
         "type": "ed25519",
         "pubkey_hex": "a1b2c3...",
         "secret_ref": "arn:aws:secretsmanager:...:secret:ed25519_main",
         "caps": ["sign.span", "sign.http"],
         "status": "active"
       }
     }
   }
   ```

2. Armazena chave privada no Secrets Manager:
   ```json
   {
     "private_key_hex": "123456...",
     "public_key_hex": "a1b2c3..."
   }
   ```

3. Cria span `wallet_opened`:
   ```json
   {
     "entity_type": "wallet_opened",
     "who": "kernel:wallet_service",
     "metadata": {
       "wallet_id": "wlt_voulezvous_dan",
       "kid": "b3:abc123...",
       "encrypted_key_ref": "arn:aws:secretsmanager:..."
     }
   }
   ```

**Resultado:** Wallet criado, chave privada segura, span no ledger.

---

### Passo 5: Token Issued

**Endpoint:** `POST /auth/keys/issue` (chamado automaticamente ou manualmente)

**O que acontece:**
1. Auth Service gera token:
   ```javascript
   const random = randomBytes(24).toString('base64url');
   const token = `tok_live_${random}`;
   // Resultado: "tok_live_AbCdEf123..."
   ```

2. Calcula hash (Argon2id + HMAC + pepper):
   ```javascript
   const hmac = createHmac('sha256', pepper);
   hmac.update(token);
   const hash = await argon2.hash(hmac.digest('hex'));
   ```

3. Armazena no DynamoDB:
   ```json
   {
     "token_hash": "argon2id_hash...",
     "wallet_id": "wlt_voulezvous_dan",
     "tenant_id": "voulezvous",
     "scopes": ["wallet.open", "span.sign", "memory.*"],
     "exp": 1734048000,
     "status": "active",
     "token_type": "api_token"  // vs "service_token"
   }
   ```

4. **EMITE span `api_token_issued`:**
   ```json
   {
     "entity_type": "api_token_issued",
     "who": "kernel:auth_service",
     "metadata": {
       "token_hash": "hash...",
       "wallet_id": "wlt_voulezvous_dan",
       "kid": "b3:abc123...",
       "scopes": ["wallet.open", "span.sign"],
       "ttl_hours": 24
     }
   }
   ```

**Response:**
```json
{
  "token": "tok_live_AbCdEf123...",
  "exp": 1734048000,
  "token_type": "api_token",
  "ttl_hours": 24
}
```

⚠️ **IMPORTANTE:** Token mostrado **UMA VEZ**. Depois, só o hash existe no DynamoDB.

---

### Passo 6: BYO Provider Keys (Opcional)

**Endpoint:** `POST /wallet/key/register`

**Request:**
```json
{
  "kid": "kid_provider_anthropic",
  "type": "provider_key",
  "provider": "anthropic",
  "secret_ref": "arn:aws:secretsmanager:...:secret:anthropic_key",
  "caps": ["provider.invoke:anthropic/*"]
}
```

**O que acontece:**
1. Wallet Service adiciona provider key ao wallet
2. API key fica no Secrets Manager (nunca exposta)
3. Cliente pode usar via `wallet/provider/invoke` sem expor key

**Resultado:** Provider keys seguras, disponíveis para uso.

---

### Passo 7: Consent/ToS (Opcional)

**Endpoint:** (Falta implementar, mas template existe)

**O que deveria acontecer:**
1. Cliente cria span `consent.accepted` assinado
2. Inclui versão do ToS, IP, user agent
3. Armazena no ledger

**Resultado:** Consentimento auditável, versão do ToS rastreável.

---

## 🔐 Segurança do Fluxo

### Por que é seguro?

1. **Chave privada nunca sai do cliente** — Só a pública é enviada
2. **Nonce único** — Previne replay attacks
3. **Assinatura obrigatória** — Tudo precisa ser assinado (Ed25519 + BLAKE3)
4. **Token hash no banco** — Plaintext só existe na resposta inicial
5. **Wallet isolado** — Chaves privadas no Secrets Manager (KMS)
6. **Auditoria completa** — Todos os spans no ledger (imutável)

### Pontos de verificação:

- ✅ Cliente tem chave privada (span assinado)
- ✅ Cliente controla chave agora (nonce assinado)
- ✅ Wallet criado com chave segura
- ✅ Token emitido com escopos corretos
- ✅ Tudo auditável no ledger

---

## 📊 Spans Gerados no Fluxo

| Ordem | Span | Status Inicial | Quando Vira Active |
|-------|------|----------------|-------------------|
| 1 | `identity_registration` | `pending` | Após `key_attestation` |
| 2 | `key_attestation` | `verified` | Imediato |
| 3 | `wallet_opened` | `active` | Quando wallet criado |
| 4 | `api_token_issued` | `active` | Quando token emitido |
| 5 | `capability_grant` | `active` | Após token (opcional) |
| 6 | `consent.accepted` | `active` | Quando usuário aceita (opcional) |

---

## 🎯 Exemplo Completo (cURL)

```bash
# 1. Cliente gera chaves (local)
# (código JavaScript, não mostrado aqui)

# 2. Identity Registration
curl -X POST "https://api.example.com/dev/auth/identity/register" \
  -H "Authorization: Bearer <bootstrap_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "kid": "b3:abc123...",
    "pubkey_hex": "a1b2c3...",
    "display_name": "Dan",
    "email": "dan@voulezvous.com",
    "tenant_id": "voulezvous",
    "span": {
      "entity_type": "identity_registration",
      "metadata": {"kid": "b3:abc123...", "display_name": "Dan"},
      "sig": {"alg": "ed25519-blake3-v1", "kid": "b3:abc123...", "signature": "..."}
    }
  }'

# Resposta: { "attestation_nonce": "xYz123..." }

# 3. Attestation
curl -X POST "https://api.example.com/dev/auth/attest" \
  -H "Content-Type: application/json" \
  -d '{
    "kid": "b3:abc123...",
    "nonce": "xYz123...",
    "signature": "<ed25519(nonce)>"
  }'

# Resposta: { "ok": true, "attestation_span": {...} }

# 4. Wallet criado automaticamente (backend)

# 5. Token emitido (pode ser automático ou manual)
curl -X POST "https://api.example.com/dev/auth/keys/issue" \
  -H "Authorization: ApiKey <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_id": "wlt_voulezvous_dan",
    "tenant_id": "voulezvous",
    "scopes": ["wallet.open", "span.sign", "memory.*"],
    "ttl_hours": 24
  }'

# Resposta: { "token": "tok_live_...", "exp": 1734048000 }
```

---

## 🤔 Dúvidas Comuns

### Por que dois passos (register + attest)?

- **Register:** Prova que você tem a chave (span assinado)
- **Attest:** Prova que você controla a chave **agora** (nonce único)

Isso previne ataques de replay e garante que a chave não foi comprometida.

### Por que não usar senha?

- Senhas podem ser comprometidas
- Ed25519 é criptografia assimétrica (mais seguro)
- Assinaturas são auditáveis (não repudiáveis)
- Não precisa armazenar senhas (zero-knowledge)

### O que acontece se perder a chave privada?

- Precisa do processo de **recovery** (multisig_approval)
- Gera nova chave e faz `key_rotation`
- Tokens antigos são revogados

---

**Status:** Fluxo completo implementado  
**Última atualização:** 2025-11-04

