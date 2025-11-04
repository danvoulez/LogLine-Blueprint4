# 🔄 Migration Notes: Token Service → Auth/Wallet/CLI

## Mudanças Principais

### ❌ O que foi desfeito/obsoleto

1. **Token Service baseado em ledger** (`AUTH_TOKEN_SERVICE_SPEC.md`)
   - ❌ Tokens armazenados como spans no ledger
   - ❌ Lambda Authorizer que valida no RDS
   - ❌ Kernel `token_issuer` que emite tokens

2. **Formato de token:**
   - ❌ `Authorization: Bearer tok_acme_...`
   - ✅ Novo: `Authorization: ApiKey tok_live_...`

3. **Armazenamento:**
   - ❌ Tokens no ledger (`api_token` spans)
   - ✅ Novo: DynamoDB `auth_api_tokens`

### ✅ Novo Design

1. **DynamoDB para tokens:**
   - Tabela `auth_api_tokens` com hash Argon2id
   - Tabela `wallets` para metadados de chaves
   - Tabela `nonces` para anti-replay

2. **Wallet Service:**
   - Gerencia chaves Ed25519 e provider keys
   - Assina spans antes de enviar ao Stage-0
   - Nunca expõe segredos

3. **CLI as a Service:**
   - Endpoints simplificados: `/cli/memory.add`, `/cli/ask`, etc.
   - Orquestra Wallet + Stage-0 internamente

4. **Assinatura obrigatória:**
   - Stage-0 recusa spans sem `sig{}` válido
   - Assinatura Ed25519 + BLAKE3

## Arquivos a Remover/Atualizar

### Remover:
- ❌ `AUTH_TOKEN_SERVICE_SPEC.md` (substituído por `BLUEPRINT4_AUTH_WALLET_CLI.md`)
- ❌ `TOKEN_SERVICE_OPERATIONS.md` (obsoleto)
- ❌ `ROW/kernels/15-token-issuer.ndjson` (tokens não são mais kernels)
- ❌ `lambda/authorizers/tokenAuthorizer.js` (substituído por novo authorizer)
- ❌ `scripts/setup-token-service.sh` (obsoleto)
- ❌ `terraform/token-authorizer.tf` (será substituído)

### Manter mas atualizar:
- ✅ `LOGLINEOS_SERVICES_SPEC.md` - Remover PART 5 (Token Service), adicionar referência ao novo blueprint
- ✅ `openapi.yaml` - Atualizar schemas de auth para ApiKey
- ✅ `FILES/src/stage0_loader.js` - Adicionar verificação de `sig{}` obrigatória

### Novo arquivo principal:
- ✅ `BLUEPRINT4_AUTH_WALLET_CLI.md` - **FONTE ÚNICA** para Auth/Wallet/CLI

## Próximos Passos

1. Implementar novo Authorizer (`auth_api_key_authorizer`)
2. Implementar Wallet Service (`wallet_service`)
3. Implementar CLI Service (`cli_service`)
4. Criar tabelas DynamoDB
5. Atualizar Stage-0 para validar assinaturas
6. Migrar tokens existentes (se houver)

---

**Status:** Design frozen, aguardando implementação

