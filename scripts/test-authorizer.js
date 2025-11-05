#!/usr/bin/env node
/**
 * Test Authorizer
 * Tests the API Key Authorizer logic
 * 
 * Usage:
 *   node scripts/test-authorizer.js
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
const { createHmac } = require('crypto');
const argon2 = require('argon2');
const { randomBytes } = require('crypto');

/**
 * Create test token and store in DynamoDB
 */
async function createTestToken() {
  console.log('🔧 Creating test token...');
  
  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ 
    region: process.env.AWS_REGION || 'us-east-1' 
  }));
  const secretsManager = new SecretsManager({ 
    region: process.env.AWS_REGION || 'us-east-1' 
  });
  
  // Get or create pepper
  let pepper;
  try {
    const pepperSecret = await secretsManager.getSecretValue({
      SecretId: process.env.TOKENS_PEPPER_SECRET_ARN || 'loglineos-token-pepper'
    });
    pepper = JSON.parse(pepperSecret.SecretString).pepper;
  } catch (err) {
    // Create pepper if doesn't exist
    pepper = randomBytes(64).toString('hex');
    console.log('⚠️  Pepper not found, using generated one (not persisted)');
  }
  
  // Generate token
  const token = `tok_live_${randomBytes(24).toString('base64url')}`;
  console.log('📝 Generated token:', token.substring(0, 30) + '...');
  
  // Calculate hash
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
  
  const tokenHash = hash.split('$').pop();
  
  // Store in DynamoDB
  const tokensTable = process.env.TOKENS_TABLE || 'auth_api_tokens';
  const walletId = `wlt_test_${Date.now()}`;
  
  await dynamoClient.send(new PutCommand({
    TableName: tokensTable,
    Item: {
      token_hash: tokenHash,
      wallet_id: walletId,
      tenant_id: 'test',
      scopes: ['wallet.open', 'span.sign', 'memory.*'],
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      status: 'active',
      description: 'Test token',
      created_at: Math.floor(Date.now() / 1000),
      created_by: 'test'
    }
  }));
  
  console.log('✅ Token stored in DynamoDB');
  return { token, tokenHash, walletId };
}

/**
 * Test Authorizer handler
 */
async function testAuthorizer() {
  console.log('\n🧪 Testing Authorizer\n');
  
  try {
    // Setup
    const { token, tokenHash, walletId } = await createTestToken();
    
    // Load handler
    const handler = require('../lambda/auth_api_key_authorizer/index.js').handler;
    
    // Test 1: Valid token
    console.log('📝 Test 1: Valid Token');
    const validEvent = {
      headers: {
        authorization: `ApiKey ${token}`
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/*',
      requestContext: {
        apiId: 'abcdef123',
        stage: 'test',
        accountId: '123456789012'
      }
    };
    
    const validResult = await handler(validEvent);
    console.log('   Effect:', validResult.policyDocument.Statement[0].Effect);
    console.log('   Principal:', validResult.principalId);
    if (validResult.policyDocument.Statement[0].Effect === 'Allow') {
      console.log('   ✅ Token validated successfully');
      console.log('   Context:', validResult.context);
    } else {
      console.log('   ❌ Token rejected');
    }
    
    // Test 2: Invalid token
    console.log('\n📝 Test 2: Invalid Token');
    const invalidEvent = {
      headers: {
        authorization: 'ApiKey tok_invalid_123'
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/*'
    };
    
    const invalidResult = await handler(invalidEvent);
    console.log('   Effect:', invalidResult.policyDocument.Statement[0].Effect);
    if (invalidResult.policyDocument.Statement[0].Effect === 'Deny') {
      console.log('   ✅ Invalid token correctly rejected');
      console.log('   Reason:', invalidResult.context.reason);
    } else {
      console.log('   ❌ Should have been rejected');
    }
    
    // Test 3: Missing token
    console.log('\n📝 Test 3: Missing Token');
    const missingEvent = {
      headers: {},
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/*'
    };
    
    const missingResult = await handler(missingEvent);
    console.log('   Effect:', missingResult.policyDocument.Statement[0].Effect);
    if (missingResult.policyDocument.Statement[0].Effect === 'Deny') {
      console.log('   ✅ Missing token correctly rejected');
    } else {
      console.log('   ❌ Should have been rejected');
    }
    
    console.log('\n✅ Tests completed');
    
  } catch (error) {
    console.error('❌ Test error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  testAuthorizer();
}

module.exports = { testAuthorizer };

