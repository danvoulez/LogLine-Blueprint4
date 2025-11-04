/**
 * Lambda Auth Service
 * Issues, revokes, and rotates API keys
 * 
 * Environment variables:
 *   TOKENS_TABLE - DynamoDB table name for auth_api_tokens
 *   TOKENS_PEPPER_SECRET_ARN - ARN of Secrets Manager secret with token pepper
 *   AWS_REGION - AWS region (default: us-east-1)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
const { createHmac } = require('crypto');
const argon2 = require('argon2');
const { randomBytes } = require('crypto');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
const secretsManager = new SecretsManager({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Calculate token hash: argon2id(hmac(pepper, token))
 */
async function calculateTokenHash(token, pepper) {
  const hmac = createHmac('sha256', pepper);
  hmac.update(token);
  const hmacResult = hmac.digest('hex');
  
  const hash = await argon2.hash(hmacResult, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
    hashLength: 32
  });
  
  return hash.split('$').pop();
}

/**
 * POST /auth/keys/issue
 * Issues a new API key
 */
async function handleIssue(event) {
  const { wallet_id, tenant_id, scopes, ttl_hours = 720, description } = JSON.parse(event.body || '{}');
  
  if (!wallet_id || !tenant_id || !scopes?.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'wallet_id, tenant_id, scopes required' }) };
  }
  
  // Get pepper
  const pepperSecret = await secretsManager.getSecretValue({
    SecretId: process.env.TOKENS_PEPPER_SECRET_ARN
  });
  const pepper = JSON.parse(pepperSecret.SecretString).pepper;
  
  // Generate token
  const random = randomBytes(24).toString('base64url');
  const token = `tok_live_${random}`;
  
  // Calculate hash
  const tokenHash = await calculateTokenHash(token, pepper);
  
  // Calculate expiration
  const exp = Math.floor(Date.now() / 1000) + (ttl_hours * 3600);
  
  // Get creator from authorizer context
  const authorizer = event.requestContext?.authorizer || {};
  const createdBy = authorizer.wallet_id || 'system';
  
  // Store in DynamoDB
  await dynamoClient.send(new PutCommand({
    TableName: process.env.TOKENS_TABLE,
    Item: {
      token_hash: tokenHash,
      wallet_id: wallet_id,
      tenant_id: tenant_id,
      scopes: scopes,
      exp: exp,
      status: 'active',
      description: description || '',
      created_at: Math.floor(Date.now() / 1000),
      created_by: createdBy
    }
  }));
  
  // Return token (shown once!)
  return {
    statusCode: 200,
    body: JSON.stringify({
      token: token,
      exp: exp
    })
  };
}

/**
 * POST /auth/keys/revoke
 * Revokes a token
 */
async function handleRevoke(event) {
  const { token_last4, token_hash, wallet_id } = JSON.parse(event.body || '{}');
  
  if (!token_hash && !wallet_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'token_hash or wallet_id required' }) };
  }
  
  if (token_hash) {
    // Revoke by hash
    await dynamoClient.send(new UpdateCommand({
      TableName: process.env.TOKENS_TABLE,
      Key: { token_hash: token_hash },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'revoked' }
    }));
  } else if (wallet_id) {
    // Revoke all tokens for wallet
    const result = await dynamoClient.send(new QueryCommand({
      TableName: process.env.TOKENS_TABLE,
      IndexName: 'wallet_id-index', // GSI
      KeyConditionExpression: 'wallet_id = :wallet_id',
      ExpressionAttributeValues: { ':wallet_id': wallet_id }
    }));
    
    for (const item of result.Items || []) {
      await dynamoClient.send(new UpdateCommand({
        TableName: process.env.TOKENS_TABLE,
        Key: { token_hash: item.token_hash },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'revoked' }
      }));
    }
  }
  
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}

/**
 * POST /auth/keys/rotate
 * Rotates token (issues new, revokes old)
 */
async function handleRotate(event) {
  const { wallet_id, scopes, ttl_hours = 720 } = JSON.parse(event.body || '{}');
  
  if (!wallet_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'wallet_id required' }) };
  }
  
  // Revoke old tokens
  await handleRevoke({ body: JSON.stringify({ wallet_id }) });
  
  // Issue new token
  const issueResult = await handleIssue({
    body: JSON.stringify({
      wallet_id: wallet_id,
      tenant_id: '', // Will be set from context
      scopes: scopes || [],
      ttl_hours: ttl_hours,
      description: 'Rotated token'
    }),
    requestContext: event.requestContext
  });
  
  return issueResult;
}

/**
 * GET /auth/keys/list
 * Lists tokens (metadata only, never plaintext)
 */
async function handleList(event) {
  const authorizer = event.requestContext?.authorizer || {};
  const walletId = authorizer.wallet_id || event.queryStringParameters?.wallet_id;
  
  if (!walletId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'wallet_id required' }) };
  }
  
  const result = await dynamoClient.send(new QueryCommand({
    TableName: process.env.TOKENS_TABLE,
    IndexName: 'wallet_id-index', // GSI
    KeyConditionExpression: 'wallet_id = :wallet_id',
    ExpressionAttributeValues: { ':wallet_id': walletId },
    ProjectionExpression: 'token_hash, wallet_id, tenant_id, scopes, exp, status, description, created_at, created_by'
  }));
  
  // Remove token_hash from response (security)
  const tokens = (result.Items || []).map(item => {
    const { token_hash, ...rest } = item;
    return {
      ...rest,
      token_hash_preview: token_hash.substring(0, 8) + '...'
    };
  });
  
  return {
    statusCode: 200,
    body: JSON.stringify({ tokens })
  };
}

/**
 * Main handler
 */
exports.handler = async (event) => {
  console.log('🔐 Auth Service Event:', JSON.stringify(event, null, 2));
  
  try {
    const path = event.path || event.requestContext?.path || '';
    const method = event.httpMethod || event.requestContext?.httpMethod || '';
    
    // Route requests
    if (method === 'POST') {
      if (path.includes('/auth/keys/issue')) {
        return await handleIssue(event);
      } else if (path.includes('/auth/keys/revoke')) {
        return await handleRevoke(event);
      } else if (path.includes('/auth/keys/rotate')) {
        return await handleRotate(event);
      }
    } else if (method === 'GET') {
      if (path.includes('/auth/keys/list')) {
        return await handleList(event);
      }
    }
    
    return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    
  } catch (error) {
    console.error('❌ Auth Service error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

