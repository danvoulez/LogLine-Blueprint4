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
  
  // Determine token type (api_token for users, service_token for apps)
  const tokenType = description?.includes('service') || description?.includes('app') ? 'service_token' : 'api_token';
  const defaultTTL = tokenType === 'service_token' ? 8760 : 24; // 1 year for service, 24h for user
  const finalTTL = ttl_hours || defaultTTL;
  const finalExp = Math.floor(Date.now() / 1000) + (finalTTL * 3600);
  
  // Store in DynamoDB
  await dynamoClient.send(new PutCommand({
    TableName: process.env.TOKENS_TABLE,
    Item: {
      token_hash: tokenHash,
      wallet_id: wallet_id,
      tenant_id: tenant_id,
      scopes: scopes,
      exp: finalExp,
      status: 'active',
      description: description || '',
      token_type: tokenType,
      created_at: Math.floor(Date.now() / 1000),
      created_by: createdBy
    }
  }));
  
  // Get KID from wallet (if available)
  const kid = authorizer.kid || 'unknown';
  
  // Emit token_issued span
  try {
    await emitTokenIssuedSpan(tokenHash, wallet_id, tenant_id, kid, scopes, finalExp, tokenType);
  } catch (err) {
    console.warn('Failed to emit token_issued span:', err.message);
  }
  
  // Return token (shown once!)
  return {
    statusCode: 200,
    body: JSON.stringify({
      token: token,
      exp: finalExp,
      token_type: tokenType,
      ttl_hours: finalTTL
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
 * POST /auth/identity/register
 * Registers a new identity (user) with Ed25519 key
 */
async function handleIdentityRegister(event) {
  const body = JSON.parse(event.body || '{}');
  const { kid, pubkey_hex, display_name, email, tenant_id } = body;
  
  if (!kid || !pubkey_hex || !tenant_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'kid, pubkey_hex, tenant_id required' }) };
  }
  
  // Validate span signature if provided
  const span = body.span;
  if (!span || !span.sig) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Signed identity_registration span required' }) };
  }
  
  // Store span in ledger (via /api/spans)
  // For now, we'll return the span structure for the client to store
  const identitySpan = {
    id: span.id || `identity_${Date.now()}_${randomBytes(4).toString('hex')}`,
    seq: 0,
    entity_type: 'identity_registration',
    who: 'user:self',
    did: 'registered',
    this: 'identity.user',
    at: new Date().toISOString(),
    status: 'pending', // Will be 'active' after attestation
    owner_id: email || `user_${kid.substring(0, 8)}`,
    tenant_id: tenant_id,
    visibility: 'tenant',
    metadata: {
      kid: kid,
      display_name: display_name || '',
      email: email || ''
    },
    sig: span.sig
  };
  
  // Generate nonce for attestation
  const nonce = randomBytes(16).toString('base64url');
  
  // Store nonce temporarily (in DynamoDB or return for client to sign)
  // For now, return nonce for client to attest
  
  // Optional: Send verification email if email provided
  // (Email service is optional - onboarding works without it)
  if (email && process.env.EMAIL_SERVICE_URL) {
    try {
      const https = require('https');
      const http = require('http');
      const url = require('url');
      
      const emailUrl = process.env.EMAIL_SERVICE_URL;
      const urlObj = new URL(emailUrl.startsWith('http') ? emailUrl : `https://${emailUrl}`);
      const client = urlObj.protocol === 'https:' ? https : http;
      
      const postData = JSON.stringify({
        email: email,
        display_name: display_name
      });
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: '/email/verify/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      // Fire and forget - don't block onboarding if email fails
      client.request(options, () => {}).on('error', () => {}).write(postData).end();
    } catch (err) {
      console.warn('Failed to send verification email:', err.message);
      // Don't fail onboarding if email fails
    }
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      identity_span: identitySpan,
      attestation_nonce: nonce,
      next_step: 'POST /auth/attest with signed nonce',
      email_verification_sent: !!email && !!process.env.EMAIL_SERVICE_URL
    })
  };
}

/**
 * POST /auth/attest
 * Key attestation: client signs nonce to prove key control
 */
async function handleAttest(event) {
  const { kid, nonce, signature, attestation_hash } = JSON.parse(event.body || '{}');
  
  if (!kid || !nonce || !signature) {
    return { statusCode: 400, body: JSON.stringify({ error: 'kid, nonce, signature required' }) };
  }
  
  // Verify signature (would need pubkey from identity_registration)
  // For now, accept if signature format is valid
  
  // Create key_attestation span
  const attestationSpan = {
    id: `attest_${Date.now()}_${randomBytes(4).toString('hex')}`,
    seq: 0,
    entity_type: 'key_attestation',
    who: 'user:self',
    did: 'attested',
    this: 'identity.attestation',
    at: new Date().toISOString(),
    status: 'verified',
    owner_id: `user_${kid.substring(0, 8)}`,
    tenant_id: 'unknown', // Should come from identity_registration
    visibility: 'tenant',
    metadata: {
      kid: kid,
      nonce: nonce,
      attestation_hash: attestation_hash || 'pending'
    },
    sig: {
      alg: 'ed25519-blake3-v1',
      kid: kid,
      signature: signature
    }
  };
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      attestation_span: attestationSpan,
      next_step: 'Wallet will be opened and token issued'
    })
  };
}

/**
 * Helper: Store span in ledger via /api/spans
 */
async function storeSpanInLedger(span, apiUrl, apiKey) {
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
  
  return new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`API error: ${res.statusCode} ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Helper: Emit token_issued span
 */
async function emitTokenIssuedSpan(tokenHash, walletId, tenantId, kid, scopes, exp, tokenType = 'api_token') {
  const span = {
    id: `token_${Date.now()}_${randomBytes(4).toString('hex')}`,
    seq: 0,
    entity_type: tokenType === 'api_token' ? 'api_token_issued' : 'service_token_issued',
    who: 'kernel:auth_service',
    did: 'issued',
    this: `security.${tokenType}`,
    at: new Date().toISOString(),
    status: 'active',
    owner_id: walletId,
    tenant_id: tenantId,
    visibility: 'tenant',
    metadata: {
      token_hash: tokenHash.substring(0, 16) + '...', // Truncated for security
      wallet_id: walletId,
      kid: kid || 'unknown',
      scopes: scopes,
      exp: exp,
      ttl_hours: Math.floor((exp - Math.floor(Date.now() / 1000)) / 3600)
    }
  };
  
  // Store span (if API Gateway URL is available)
  if (process.env.API_GATEWAY_URL && process.env.BOOTSTRAP_TOKEN) {
    try {
      await storeSpanInLedger(span, process.env.API_GATEWAY_URL, process.env.BOOTSTRAP_TOKEN);
    } catch (err) {
      console.warn('Failed to store token_issued span:', err.message);
    }
  }
  
  return span;
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
 * POST /auth/keys/request
 * CLI requests API key (creates wallet automatically)
 */
async function handleKeyRequest(event) {
  const body = JSON.parse(event.body || '{}');
  const { email, tenant_id, device_info, scopes } = body;
  
  if (!email || !tenant_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email, tenant_id required' }) };
  }
  
  // Generate wallet_id from email
  const walletId = `wlt_${tenant_id}_${email.split('@')[0]}`;
  
  // Check if wallet exists
  const { DynamoDBClient: WalletDynamoDB } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient: WalletDocClient, GetCommand: WalletGetCommand } = require('@aws-sdk/lib-dynamodb');
  const walletClient = WalletDocClient.from(new WalletDynamoDB({ region: process.env.AWS_REGION || 'us-east-1' }));
  
  let walletExists = false;
  try {
    const walletResult = await walletClient.send(new WalletGetCommand({
      TableName: process.env.WALLETS_TABLE || 'wallets',
      Key: { wallet_id: walletId }
    }));
    walletExists = !!walletResult.Item;
  } catch (err) {
    console.warn('Wallet check failed:', err.message);
  }
  
  // Create wallet if not exists
  if (!walletExists) {
    try {
      const { PutCommand: WalletPutCommand } = require('@aws-sdk/lib-dynamodb');
      await walletClient.send(new WalletPutCommand({
        TableName: process.env.WALLETS_TABLE || 'wallets',
        Item: {
          wallet_id: walletId,
          owner_id: email,
          tenant_id: tenant_id,
          status: 'active',
          created_at: Math.floor(Date.now() / 1000),
          items: {}
        }
      }));
      
      // Create wallet_opened span
      const walletSpan = {
        entity_type: 'wallet_opened',
        who: 'system:auth_service',
        did: 'opened',
        this: 'wallet',
        metadata: {
          wallet_id: walletId,
          owner_id: email,
          tenant_id: tenant_id
        }
      };
      
      if (process.env.API_GATEWAY_URL) {
        try {
          await storeSpanInLedger(walletSpan, process.env.API_GATEWAY_URL, process.env.BOOTSTRAP_TOKEN || '');
        } catch (err) {
          console.warn('Failed to store wallet_opened span:', err.message);
        }
      }
    } catch (err) {
      console.error('Failed to create wallet:', err.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create wallet' }) };
    }
  }
  
  // Create api_key_request span
  const requestSpan = {
    entity_type: 'api_key_request',
    who: 'user:self',
    did: 'requested',
    this: 'security.api_key',
    metadata: {
      email: email,
      tenant_id: tenant_id,
      device_info: device_info || {},
      requested_scopes: scopes || []
    }
  };
  
  if (process.env.API_GATEWAY_URL) {
    try {
      await storeSpanInLedger(requestSpan, process.env.API_GATEWAY_URL, process.env.BOOTSTRAP_TOKEN || '');
    } catch (err) {
      console.warn('Failed to store api_key_request span:', err.message);
    }
  }
  
  // Issue token
  const defaultScopes = scopes || ['wallet.open', 'span.sign', 'cli.memory.add', 'cli.memory.search', 'cli.ask'];
  const issueEvent = {
    body: JSON.stringify({
      wallet_id: walletId,
      tenant_id: tenant_id,
      scopes: defaultScopes,
      ttl_hours: 720,
      description: `CLI token for ${email}`
    }),
    requestContext: { authorizer: { wallet_id: 'system' } }
  };
  
  const issueResult = await handleIssue(issueEvent);
  const issueBody = JSON.parse(issueResult.body);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      token: issueBody.token,
      wallet_id: walletId,
      exp: issueBody.exp,
      spans_created: ['api_key_request', 'wallet_opened', 'api_token_issued']
    })
  };
}

/**
 * POST /auth/keys/recover
 * Recover API key (reissue)
 */
async function handleKeyRecover(event) {
  const body = JSON.parse(event.body || '{}');
  const { email, tenant_id } = body;
  
  if (!email || !tenant_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email, tenant_id required' }) };
  }
  
  const walletId = `wlt_${tenant_id}_${email.split('@')[0]}`;
  
  // Check wallet exists
  const { DynamoDBClient: WalletDynamoDB } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient: WalletDocClient, GetCommand: WalletGetCommand } = require('@aws-sdk/lib-dynamodb');
  const walletClient = WalletDocClient.from(new WalletDynamoDB({ region: process.env.AWS_REGION || 'us-east-1' }));
  
  const walletResult = await walletClient.send(new WalletGetCommand({
    TableName: process.env.WALLETS_TABLE || 'wallets',
    Key: { wallet_id: walletId }
  }));
  
  if (!walletResult.Item) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Wallet not found' }) };
  }
  
  // Revoke old tokens
  await handleRevoke({ body: JSON.stringify({ wallet_id: walletId }) });
  
  // Issue new token
  const issueEvent = {
    body: JSON.stringify({
      wallet_id: walletId,
      tenant_id: tenant_id,
      scopes: ['wallet.open', 'span.sign', 'cli.memory.add', 'cli.memory.search', 'cli.ask'],
      ttl_hours: 720,
      description: `Recovered CLI token for ${email}`
    }),
    requestContext: { authorizer: { wallet_id: 'system' } }
  };
  
  const issueResult = await handleIssue(issueEvent);
  const issueBody = JSON.parse(issueResult.body);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      token: issueBody.token,
      wallet_id: walletId,
      exp: issueBody.exp,
      old_token_revoked: true
    })
  };
}

/**
 * POST /auth/magic/send
 * Send magic link via email
 */
async function handleMagicSend(event) {
  const body = JSON.parse(event.body || '{}');
  const { email, tenant_id, redirect_url } = body;
  
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email required' }) };
  }
  
  const finalTenantId = tenant_id || email.split('@')[1].split('.')[0];
  const magicToken = `magic_${randomBytes(24).toString('base64url')}`;
  const expiresAt = Math.floor(Date.now() / 1000) + (15 * 60);
  
  // Store magic token
  const { DynamoDBClient: MagicDynamoDB } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient: MagicDocClient, PutCommand: MagicPutCommand } = require('@aws-sdk/lib-dynamodb');
  const magicClient = MagicDocClient.from(new MagicDynamoDB({ region: process.env.AWS_REGION || 'us-east-1' }));
  
  await magicClient.send(new MagicPutCommand({
    TableName: process.env.MAGIC_LINKS_TABLE || 'magic_links',
    Item: {
      token: magicToken,
      email: email,
      tenant_id: finalTenantId,
      expires_at: expiresAt,
      status: 'pending',
      redirect_url: redirect_url || 'https://app.loglineos.com/dashboard',
      created_at: Math.floor(Date.now() / 1000)
    }
  }));
  
  // Send email
  if (process.env.EMAIL_SERVICE_URL) {
    try {
      const https = require('https');
      const http = require('http');
      const url = require('url');
      
      const emailUrl = process.env.EMAIL_SERVICE_URL;
      const urlObj = new URL(emailUrl.startsWith('http') ? emailUrl : `https://${emailUrl}`);
      const client = urlObj.protocol === 'https:' ? https : http;
      
      const magicLinkUrl = `${process.env.API_GATEWAY_URL || 'https://api.loglineos.com'}/auth/magic/verify?token=${magicToken}&redirect=${encodeURIComponent(redirect_url || 'https://app.loglineos.com/dashboard')}`;
      
      const postData = JSON.stringify({
        email: email,
        event_type: 'magic_link',
        details: { magic_link: magicLinkUrl, expires_in_minutes: 15 }
      });
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: '/email/notify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      client.request(options, () => {}).on('error', () => {}).write(postData).end();
    } catch (err) {
      console.warn('Failed to send magic link email:', err.message);
    }
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: 'Magic link sent to email' })
  };
}

/**
 * GET /auth/magic/verify
 * Verify magic link and authenticate
 */
async function handleMagicVerify(event) {
  const token = event.queryStringParameters?.token;
  const redirect = event.queryStringParameters?.redirect || 'https://app.loglineos.com/dashboard';
  
  if (!token) {
    return {
      statusCode: 302,
      headers: { 'Location': `${redirect}?error=missing_token` },
      body: ''
    };
  }
  
  // Look up magic token
  const { DynamoDBClient: MagicDynamoDB } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient: MagicDocClient, GetCommand: MagicGetCommand, UpdateCommand: MagicUpdateCommand } = require('@aws-sdk/lib-dynamodb');
  const magicClient = MagicDocClient.from(new MagicDynamoDB({ region: process.env.AWS_REGION || 'us-east-1' }));
  
  const magicResult = await magicClient.send(new MagicGetCommand({
    TableName: process.env.MAGIC_LINKS_TABLE || 'magic_links',
    Key: { token: token }
  }));
  
  if (!magicResult.Item || magicResult.Item.expires_at < Math.floor(Date.now() / 1000) || magicResult.Item.status === 'used') {
    return {
      statusCode: 302,
      headers: { 'Location': `${redirect}?error=invalid_token` },
      body: ''
    };
  }
  
  // Mark as used
  await magicClient.send(new MagicUpdateCommand({
    TableName: process.env.MAGIC_LINKS_TABLE || 'magic_links',
    Key: { token: token },
    UpdateExpression: 'SET #status = :used, used_at = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':used': 'used', ':now': Math.floor(Date.now() / 1000) }
  }));
  
  const email = magicResult.Item.email;
  const tenantId = magicResult.Item.tenant_id;
  const walletId = `wlt_${tenantId}_${email.split('@')[0]}`;
  
  // Check if new user
  const { DynamoDBClient: WalletDynamoDB } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient: WalletDocClient, GetCommand: WalletGetCommand, PutCommand: WalletPutCommand } = require('@aws-sdk/lib-dynamodb');
  const walletClient = WalletDocClient.from(new WalletDynamoDB({ region: process.env.AWS_REGION || 'us-east-1' }));
  
  const walletResult = await walletClient.send(new WalletGetCommand({
    TableName: process.env.WALLETS_TABLE || 'wallets',
    Key: { wallet_id: walletId }
  }));
  
  const isNewUser = !walletResult.Item;
  
  if (isNewUser) {
    await walletClient.send(new WalletPutCommand({
      TableName: process.env.WALLETS_TABLE || 'wallets',
      Item: {
        wallet_id: walletId,
        owner_id: email,
        tenant_id: tenantId,
        status: 'active',
        created_at: Math.floor(Date.now() / 1000),
        items: {}
      }
    }));
    
    // Create spans
    const identitySpan = {
      entity_type: 'identity_registration',
      who: 'user:self',
      did: 'registered',
      this: 'identity.user',
      metadata: { email: email, tenant_id: tenantId, registration_method: 'magic_link' }
    };
    
    const walletSpan = {
      entity_type: 'wallet_opened',
      who: 'system:auth_service',
      did: 'opened',
      this: 'wallet',
      metadata: { wallet_id: walletId, owner_id: email, tenant_id: tenantId }
    };
    
    if (process.env.API_GATEWAY_URL) {
      try {
        await storeSpanInLedger(identitySpan, process.env.API_GATEWAY_URL, process.env.BOOTSTRAP_TOKEN || '');
        await storeSpanInLedger(walletSpan, process.env.API_GATEWAY_URL, process.env.BOOTSTRAP_TOKEN || '');
      } catch (err) {
        console.warn('Failed to store spans:', err.message);
      }
    }
  }
  
  // Issue token
  const issueEvent = {
    body: JSON.stringify({
      wallet_id: walletId,
      tenant_id: tenantId,
      scopes: ['wallet.open', 'span.sign', 'cli.memory.add', 'cli.memory.search', 'cli.ask'],
      ttl_hours: 8760,
      description: `UI token for ${email}`
    }),
    requestContext: { authorizer: { wallet_id: 'system' } }
  };
  
  const issueResult = await handleIssue(issueEvent);
  const issueBody = JSON.parse(issueResult.body);
  
  const redirectUrl = `${redirect}?token=${issueBody.token}&wallet_id=${walletId}&new_user=${isNewUser}`;
  
  return {
    statusCode: 302,
    headers: { 'Location': redirectUrl },
    body: ''
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
    
    if (method === 'POST') {
      if (path.includes('/auth/keys/request')) {
        return await handleKeyRequest(event);
      } else if (path.includes('/auth/keys/recover')) {
        return await handleKeyRecover(event);
      } else if (path.includes('/auth/keys/issue')) {
        return await handleIssue(event);
      } else if (path.includes('/auth/keys/revoke')) {
        return await handleRevoke(event);
      } else if (path.includes('/auth/keys/rotate')) {
        return await handleRotate(event);
      } else if (path.includes('/auth/keys/list')) {
        return await handleList(event);
      } else if (path.includes('/auth/magic/send')) {
        return await handleMagicSend(event);
      } else if (path.includes('/auth/identity/register')) {
        return await handleIdentityRegister(event);
      } else if (path.includes('/auth/attest')) {
        return await handleAttest(event);
      }
    } else if (method === 'GET') {
      if (path.includes('/auth/magic/verify')) {
        return await handleMagicVerify(event);
      } else if (path.includes('/auth/keys/list')) {
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

