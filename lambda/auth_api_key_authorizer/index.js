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
      console.log('❌ Token not found:', tokenHash.substring(0, 16) + '...');
      return deny('token_not_found');
    }
    
    const token = result.Item;
    
    // Check status
    if (token.status !== 'active') {
      console.log('❌ Token not active:', token.status);
      return deny('token_inactive');
    }
    
    // Check expiration
    if (token.exp && token.exp < Math.floor(Date.now() / 1000)) {
      console.log('❌ Token expired:', new Date(token.exp * 1000).toISOString());
      return deny('token_expired');
    }
    
    // Build context for API Gateway
    const context = {
      wallet_id: token.wallet_id,
      tenant_id: token.tenant_id,
      scopes: JSON.stringify(token.scopes || []),
      token_hash: tokenHash.substring(0, 16) // Truncated for logging
    };
    
    // Determine resource ARN (API Gateway v1 or v2)
    const resource = event.methodArn || 
                     `${event.requestContext?.apiId || '*'}/${event.requestContext?.stage || 'dev'}/*/*`;
    
    console.log('✅ Token validated:', { 
      wallet_id: token.wallet_id, 
      tenant_id: token.tenant_id,
      scopes_count: token.scopes?.length || 0 
    });
    
    // Cache key = token_hash (first 32 chars)
    return allow(resource, context, tokenHash.substring(0, 32));
    
  } catch (error) {
    console.error('❌ Authorizer error:', error);
    return deny('authorizer_error');
  }
};

