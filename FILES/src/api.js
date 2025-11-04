/**
 * API Layer (Section 7) - REST + SSE endpoints
 * Adapted from Blueprint4.md for Node.js/AWS Lambda
 */

const { getClient, setRlsContext, insertSpan } = require('./db');
const crypto = require('crypto');

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-LogLine-Session,X-LogLine-Memory,X-LogLine-Sensitivity'
  };
}

function corsJson() {
  return {
    ...cors(),
    'Content-Type': 'application/json'
  };
}

function corsSSE() {
  return {
    ...cors(),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  };
}

/**
 * Parse HTTP event from API Gateway or direct Lambda invocation
 */
function parseEvent(event) {
  let path = event.path || event.pathParameters?.proxy || '/';
  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const queryString = event.queryStringParameters || {};
  const headers = event.headers || {};
  const body = event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {};
  const pathParameters = event.pathParameters || {};
  
  // Extract ID from path if it's a memory endpoint
  if (path.match(/^\/api\/memory\/[^/]+$/)) {
    const match = path.match(/^\/api\/memory\/([^/]+)$/);
    if (match) {
      pathParameters.id = match[1];
    }
  }
  
  return { path, method, queryString, headers, body, pathParameters };
}

/**
 * GET /api/spans - List spans
 */
async function listSpans(event) {
  const { queryString } = parseEvent(event);
  const entityType = queryString.entity_type;
  const status = queryString.status;
  const limit = Number(queryString.limit || 50);
  
  const client = await getClient();
  try {
    await setRlsContext(client, 'api', 'voulezvous');
    
    let query = 'SELECT * FROM ledger.universal_registry WHERE is_deleted=false';
    const params = [];
    
    if (entityType) {
      params.push(entityType);
      query += ` AND entity_type=$${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND status=$${params.length}`;
    }
    params.push(limit);
    query += ` ORDER BY at DESC LIMIT $${params.length}`;
    
    const { rows } = await client.query(query, params);
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify(rows)
    };
  } finally {
    await client.end();
  }
}

/**
 * POST /api/spans - Create span (append-only)
 */
async function createSpan(event) {
  const { body } = parseEvent(event);
  const client = await getClient();
  try {
    const userId = body.owner_id || 'api:web';
    const tenantId = body.tenant_id || 'voulezvous';
    await setRlsContext(client, userId, tenantId);
    
    body.id = body.id || crypto.randomUUID();
    body.seq = body.seq ?? 0;
    body.at = body.at || new Date().toISOString();
    
    const span = await insertSpan(client, body);
    
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify(span)
    };
  } finally {
    await client.end();
  }
}

/**
 * GET /api/timeline - Visible timeline
 */
async function timeline(event) {
  const { queryString } = parseEvent(event);
  const visibility = queryString.visibility || 'tenant';
  const limit = Number(queryString.limit || 50);
  
  const client = await getClient();
  try {
    await setRlsContext(client, 'api', 'voulezvous');
    
    const { rows } = await client.query(
      `SELECT * FROM ledger.visible_timeline WHERE visibility=$1 OR visibility='public' ORDER BY "when" DESC LIMIT $2`,
      [visibility, limit]
    );
    
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify(rows)
    };
  } finally {
    await client.end();
  }
}

/**
 * POST /api/execute - Schedule/trigger execution for a function span
 */
async function executeNow(event) {
  const { body } = parseEvent(event);
  const { span_id } = body;
  
  if (!span_id) {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: 'span_id required' })
    };
  }
  
  // In production, call request_worker/observer flow
  // For now, create a request span to trigger execution
  const client = await getClient();
  try {
    await setRlsContext(client, 'api:execute', 'voulezvous');
    
    // Create request span to trigger run_code_kernel
    const requestSpan = {
      id: crypto.randomUUID(),
      seq: 0,
      entity_type: 'request',
      who: 'api:execute',
      did: 'scheduled',
      this: 'run_code',
      at: new Date().toISOString(),
      status: 'scheduled',
      parent_id: span_id,
      related_to: [span_id],
      owner_id: 'api',
      tenant_id: 'voulezvous',
      visibility: 'private'
    };
    
    await insertSpan(client, requestSpan);
    
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({ scheduled_for: span_id, request_id: requestSpan.id })
    };
  } finally {
    await client.end();
  }
}

/**
 * GET /api/metrics - Execution metrics
 */
async function metrics(event) {
  const client = await getClient();
  try {
    await setRlsContext(client, 'api:metrics', 'voulezvous');
    
    const countsResult = await client.query(`
      SELECT date("when") AS day, status, count(*)::int AS n
      FROM ledger.visible_timeline
      WHERE entity_type='execution'
      GROUP BY 1,2 ORDER BY 1 DESC, 2 ASC LIMIT 200
    `);
    
    const latencyResult = await client.query(`
      SELECT date("when") AS day, avg(duration_ms)::int AS avg_ms,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
      FROM ledger.visible_timeline
      WHERE entity_type='execution'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 30
    `);
    
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({
        counts: countsResult.rows,
        latency: latencyResult.rows
      })
    };
  } finally {
    await client.end();
  }
}

/**
 * GET /api/timeline/stream - SSE stream of timeline updates
 * Note: SSE in Lambda requires WebSocket API Gateway or separate service
 * This is a simplified version that works with polling
 */
async function streamTimeline(event) {
  // For Lambda, SSE requires WebSocket API Gateway
  // This returns a basic response indicating SSE is available
  // In production, use a dedicated service (Cloud Run, Fly.io, etc.)
  return {
    statusCode: 200,
    headers: corsSSE(),
    body: 'data: {"message":"SSE requires WebSocket API Gateway or dedicated service"}\n\n'
  };
}

/**
 * POST /api/memory - Upsert memory
 */
async function memoryUpsert(event) {
  const { body, headers } = parseEvent(event);
  const sessionId = headers['x-logline-session'] || headers['X-LogLine-Session'];
  const memoryMode = headers['x-logline-memory'] || headers['X-LogLine-Memory'] || 'on';
  const sensitivity = headers['x-logline-sensitivity'] || headers['X-LogLine-Sensitivity'] || 'internal';
  
  if (memoryMode === 'off') {
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({ ok: true, skipped: true, reason: 'memory_mode=off' })
    };
  }
  
  const { layer, type, content, tags, schema_id, ttl_at } = body;
  
  if (!layer || !type || !content) {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: 'layer, type, and content required' })
    };
  }
  
  const client = await getClient();
  try {
    const userId = body.owner_id || 'api:web';
    const tenantId = body.tenant_id || 'voulezvous';
    await setRlsContext(client, userId, tenantId);
    
    // Call memory_upsert_kernel via stage0
    const stage0 = require('./stage0_loader');
    const result = await stage0.handler({
      action: 'boot',
      boot_function_id: '00000000-0000-4000-8000-000000000009',
      input: {
        layer,
        type,
        content,
        tags,
        schema_id,
        sensitivity,
        ttl_at,
        session_id: sessionId
      }
    }, {});
    
    return {
      statusCode: 200,
      headers: corsJson(),
      body: typeof result.body === 'string' ? result.body : JSON.stringify(result)
    };
  } finally {
    await client.end();
  }
}

/**
 * GET /api/memory/:id - Fetch one memory
 */
async function memoryGet(event) {
  const { pathParameters, queryString } = parseEvent(event);
  const memoryId = pathParameters?.id || pathParameters?.proxy;
  
  if (!memoryId) {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: 'memory ID required' })
    };
  }
  
  const client = await getClient();
  try {
    const tenantId = queryString.tenant_id || 'voulezvous';
    await setRlsContext(client, 'api', tenantId);
    
    const { rows } = await client.query(
      `SELECT * FROM ledger.visible_timeline WHERE id=$1 AND entity_type='memory' ORDER BY "when" DESC, seq DESC LIMIT 1`,
      [memoryId]
    );
    
    if (rows.length === 0) {
      return {
        statusCode: 404,
        headers: corsJson(),
        body: JSON.stringify({ error: 'memory not found' })
      };
    }
    
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify(rows[0])
    };
  } finally {
    await client.end();
  }
}

/**
 * GET /api/memory/search - Search memories
 */
async function memorySearch(event) {
  const { queryString, headers } = parseEvent(event);
  const query = queryString.Q || queryString.q || '';
  const topK = Number(queryString.TOPK || queryString.topk || 10);
  const useVector = queryString.USE_VECTOR === 'true' || queryString.use_vector === 'true';
  const sessionId = headers['x-logline-session'] || headers['X-LogLine-Session'];
  const memoryMode = headers['x-logline-memory'] || headers['X-LogLine-Memory'] || 'on';
  
  if (memoryMode === 'off') {
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({ ok: true, hits: [], skipped: true, reason: 'memory_mode=off' })
    };
  }
  
  if (!query) {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: 'Q parameter required' })
    };
  }
  
  const client = await getClient();
  try {
    const tenantId = queryString.tenant_id || 'voulezvous';
    await setRlsContext(client, 'api', tenantId);
    
    // Call memory_search_kernel via stage0
    const stage0 = require('./stage0_loader');
    const result = await stage0.handler({
      action: 'boot',
      boot_function_id: '00000000-0000-4000-8000-000000000010',
      input: {
        Q: query,
        TOPK: topK,
        USE_VECTOR: useVector,
        session_id: sessionId,
        memory_mode: memoryMode
      }
    }, {});
    
    return {
      statusCode: 200,
      headers: corsJson(),
      body: typeof result.body === 'string' ? result.body : JSON.stringify(result)
    };
  } finally {
    await client.end();
  }
}

/**
 * Main API handler
 */
async function handler(event, context) {
  const { path, method } = parseEvent(event);
  
  // Handle OPTIONS for CORS
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: cors(),
      body: ''
    };
  }
  
  try {
    // Route by path
    if (path === '/api/spans' && method === 'GET') {
      return await listSpans(event);
    }
    if (path === '/api/spans' && method === 'POST') {
      return await createSpan(event);
    }
    if (path === '/api/timeline' && method === 'GET') {
      return await timeline(event);
    }
    if (path === '/api/execute' && method === 'POST') {
      return await executeNow(event);
    }
    if (path === '/api/metrics' && method === 'GET') {
      return await metrics(event);
    }
    if (path === '/api/timeline/stream' && method === 'GET') {
      return await streamTimeline(event);
    }
    if (path === '/api/memory' && method === 'POST') {
      return await memoryUpsert(event);
    }
    if (path.match(/^\/api\/memory\/[^/]+$/) && method === 'GET') {
      return await memoryGet(event);
    }
    if (path === '/api/memory/search' && method === 'GET') {
      return await memorySearch(event);
    }
    
    return {
      statusCode: 404,
      headers: corsJson(),
      body: JSON.stringify({ error: 'Not Found' })
    };
  } catch (error) {
    console.error('API error:', error);
    return {
      statusCode: 500,
      headers: corsJson(),
      body: JSON.stringify({ error: error.message, stack: error.stack })
    };
  }
}

module.exports = { handler };

