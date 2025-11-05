#!/usr/bin/env node
/**
 * Test Auth Flow
 * Tests the complete authentication flow: issue token → use wallet → sign span
 * 
 * Usage:
 *   node scripts/test-auth-flow.js
 * 
 * Environment variables:
 *   API_GATEWAY_URL - API Gateway base URL
 *   ADMIN_TOKEN - Bootstrap admin token (optional, for first-time setup)
 *   AWS_REGION - AWS region
 */

const https = require('https');
const http = require('http');
const { randomBytes } = require('crypto');

const API_URL = process.env.API_GATEWAY_URL || 'https://api.example.com/dev';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

/**
 * Make HTTP request
 */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      ...options
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * Test 1: Issue Token
 */
async function testIssueToken() {
  console.log('\n📝 Test 1: Issue Token');
  console.log('─'.repeat(50));
  
  if (!ADMIN_TOKEN) {
    console.log('⚠️  ADMIN_TOKEN not set, skipping...');
    return null;
  }
  
  const walletId = `wlt_test_${Date.now()}`;
  const tenantId = 'test';
  
  const result = await request(`${API_URL}/auth/keys/issue`, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: {
      wallet_id: walletId,
      tenant_id: tenantId,
      scopes: [
        'wallet.open',
        'span.sign',
        'provider.invoke:anthropic/*',
        'prompt.fetch',
        'memory.*'
      ],
      ttl_hours: 24,
      description: 'Test token'
    }
  });
  
  if (result.status === 200 && result.data.token) {
    console.log('✅ Token issued:', result.data.token.substring(0, 20) + '...');
    console.log('   Expires:', new Date(result.data.exp * 1000).toISOString());
    return { token: result.data.token, walletId, tenantId };
  } else {
    console.log('❌ Failed to issue token:', result.data);
    return null;
  }
}

/**
 * Test 2: Open Wallet
 */
async function testOpenWallet(token, walletId) {
  console.log('\n🔐 Test 2: Open Wallet');
  console.log('─'.repeat(50));
  
  const result = await request(`${API_URL}/wallet/open`, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (result.status === 200 && result.data.wallet_session) {
    console.log('✅ Wallet session opened:', result.data.wallet_session);
    console.log('   Wallet ID:', result.data.wallet_id);
    console.log('   Expires:', new Date(result.data.exp * 1000).toISOString());
    return result.data;
  } else {
    console.log('❌ Failed to open wallet:', result.data);
    return null;
  }
}

/**
 * Test 3: Sign Span
 */
async function testSignSpan(token, walletId) {
  console.log('\n✍️  Test 3: Sign Span');
  console.log('─'.repeat(50));
  
  // Create test span (without sig)
  const span = {
    id: `span_${Date.now()}_${randomBytes(4).toString('hex')}`,
    seq: 0,
    entity_type: 'memory',
    who: 'test-user',
    did: 'stored',
    this: 'memory',
    at: new Date().toISOString(),
    status: 'active',
    owner_id: 'test-user',
    tenant_id: 'test',
    visibility: 'private',
    content: {
      text: 'Test memory entry'
    },
    metadata: {
      layer: 'session',
      type: 'note'
    }
  };
  
  const result = await request(`${API_URL}/wallet/sign/span`, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${token}`,
      'Content-Type': 'application/json'
    },
    body: {
      kid: 'kid_ed25519_main',
      span: span
    }
  });
  
  if (result.status === 200 && result.data.sig) {
    console.log('✅ Span signed');
    console.log('   Payload hash:', result.data.payload_hash.substring(0, 20) + '...');
    console.log('   Signature alg:', result.data.sig.alg);
    console.log('   Key ID:', result.data.sig.key_id.substring(0, 30) + '...');
    return { span, signature: result.data };
  } else {
    console.log('❌ Failed to sign span:', result.data);
    return null;
  }
}

/**
 * Test 4: Sign HTTP Request
 */
async function testSignHttp(token, walletId) {
  console.log('\n🔒 Test 4: Sign HTTP Request');
  console.log('─'.repeat(50));
  
  const method = 'POST';
  const path = '/api/spans?tenant=test';
  const body = JSON.stringify({ test: 'data' });
  
  const result = await request(`${API_URL}/wallet/sign/http`, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${token}`,
      'Content-Type': 'application/json'
    },
    body: {
      kid: 'kid_ed25519_main',
      method: method,
      path_with_query: path,
      body_canon: body
    }
  });
  
  if (result.status === 200 && result.data.headers) {
    console.log('✅ HTTP request signed');
    console.log('   Headers:', Object.keys(result.data.headers).join(', '));
    console.log('   Timestamp:', result.data.headers['X-LL-TS']);
    return result.data;
  } else {
    console.log('❌ Failed to sign HTTP:', result.data);
    return null;
  }
}

/**
 * Test 5: Authorizer Validation
 */
async function testAuthorizer(token) {
  console.log('\n🛡️  Test 5: Authorizer Validation');
  console.log('─'.repeat(50));
  
  // Test with a protected endpoint
  const result = await request(`${API_URL}/wallet/open`, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (result.status === 200 || result.status === 401 || result.status === 403) {
    console.log('✅ Authorizer processed request');
    console.log('   Status:', result.status);
    if (result.status === 200) {
      console.log('   ✅ Token validated successfully');
    } else {
      console.log('   ❌ Token rejected:', result.data);
    }
    return result.status === 200;
  } else {
    console.log('⚠️  Unexpected status:', result.status);
    return false;
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 Starting Auth Flow Tests\n');
  console.log('API URL:', API_URL);
  console.log('─'.repeat(50));
  
  const results = {
    issueToken: false,
    openWallet: false,
    signSpan: false,
    signHttp: false,
    authorizer: false
  };
  
  try {
    // Test 1: Issue token
    const tokenData = await testIssueToken();
    if (tokenData) {
      results.issueToken = true;
      const { token, walletId, tenantId } = tokenData;
      
      // Test 2: Open wallet
      const walletSession = await testOpenWallet(token, walletId);
      if (walletSession) {
        results.openWallet = true;
      }
      
      // Test 3: Sign span
      const signedSpan = await testSignSpan(token, walletId);
      if (signedSpan) {
        results.signSpan = true;
      }
      
      // Test 4: Sign HTTP
      const signedHttp = await testSignHttp(token, walletId);
      if (signedHttp) {
        results.signHttp = true;
      }
      
      // Test 5: Authorizer
      results.authorizer = await testAuthorizer(token);
    }
    
    // Summary
    console.log('\n📊 Test Summary');
    console.log('═'.repeat(50));
    Object.entries(results).forEach(([test, passed]) => {
      console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASS' : 'FAIL'}`);
    });
    
    const allPassed = Object.values(results).every(r => r);
    console.log('\n' + (allPassed ? '✅ All tests passed!' : '⚠️  Some tests failed'));
    
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

