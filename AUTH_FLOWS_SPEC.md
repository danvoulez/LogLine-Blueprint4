# 🔐 Fluxos de Autenticação LogLineOS

## Visão Geral

Dois fluxos distintos de autenticação:

1. **CLI Flow** - Para clientes que usam linha de comando
2. **UI Flow** - Para clientes que usam interface web (magic link)

---

## 1️⃣ Fluxo CLI (API Key Request)

### Fluxo Completo

```
1. Cliente CLI faz POST /auth/keys/request
   ↓
2. Backend cria wallet automaticamente
   ↓
3. Gera API key
   ↓
4. Retorna key na resposta (única vez)
   ↓
5. Key serve tanto para wallet quanto para API
```

### Endpoint: `POST /auth/keys/request`

**Request (sem autenticação):**
```json
{
  "email": "dan@voulezvous.com",
  "tenant_id": "voulezvous",
  "device_info": {
    "name": "MacBook Pro",
    "os": "macOS",
    "cli_version": "1.0.0"
  },
  "scopes": [
    "wallet.open",
    "span.sign",
    "cli.memory.add",
    "cli.memory.search",
    "cli.ask"
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "token": "tok_live_AbCdEf123...",
  "wallet_id": "wlt_voulezvous_dan",
  "exp": 1734048000,
  "spans_created": [
    "api_key_request",
    "wallet_opened",
    "api_token_issued"
  ]
}
```

**⚠️ IMPORTANTE:** Token mostrado apenas uma vez! Salvar imediatamente.

### Spans Criados

1. **`api_key_request`**
```json
{
  "entity_type": "api_key_request",
  "who": "user:self",
  "did": "requested",
  "this": "security.api_key",
  "metadata": {
    "email": "dan@voulezvous.com",
    "tenant_id": "voulezvous",
    "device_info": {...},
    "requested_scopes": [...]
  }
}
```

2. **`wallet_opened`**
```json
{
  "entity_type": "wallet_opened",
  "who": "system:wallet_service",
  "did": "opened",
  "this": "wallet",
  "metadata": {
    "wallet_id": "wlt_voulezvous_dan",
    "owner_id": "dan@voulezvous.com",
    "tenant_id": "voulezvous"
  }
}
```

3. **`api_token_issued`**
```json
{
  "entity_type": "api_token_issued",
  "who": "system:auth_service",
  "did": "issued",
  "this": "security.token",
  "metadata": {
    "token_hash": "argon2id(...)",
    "wallet_id": "wlt_voulezvous_dan",
    "scopes": [...],
    "exp": 1734048000
  }
}
```

### Reemissão de Chave

**Endpoint:** `POST /auth/keys/recover`

**Request:**
```json
{
  "email": "dan@voulezvous.com",
  "tenant_id": "voulezvous",
  "recovery_code": "recovery_abc123..." // Opcional, se tiver
}
```

**Response:**
```json
{
  "ok": true,
  "token": "tok_live_NewKey123...",
  "wallet_id": "wlt_voulezvous_dan",
  "old_token_revoked": true
}
```

**Spans:**
- `api_token_revoked` (token antigo)
- `api_token_issued` (novo token)

---

## 2️⃣ Fluxo UI (Magic Link)

### Fluxo Completo

```
1. Cliente entra email na UI
   ↓
2. POST /auth/magic/send → email enviado
   ↓
3. Cliente clica no magic link
   ↓
4. GET /auth/magic/verify?token=...
   ↓
5. Se novo: cria wallet + gera chaves Ed25519 (cliente não vê)
   ↓
6. Se existente: apenas autentica
   ↓
7. Retorna session token (JWT curto) ou redirect com token
```

### Endpoint: `POST /auth/magic/send`

**Request (público):**
```json
{
  "email": "dan@voulezvous.com",
  "tenant_id": "voulezvous", // Opcional, pode inferir do domínio
  "redirect_url": "https://app.loglineos.com/dashboard" // Onde redirecionar após login
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Magic link sent to email"
}
```

**Email enviado:**
```
Subject: Sign in to LogLineOS
Body: Click here to sign in: https://api.loglineos.com/auth/magic/verify?token=magic_abc123...&redirect=...
```

### Endpoint: `GET /auth/magic/verify`

**Request (via link no email):**
```
GET /auth/magic/verify?token=magic_abc123...&redirect=https://app.loglineos.com/dashboard
```

**Comportamento:**
1. Valida token (expira em 15 minutos)
2. Se novo usuário:
   - Cria wallet
   - Gera chaves Ed25519 (no Secrets Manager)
   - Cria `identity_registration` span
   - Cria `wallet_opened` span
   - Gera API token (long-lived, 1 ano)
3. Se usuário existente:
   - Busca wallet existente
   - Gera novo API token (ou reusa válido)
4. Redirect para `redirect_url` com token:
   ```
   https://app.loglineos.com/dashboard?token=tok_live_...&wallet_id=wlt_...
   ```

**Spans Criados (novo usuário):**
- `identity_registration`
- `wallet_opened`
- `api_token_issued`
- `email.verified` (implicitamente)

### Magic Link Token

**Formato:**
```
magic_{randomBase64url}_{timestamp}
```

**Armazenado em DynamoDB:**
```json
{
  "token": "magic_abc123...",
  "email": "dan@voulezvous.com",
  "tenant_id": "voulezvous",
  "expires_at": 1730740831,
  "status": "pending",
  "redirect_url": "..."
}
```

**TTL:** 15 minutos

---

## 3️⃣ Chamadas API = Spans?

**Sim!** Toda chamada API que modifica estado (POST, PUT, DELETE) pode ser registrada como span no ledger.

### Exemplo: `POST /cli/memory.add`

**Request:**
```json
{
  "content": "User prefers espresso",
  "tags": ["preference"]
}
```

**Span criado automaticamente:**
```json
{
  "entity_type": "memory",
  "who": "user:self",
  "did": "added",
  "this": "memory.item",
  "metadata": {
    "content": "User prefers espresso",
    "tags": ["preference"]
  },
  "sig": {
    "alg": "ed25519-blake3-v1",
    "key_id": "did:logline:...",
    "signature": "..."
  }
}
```

**Observação:** Spans são assinados pelo Wallet Service antes de serem armazenados no ledger.

---

## 4️⃣ Comparação dos Fluxos

| Aspecto | CLI Flow | UI Flow |
|---------|----------|---------|
| **Autenticação inicial** | Email + device_info | Email apenas |
| **Wallet** | Criado automaticamente | Criado automaticamente |
| **Chaves Ed25519** | Geradas no primeiro uso | Geradas automaticamente (cliente não vê) |
| **Token** | API Key (`tok_live_...`) | API Key (retornado via redirect) |
| **Magic Link** | Não | Sim (sempre) |
| **Recovery** | `/auth/keys/recover` | Magic link (mesmo fluxo) |
| **Spans** | `api_key_request`, `wallet_opened`, `api_token_issued` | `identity_registration`, `wallet_opened`, `api_token_issued` |

---

## 5️⃣ Segurança

### CLI Flow
- ✅ Wallet criado automaticamente
- ✅ API key única e não reutilizável
- ✅ Reemissão requer email + tenant_id
- ✅ Todos os eventos registrados como spans

### UI Flow
- ✅ Magic link expira em 15 minutos
- ✅ Token único por link (usado apenas uma vez)
- ✅ Chaves Ed25519 geradas automaticamente (não expostas ao cliente)
- ✅ Wallet isolado por tenant

### Ambos
- ✅ Tokens armazenados como hash (Argon2id)
- ✅ Spans assinados (Ed25519 + BLAKE3)
- ✅ Auditoria completa no ledger

---

## 6️⃣ Próximos Passos (Etapa 3 - Luxo)

### Passkey (WebAuthn)

**Quando implementar:**
- Após fluxos básicos estáveis
- Para melhor UX (sem senha, sem magic link)

**Fluxo:**
1. Cliente clica "Sign in with Passkey"
2. Browser/App solicita biometria/Touch ID/Face ID
3. Chave pública enviada ao backend
4. Backend valida passkey
5. Autentica (reusa wallet existente ou cria novo)

**Suporte:**
- ✅ Apple (Touch ID, Face ID)
- ✅ Android (Fingerprint, Face)
- ✅ Chrome (Windows Hello, USB Security Key)

**Status:** Planejado para futuro (luxo)

---

## 7️⃣ Implementação

### Endpoints a Criar

1. ✅ `POST /auth/keys/request` - CLI solicita API key
2. ✅ `POST /auth/keys/recover` - Reemissão de chave
3. ✅ `POST /auth/magic/send` - Envia magic link
4. ✅ `GET /auth/magic/verify` - Valida magic link

### Integrações

- ✅ Email Service (para magic links)
- ✅ Wallet Service (criação automática)
- ✅ DynamoDB (tokens, magic links)
- ✅ Ledger (spans)

---

**Status:** Em implementação  
**Prioridade:** Alta (fluxos core de autenticação)

