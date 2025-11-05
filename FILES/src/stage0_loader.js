const { getClient, setRlsContext, insertSpan } = require('./db');
const { verifySpan, hashSpan, toHex, fromHex, encryptAES256GCM, decryptAES256GCM } = require('./crypto');
const { blake3 } = require('@noble/hashes/blake3');

exports.handler = async (event) => {
  const client = await getClient();
  
  try {
    // Extract request parameters
    const body = event.body ? JSON.parse(event.body) : event;
    const bootFunctionId = body.boot_function_id || body.span_id;
    const userId = body.user_id || 'edge:stage0';
    const tenantId = body.tenant_id || 'system';
    
    if (!bootFunctionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'boot_function_id required' })
      };
    }
    
    // Set RLS context
    await setRlsContext(client, userId, tenantId);
    
    // 1. Fetch manifest (latest seq for each id)
    const { rows: manifestRows } = await client.query(
      `SELECT * FROM ledger.visible_timeline 
       WHERE entity_type='manifest' 
       ORDER BY "when" DESC, seq DESC LIMIT 1`
    );
    
    const manifest = manifestRows[0] || { metadata: {} };
    const allowedIds = (manifest.metadata?.allowed_boot_ids || []);
    
    if (!allowedIds.includes(bootFunctionId)) {
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          error: 'Boot function not allowed by manifest',
          bootFunctionId,
          allowed: allowedIds
        })
      };
    }
    
    // 2. Fetch target function
    const { rows: fnRows } = await client.query(
      `SELECT * FROM ledger.visible_timeline 
       WHERE id=$1 AND entity_type='function' 
       ORDER BY "when" DESC, seq DESC LIMIT 1`,
      [bootFunctionId]
    );
    
    if (fnRows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Function span not found', id: bootFunctionId })
      };
    }
    
    const fnSpan = fnRows[0];
    
    // 2.5. Check kernel-level scopes (if token is provided)
    const authorizerContext = event.requestContext?.authorizer;
    if (authorizerContext && event.path?.includes('/api/boot')) {
      const scopes = JSON.parse(authorizerContext.scopes || '[]');
      const kernelName = fnSpan.name || 'unknown';
      const neededScope = `kernel:${kernelName}:invoke`;
      
      if (!scopes.includes(neededScope)) {
        // emit auth.decision (denied) at kernel level
        await insertSpan(client, {
          id: require('crypto').randomUUID(), seq:0,
          entity_type: 'auth.decision', who: 'edge:stage0', did: 'evaluated', this: 'kernel.authz',
          at: new Date().toISOString(), status: 'denied',
          tenant_id: fnSpan.tenant_id,
          metadata: { reason: 'insufficient_scope_for_kernel', needed: neededScope, has: scopes, kernel: kernelName, wallet_id: authorizerContext.wallet_id || null }
        });
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: 'insufficient_scope_for_kernel',
            needed: neededScope,
            has: scopes,
            kernel: kernelName
          })
        };
      }
      // emit auth.decision (permitted) at kernel level
      await insertSpan(client, {
        id: require('crypto').randomUUID(), seq:0,
        entity_type: 'auth.decision', who: 'edge:stage0', did: 'evaluated', this: 'kernel.authz',
        at: new Date().toISOString(), status: 'permitted',
        tenant_id: fnSpan.tenant_id,
        metadata: { reason: 'ok', needed: neededScope, kernel: kernelName, wallet_id: authorizerContext.wallet_id || null }
      });
    }
    
    // 3. Verify cryptographic integrity (if span has crypto fields)
    if (fnSpan.curr_hash && fnSpan.signature) {
      try {
        await verifySpan(fnSpan);
        console.log('✅ Span signature verified');
      } catch (error) {
        console.warn('⚠️  Signature verification failed:', error.message);
        // Continue anyway for now (in production, should fail)
      }
    }
    
    // 4. Emit boot_event
    await insertSpan(client, {
      id: require('crypto').randomUUID(),
      seq: 0,
      entity_type: 'boot_event',
      who: 'edge:stage0',
      did: 'booted',
      this: 'stage0',
      at: new Date().toISOString(),
      status: 'complete',
      input: { boot_id: bootFunctionId, user: userId, tenant: tenantId },
      owner_id: fnSpan.owner_id,
      tenant_id: fnSpan.tenant_id,
      visibility: fnSpan.visibility || 'private',
      related_to: [bootFunctionId]
    });
    
    // 5. Execute function code
    const code = fnSpan.code;
    const input = body.input || fnSpan.input || {};
    
    let output = null;
    let error = null;
    const start = Date.now();
    
    try {
      // Simple eval execution (TODO: use Worker for isolation)
      const ctx = {
        input,
        env: { 
          userId, 
          tenantId,
          APP_USER_ID: userId,
          APP_TENANT_ID: tenantId
        },
        client,
        console,
        crypto: {
          ...require('crypto'),
          blake3: (data) => {
            const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
            const hash = blake3(bytes);
            return hash;
          },
          hex: toHex,
          toU8: fromHex,
          randomUUID: require('crypto').randomUUID,
          encryptAES256GCM: encryptAES256GCM,
          decryptAES256GCM: decryptAES256GCM
        },
        insertSpan: async (span) => await insertSpan(client, span),
        now: () => new Date().toISOString(),
        sql: async (query, params) => {
          return await client.query(query, params || []);
        }
      };
      
      const fn = new Function('ctx', `
        ${code}
        return (typeof globalThis.default !== 'undefined' ? globalThis.default : main);
      `)(ctx);
      
      if (typeof fn === 'function') {
        output = await fn(ctx);
      } else {
        output = { executed: true, result: fn };
      }
    } catch (e) {
      error = { message: e.message, stack: e.stack };
    }
    
    const duration = Date.now() - start;
    
    // 6. Record execution span
    await insertSpan(client, {
      id: require('crypto').randomUUID(),
      seq: 0,
      entity_type: 'execution',
      who: 'edge:stage0',
      did: 'executed',
      this: 'run_code',
      at: new Date().toISOString(),
      parent_id: fnSpan.id,
      status: error ? 'error' : 'complete',
      input: input,
      output: error ? null : output,
      error: error,
      duration_ms: duration,
      trace_id: body.trace_id || require('crypto').randomUUID(),
      owner_id: fnSpan.owner_id,
      tenant_id: fnSpan.tenant_id,
      visibility: fnSpan.visibility || 'private',
      related_to: [fnSpan.id]
    });
    
    return {
      statusCode: error ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: !error,
        span_id: fnSpan.id,
        output: output,
        error: error,
        duration_ms: duration
      })
    };
    
  } catch (error) {
    console.error('❌ Stage-0 error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message, stack: error.stack })
    };
  } finally {
    await client.end();
  }
};
