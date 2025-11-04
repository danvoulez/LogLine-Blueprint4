# ✅ Checklist de Onboarding LogLineID

Comparação entre o **requisito** e o que está **implementado**.

---

## 📋 Obrigatório no Onboarding

| Item | Status | Implementação |
|------|--------|---------------|
| **1. Par de chaves Ed25519** | ✅ | Wallet Service gera chaves, armazena no Secrets Manager |
| **2. KID = blake3(publicKey)** | ✅ | Implementado em `wallet/sign/span` (key_id = did:logline:<b3(pubkey)>) |
| **3. identity_registration (span)** | ❌ | **FALTA** - Criar endpoint específico |
| **4. key_attestation (nonce → assinatura)** | ❌ | **FALTA** - Criar `/auth/attest` |
| **5. wallet_opened** | ✅ | Wallet Service `/wallet/open` |
| **6. API Token emitido** | ✅ | Auth Service `/auth/keys/issue` |
| **7. Capability set** | ⚠️ | Parcial - escopos no token, mas falta `capability_grant` span |
| **8. Consent/ToS** | ❌ | **FALTA** - Criar `consent.accepted` span |
| **9. Rotação de chaves** | ✅ | Wallet Service `/wallet/key/rotate` |

---

## 🔁 Fluxo Humano

| Passo | Status | Implementação |
|-------|--------|---------------|
| 1. Gera chaves localmente + calcula KID | ✅ | Cliente gera, Wallet Service valida |
| 2. Envia `identity_registration` assinado | ❌ | **FALTA** - Criar endpoint |
| 3. Recebe nonce, assina, envia `key_attestation` | ❌ | **FALTA** - Criar `/auth/attest` |
| 4. Backend cria `wallet_opened`, emite `api_token_issued` | ⚠️ | Token emitido, mas falta span `api_token_issued` |
| 5. `secret_upsert` para BYO provider | ⚠️ | Wallet Service tem `key/register`, mas falta endpoint específico |
| 6. Policies/quotas mínimas | ❌ | **FALTA** - Criar spans de policy |

---

## 📦 Fluxo App

| Passo | Status | Implementação |
|-------|--------|---------------|
| 1. Gera chaves do app | ✅ | Mesmo processo |
| 2. Envia `app_registration` assinado | ✅ | CLI Service `/cli/app.register` |
| 3. Backend valida, cria `service_token_issued` | ⚠️ | Token emitido, mas não diferenciado de `api_token` |
| 4. `onboard_agent` emite spans | ❌ | **FALTA** - Automatização |
| 5. Agenda smoke test | ❌ | **FALTA** - Criar `smoke_test.requested` |

---

## 🧱 Spans Mínimos

| Span | Para quem | Status | Implementação |
|------|-----------|--------|---------------|
| `identity_registration` | ambos | ❌ | **FALTA** |
| `key_attestation` | ambos | ❌ | **FALTA** |
| `wallet_opened` | ambos | ✅ | Wallet Service cria |
| `api_token_issued` | pessoa | ⚠️ | Token emitido, mas falta span |
| `service_token_issued` | app | ❌ | **FALTA** - Diferenciar de api_token |
| `capability_grant` | ambos | ❌ | **FALTA** |
| `consent.accepted` | ambos | ❌ | **FALTA** |
| `app_registration` | app | ✅ | CLI Service cria |
| `pact` (ex.: provider.invoke) | app | ❌ | **FALTA** |
| `slo_spec` | app | ❌ | **FALTA** |
| `smoke_test.requested` | app | ❌ | **FALTA** |
| `device_registration` | pessoa | ❌ | **FALTA** |

---

## 🔐 Tokens e Escopos

| Item | Status | Implementação |
|------|--------|---------------|
| `api_token` (humano) - curto prazo | ✅ | Auth Service (`ttl_hours`) |
| `service_token` (app) - longo prazo | ❌ | **FALTA** - Diferenciar tipos |
| Rotação com `key_rotation` + `capability_migrate` | ⚠️ | Rotação existe, mas falta `capability_migrate` |

---

## 🛡️ Governança

| Item | Status | Implementação |
|------|--------|---------------|
| Stage-0 recusa spans sem `sig.alg=ed25519-blake3-v1` | ⚠️ | Placeholder no stage0_loader |
| Manifest whitelista kernels | ✅ | Implementado |
| RLS por tenant_id e owner_id | ✅ | Implementado |
| Policies: throttle, slow-exec, error-notify, quota | ❌ | **FALTA** - Spans de policy |
| Pacts: chamadas federadas | ❌ | **FALTA** - Span `pact` |

---

## 🧯 Recuperação & Múltiplos Devices

| Item | Status | Implementação |
|------|--------|---------------|
| `device_registration` com attestation | ❌ | **FALTA** |
| Perda de chave: `recovery_request` + `multisig_approval` | ❌ | **FALTA** |

---

## 📊 Resumo

- **✅ Implementado:** 7 itens (38%)
- **⚠️ Parcial:** 5 itens (26%)
- **❌ Falta:** 11 itens (58%)

---

## 🎯 Próximos Passos

1. **Alta prioridade:**
   - Criar `identity_registration` endpoint
   - Criar `/auth/attest` para `key_attestation`
   - Criar spans `api_token_issued` e `service_token_issued`
   - Diferenciar `api_token` de `service_token` no Auth Service

2. **Média prioridade:**
   - Criar `capability_grant` span
   - Criar `consent.accepted` span
   - Criar `device_registration` span
   - Implementar `onboard_agent` (automatização)

3. **Baixa prioridade:**
   - Criar spans `pact`, `slo_spec`, `smoke_test.requested`
   - Implementar recovery flow
   - Adicionar `capability_migrate` na rotação

---

**Status:** 38% completo  
**Data:** 2025-11-04

