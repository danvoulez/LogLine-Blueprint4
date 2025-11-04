/**
 * Lambda CLI Service
 * Simplified HTTP endpoints that orchestrate Wallet + Stage-0
 * 
 * Environment variables:
 *   STAGE0_FUNCTION_NAME - Name of Stage-0 Lambda function
 *   AWS_REGION - AWS region (default: us-east-1)
 */

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Call Wallet Service
 */
async function callWalletService(walletId, endpoint, body, apiKey) {
  // In production, this would call the Wallet Service Lambda or API Gateway
  // For now, we'll construct the URL from environment
  const walletUrl = process.env.WALLET_SERVICE_URL || 'https://api.example.com/dev';
  
  const response = await fetch(`${walletUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  return await response.json();
}

/**
 * Call Stage-0 Lambda
 */
async function callStage0(bootFunctionId, input, context) {
  const payload = {
    boot_function_id: bootFunctionId,
    input: input,
    user_id: context.userId,
    tenant_id: context.tenantId
  };
  
  const command = new InvokeCommand({
    FunctionName: process.env.STAGE0_FUNCTION_NAME,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload)
  });
  
  const response = await lambdaClient.send(command);
  const result = JSON.parse(Buffer.from(response.Payload).toString());
  
  return result;
}

/**
 * POST /cli/memory.add
 * Adds memory (creates signed span)
 */
async function handleMemoryAdd(event, context) {
  const { content, tags, layer } = JSON.parse(event.body || '{}');
  
  if (!content) {
    return { statusCode: 400, body: JSON.stringify({ error: 'content required' }) };
  }
  
  const walletId = context.walletId;
  const apiKey = event.headers?.authorization?.replace(/^ApiKey\s+/i, '');
  
  // 1. Create span (without sig)
  const span = {
    id: `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    entity_type: 'memory',
    who: context.userId,
    did: 'stored',
    this: 'memory',
    at: new Date().toISOString(),
    status: 'active',
    owner_id: context.userId,
    tenant_id: context.tenantId,
    visibility: 'private',
    content: { text: content },
    metadata: {
      layer: layer || 'session',
      type: 'note',
      tags: tags || [],
      stored_at: Date.now()
    }
  };
  
  // 2. Sign span via Wallet
  const signResult = await callWalletService(
    walletId,
    '/wallet/sign/span',
    { kid: 'kid_ed25519_main', span: span },
    apiKey
  );
  
  if (!signResult.sig) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to sign span' }) };
  }
  
  // 3. Add signature to span
  span.payload_hash = signResult.payload_hash;
  span.sig = signResult.sig;
  
  // 4. Send to Stage-0 (via memory_upsert kernel)
  const result = await callStage0(
    '00000000-0000-4000-8000-000000000009', // memory_upsert_kernel
    {
      layer: layer || 'session',
      type: 'note',
      content: { text: content },
      tags: tags || []
    },
    context
  );
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      memory_id: span.id,
      span_id: span.id
    })
  };
}

/**
 * POST /cli/memory.search
 * Searches memories
 */
async function handleMemorySearch(event, context) {
  const { query, limit = 10 } = JSON.parse(event.body || '{}');
  
  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'query required' }) };
  }
  
  // Call Stage-0 with memory_search kernel
  const result = await callStage0(
    '00000000-0000-4000-8000-000000000014', // memory_search_kernel
    {
      Q: query,
      TOPK: limit,
      USE_VECTOR: false
    },
    context
  );
  
  return {
    statusCode: 200,
    body: JSON.stringify(result)
  };
}

/**
 * POST /cli/ask
 * Asks LLM (via Wallet provider.invoke)
 */
async function handleAsk(event, context) {
  const { text, model = 'claude-3-5-sonnet', with_memory = false, vars } = JSON.parse(event.body || '{}');
  
  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ error: 'text required' }) };
  }
  
  const walletId = context.walletId;
  const apiKey = event.headers?.authorization?.replace(/^ApiKey\s+/i, '');
  
  // Build messages
  const messages = [{ role: 'user', content: text }];
  
  // Optionally add memory context
  if (with_memory) {
    // TODO: Search memory and add context
  }
  
  // Call Wallet provider.invoke
  const result = await callWalletService(
    walletId,
    '/wallet/provider/invoke',
    {
      kid: 'kid_provider_anthropic',
      provider: 'anthropic',
      model: model,
      input: { messages: messages },
      with_memory: with_memory
    },
    apiKey
  );
  
  return {
    statusCode: 200,
    body: JSON.stringify(result)
  };
}

/**
 * POST /cli/prompt.fetch
 * Fetches and interpolates prompt
 */
async function handlePromptFetch(event, context) {
  const { prompt_id, vars } = JSON.parse(event.body || '{}');
  
  if (!prompt_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'prompt_id required' }) };
  }
  
  // Call Stage-0 with prompt_fetch kernel
  const result = await callStage0(
    '00000000-0000-4000-8000-000000000006', // prompt_fetch_kernel
    {
      prompt_id: prompt_id,
      vars: vars || {}
    },
    context
  );
  
  return {
    statusCode: 200,
    body: JSON.stringify(result)
  };
}

/**
 * POST /cli/run
 * Runs a kernel directly
 */
async function handleRun(event, context) {
  const { boot_function_id, input } = JSON.parse(event.body || '{}');
  
  if (!boot_function_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'boot_function_id required' }) };
  }
  
  const result = await callStage0(boot_function_id, input || {}, context);
  
  return {
    statusCode: 200,
    body: JSON.stringify(result)
  };
}

/**
 * POST /cli/device.register
 * Registers a device for a user
 */
async function handleDeviceRegister(event, context) {
  const { device_fingerprint, device_name, device_type, pubkey } = JSON.parse(event.body || '{}');
  
  if (!device_fingerprint || !device_name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'device_fingerprint, device_name required' }) };
  }
  
  const span = {
    id: `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    seq: 0,
    entity_type: 'device_registration',
    who: context.userId,
    did: 'registered',
    this: `device.${device_fingerprint}`,
    at: new Date().toISOString(),
    status: 'active',
    owner_id: context.userId,
    tenant_id: context.tenantId,
    visibility: 'private',
    content: {
      device_fingerprint: device_fingerprint,
      device_name: device_name,
      device_type: device_type || 'unknown'
    },
    metadata: {
      pubkey: pubkey || null,
      registered_at: Date.now()
    }
  };
  
  // Sign and store (similar to app.register)
  const walletId = context.walletId;
  const apiKey = event.headers?.authorization?.replace(/^ApiKey\s+/i, '');
  
  const signResult = await callWalletService(
    walletId,
    '/wallet/sign/span',
    { kid: 'kid_ed25519_main', span: span },
    apiKey
  );
  
  span.payload_hash = signResult.payload_hash;
  span.sig = signResult.sig;
  
  // Store in ledger
  try {
    const apiUrl = process.env.API_GATEWAY_URL || event.headers?.host || 'https://api.example.com/dev';
    const https = require('https');
    const http = require('http');
    const apiUrlObj = new URL(apiUrl.startsWith('http') ? apiUrl : `https://${apiUrl}`);
    const client = apiUrlObj.protocol === 'https:' ? https : http;
    
    const postData = JSON.stringify(span);
    const response = await new Promise((resolve, reject) => {
      const req = client.request({
        hostname: apiUrlObj.hostname,
        port: apiUrlObj.port || (apiUrlObj.protocol === 'https:' ? 443 : 80),
        path: '/api/spans',
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
    
    if (response.statusCode >= 400) {
      return { statusCode: response.statusCode, body: response.body };
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        device_id: span.id,
        stored: true
      })
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        device_id: span.id,
        stored: false,
        warning: err.message
      })
    };
  }
}

/**
 * POST /cli/app.register
 * Registers an app (onboarding via spans)
 */
async function handleAppRegister(event, context) {
  const { app_id, intent_set, requires_caps, default_slo, memory_contracts, prompt_blocks, visibility } = 
    JSON.parse(event.body || '{}');
  
  if (!app_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'app_id required' }) };
  }
  
  // Create app registration span (signed)
  const span = {
    id: `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    entity_type: 'app_registration',
    who: context.userId,
    did: 'registered',
    this: `app.${app_id}`,
    at: new Date().toISOString(),
    status: 'active',
    owner_id: context.userId,
    tenant_id: context.tenantId,
    visibility: visibility || 'tenant',
    content: {
      app_id: app_id,
      intent_set: intent_set || [],
      requires_caps: requires_caps || []
    },
    metadata: {
      default_slo: default_slo,
      memory_contracts: memory_contracts || [],
      prompt_blocks: prompt_blocks || []
    }
  };
  
  // Sign and send (similar to memory.add)
  const walletId = context.walletId;
  const apiKey = event.headers?.authorization?.replace(/^ApiKey\s+/i, '');
  
  const signResult = await callWalletService(
    walletId,
    '/wallet/sign/span',
    { kid: 'kid_ed25519_main', span: span },
    apiKey
  );
  
  span.payload_hash = signResult.payload_hash;
  span.sig = signResult.sig;
  
  // Store in ledger via API Gateway /api/spans endpoint
  try {
    const apiUrl = process.env.API_GATEWAY_URL || event.headers?.host || 'https://api.example.com/dev';
    const apiKey = event.headers?.authorization?.replace(/^ApiKey\s+/i, '') || '';
    
    // Use https module (built-in, no dependency needed)
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const apiUrlObj = new URL(apiUrl.startsWith('http') ? apiUrl : `https://${apiUrl}`);
    const client = apiUrlObj.protocol === 'https:' ? https : http;
    
    const postData = JSON.stringify(span);
    const options = {
      hostname: apiUrlObj.hostname,
      port: apiUrlObj.port || (apiUrlObj.protocol === 'https:' ? 443 : 80),
      path: '/api/spans',
      method: 'POST',
      headers: {
        'Authorization': `ApiKey ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    // Make HTTP request
    const response = await new Promise((resolve, reject) => {
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: data
          });
        });
      });
      
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
    
    if (response.statusCode >= 400) {
      console.error('Failed to store span:', response.body);
      return {
        statusCode: response.statusCode,
        body: JSON.stringify({ 
          error: 'Failed to store app registration span',
          details: response.body 
        })
      };
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        app_id: app_id,
        span_id: span.id,
        stored: true
      })
    };
  } catch (err) {
    console.error('Error storing span:', err);
    // Fallback: return success but log error (span was signed, just not stored yet)
    // In production, you might want to queue this for retry
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        app_id: app_id,
        span_id: span.id,
        stored: false,
        warning: 'Span created and signed, but storage failed. Span is ready to be stored manually or retried.',
        error: err.message
      })
    };
  }
}

/**
 * Main handler
 */
exports.handler = async (event) => {
  console.log('🛰️ CLI Service Event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract context from authorizer
    const authorizer = event.requestContext?.authorizer || {};
    const context = {
      walletId: authorizer.wallet_id,
      tenantId: authorizer.tenant_id,
      userId: event.headers?.['x-user-id'] || authorizer.user_id || 'unknown',
      scopes: JSON.parse(authorizer.scopes || '[]')
    };
    
    if (!context.walletId) {
      return { statusCode: 401, body: JSON.stringify({ error: 'wallet_id required' }) };
    }
    
    const path = event.path || event.requestContext?.path || '';
    const method = event.httpMethod || event.requestContext?.httpMethod || '';
    
    // Route requests
    if (method === 'POST') {
      if (path.includes('/cli/memory.add')) {
        return await handleMemoryAdd(event, context);
      } else if (path.includes('/cli/memory.search')) {
        return await handleMemorySearch(event, context);
      } else if (path.includes('/cli/ask')) {
        return await handleAsk(event, context);
      } else if (path.includes('/cli/prompt.fetch')) {
        return await handlePromptFetch(event, context);
      } else if (path.includes('/cli/run')) {
        return await handleRun(event, context);
      } else if (path.includes('/cli/app.register')) {
        return await handleAppRegister(event, context);
      } else if (path.includes('/cli/device.register')) {
        return await handleDeviceRegister(event, context);
      }
    }
    
    return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    
  } catch (error) {
    console.error('❌ CLI Service error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

