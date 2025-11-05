#!/usr/bin/env node
/**
 * Create deployment request spans from changed Lambda functions
 * Outputs NDJSON to .ledger/spans/deployment_request.ndjson
 */

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

// Lambda directories to monitor
const LAMBDA_DIRS = [
  { dir: 'lambda/auth_service', name: 'loglineos-auth-service' },
  { dir: 'lambda/wallet_service', name: 'loglineos-wallet-service' },
  { dir: 'lambda/cli_service', name: 'loglineos-cli-service' },
  { dir: 'lambda/auth_api_key_authorizer', name: 'loglineos-auth-authorizer' },
  { dir: 'lambda/email_service', name: 'loglineos-email-service' },
  { dir: 'lambda/onboard_agent', name: 'loglineos-onboard-agent' }
];

// Legacy Lambdas (use root deploy.zip)
const LEGACY_LAMBDAS = [
  { name: 'loglineos-stage0-loader', source: 'FILES/' },
  { name: 'loglineos-db-migration', source: 'FILES/' },
  { name: 'loglineos-diagnostic', source: 'FILES/' }
];

function createDeploymentSpan(functionName, source, commitSha, environment = 'dev') {
  return {
    id: `span:deployment:${randomBytes(16).toString('hex')}`,
    seq: 0,
    entity_type: 'deployment_request',
    who: 'system:github_actions',
    did: 'requested',
    this: 'deployment',
    at: new Date().toISOString(),
    status: 'pending',
    tenant_id: 'system',
    visibility: 'public',
    metadata: {
      target: 'lambda',
      function_name: functionName,
      source: source,
      commit_sha: commitSha || process.env.GITHUB_SHA || 'local',
      environment: environment,
      law: {
        scope: 'deployment',
        targets: ['deployment_executor:1.0.0'],
        triage: 'auto'
      }
    }
  };
}

function main() {
  const commitSha = process.env.GITHUB_SHA || 'local';
  const environment = process.env.ENVIRONMENT || 'dev';
  
  const spans = [];
  
  // Check Lambda directories
  for (const { dir, name } of LAMBDA_DIRS) {
    if (fs.existsSync(dir)) {
      spans.push(createDeploymentSpan(name, dir, commitSha, environment));
    }
  }
  
  // Add legacy Lambdas (if changed files detected)
  // For now, include them all (could be optimized to check git diff)
  const changedFiles = process.env.CHANGED_FILES ? process.env.CHANGED_FILES.split('\n') : [];
  const shouldDeployLegacy = changedFiles.some(f => 
    f.startsWith('FILES/') || f.startsWith('index.js') || f.startsWith('handler.js')
  );
  
  if (shouldDeployLegacy || process.env.DEPLOY_ALL === 'true') {
    for (const { name, source } of LEGACY_LAMBDAS) {
      spans.push(createDeploymentSpan(name, source, commitSha, environment));
    }
  }
  
  // Create output directory
  const outputDir = '.ledger/spans';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write NDJSON
  const outputPath = path.join(outputDir, 'deployment_request.ndjson');
  const ndjson = spans.map(s => JSON.stringify(s)).join('\n');
  fs.writeFileSync(outputPath, ndjson + '\n');
  
  console.log(`✅ Created ${spans.length} deployment request spans`);
  console.log(`   Output: ${outputPath}`);
  console.log(`   Functions:`);
  spans.forEach(s => {
    console.log(`     - ${s.metadata.function_name}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { createDeploymentSpan };

