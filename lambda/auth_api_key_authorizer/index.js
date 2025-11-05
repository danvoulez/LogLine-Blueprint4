/**
 * Lambda Authorizer (REQUEST type) for API Gateway
 * Validates API Keys (ApiKey format) against DynamoDB
 * 
 * Environment variables:
 *   TOKENS_TABLE - DynamoDB table name for auth_api_tokens
 *   TOKENS_PEPPER_SECRET_ARN - ARN of Secrets Manager secret with token pepper
 *   WALLETS_TABLE - DynamoDB table name for wallets (optional, for validation)
 *   AWS_REGION - AWS region (default: us-east-1)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
const { createHmac } = require('crypto');
const argon2 = require('argon2');
const https = require('https');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
const secretsManager = new SecretsManager({ region: process.env.AWS_REGION || 'us-east-1' });

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
    usageIdentifierKey: cacheKey // Enables API Gateway caching (60s TTL)
  };
};

const allow = (resource, context, cacheKey) => 
  generatePolicy('Allow', resource, context.wallet_id || 'token', context, cacheKey);

const deny = (reason) => 
  generatePolicy('Deny', '*', 'anon', { reason }, undefined);

/**
 * Post a span to ledger via API Gateway
 */
const postSpan = (span) => new Promise((resolve, reject) => {
  const baseUrl = process.env.API_GATEWAY_URL;
  const bootstrap = process.env.BOOTSTRAP_TOKEN || '';
  if (!baseUrl) return resolve(false);

  const url = new URL('/api/spans', baseUrl);
  const data = JSON.stringify(span);
  const req = https.request({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname + (url.search || ''),
    port: url.port || 443,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Authorization': `Bearer ${bootstrap}`
    }
  }, (res) => {
    res.on('data', () => {});
    res.on('end', () => resolve(true));
  });
  req.on('error', reject);
  req.write(data);
  req.end();
});

/**
 * Extract ApiKey from Authorization header
 * Format: Authorization: ApiKey tok_live_...
 */
const extractApiKey = (event) => {
  const auth = event.headers?.authorization || 
               event.headers?.Authorization || 
               event.authorizationToken;
  
  if (!auth) return null;
  
  // Support both "ApiKey tok_..." and "Bearer tok_..." (backward compat)
  const match = auth.match(/^(?:apikey|bearer)\s+(tok_\w+)/i);
  return match ? match[1] : null;
};

/**
 * Calculate token hash: argon2id(hmac(pepper, token))
 */
const calculateTokenHash = async (token, pepper) => {
  // Step 1: HMAC with pepper
  const hmac = createHmac('sha256', pepper);
  hmac.update(token);
  const hmacResult = hmac.digest('hex');
  
  // Step 2: Argon2id hash
  const hash = await argon2.hash(hmacResult, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
    hashLength: 32
  });
  
  // Return just the hash part (without argon2 metadata)
  return hash.split('$').pop();
};

/**
 * Main handler
 */
exports.handler = async (event) => {
  console.log('🔐 Auth API Key Authorizer Event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract ApiKey
    const apiKey = extractApiKey(event);
    if (!apiKey) {
      // emit auth.decision (deny)
      await postSpan({
        id: require('crypto').randomUUID(), seq: 0,
        entity_type: 'auth.decision', who: 'edge:authorizer', did: 'evaluated', this: 'authz',
        at: new Date().toISOString(), status: 'denied',
        tenant_id: event.requestContext?.domainName || null,
        metadata: {
          reason: 'missing_apikey', route: event.path || '', method: event.httpMethod || 'GET',
          auth_method: 'api_key'
        }
      });
      console.log('❌ Missing ApiKey');
      return deny('missing_apikey');
    }
    
    // Get pepper from Secrets Manager
    const pepperSecret = await secretsManager.getSecretValue({
      SecretId: process.env.TOKENS_PEPPER_SECRET_ARN
    });
    const pepper = JSON.parse(pepperSecret.SecretString).pepper;
    
    // Calculate token hash
    const tokenHash = await calculateTokenHash(apiKey, pepper);
    
    // Look up token in DynamoDB
    const result = await dynamoClient.send(new GetCommand({
      TableName: process.env.TOKENS_TABLE,
      Key: { token_hash: tokenHash }
    }));
    
    if (!result.Item) {
      await postSpan({
        id: require('crypto').randomUUID(), seq: 0,
        entity_type: 'auth.decision', who: 'edge:authorizer', did: 'evaluated', this: 'authz',
        at: new Date().toISOString(), status: 'denied',
        tenant_id: null,
        metadata: { reason: 'token_not_found', token_hash: tokenHash.slice(0, 12), route, method, auth_method: 'api_key' }
      });
      console.log('❌ Token not found:', tokenHash.substring(0, 16) + '...');
      return deny('token_not_found');
    }
    
    const token = result.Item;
    
    // Check status
    if (token.status !== 'active') {
      await postSpan({ id: require('crypto').randomUUID(), seq:0, entity_type:'auth.decision', who:'edge:authorizer', did:'evaluated', this:'authz', at:new Date().toISOString(), status:'denied', tenant_id: token.tenant_id, metadata:{ reason:'token_inactive', token_hash: tokenHash.slice(0,12), route, method, auth_method:'api_key' } });
      console.log('❌ Token not active:', token.status);
      return deny('token_inactive');
    }
    
    // Check expiration
    if (token.exp && token.exp < Math.floor(Date.now() / 1000)) {
      await postSpan({ id: require('crypto').randomUUID(), seq:0, entity_type:'auth.decision', who:'edge:authorizer', did:'evaluated', this:'authz', at:new Date().toISOString(), status:'denied', tenant_id: token.tenant_id, metadata:{ reason:'token_expired', token_hash: tokenHash.slice(0,12), route, method, auth_method:'api_key' } });
      console.log('❌ Token expired:', new Date(token.exp * 1000).toISOString());
      return deny('token_expired');
    }
    
    // Optional: Check scope requirements for specific routes
    const route = event.path || event.requestContext?.path || '';
    const method = event.httpMethod || event.requestContext?.httpMethod || 'GET';
    const scopes = token.scopes || [];
    
    // Basic scope checking (can be enhanced)
    const routeNeedsScope = (path, method) => {
      if (path.includes('/wallet/')) return 'wallet.open';
      if (path.includes('/cli/memory.add') && method === 'POST') return 'memory.write';
      if (path.includes('/cli/memory.search') && method === 'POST') return 'memory.read';
      if (path.includes('/cli/ask') && method === 'POST') return 'provider.invoke:*';
      if (path.includes('/api/spans') && method === 'POST') return 'span.write';
      if (path.includes('/api/boot') && method === 'POST') return 'kernel:invoke';
      return null;
    };
    
    const neededScope = routeNeedsScope(route, method);
    if (neededScope) {
      // Check if token has the required scope (wildcard or exact match)
      const hasScope = scopes.some(scope => {
        if (scope === neededScope) return true;
        if (scope.endsWith('*') && neededScope.startsWith(scope.slice(0, -1))) return true;
        if (neededScope.endsWith('*') && scope.startsWith(neededScope.slice(0, -1))) return true;
        return false;
      });
      
      if (!hasScope) {
        await postSpan({ id: require('crypto').randomUUID(), seq:0, entity_type:'auth.decision', who:'edge:authorizer', did:'evaluated', this:'authz', at:new Date().toISOString(), status:'denied', tenant_id: token.tenant_id, metadata:{ reason:'insufficient_scope', needed: neededScope, has: scopes, route, method, wallet_id: token.wallet_id, auth_method:'api_key' } });
        console.log('❌ Insufficient scope:', { needed: neededScope, has: scopes });
        return deny('insufficient_scope');
      }
    }
    
    // Build context for API Gateway
    const context = {
      wallet_id: token.wallet_id,
      tenant_id: token.tenant_id,
      scopes: JSON.stringify(scopes),
      token_hash: tokenHash.substring(0, 16) // Truncated for logging
    };
    
    // Determine resource ARN (API Gateway v1 or v2)
    // For v2, methodArn might be different format
    let resource = event.methodArn;
    if (!resource) {
      // Try to construct from requestContext
      if (event.requestContext?.apiId) {
        resource = `arn:aws:execute-api:${process.env.AWS_REGION || 'us-east-1'}:${event.requestContext.accountId || '*'}:${event.requestContext.apiId}/${event.requestContext.stage || 'dev'}/*/*`;
      } else {
        resource = '*';
      }
    }
    
    // emit auth.decision (permit)
    await postSpan({ id: require('crypto').randomUUID(), seq:0, entity_type:'auth.decision', who:'edge:authorizer', did:'evaluated', this:'authz', at:new Date().toISOString(), status:'permitted', tenant_id: token.tenant_id, metadata:{ reason:'ok', route, method, wallet_id: token.wallet_id, token_hash: tokenHash.slice(0,12), scopes, auth_method:'api_key' } });

    // emit token_use telemetry
    await postSpan({ id: require('crypto').randomUUID(), seq:0, entity_type:'token_use', who:'edge:authorizer', did:'used', this:'security.token', at:new Date().toISOString(), status:'ok', tenant_id: token.tenant_id, metadata:{ token_hash: tokenHash.slice(0,12), route, method, scopes_checked: neededScope ? [neededScope] : [], wallet_id: token.wallet_id, trace_id: event.requestContext?.requestId || null } });

    console.log('✅ Token validated:', { 
      wallet_id: token.wallet_id, 
      tenant_id: token.tenant_id,
      scopes_count: scopes.length,
      route: route
    });
    
    // Cache key = token_hash (first 32 chars)
    // API Gateway caches for 60 seconds by default
    return allow(resource, context, tokenHash.substring(0, 32));
    
  } catch (error) {
    console.error('❌ Authorizer error:', error);
    return deny('authorizer_error');
  }
};

