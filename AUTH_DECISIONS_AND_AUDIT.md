## Auth Decisions and Audit (Spans)

### Spans emitidos
- auth.decision (permit/denied) — em Authorizer e Stage-0 (kernel-level)
- token_use — telemetria por requisição

### auth.decision (exemplo)
```json
{
  "entity_type": "auth.decision",
  "who": "edge:authorizer",
  "did": "evaluated",
  "this": "authz",
  "status": "permitted",
  "tenant_id": "acme",
  "metadata": {
    "route": "/api/boot",
    "method": "POST",
    "wallet_id": "wlt_acme_dan",
    "token_hash": "abc123",
    "scopes": ["kernel:ledger_xray:invoke"],
    "auth_method": "api_key"
  }
}
```

### Leis relacionadas
- auth_break_glass:1.0.0 — overrides emergenciais
- auth_decision_audit:1.0.0 — audita denies/permites críticos

### RBAC tenant-scoped
Ver `ROLE_MATRIX.md` — roles → scopes por tenant; tokens carregam roles e scopes derivados.
