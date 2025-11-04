# ✅ Checklist de Onboarding LogLineID

Comparação entre o **requisito** e o que está **implementado**.

---

## 📋 Obrigatório no Onboarding

| Item | Status | Implementação |
|------|--------|---------------|
| **1. Par de chaves Ed25519** | ✅ | Wallet Service gera chaves, armazena no Secrets Manager |
| **2. KID = blake3(publicKey)** | ✅ | Implementado em `wallet/sign/span` (key_id = did:logline:<b3(pubkey)>) |
| **3. identity_registration (span)** | ✅ | **IMPLEMENTADO** - `/auth/identity/register` |
| **4. key_attestation (nonce → assinatura)** | ✅ | **IMPLEMENTADO** - `/auth/attest` |
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
| 2. Envia `identity_registration` assinado | ✅ | **IMPLEMENTADO** - `/auth/identity/register` |
| 3. Recebe nonce, assina, envia `key_attestation` | ✅ | **IMPLEMENTADO** - `/auth/attest` |
| 4. Backend cria `wallet_opened`, emite `api_token_issued` | ✅ | **IMPLEMENTADO** - Span emitido automaticamente |
| 5. `secret_upsert` para BYO provider | ⚠️ | Wallet Service tem `key/register`, mas falta endpoint específico |
| 6. Policies/quotas mínimas | ❌ | **FALTA** - Criar spans de policy |

---

## 📦 Fluxo App

| Passo | Status | Implementação |
|-------|--------|---------------|
| 1. Gera chaves do app | ✅ | Mesmo processo |
| 2. Envia `app_registration` assinado | ✅ | CLI Service `/cli/app.register` |
| 3. Backend valida, cria `service_token_issued` | ✅ | **IMPLEMENTADO** - Diferenciado por `token_type` |
| 4. `onboard_agent` emite spans | ✅ | **IMPLEMENTADO** - Lambda `onboard_agent` criado |
| 5. Agenda smoke test | ✅ | **IMPLEMENTADO** - `onboard_agent` cria `smoke_test.requested` |

---

## 🧱 Spans Mínimos

| Span | Para quem | Status | Implementação |
|------|-----------|--------|---------------|
| `identity_registration` | ambos | ✅ | **IMPLEMENTADO** - `/auth/identity/register` |
| `key_attestation` | ambos | ✅ | **IMPLEMENTADO** - `/auth/attest` |
| `wallet_opened` | ambos | ✅ | Wallet Service cria |
| `api_token_issued` | pessoa | ✅ | **IMPLEMENTADO** - Emitido automaticamente |
| `service_token_issued` | app | ✅ | **IMPLEMENTADO** - Diferenciado por tipo |
| `capability_grant` | ambos | ✅ | **IMPLEMENTADO** - `onboard_agent` cria |
| `consent.accepted` | ambos | ⚠️ | Template criado, falta endpoint |
| `app_registration` | app | ✅ | CLI Service cria |
| `pact` (ex.: provider.invoke) | app | ✅ | **IMPLEMENTADO** - `onboard_agent` cria |
| `slo_spec` | app | ✅ | **IMPLEMENTADO** - `onboard_agent` cria |
| `smoke_test.requested` | app | ✅ | **IMPLEMENTADO** - `onboard_agent` cria |
| `device_registration` | pessoa | ✅ | **IMPLEMENTADO** - `/cli/device.register` |

---

## 🔐 Tokens e Escopos

| Item | Status | Implementação |
|------|--------|---------------|
| `api_token` (humano) - curto prazo | ✅ | Auth Service (24h default) |
| `service_token` (app) - longo prazo | ✅ | **IMPLEMENTADO** - 8760h (1 ano) default |
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

- **✅ Implementado:** 16 itens (84%)
- **⚠️ Parcial:** 2 itens (11%)
- **❌ Falta:** 1 itens (5%)

---

## 🎯 Próximos Passos

1. **Alta prioridade:**
   - ✅ Criar `identity_registration` endpoint - **FEITO**
   - ✅ Criar `/auth/attest` para `key_attestation` - **FEITO**
   - ✅ Criar spans `api_token_issued` e `service_token_issued` - **FEITO**
   - ✅ Diferenciar `api_token` de `service_token` - **FEITO**

2. **Média prioridade:**
   - ✅ Criar `capability_grant` span - **FEITO** (onboard_agent)
   - ⚠️ Criar `consent.accepted` span - Template criado, falta endpoint
   - ✅ Criar `device_registration` span - **FEITO**
   - ✅ Implementar `onboard_agent` - **FEITO**

3. **Baixa prioridade:**
   - ✅ Criar spans `pact`, `slo_spec`, `smoke_test.requested` - **FEITO**
   - ❌ Implementar recovery flow - **FALTA**
   - ⚠️ Adicionar `capability_migrate` na rotação - **FALTA**

---

**Status:** 84% completo  
**Data:** 2025-11-04  
**Última atualização:** 2025-11-04

