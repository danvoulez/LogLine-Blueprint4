# ROW/ - Ledger Data

This directory contains all data that **lives in the ledger** as spans in `ledger.universal_registry`.

## Structure

```
ROW/
├── kernels/      # Function spans (JavaScript kernels)
├── prompts/      # Prompt system spans (blocks, variants, evals)
├── policies/     # Policy spans
├── providers/    # LLM provider configuration spans
├── manifest/     # System manifest spans
├── memory/       # Memory template spans
├── bundles/      # Application bundles
└── tests/        # Test suites
```

## Format

All files are in **NDJSON** (Newline Delimited JSON) format, where each line is a complete JSON object representing a span.

## Entity Types

- **kernels/** → `entity_type='function'`
- **prompts/** → `entity_type='prompt_block'`, `'prompt_variant'`, `'prompt_eval'`
- **policies/** → `entity_type='policy'`
- **providers/** → `entity_type='provider'`
- **manifest/** → `entity_type='manifest'`
- **memory/** → `entity_type='memory'`

## Seeding

The `FILES/src/seed.js` script reads from `ROW/` and inserts all spans into the ledger.

## Versioning

Spans are versioned using the `seq` field. Hardened versions (higher `seq`) take precedence during seeding.

