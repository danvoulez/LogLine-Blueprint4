# LogLineOS Deploy

**Production-ready deployment infrastructure for LogLineOS: Lambda functions, Terraform, CI/CD, and deployment automation.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-orange.svg)](https://aws.amazon.com/lambda/)
[![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-blue.svg)](https://www.postgresql.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)

---

## 🎯 What is LogLineOS?

LogLineOS is a **universal, semantic, ledger-only backend** where every behavior (executors, observers, policies, providers, prompt system) is stored as **versioned spans** in an append-only PostgreSQL ledger. All code lives in the database as immutable, auditable spans.

### Core Principles

- **Ledger-Only**: All business logic stored as spans in `universal_registry`
- **Append-Only**: Immutable history with cryptographic proofs (BLAKE3 + Ed25519)
- **Multitenant**: Row-level security (RLS) with tenant isolation
- **Stage-0 Loader**: Minimal bootstrap that loads and executes whitelisted kernels
- **Semantic Columns**: ~70 semantic columns for rich queryability

---

## 📦 What's Included

### ✅ Core Kernels (8 Production-Ready)

| Kernel | ID | Purpose | Status |
|--------|-----|---------|--------|
| run_code_kernel | `00000000-0000-4000-8000-000000000001` | Execute user functions | ✅ |
| observer_bot_kernel | `00000000-0000-4000-8000-000000000002` | Monitor and schedule | ✅ |
| request_worker_kernel | `00000000-0000-4000-8000-000000000003` | Process requests | ✅ |
| policy_agent_kernel | `00000000-0000-4000-8000-000000000004` | Apply policies | ✅ |
| provider_exec_kernel | `00000000-0000-4000-8000-000000000005` | LLM providers (OpenAI, Ollama) | ✅ |
| prompt_fetch_kernel | `00000000-0000-4000-8000-000000000006` | Prompt interpolation | ✅ |
| memory_store_kernel | `00000000-0000-4000-8000-000000000007` | Memory layer (store/search/list) | ✅ |
| app_enrollment_kernel | `00000000-0000-4000-8000-000000000008` | App onboarding | ✅ |

### 📊 Features Implemented

- ✅ **Policies**: Throttle, slow exec detection, metrics, error reporting
- ✅ **Providers**: OpenAI, Ollama integration
- ✅ **Prompts**: 6 system prompts with variable interpolation
- ✅ **Memory Layer**: Store, search, list with UTF-8 support
- ✅ **App Enrollment**: Device registration, manifest distribution
- ✅ **Manifest Governance**: Whitelist-based kernel execution
- ✅ **RLS & Security**: Tenant isolation, ownership validation
- ✅ **Battle-Hardened**: 7/7 critical security tests passed (A+ grade)

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **AWS CLI** configured (for Lambda deployment)
- **AWS Account** with Lambda + RDS access

### 1. Clone & Install

```bash
git clone https://github.com/danvoulez/LogLine-Deploy.git
cd LogLine-Deploy
npm install
```

### 2. Database Setup

```bash
# Set your DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# Run migrations
node FILES/src/migrate.js

# Seed kernels, policies, providers from ROW/
node FILES/src/seed.js
```

### 3. Deploy to AWS Lambda

```bash
# Package and deploy (uses FILES/ and ROW/)
bash FILES/scripts/deploy.sh

# Seed via Lambda
bash FILES/scripts/invoke.sh seed
```

### 4. Test It!

```bash
# Store a memory
aws lambda invoke \
  --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"store","content":"Hello LogLineOS!","tags":["test"]}}' \
  --cli-binary-format raw-in-base64-out \
  response.json && cat response.json
```

---

## 📖 Documentation

- [Blueprint4.md](Blueprint4.md) - Complete specification
- [PHASE4_COMPLETE.md](PHASE4_COMPLETE.md) - Core kernels
- [PHASE5_6_COMPLETE.md](PHASE5_6_COMPLETE.md) - Policies & providers
- [PHASE7_COMPLETE.md](PHASE7_COMPLETE.md) - Prompt system
- [PHASE8_COMPLETE.md](PHASE8_COMPLETE.md) - Memory layer
- [PHASE9_COMPLETE.md](PHASE9_COMPLETE.md) - App enrollment
- [BATTLE_HARDENING_RESULTS.md](BATTLE_HARDENING_RESULTS.md) - Security tests

---

## 🛠️ Usage Examples

### Store & Search Memories

```bash
# Store
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{
    "action":"boot",
    "boot_function_id":"00000000-0000-4000-8000-000000000007",
    "input":{
      "action":"store",
      "content":"User prefers dark mode 🌙",
      "tags":["ui","preference"],
      "memory_type":"local"
    }
  }' --cli-binary-format raw-in-base64-out response.json

# Search
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{
    "action":"boot",
    "boot_function_id":"00000000-0000-4000-8000-000000000007",
    "input":{
      "action":"search",
      "search_query":"dark mode"
    }
  }' --cli-binary-format raw-in-base64-out response.json
```

### Fetch Prompts with Variables

```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{
    "action":"boot",
    "boot_function_id":"00000000-0000-4000-8000-000000000006",
    "input":{
      "prompt_id":"00000000-0000-4000-8000-000000000103",
      "variables":{"user_name":"Alice","org_name":"Acme Corp"}
    }
  }' --cli-binary-format raw-in-base64-out response.json
```

### Enroll App

```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{
    "action":"boot",
    "boot_function_id":"00000000-0000-4000-8000-000000000008",
    "input":{
      "action":"enroll",
      "app_name":"My iOS App",
      "app_version":"1.0.0",
      "device_fingerprint":"iphone-15-abc",
      "pubkey":"ed25519:your_public_key"
    }
  }' --cli-binary-format raw-in-base64-out response.json
```

---

## 🔐 Security

### Battle-Hardened ✅

All critical security tests passed with **A+ grade**:

- ✅ SQL Injection Protection
- ✅ Manifest Whitelist Enforcement
- ✅ Ownership Validation
- ✅ XSS-Safe Storage
- ✅ UTF-8 Complete (🌙 用户 café ñoño)
- ✅ Concurrent Write Safety
- ✅ Clear Error Messages

### Security Features

- **Parameterized SQL** - No injection attacks
- **RLS (Row-Level Security)** - Tenant isolation
- **Ed25519 Signatures** - Cryptographic proofs
- **Append-Only Ledger** - Immutable audit trail
- **Manifest Governance** - Whitelist-based kernel execution

---

## 📊 Performance

- **Memory Store**: ~3-4ms avg
- **Memory Search**: ~2-3ms avg
- **Enrollment**: ~4-5ms avg
- **Lambda Cold Start**: <1s
- **Lambda Warm**: <10ms overhead

---

## 🏗️ Architecture

### Codebase Organization

```
loglineos-blueprint4/
├── FILES/          # Project code (not in ledger)
│   ├── src/        # Source code (handler, stage0, db, crypto, api)
│   ├── config/     # Configuration (schema.sql)
│   └── scripts/    # Deployment scripts
├── ROW/            # Ledger data (spans that live in database)
│   ├── kernels/    # Function spans
│   ├── prompts/    # Prompt system spans
│   ├── policies/   # Policy spans
│   ├── providers/  # Provider spans
│   └── manifest/   # Manifest spans
└── handler.js      # Lambda entry point (re-exports FILES/src/handler.js)
```

### System Architecture

```
┌─────────────────┐
│   Client App    │
│  (VS Code, iOS, │
│   Web, CLI)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AWS Lambda     │
│  Stage-0 Loader │
│  (FILES/src/)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────┐
│   PostgreSQL    │◄─────│   Kernels    │
│ Ledger (RLS)    │      │  (ROW/ → DB) │
└─────────────────┘      └──────────────┘
```

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Inspired by event sourcing, CQRS, and ledger-based architectures
- Built with love by [@danvoulez](https://github.com/danvoulez)
- Powered by PostgreSQL, Node.js, and AWS Lambda

---

## 📬 Contact

- **GitHub**: [@danvoulez](https://github.com/danvoulez)
- **Project**: [LogLine-Deploy](https://github.com/danvoulez/LogLine-Deploy)
- **Specs**: [LogLine-Ruleset](https://github.com/danvoulez/LogLine-Ruleset) - Functional specifications and blueprints

---

**⭐ Star this repo if you find it useful!**
# CI/CD Test
# Test CI/CD with secrets
