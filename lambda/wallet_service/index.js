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
const { ed25519 } = require('@noble/ed25519');
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
  const privateKey = Buffer.from(secret.private_key_hex || secret.privateKey, 'hex');
  
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
  const signPayloadBytes = new TextEncoder().encode(signPayload);
  const signature = await ed25519.sign(signPayloadBytes, privateKey);
  
  // Calculate key_id (did:logline:<b3(pubkey)>)
  const pubkeyBytes = Buffer.from(keyItem.pubkey_hex, 'hex');
  const pubkeyHash = blake3(pubkeyBytes);
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
 * POST /wallet/sign/http
 * Signs HTTP request with Ed25519
 */
async function handleSignHttp(event, walletId) {
  const { kid, method, path_with_query, body_canon } = JSON.parse(event.body || '{}');
  
  if (!kid || !method || !path_with_query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'kid, method, path_with_query required' }) };
  }
  
  const wallet = await getWallet(walletId);
  if (!wallet || wallet.status !== 'active') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Wallet not found' }) };
  }
  
  const keyItem = wallet.items?.[kid];
  if (!keyItem || keyItem.status !== 'active' || keyItem.type !== 'ed25519') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Key not found or invalid' }) };
  }
  
  if (!keyItem.caps.includes('sign.http')) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Key does not have sign.http capability' }) };
  }
  
  // Get private key from Secrets Manager
  const secret = await getSecret(keyItem.secret_ref);
  const privateKey = Buffer.from(secret.private_key_hex || secret.privateKey, 'hex');
  
  // Build canonical string
  const canonical = `${method}\n${path_with_query}\n${body_canon || ''}`;
  const canonicalBytes = new TextEncoder().encode(canonical);
  
  // Generate nonce and timestamp
  const nonce = randomBytes(16).toString('base64url');
  const ts = Date.now();
  
  // Sign
  const signPayload = `${canonical}|${nonce}|${ts}`;
  const signPayloadBytes = new TextEncoder().encode(signPayload);
  const signature = await ed25519.sign(signPayloadBytes, privateKey);
  
  // Calculate key_id
  const pubkeyBytes = Buffer.from(keyItem.pubkey_hex, 'hex');
  const pubkeyHash = blake3(pubkeyBytes);
  const keyId = `did:logline:${Buffer.from(pubkeyHash).toString('hex')}`;
  
  // Check nonce (anti-replay)
  const nonceKey = `${kid}|${nonce}`;
  const nonceTable = process.env.NONCE_TABLE || 'nonces';
  
  // Store nonce with TTL (5 min)
  await dynamoClient.send(new PutCommand({
    TableName: nonceTable,
    Item: {
      k: nonceKey,
      ttl: Math.floor(Date.now() / 1000) + 300
    }
  }));
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      headers: {
        'X-LL-Alg': 'ed25519-blake3-v1',
        'X-LL-KeyID': keyId,
        'X-LL-KID': kid,
        'X-LL-TS': ts.toString(),
        'X-LL-Nonce': nonce,
        'X-LL-Signature': Buffer.from(signature).toString('hex')
      }
    })
  };
}

/**
 * POST /wallet/provider/invoke
 * Invokes LLM provider using key from wallet
 */
async function handleProviderInvoke(event, walletId) {
  const { kid, provider, model, input, with_memory, byo_key, max_tokens } = JSON.parse(event.body || '{}');
  
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
  
  // Check if provider matches
  if (keyItem.provider !== provider) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Provider mismatch' }) };
  }
  
  // Get API key from Secrets Manager
  const secret = await getSecret(keyItem.secret_ref);
  const apiKey = secret.api_key || secret.API_KEY || secret.key;
  
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not found in secret' }) };
  }
  
  const traceId = `trace_${randomBytes(8).toString('hex')}`;
  
  try {
    // Invoke provider
    let response, data;
    
    if (provider === 'anthropic') {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: max_tokens || 1024,
          messages: input.messages || []
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return {
          statusCode: response.status,
          body: JSON.stringify({ error: 'Provider error', details: errorText })
        };
      }
      
      data = await response.json();
      
    } else if (provider === 'openai' || provider === 'openai-compatible') {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: input.messages || [],
          max_tokens: max_tokens || 1024
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return {
          statusCode: response.status,
          body: JSON.stringify({ error: 'Provider error', details: errorText })
        };
      }
      
      data = await response.json();
      
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Provider not supported', provider }) };
    }
    
    // Extract output text
    let outputText = '';
    if (data.content) {
      // Anthropic format
      outputText = Array.isArray(data.content) 
        ? data.content.map(c => c.text || c).join('')
        : data.content;
    } else if (data.choices && data.choices[0]) {
      // OpenAI format
      outputText = data.choices[0].message?.content || '';
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        output: { text: outputText },
        usage: data.usage || { input_tokens: 0, output_tokens: 0 },
        trace_id: traceId,
        raw: data // Include raw response for debugging
      })
    };
    
  } catch (err) {
    console.error('Provider invoke error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Provider invoke failed',
        message: err.message,
        trace_id: traceId
      })
    };
  }
}

/**
 * POST /wallet/key/register
 * Register a new key (Ed25519 or provider key)
 */
async function handleKeyRegister(event, walletId) {
  const { kid, type, pubkey_hex, secret_ref, provider, caps } = JSON.parse(event.body || '{}');
  
  if (!kid || !type || !secret_ref) {
    return { statusCode: 400, body: JSON.stringify({ error: 'kid, type, secret_ref required' }) };
  }
  
  if (type === 'ed25519' && !pubkey_hex) {
    return { statusCode: 400, body: JSON.stringify({ error: 'pubkey_hex required for ed25519' }) };
  }
  
  if (type === 'provider_key' && !provider) {
    return { statusCode: 400, body: JSON.stringify({ error: 'provider required for provider_key' }) };
  }
  
  const wallet = await getWallet(walletId);
  if (!wallet || wallet.status !== 'active') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Wallet not found' }) };
  }
  
  // Check if key already exists
  if (wallet.items?.[kid]) {
    return { statusCode: 409, body: JSON.stringify({ error: 'Key already exists' }) };
  }
  
  // Add key to wallet
  const items = wallet.items || {};
  items[kid] = {
    type: type,
    pubkey_hex: pubkey_hex || null,
    secret_ref: secret_ref,
    provider: provider || null,
    caps: caps || [],
    status: 'active',
    created_at: Math.floor(Date.now() / 1000)
  };
  
  await dynamoClient.send(new UpdateCommand({
    TableName: process.env.WALLETS_TABLE,
    Key: { wallet_id: walletId },
    UpdateExpression: 'SET items = :items',
    ExpressionAttributeValues: { ':items': items }
  }));
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      kid: kid,
      key_id: type === 'ed25519' ? `did:logline:${Buffer.from(blake3(Buffer.from(pubkey_hex, 'hex'))).toString('hex')}` : null
    })
  };
}

/**
 * POST /wallet/key/rotate
 * Rotate a key (generate new key pair, update secret)
 */
async function handleKeyRotate(event, walletId) {
  const { kid, new_secret_ref } = JSON.parse(event.body || '{}');
  
  if (!kid || !new_secret_ref) {
    return { statusCode: 400, body: JSON.stringify({ error: 'kid, new_secret_ref required' }) };
  }
  
  const wallet = await getWallet(walletId);
  if (!wallet || wallet.status !== 'active') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Wallet not found' }) };
  }
  
  const keyItem = wallet.items?.[kid];
  if (!keyItem) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Key not found' }) };
  }
  
  // Update secret_ref
  const items = wallet.items;
  items[kid].secret_ref = new_secret_ref;
  items[kid].rotated_at = Math.floor(Date.now() / 1000);
  
  await dynamoClient.send(new UpdateCommand({
    TableName: process.env.WALLETS_TABLE,
    Key: { wallet_id: walletId },
    UpdateExpression: 'SET items = :items',
    ExpressionAttributeValues: { ':items': items }
  }));
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      kid: kid,
      message: 'Key rotated successfully'
    })
  };
}

/**
 * POST /wallet/key/revoke
 * Revoke a key (mark as inactive)
 */
async function handleKeyRevoke(event, walletId) {
  const { kid } = JSON.parse(event.body || '{}');
  
  if (!kid) {
    return { statusCode: 400, body: JSON.stringify({ error: 'kid required' }) };
  }
  
  const wallet = await getWallet(walletId);
  if (!wallet || wallet.status !== 'active') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Wallet not found' }) };
  }
  
  const keyItem = wallet.items?.[kid];
  if (!keyItem) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Key not found' }) };
  }
  
  // Mark key as revoked
  const items = wallet.items;
  items[kid].status = 'revoked';
  items[kid].revoked_at = Math.floor(Date.now() / 1000);
  
  await dynamoClient.send(new UpdateCommand({
    TableName: process.env.WALLETS_TABLE,
    Key: { wallet_id: walletId },
    UpdateExpression: 'SET items = :items',
    ExpressionAttributeValues: { ':items': items }
  }));
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      kid: kid,
      message: 'Key revoked successfully'
    })
  };
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
      } else if (path.includes('/wallet/sign/http')) {
        return await handleSignHttp(event, walletId);
      } else if (path.includes('/wallet/provider/invoke')) {
        return await handleProviderInvoke(event, walletId);
      } else if (path.includes('/wallet/key/register')) {
        return await handleKeyRegister(event, walletId);
      } else if (path.includes('/wallet/key/rotate')) {
        return await handleKeyRotate(event, walletId);
      } else if (path.includes('/wallet/key/revoke')) {
        return await handleKeyRevoke(event, walletId);
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

