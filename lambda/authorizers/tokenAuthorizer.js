/**
 * Lambda Authorizer (REQUEST type) for API Gateway
 * Validates API tokens against ledger, returns IAM policy with tenant context
 * 
 * Environment variables:
 *   DB_SECRET_ARN - ARN of Secrets Manager secret with DB credentials
 *   TOKEN_PEPPER_SECRET_ARN - ARN of Secrets Manager secret with token pepper
 */

const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
const { Client } = require('pg');
const { blake3 } = require('@noble/hashes/blake3');

const secretsManager = new SecretsManager();

/**
 * Generate IAM policy for API Gateway
 */
const generatePolicy = (effect, resource, principalId, context = {}, cacheKey = undefined) => {
  return {
    principalId: principalId || 'loglineos',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource
      }]
    },
    context,
    usageIdentifierKey: cacheKey // Enables API Gateway caching
  };
};

const allow = (resource, context, cacheKey) => 
  generatePolicy('Allow', resource, 'token', context, cacheKey);

const deny = (reason) => 
  generatePolicy('Deny', '*', 'anon', { reason }, undefined);

/**
 * Extract token from Authorization header
 */
const extractToken = (event) => {
  const auth = event.headers?.authorization || 
               event.headers?.Authorization || 
               event.authorizationToken;
  
  if (!auth) return null;
  
  const match = auth.match(/^bearer\s+(.+)$/i);
  return match ? match[1] : null;
};

/**
 * Map route to required scope
 */
const routeToScope = (route, method = 'POST') => {
  if (route.includes('/api/boot')) return '/api/boot:invoke';
  if (route.includes('/api/spans')) {
    return method === 'GET' ? '/api/spans:read' : '/api/spans:write';
  }
  if (route.includes('/api/memory')) {
    return method === 'GET' ? '/api/memory:read' : '/api/memory:write';
  }
  if (route.includes('/api/chat')) return '/api/chat:invoke';
  if (route.includes('/api/prompts')) return '/api/prompts:read';
  return null;
};

/**
 * Main handler
 */
exports.handler = async (event) => {
  console.log('🔐 Token Authorizer Event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract token
    const token = extractToken(event);
    if (!token) {
      console.log('❌ Missing token');
      return deny('missing_token');
    }
    
    // Get secrets
    const dbSecret = await secretsManager.getSecretValue({
      SecretId: process.env.DB_SECRET_ARN
    });
    const pepperSecret = await secretsManager.getSecretValue({
      SecretId: process.env.TOKEN_PEPPER_SECRET_ARN
    });
    
    const dbConfig = JSON.parse(dbSecret.SecretString);
    const pepper = JSON.parse(pepperSecret.SecretString).pepper;
    
    // Compute hash
    const hashInput = Buffer.from(token + pepper);
    const hashBytes = blake3(hashInput);
    const hashHex = Buffer.from(hashBytes).toString('hex');
    const hashTag = `b3:${hashHex}`;
    
    // Connect to database
    const client = new Client({
      host: dbConfig.host,
      database: dbConfig.database,
      user: dbConfig.username,
      password: dbConfig.password,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 3000
    });
    
    await client.connect();
    
    try {
      // Set RLS context
      await client.query('SET app.user_id = $1; SET app.tenant_id = $2;', [
        'edge:authorizer',
        'system' // Will be overridden by token lookup
      ]);
      
      // Look up token in ledger
      const result = await client.query(`
        SELECT 
          tenant_id,
          (metadata->>'app_id') AS app_id,
          (metadata->>'expires_at')::timestamptz AS expires_at,
          (metadata->'scopes')::jsonb AS scopes,
          status
        FROM ledger.visible_timeline
        WHERE entity_type = 'api_token'
          AND metadata->>'token_hash' = $1
          AND status = 'active'
        ORDER BY "when" DESC
        LIMIT 1
      `, [hashTag]);
      
      if (result.rowCount === 0) {
        console.log('❌ Token not found:', hashTag);
        return deny('token_not_found');
      }
      
      const row = result.rows[0];
      
      // Check expiration
      if (new Date(row.expires_at) <= new Date()) {
        console.log('❌ Token expired:', row.expires_at);
        return deny('token_expired');
      }
      
      // Check if token was revoked (check for revocation span)
      const revokedCheck = await client.query(`
        SELECT id FROM ledger.visible_timeline
        WHERE entity_type = 'api_token_revoked'
          AND related_to @> ARRAY[$1]::uuid[]
        ORDER BY "when" DESC
        LIMIT 1
      `, [result.rows[0].id]); // Use the token span ID
      
      if (revokedCheck.rowCount > 0) {
        console.log('❌ Token revoked');
        return deny('token_revoked');
      }
      
      // Check scope
      const route = event.path || event.methodArn || '';
      const method = event.httpMethod || event.requestContext?.httpMethod || 'POST';
      const neededScope = routeToScope(route, method);
      
      if (neededScope) {
        const scopes = Array.isArray(row.scopes) ? row.scopes : JSON.parse(row.scopes || '[]');
        if (!scopes.includes(neededScope)) {
          console.log('❌ Insufficient scope. Needed:', neededScope, 'Has:', scopes);
          return deny('insufficient_scope');
        }
      }
      
      // Log token use (async, don't wait)
      client.query(`
        INSERT INTO ledger.universal_registry
        (id, seq, entity_type, who, did, "this", at, status, tenant_id, visibility, metadata)
        VALUES (
          gen_random_uuid(),
          0,
          'token_use',
          'edge:authorizer',
          'used',
          'security.token',
          now(),
          'ok',
          $1,
          'tenant',
          jsonb_build_object(
            'token_hash', $2,
            'route', $3,
            'method', $4,
            'scopes_checked', $5,
            'trace_id', $6
          )
        )
      `, [
        row.tenant_id,
        hashTag,
        route,
        method,
        JSON.stringify(neededScope ? [neededScope] : []),
        event.requestContext?.requestId || event.requestId || 'unknown'
      ]).catch(err => console.error('Failed to log token_use:', err));
      
      // Build context for API Gateway
      const context = {
        tenant_id: row.tenant_id,
        app_id: row.app_id || '',
        token_hash: hashTag,
        scopes: JSON.stringify(Array.isArray(row.scopes) ? row.scopes : JSON.parse(row.scopes || '[]'))
      };
      
      // Determine resource ARN (API Gateway v1 or v2)
      const resource = event.methodArn || 
                       `${event.requestContext?.apiId || '*'}/${event.requestContext?.stage || 'dev'}/*/*`;
      
      console.log('✅ Token validated:', { tenant_id: row.tenant_id, app_id: row.app_id });
      
      return allow(resource, context, hashTag);
      
    } finally {
      await client.end();
    }
    
  } catch (error) {
    console.error('❌ Authorizer error:', error);
    return deny('authorizer_error');
  }
};

