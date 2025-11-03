# 🔍 Policy Wildcard Matching - Análise e Solução

## Problema Identificado

**Policy seeded:**
```json
{
  "action": "execute",
  "resource": "function/*",
  "effect": "allow"
}
```

**Request:**
```json
{
  "action": "execute",
  "resource": "function/run_code"
}
```

**Resultado atual:** ❌ `"No matching policy found - default deny"`

**Esperado:** ✅ `"Allowed by policy: allow_system_functions"`

---

## Código Atual (policy_agent_kernel linha 4)

```javascript
// Match action pattern
if (rule.action && rule.action !== action && rule.action !== '*') {
  continue;
}

// Match resource pattern
if (rule.resource && rule.resource !== resource && rule.resource !== '*') {
  continue;
}
```

**Problema:** Comparação exata (`!==`) não suporta wildcards.
- `"function/*" !== "function/run_code"` → true → continue (skip rule)
- Wildcard `*` só funciona se for literal `"*"`, não em patterns como `"prefix/*"`

---

## Solução: Wildcard Matching Function

### Opção 1: Simple Glob Matching (Recomendado)

```javascript
function matchPattern(pattern, value) {
  if (!pattern || pattern === '*') return true;
  if (pattern === value) return true;
  
  // Convert glob pattern to regex
  // function/* → ^function\/.*$
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars
    .replace(/\*/g, '.*');                    // * → .*
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(value);
}
```

**Testes:**
- `matchPattern("function/*", "function/run_code")` → ✅ true
- `matchPattern("function/*", "kernel/observer")` → ❌ false
- `matchPattern("*", "anything")` → ✅ true
- `matchPattern("function/run_code", "function/run_code")` → ✅ true (exact)

### Opção 2: Path-based Matching (Alternativa)

```javascript
function matchPattern(pattern, value) {
  if (!pattern || pattern === '*') return true;
  if (pattern === value) return true;
  
  const patternParts = pattern.split('/');
  const valueParts = value.split('/');
  
  if (patternParts.length !== valueParts.length && !pattern.includes('*')) {
    return false;
  }
  
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '*') return true;
    if (patternParts[i] !== valueParts[i]) return false;
  }
  
  return true;
}
```

---

## Kernel Atualizado (policy_agent_kernel seq 3)

```javascript
globalThis.default = async function checkPolicies(ctx) {
  const { client, env } = ctx;
  const { action, resource, request_id } = ctx.input;
  
  if (!action || !resource) {
    return { allowed: false, reason: 'Missing required fields: action, resource' };
  }
  
  const userId = env.userId;
  const tenantId = env.tenantId;
  
  console.log(`Checking policies for user=${userId}, tenant=${tenantId}, action=${action}, resource=${resource}`);
  
  // Wildcard matching helper
  function matchPattern(pattern, value) {
    if (!pattern || pattern === '*') return true;
    if (pattern === value) return true;
    
    // Convert glob to regex: function/* → ^function\/.*$
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
  }
  
  // Fetch active policies from ledger
  const { rows: policies } = await client.query(`
    SELECT id, name, metadata
    FROM ledger.visible_timeline
    WHERE entity_type = 'policy'
      AND status = 'active'
      AND (visibility = 'public' OR tenant_id = $1)
    ORDER BY at DESC
  `, [tenantId]);
  
  console.log(`Found ${policies.length} policies to evaluate`);
  
  if (policies.length === 0) {
    return {
      allowed: false,
      reason: 'No policies found - default deny',
      policies_checked: 0
    };
  }
  
  // Evaluate each policy (deny takes precedence)
  let lastMatch = null;
  
  for (const policy of policies) {
    const meta = policy.metadata || {};
    const rules = meta.rules || [];
    
    for (const rule of rules) {
      // Match action pattern with wildcards
      if (rule.action && !matchPattern(rule.action, action)) {
        continue;
      }
      
      // Match resource pattern with wildcards
      if (rule.resource && !matchPattern(rule.resource, resource)) {
        continue;
      }
      
      console.log(`Matched rule: action=${rule.action}, resource=${rule.resource}, effect=${rule.effect}`);
      
      // Check effect - DENY takes immediate precedence
      if (rule.effect === 'deny') {
        return {
          allowed: false,
          reason: `Denied by policy: ${policy.name} (${policy.id})`,
          policy_id: policy.id,
          rule: rule
        };
      }
      
      // Track allow rule (but continue checking for deny)
      if (rule.effect === 'allow') {
        lastMatch = {
          allowed: true,
          reason: `Allowed by policy: ${policy.name} (${policy.id})`,
          policy_id: policy.id,
          rule: rule
        };
      }
    }
  }
  
  // Return allow if found, otherwise deny
  if (lastMatch) {
    return lastMatch;
  }
  
  return {
    allowed: false,
    reason: 'No matching policy found - default deny',
    policies_checked: policies.length
  };
};
```

---

## Mudanças Chave

1. **Helper `matchPattern()`:** Converte glob patterns para regex
2. **Wildcard support:** `function/*` agora match `function/anything`
3. **Deny precedence:** DENY rules retornam imediatamente (segurança)
4. **Allow tracking:** ALLOW rules são rastreadas mas não retornam até verificar todas as deny rules

---

## Testes Esperados

### Test 1: Wildcard Allow
```json
Input: { "action": "execute", "resource": "function/run_code" }
Policy: { "action": "execute", "resource": "function/*", "effect": "allow" }
Expected: ✅ { "allowed": true, "reason": "Allowed by policy: allow_system_functions" }
```

### Test 2: Wildcard Deny (precedence)
```json
Input: { "action": "delete", "resource": "database/production" }
Policy: { "action": "delete", "resource": "database/*", "effect": "deny" }
Expected: ❌ { "allowed": false, "reason": "Denied by policy: deny_dangerous_operations" }
```

### Test 3: No Match
```json
Input: { "action": "delete", "resource": "function/run_code" }
Policies: (none matching)
Expected: ❌ { "allowed": false, "reason": "No matching policy found - default deny" }
```

---

## Próximos Passos

1. Atualizar `ROW/kernels/01-kernels.ndjson` com seq=3 para policy_agent_kernel
2. Deploy + Seed
3. Testar com `./invoke.sh boot 00000000-0000-4000-8000-000000000004`
4. Validar allowed=true para `function/*` patterns
