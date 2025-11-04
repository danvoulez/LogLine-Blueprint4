/**
 * Lambda Onboard Agent
 * Automates onboarding flow: creates pacts, SLO specs, smoke tests after app registration
 * 
 * Environment variables:
 *   API_GATEWAY_URL - Base URL for API Gateway
 *   BOOTSTRAP_TOKEN - Token for storing spans
 *   AWS_REGION - AWS region
 */

const { randomBytes } = require('crypto');

/**
 * Store span in ledger
 */
async function storeSpan(span, apiUrl, apiKey) {
  const https = require('https');
  const http = require('http');
  
  const urlObj = new URL(apiUrl.startsWith('http') ? apiUrl : `https://${apiUrl}`);
  const client = urlObj.protocol === 'https:' ? https : http;
  
  const postData = JSON.stringify(span);
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
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
 * Create capability_grant span
 */
function createCapabilityGrant(appId, kid, capabilities, tenantId, userId) {
  return {
    id: `cap_${Date.now()}_${randomBytes(4).toString('hex')}`,
    seq: 0,
    entity_type: 'capability_grant',
    who: 'kernel:onboard_agent',
    did: 'granted',
    this: 'capability.grant',
    at: new Date().toISOString(),
    status: 'active',
    owner_id: userId,
    tenant_id: tenantId,
    visibility: 'tenant',
    metadata: {
      kid: kid,
      app_id: appId || null,
      capabilities: capabilities,
      granted_by: 'onboard_agent'
    }
  };
}

/**
 * Create pact span
 */
function createPact(appId, pactType, provider, limits, tenantId, userId) {
  return {
    id: `pact_${Date.now()}_${randomBytes(4).toString('hex')}`,
    seq: 0,
    entity_type: 'pact',
    who: 'kernel:onboard_agent',
    did: 'created',
    this: `pact.${pactType}`,
    at: new Date().toISOString(),
    status: 'active',
    owner_id: userId,
    tenant_id: tenantId,
    visibility: 'tenant',
    metadata: {
      app_id: appId,
      pact_type: pactType,
      provider: provider || '*',
      limits: limits || {
        requests_per_minute: 100,
        tokens_per_day: 1000000
      },
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() // 1 year
    }
  };
}

/**
 * Create slo_spec span
 */
function createSLOSpec(appId, defaultSLO, tenantId, userId) {
  return {
    id: `slo_${Date.now()}_${randomBytes(4).toString('hex')}`,
    seq: 0,
    entity_type: 'slo_spec',
    who: 'kernel:onboard_agent',
    did: 'specified',
    this: 'slo.spec',
    at: new Date().toISOString(),
    status: 'active',
    owner_id: userId,
    tenant_id: tenantId,
    visibility: 'tenant',
    metadata: {
      app_id: appId,
      p95_ms: defaultSLO?.p95_ms || 800,
      min_quality: defaultSLO?.min_quality || 0.7,
      error_rate_threshold: 0.01,
      monitoring_enabled: true
    }
  };
}

/**
 * Create smoke_test.requested span
 */
function createSmokeTest(appId, testSuite, tenantId, userId) {
  return {
    id: `smoke_${Date.now()}_${randomBytes(4).toString('hex')}`,
    seq: 0,
    entity_type: 'smoke_test.requested',
    who: 'kernel:onboard_agent',
    did: 'requested',
    this: 'test.smoke',
    at: new Date().toISOString(),
    status: 'pending',
    owner_id: userId,
    tenant_id: tenantId,
    visibility: 'tenant',
    metadata: {
      app_id: appId,
      test_suite: testSuite || ['memory.write', 'prompt_runner.execute', 'provider.invoke'],
      scheduled_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 min from now
    }
  };
}

/**
 * Main handler - triggered after app_registration
 */
exports.handler = async (event) => {
  console.log('🤖 Onboard Agent Event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract app registration data from event
    // This could be triggered by EventBridge, SQS, or direct invocation
    const appRegistration = event.app_registration || event;
    const {
      app_id,
      kid,
      requires_caps,
      default_slo,
      tenant_id,
      owner_id,
      metadata
    } = appRegistration;
    
    if (!app_id || !tenant_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'app_id, tenant_id required' })
      };
    }
    
    const apiUrl = process.env.API_GATEWAY_URL || 'https://api.example.com/dev';
    const apiKey = process.env.BOOTSTRAP_TOKEN || event.bootstrap_token;
    
    if (!apiKey) {
      console.warn('⚠️  No bootstrap token, spans will not be stored');
    }
    
    const results = {
      capability_grant: null,
      pacts: [],
      slo_spec: null,
      smoke_test: null
    };
    
    // 1. Create capability_grant
    if (requires_caps && requires_caps.length > 0) {
      const capabilitySpan = createCapabilityGrant(app_id, kid, requires_caps, tenant_id, owner_id);
      if (apiKey) {
        try {
          await storeSpan(capabilitySpan, apiUrl, apiKey);
          results.capability_grant = capabilitySpan.id;
          console.log('✅ Capability grant created:', capabilitySpan.id);
        } catch (err) {
          console.error('❌ Failed to store capability_grant:', err.message);
        }
      }
    }
    
    // 2. Create pacts for providers
    if (requires_caps) {
      for (const cap of requires_caps) {
        if (cap.startsWith('provider.invoke:')) {
          const provider = cap.split(':')[2] || '*';
          const pactSpan = createPact(app_id, 'provider.invoke', provider, null, tenant_id, owner_id);
          if (apiKey) {
            try {
              await storeSpan(pactSpan, apiUrl, apiKey);
              results.pacts.push(pactSpan.id);
              console.log('✅ Pact created:', pactSpan.id);
            } catch (err) {
              console.error('❌ Failed to store pact:', err.message);
            }
          }
        }
      }
    }
    
    // 3. Create SLO spec
    if (default_slo) {
      const sloSpan = createSLOSpec(app_id, default_slo, tenant_id, owner_id);
      if (apiKey) {
        try {
          await storeSpan(sloSpan, apiUrl, apiKey);
          results.slo_spec = sloSpan.id;
          console.log('✅ SLO spec created:', sloSpan.id);
        } catch (err) {
          console.error('❌ Failed to store slo_spec:', err.message);
        }
      }
    }
    
    // 4. Schedule smoke test
    const testSuite = metadata?.intent_set || requires_caps || [];
    const smokeSpan = createSmokeTest(app_id, testSuite, tenant_id, owner_id);
    if (apiKey) {
      try {
        await storeSpan(smokeSpan, apiUrl, apiKey);
        results.smoke_test = smokeSpan.id;
        console.log('✅ Smoke test scheduled:', smokeSpan.id);
      } catch (err) {
        console.error('❌ Failed to store smoke_test:', err.message);
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        app_id: app_id,
        results: results
      })
    };
    
  } catch (error) {
    console.error('❌ Onboard Agent error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

