# FILES/ - Project Code

This directory contains all **project code** that does **not** live in the ledger.

## Structure

```
FILES/
├── src/          # Source code (handlers, core logic)
├── config/       # Configuration files (schema, env templates)
└── scripts/      # Deployment and utility scripts
```

## Source Code (`src/`)

- **handler.js** - Universal Lambda handler (routes to migrate, seed, stage0, api)
- **stage0_loader.js** - Stage-0 kernel loader and executor
- **db.js** - Database client and RLS utilities
- **crypto.js** - Cryptographic functions (BLAKE3, Ed25519, AES-256-GCM)
- **api.js** - REST + SSE API layer
- **seed.js** - Ledger seeding from ROW/ files
- **migrate.js** - Database schema migration
- **query.js** - Query utilities

## Configuration (`config/`)

- **schema.sql** - PostgreSQL schema definition

## Scripts (`scripts/`)

- **deploy.sh** - Manual Lambda deployment script
- **invoke.sh** - Lambda invocation helpers
- **cleanup-old-resources.sh** - AWS resource cleanup

## Imports

All files in `src/` use relative imports (`./db`, `./crypto`, etc.) since they're in the same directory.

Files that need to access `ROW/` use:
```javascript
path.join(__dirname, '../../ROW/...')
```

Files that need to access `config/` use:
```javascript
path.join(__dirname, '../config/...')
```

## Entry Point

The root `handler.js` re-exports from `FILES/src/handler.js` to maintain Lambda function handler compatibility.

