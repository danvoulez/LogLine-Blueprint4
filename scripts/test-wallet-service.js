#!/usr/bin/env node
/**
 * Test Wallet Service Directly
 * Tests Wallet Service endpoints directly (bypasses API Gateway for unit testing)
 * 
 * Usage:
 *   node scripts/test-wallet-service.js
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
const { randomBytes } = require('crypto');

// Mock event for Lambda handler
function createMockEvent(path, method, body, walletId, tenantId) {
  return {
    path: path,
    httpMethod: method,
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        wallet_id: walletId,
        tenant_id: tenantId,
        scopes: JSON.stringify(['wallet.open', 'span.sign', 'provider.invoke:*'])
      }
    }
  };
}

/**
 * Setup test wallet and keys
 */
async function setupTestWallet() {
  console.log('🔧 Setting up test wallet...');
  
  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ 
    region: process.env.AWS_REGION || 'us-east-1' 
  }));
  const secretsManager = new SecretsManager({ 
    region: process.env.AWS_REGION || 'us-east-1' 
  });
  
  const walletId = `wlt_test_${Date.now()}`;
  
  // Generate Ed25519 key pair
  const { ed25519 } = require('@noble/ed25519');
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  
  // Store private key in Secrets Manager
  const secretName = `test-ed25519-${Date.now()}`;
  try {
    await secretsManager.createSecret({
      Name: secretName,
      SecretString: JSON.stringify({
        private_key_hex: Buffer.from(privateKey).toString('hex'),
        public_key_hex: Buffer.from(publicKey).toString('hex')
      })
    });
    console.log('✅ Created secret:', secretName);
  } catch (err) {
    console.log('⚠️  Secret might already exist:', err.message);
  }
  
  const secretArn = `arn:aws:secretsmanager:${process.env.AWS_REGION || 'us-east-1'}:${process.env.AWS_ACCOUNT_ID || '123456789012'}:secret:${secretName}`;
  
  // Create wallet in DynamoDB
  const walletsTable = process.env.WALLETS_TABLE || 'wallets';
  await dynamoClient.send(new PutCommand({
    TableName: walletsTable,
    Item: {
      wallet_id: walletId,
      owner_id: 'test-user',
      tenant_id: 'test',
      status: 'active',
      items: {
        'kid_ed25519_main': {
          type: 'ed25519',
          pubkey_hex: Buffer.from(publicKey).toString('hex'),
          secret_ref: secretArn,
          caps: ['sign.span', 'sign.http'],
          status: 'active'
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    }
  }));
  
  console.log('✅ Created wallet:', walletId);
  return { walletId, secretArn };
}

/**
 * Test Wallet Service handler
 */
async function testWalletService() {
  console.log('\n🧪 Testing Wallet Service\n');
  
  try {
    // Setup
    const { walletId } = await setupTestWallet();
    
    // Load handler
    const handler = require('../lambda/wallet_service/index.js').handler;
    
    // Test 1: Open wallet
    console.log('📝 Test 1: Open Wallet');
    const openEvent = createMockEvent('/wallet/open', 'POST', {}, walletId, 'test');
    const openResult = await handler(openEvent);
    console.log('   Status:', openResult.statusCode);
    if (openResult.statusCode === 200) {
      const data = JSON.parse(openResult.body);
      console.log('   ✅ Wallet session:', data.wallet_session);
    } else {
      console.log('   ❌ Failed:', openResult.body);
    }
    
    // Test 2: Sign span
    console.log('\n📝 Test 2: Sign Span');
    const span = {
      id: `span_${Date.now()}`,
      seq: 0,
      entity_type: 'memory',
      who: 'test',
      did: 'stored',
      this: 'memory',
      at: new Date().toISOString(),
      status: 'active',
      content: { text: 'Test' }
    };
    
    const signEvent = createMockEvent('/wallet/sign/span', 'POST', {
      kid: 'kid_ed25519_main',
      span: span
    }, walletId, 'test');
    
    const signResult = await handler(signEvent);
    console.log('   Status:', signResult.statusCode);
    if (signResult.statusCode === 200) {
      const data = JSON.parse(signResult.body);
      console.log('   ✅ Span signed');
      console.log('   Payload hash:', data.payload_hash.substring(0, 20) + '...');
      console.log('   Signature:', data.sig.signature.substring(0, 20) + '...');
    } else {
      console.log('   ❌ Failed:', signResult.body);
    }
    
    console.log('\n✅ Tests completed');
    
  } catch (error) {
    console.error('❌ Test error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  testWalletService();
}

module.exports = { testWalletService };

