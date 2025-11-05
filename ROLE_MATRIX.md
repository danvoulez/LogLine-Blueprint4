## RBAC - Tenant-Scoped Role Matrix

### Roles (per tenant)
- owner: all scopes
- admin: manage users, tokens, kernels (no destructive DB ops)
- ops: operational actions, emergency_override (with law approval)
- developer: kernel invoke, spans write in dev namespaces
- reader: read-only spans/timeline

### Scopes (examples)
- /api/spans:write
- /api/boot:invoke
- kernel:<name>:invoke
- memory.read, memory.write
- provider.invoke:*

### Mapping (example)
- owner → all
- admin → [/api/spans:write, /api/boot:invoke, kernel:*:invoke]
- ops → [/api/boot:invoke, kernel:ledger_xray:invoke, emergency_override]
- developer → [/api/spans:write, /api/boot:invoke, kernel:prompt_fetch:invoke]
- reader → []

Tokens carregam: { tenant_id, roles: [..], scopes: [..] (derivados), auth_method }
