/**
 * Lambda Wallet Service
 * Manages keys and credentials securely; signs spans and HTTP requests
 * Never exposes secrets - only performs operations
 * 
 * Environment variables:
 *   WALLETS_TABLE - DynamoDB table name for wallets
 *   NONCE_TABLE - DynamoDB table name for nonces (anti-replay)
 *   AWS_REGION - AWS region (default: us-east-1)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
const { blake3 } = require('@noble/hashes/blake3');
const { ed25519 } = require('@noble/curves/ed25519');
const { randomBytes } = require('crypto');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
const secretsManager = new SecretsManager({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Get wallet from DynamoDB
 */
async function getWallet(walletId) {
  const result = await dynamoClient.send(new GetCommand({
    TableName: process.env.WALLETS_TABLE,
    Key: { wallet_id: walletId }
  }));
  return result.Item;
}

/**
 * Get secret from Secrets Manager
 */
async function getSecret(secretArn) {
  const result = await secretsManager.getSecretValue({ SecretId: secretArn });
  return JSON.parse(result.SecretString);
}

/**
 * Canonicalize span (remove sig{}, sort keys)
 */
function canonicalizeSpan(span) {
  const { sig, ...rest } = span;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/**
 * POST /wallet/open
 * Returns wallet session (short-lived)
 */
async function handleOpen(event, walletId) {
  const wallet = await getWallet(walletId);
  if (!wallet || wallet.status !== 'active') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Wallet not found or inactive' }) };
  }
  
  // Generate session token (5-10 min TTL)
  const sessionId = `wss_${randomBytes(16).toString('base64url')}`;
  const exp = Date.now() + (10 * 60 * 1000); // 10 minutes
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      wallet_session: sessionId,
      wallet_id: walletId,
      exp: Math.floor(exp / 1000)
    })
  };
}

/**
 * POST /wallet/sign/span
 * Signs a span with Ed25519 + BLAKE3
 */
async function handleSignSpan(event, walletId) {
  const { kid, span } = JSON.parse(event.body || '{}');
  
  if (!kid || !span) {
    return { statusCode: 400, body: JSON.stringify({ error: 'kid and span required' }) };
  }
  
  const wallet = await getWallet(walletId);
  if (!wallet || wallet.status !== 'active') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Wallet not found' }) };
  }
  
  const keyItem = wallet.items?.[kid];
  if (!keyItem || keyItem.status !== 'active' || keyItem.type !== 'ed25519') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Key not found or invalid' }) };
  }
  
  if (!keyItem.caps.includes('sign.span')) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Key does not have sign.span capability' }) };
  }
  
  // Get private key from Secrets Manager
  const secret = await getSecret(keyItem.secret_ref);
  const privateKey = Buffer.from(secret.private_key_hex, 'hex');
  
  // Canonicalize span (remove sig)
  const canonical = canonicalizeSpan(span);
  
  // Calculate payload hash (BLAKE3)
  const hashBytes = blake3(canonical);
  const payloadHash = `b3:${Buffer.from(hashBytes).toString('hex')}`;
  
  // Generate nonce
  const nonce = randomBytes(16).toString('base64url');
  const ts = Date.now();
  
  // Sign payload_hash + nonce + ts
  const signPayload = `${payloadHash}|${nonce}|${ts}`;
  const signature = ed25519.sign(signPayload, privateKey);
  
  // Calculate key_id (did:logline:<b3(pubkey)>)
  const pubkeyHash = blake3(keyItem.pubkey_hex);
  const keyId = `did:logline:${Buffer.from(pubkeyHash).toString('hex')}`;
  
  const sig = {
    alg: 'ed25519-blake3-v1',
    key_id: keyId,
    kid: kid,
    ts: ts,
    nonce: nonce,
    signature: Buffer.from(signature).toString('hex')
  };
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      payload_hash: payloadHash,
      sig: sig
    })
  };
}

/**
 * POST /wallet/provider/invoke
 * Invokes LLM provider using key from wallet
 */
async function handleProviderInvoke(event, walletId) {
  const { kid, provider, model, input, with_memory, byo_key } = JSON.parse(event.body || '{}');
  
  if (!kid || !provider || !model || !input) {
    return { statusCode: 400, body: JSON.stringify({ error: 'kid, provider, model, input required' }) };
  }
  
  const wallet = await getWallet(walletId);
  if (!wallet || wallet.status !== 'active') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Wallet not found' }) };
  }
  
  const keyItem = wallet.items?.[kid];
  if (!keyItem || keyItem.status !== 'active' || keyItem.type !== 'provider_key') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Provider key not found' }) };
  }
  
  // Get API key from Secrets Manager
  const secret = await getSecret(keyItem.secret_ref);
  const apiKey = secret.api_key;
  
  // Invoke provider (example: Anthropic)
  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1024,
        messages: input.messages || []
      })
    });
    
    const data = await response.json();
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        output: data,
        usage: data.usage,
        trace_id: `trace_${randomBytes(8).toString('hex')}`
      })
    };
  }
  
  return { statusCode: 400, body: JSON.stringify({ error: 'Provider not supported' }) };
}

/**
 * Main handler
 */
exports.handler = async (event) => {
  console.log('🔐 Wallet Service Event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract wallet_id from authorizer context
    const walletId = event.requestContext?.authorizer?.wallet_id;
    if (!walletId) {
      return { statusCode: 401, body: JSON.stringify({ error: 'wallet_id required' }) };
    }
    
    const path = event.path || event.requestContext?.path || '';
    const method = event.httpMethod || event.requestContext?.httpMethod || '';
    
    // Route requests
    if (method === 'POST') {
      if (path.includes('/wallet/open')) {
        return await handleOpen(event, walletId);
      } else if (path.includes('/wallet/sign/span')) {
        return await handleSignSpan(event, walletId);
      } else if (path.includes('/wallet/provider/invoke')) {
        return await handleProviderInvoke(event, walletId);
      }
    }
    
    return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    
  } catch (error) {
    console.error('❌ Wallet Service error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

