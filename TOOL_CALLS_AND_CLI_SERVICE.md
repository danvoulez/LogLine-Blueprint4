# Tool Calls + CLI as a Service (CaaS)

## Diferença

- **CLI as a Service (CaaS)**: Endpoints HTTP simplificados (`/cli/*`) que orquestram Wallet + Stage-0
- **Tool Calls**: Interface que LLMs usam para chamar funções (OpenAI Functions, Anthropic Tools)

## Mapeamento: CaaS → Tool Calls

### Exemplo: OpenAI Functions

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "logline_memory_add",
        "description": "Store a memory in LogLineOS ledger",
        "parameters": {
          "type": "object",
          "properties": {
            "content": {
              "type": "string",
              "description": "Memory content to store"
            },
            "tags": {
              "type": "array",
              "items": {"type": "string"},
              "description": "Tags for categorization"
            }
          },
          "required": ["content"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "logline_memory_search",
        "description": "Search memories in LogLineOS ledger",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "Search query"
            },
            "limit": {
              "type": "integer",
              "default": 10
            }
          },
          "required": ["query"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "logline_ask",
        "description": "Ask LLM provider (via Wallet) with context",
        "parameters": {
          "type": "object",
          "properties": {
            "prompt": {
              "type": "string",
              "description": "User prompt"
            },
            "provider": {
              "type": "string",
              "enum": ["anthropic", "openai"],
              "default": "anthropic"
            },
            "model": {
              "type": "string",
              "description": "Model name (e.g., claude-3-5-sonnet)"
            }
          },
          "required": ["prompt"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "logline_run_kernel",
        "description": "Run a kernel via Stage-0",
        "parameters": {
          "type": "object",
          "properties": {
            "boot_function_id": {
              "type": "string",
              "description": "Kernel ID (e.g., 00000000-0000-4000-8000-000000000022 for ledger_xray)"
            },
            "input": {
              "type": "object",
              "description": "Kernel input"
            }
          },
          "required": ["boot_function_id"]
        }
      }
    }
  ]
}
```

### Handler: Tool Call → CaaS Endpoint

```javascript
// When LLM calls tool "logline_memory_add"
async function handleToolCall(toolName, args, apiKey, tenantId) {
  const apiUrl = process.env.API_GATEWAY_URL;
  
  switch (toolName) {
    case 'logline_memory_add':
      return await fetch(`${apiUrl}/cli/memory.add`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: args.content,
          tags: args.tags || []
        })
      }).then(r => r.json());
      
    case 'logline_memory_search':
      return await fetch(`${apiUrl}/cli/memory.search`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: args.query,
          limit: args.limit || 10
        })
      }).then(r => r.json());
      
    case 'logline_ask':
      return await fetch(`${apiUrl}/cli/ask`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: args.prompt,
          provider: args.provider || 'anthropic',
          model: args.model || 'claude-3-5-sonnet'
        })
      }).then(r => r.json());
      
    case 'logline_run_kernel':
      return await fetch(`${apiUrl}/cli/run`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          boot_function_id: args.boot_function_id,
          input: args.input || {}
        })
      }).then(r => r.json());
      
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

## Fluxo Completo

```
User → LLM (OpenAI/Claude)
    ↓
LLM decides to call tool "logline_memory_add"
    ↓
Your backend receives tool call
    ↓
Handler calls CaaS endpoint: POST /cli/memory.add
    ↓
CaaS → Wallet Service (sign span)
    ↓
CaaS → Stage-0 (store span)
    ↓
Response → LLM
    ↓
LLM responds to user
```

## Vantagens

- ✅ **LLM pode usar LogLineOS** sem saber dos detalhes (Wallet, Stage-0, spans)
- ✅ **CaaS é a abstração perfeita** — endpoints simples e mapeáveis
- ✅ **Tudo auditável** — cada tool call → CaaS → spans no ledger
- ✅ **Auth já integrado** — ApiKey passa pelo Authorizer

## Resumo

**Tool Calls = Interface do LLM**  
**CaaS = Backend que orquestra Wallet + Stage-0**  
**Mapeamento: 1 tool → 1 endpoint CaaS**

