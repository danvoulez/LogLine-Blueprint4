## Ledger X-Ray - Uso via /api/boot

### Escopo necessário
- `kernel:ledger_xray:invoke`

### Manifest
- `allowed_boot_ids` deve incluir `00000000-0000-4000-8000-000000000022`

### cURL (dev)
```bash
API_URL="https://<api-id>.execute-api.us-east-1.amazonaws.com/dev"
TENANT="acme"
TOK="tok_acme_..."

curl -sS -X POST "$API_URL/api/boot?tenant=$TENANT" \
  -H "Authorization: ApiKey $TOK" \
  -H "Content-Type: application/json" \
  -d '{
    "boot_function_id": "00000000-0000-4000-8000-000000000022",
    "input": {
      "sections": ["schema","rls","kernels","spans","signatures","integrity","activity","performance"],
      "limit": 20,
      "since": "2025-01-01T00:00:00Z"
    }
  }'
```

### Resposta (resumo)
```json
{
  "status": "complete",
  "report": {
    "schema": { "columns": [...], "indexes": [...] },
    "rls": { "enabled": true, "policies": [...] },
    "kernels": [...],
    "spans": { "by_type": [...], "total": 123, "by_status": [...], "latest": [...] },
    "signatures": { "total": 45, "signed": 38, "pct_signed": 84.4 },
    "integrity": { "versioned": [...], "orphans": 0, "metadata_empty": 0 },
    "activity": { "last_24h": 23, "last_week": 156, "latest": [...] },
    "performance": { "total_size": "2.5 MB", "table_size": "1.8 MB", "indexes_size": "700 kB", "estimate": 523 }
  },
  "metrics": { "duration_ms": 220, "latency_ms_by_section": {"spans": 45} }
}
```
