# 📚 Blueprint4 — References & Permalinks

## 🔗 Permanent Links (GitHub)

### Main Specifications

* **Auth + Wallet + CLI (SST):**
  https://github.com/danvoulez/Blueprint4/blob/695c452fd0da3753b5d8e6cec7465be88ebcb56e/Blueprint4_AUTH_WALLET_CLI.md

* **Blueprint4 Main:**
  https://github.com/danvoulez/Blueprint4/blob/695c452fd0da3753b5d8e6cec7465be88ebcb56e/Bluprint4.md

### Local Files

* `BLUEPRINT4_AUTH_WALLET_CLI.md` - Auth/Wallet/CLI specification (frozen design)
* `LOGLINEOS_SERVICES_SPEC.md` - Consolidated services specification
* `MIGRATION_NOTES.md` - Migration from old Token Service to new Auth/Wallet/CLI

---

## 📋 Quick Reference

### Design Decisions (Frozen)

1. **No passwords** - API Key authentication only
2. **Wallet-managed signatures** - All spans signed with Ed25519+BLAKE3
3. **DynamoDB for tokens** - `auth_api_tokens`, `wallets`, `nonces`
4. **Mandatory signatures** - Stage-0 rejects unsigned spans
5. **CLI as a Service** - Simplified endpoints (`/cli/*`)

### Key Components

* **Lambda Authorizer:** `auth_api_key_authorizer`
* **Lambda Wallet:** `wallet_service`
* **Lambda CLI:** `cli_service`
* **Stage-0:** `stage0_loader` (validates signatures)

### Storage

* **DynamoDB:** Tokens, wallets, nonces
* **RDS Postgres:** Ledger (with signature columns)
* **Secrets Manager:** Ed25519 keys, provider keys, pepper

---

**Last Updated:** 2025-01-XX  
**Status:** Design Frozen (SST)

