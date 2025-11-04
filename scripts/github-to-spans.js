/**
 * GitHub to Spans Transformer
 * Transforma arquivos de código em spans (NDJSON) para o ledger
 * 
 * Usage:
 *   node scripts/github-to-spans.js
 * 
 * Environment variables:
 *   GITHUB_SHA - Commit SHA
 *   GITHUB_REF - Branch/ref
 *   GITHUB_REPOSITORY - Repository name
 */

const fs = require('fs');
const path = require('path');
const { blake3 } = require('@noble/hashes/blake3');
const crypto = require('crypto');

const OUTPUT_DIR = path.join(__dirname, '../.ledger/spans');
const SPANS_DIR = path.join(__dirname, '../ROW');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Calculate hash for span content
 */
function calculateHash(content) {
  const hashBytes = blake3(new TextEncoder().encode(content));
  return Buffer.from(hashBytes).toString('hex');
}

/**
 * Generate UUID v4
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Transform kernel file to span
 */
function kernelFileToSpan(filePath, kernelData, gitMetadata) {
  const span = {
    id: kernelData.id || generateUUID(),
    seq: kernelData.seq || 0,
    entity_type: 'function',
    who: gitMetadata.author || 'github:actions',
    did: 'defined',
    this: `function.${kernelData.name || 'unknown'}`,
    at: new Date().toISOString(),
    status: kernelData.status || 'active',
    visibility: kernelData.visibility || 'public',
    owner_id: kernelData.owner_id || 'system',
    tenant_id: kernelData.tenant_id || 'system',
    name: kernelData.name,
    description: kernelData.description,
    code: kernelData.code,
    language: kernelData.language || 'javascript',
    runtime: kernelData.runtime || 'deno@1.x',
    metadata: {
      ...kernelData.metadata,
      source_file: filePath,
      git_sha: gitMetadata.sha,
      git_ref: gitMetadata.ref,
      git_repo: gitMetadata.repo,
      transformed_at: new Date().toISOString()
    }
  };
  
  // Calculate hash
  const canonical = JSON.stringify(span, Object.keys(span).sort());
  const hash = calculateHash(canonical);
  span.curr_hash = `b3:${hash}`;
  
  return span;
}

/**
 * Transform prompt file to span
 */
function promptFileToSpan(filePath, promptData, gitMetadata) {
  const span = {
    id: promptData.id || generateUUID(),
    seq: promptData.seq || 0,
    entity_type: promptData.entity_type || 'prompt_block',
    who: gitMetadata.author || 'github:actions',
    did: 'defined',
    this: `prompt.${promptData.name || 'unknown'}`,
    at: new Date().toISOString(),
    status: promptData.status || 'active',
    visibility: promptData.visibility || 'tenant',
    owner_id: promptData.owner_id || 'system',
    tenant_id: promptData.tenant_id || 'system',
    name: promptData.name,
    content: promptData.content || promptData.text,
    metadata: {
      ...promptData.metadata,
      source_file: filePath,
      git_sha: gitMetadata.sha,
      git_ref: gitMetadata.ref,
      git_repo: gitMetadata.repo,
      transformed_at: new Date().toISOString()
    }
  };
  
  const canonical = JSON.stringify(span, Object.keys(span).sort());
  const hash = calculateHash(canonical);
  span.curr_hash = `b3:${hash}`;
  
  return span;
}

/**
 * Process NDJSON file
 */
function processNDJSONFile(filePath, gitMetadata, transformer) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const spans = [];
  
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      const span = transformer(filePath, data, gitMetadata);
      spans.push(span);
    } catch (e) {
      console.warn(`⚠️  Erro ao processar linha em ${filePath}:`, e.message);
    }
  }
  
  return spans;
}

/**
 * Process single file (YAML, JS, etc) and create span
 */
function processCodeFile(filePath, gitMetadata) {
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath);
  const name = path.basename(filePath, ext);
  const relPath = path.relative(process.cwd(), filePath);
  
  // Determine entity type based on path
  let entityType = 'code_file';
  if (relPath.includes('lambda/')) {
    entityType = 'lambda_function';
  } else if (relPath.includes('FILES/src/')) {
    entityType = 'source_file';
  }
  
  const span = {
    id: generateUUID(),
    seq: 0,
    entity_type: entityType,
    who: gitMetadata.author || 'github:actions',
    did: 'committed',
    this: `file.${relPath}`,
    at: new Date().toISOString(),
    status: 'active',
    visibility: 'public',
    owner_id: 'system',
    tenant_id: 'system',
    name: name,
    code: content,
    language: ext === '.js' ? 'javascript' : ext === '.ts' ? 'typescript' : 'text',
    metadata: {
      file_path: relPath,
      file_extension: ext,
      git_sha: gitMetadata.sha,
      git_ref: gitMetadata.ref,
      git_repo: gitMetadata.repo,
      transformed_at: new Date().toISOString()
    }
  };
  
  const canonical = JSON.stringify(span, Object.keys(span).sort());
  const hash = calculateHash(canonical);
  span.curr_hash = `b3:${hash}`;
  
  return span;
}

/**
 * Main function
 */
async function main() {
  console.log('🔄 Transformando arquivos em spans...\n');
  
  const gitMetadata = {
    sha: process.env.GITHUB_SHA || 'local',
    ref: process.env.GITHUB_REF || 'refs/heads/main',
    repo: process.env.GITHUB_REPOSITORY || 'loglineos-blueprint4',
    author: process.env.GITHUB_ACTOR || 'system'
  };
  
  console.log('📝 Metadata:', gitMetadata);
  console.log('');
  
  const allSpans = [];
  
  // 1. Process ROW/kernels/*.ndjson
  console.log('📦 Processando kernels...');
  const kernelsDir = path.join(SPANS_DIR, 'kernels');
  if (fs.existsSync(kernelsDir)) {
    const kernelFiles = fs.readdirSync(kernelsDir).filter(f => f.endsWith('.ndjson'));
    for (const file of kernelFiles) {
      const filePath = path.join(kernelsDir, file);
      const spans = processNDJSONFile(filePath, gitMetadata, kernelFileToSpan);
      allSpans.push(...spans);
      console.log(`   ✅ ${file}: ${spans.length} kernels`);
    }
  }
  
  // 2. Process ROW/prompts/*.ndjson
  console.log('\n📝 Processando prompts...');
  const promptsDir = path.join(SPANS_DIR, 'prompts');
  if (fs.existsSync(promptsDir)) {
    const promptFiles = fs.readdirSync(promptsDir).filter(f => f.endsWith('.ndjson'));
    for (const file of promptFiles) {
      const filePath = path.join(promptsDir, file);
      const spans = processNDJSONFile(filePath, gitMetadata, promptFileToSpan);
      allSpans.push(...spans);
      console.log(`   ✅ ${file}: ${spans.length} prompts`);
    }
  }
  
  // 3. Process ROW/policies/*.ndjson
  console.log('\n🛡️  Processando policies...');
  const policiesDir = path.join(SPANS_DIR, 'policies');
  if (fs.existsSync(policiesDir)) {
    const policyFiles = fs.readdirSync(policiesDir).filter(f => f.endsWith('.ndjson'));
    for (const file of policyFiles) {
      const filePath = path.join(policiesDir, file);
      const spans = processNDJSONFile(filePath, gitMetadata, (fp, data, gm) => {
        return {
          id: data.id || generateUUID(),
          seq: data.seq || 0,
          entity_type: 'policy',
          who: gm.author || 'github:actions',
          did: 'defined',
          this: `policy.${data.name || 'unknown'}`,
          at: new Date().toISOString(),
          status: data.status || 'active',
          visibility: data.visibility || 'tenant',
          owner_id: data.owner_id || 'system',
          tenant_id: data.tenant_id || 'system',
          name: data.name,
          metadata: { ...data.metadata, source_file: fp, ...gm }
        };
      });
      allSpans.push(...spans);
      console.log(`   ✅ ${file}: ${spans.length} policies`);
    }
  }
  
  // 4. Process ROW/manifest/*.ndjson
  console.log('\n📋 Processando manifest...');
  const manifestDir = path.join(SPANS_DIR, 'manifest');
  if (fs.existsSync(manifestDir)) {
    const manifestFiles = fs.readdirSync(manifestDir).filter(f => f.endsWith('.ndjson'));
    for (const file of manifestFiles) {
      const filePath = path.join(manifestDir, file);
      const spans = processNDJSONFile(filePath, gitMetadata, (fp, data, gm) => {
        return {
          id: data.id || generateUUID(),
          seq: data.seq || 0,
          entity_type: 'manifest',
          who: gm.author || 'github:actions',
          did: 'defined',
          this: 'manifest',
          at: new Date().toISOString(),
          status: 'active',
          visibility: 'public',
          owner_id: 'system',
          tenant_id: 'system',
          name: data.name,
          metadata: { ...data.metadata, source_file: fp, ...gm }
        };
      });
      allSpans.push(...spans);
      console.log(`   ✅ ${file}: ${spans.length} manifests`);
    }
  }
  
  // 5. Group spans by entity_type and write to NDJSON files
  console.log('\n💾 Escrevendo spans...');
  const spansByType = {};
  for (const span of allSpans) {
    const type = span.entity_type;
    if (!spansByType[type]) {
      spansByType[type] = [];
    }
    spansByType[type].push(span);
  }
  
  for (const [entityType, spans] of Object.entries(spansByType)) {
    const outputFile = path.join(OUTPUT_DIR, `${entityType}.ndjson`);
    const content = spans.map(s => JSON.stringify(s)).join('\n');
    fs.writeFileSync(outputFile, content + '\n');
    console.log(`   ✅ ${outputFile}: ${spans.length} spans`);
  }
  
  // 6. Create summary
  const summary = {
    transformed_at: new Date().toISOString(),
    git: gitMetadata,
    spans_by_type: Object.fromEntries(
      Object.entries(spansByType).map(([type, spans]) => [type, spans.length])
    ),
    total_spans: allSpans.length
  };
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );
  
  console.log('\n✅ Transformação completa!');
  console.log(`   Total de spans: ${allSpans.length}`);
  console.log(`   Tipos: ${Object.keys(spansByType).join(', ')}`);
  console.log(`   Output: ${OUTPUT_DIR}\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };

