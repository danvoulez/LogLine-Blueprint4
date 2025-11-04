/**
 * Sync Spans to Ledger
 * Envia spans (NDJSON) para o ledger via API ou Stage-0
 * 
 * Usage:
 *   node scripts/sync-spans-to-ledger.js
 * 
 * Environment variables:
 *   DB_SECRET_ARN - ARN do secret com credenciais do DB (para API direta)
 *   API_GATEWAY_URL - URL do API Gateway (para via API)
 *   STAGE0_FUNCTION_NAME - Nome da Lambda Stage-0 (para via Lambda)
 */

const fs = require('fs');
const path = require('path');
// Optional AWS SDK imports are handled below. Postgres client is required.
const { Client } = require('pg');

const SPANS_DIR = path.join(__dirname, '../.ledger/spans');

// Try to load AWS SDK (optional)
let SecretsManagerClass, LambdaClientClass;
try {
  SecretsManagerClass = require('@aws-sdk/client-secrets-manager').SecretsManager;
  LambdaClientClass = require('@aws-sdk/client-lambda').LambdaClient;
  InvokeCommandClass = require('@aws-sdk/client-lambda').InvokeCommand;
} catch (e) {
  console.warn('⚠️  AWS SDK não disponível, usando apenas PostgreSQL direto');
}

/**
 * Get database client
 */
async function getClient() {
  if (SecretsManagerClass && process.env.DB_SECRET_ARN) {
    try {
      const secretsManager = new SecretsManagerClass({ 
        region: process.env.AWS_REGION || 'us-east-1' 
      });
      const secret = await secretsManager.getSecretValue({ SecretId: process.env.DB_SECRET_ARN });
      const dbConfig = JSON.parse(secret.SecretString);
      
      return new (require('pg').Client)({
        host: dbConfig.host || dbConfig.endpoint,
        database: dbConfig.dbname || dbConfig.database || 'loglineos',
        user: dbConfig.username || 'ledger_admin',
        password: dbConfig.password,
        port: dbConfig.port || 5432,
        ssl: { rejectUnauthorized: false }
      });
    } catch (e) {
      console.warn('⚠️  Erro ao obter secret:', e.message);
    }
  }
  
  // Fallback
  const { Client } = require('pg');
  return new Client({
    host: process.env.RDS_ENDPOINT || 'loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com',
    port: process.env.RDS_PORT || 5432,
    user: process.env.DB_USER || 'ledger_admin',
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'loglineos',
    ssl: { rejectUnauthorized: false }
  });
}

/**
 * Insert span directly to database
 */
async function insertSpanDirect(client, span) {
  const cols = Object.keys(span).filter(k => span[k] !== undefined);
  const vals = cols.map(k => span[k]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const colNames = cols.map(c => `"${c}"`).join(', ');
  
  const query = `INSERT INTO ledger.universal_registry (${colNames}) VALUES (${placeholders}) ON CONFLICT (id, seq) DO NOTHING RETURNING *`;
  
  try {
    const result = await client.query(query, vals);
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      // Duplicate, try with next seq
      const { rows: seqRows } = await client.query(
        'SELECT COALESCE(MAX(seq), -1) as max_seq FROM ledger.universal_registry WHERE id = $1',
        [span.id]
      );
      span.seq = seqRows[0].max_seq + 1;
      return await insertSpanDirect(client, span);
    }
    throw err;
  }
}

/**
 * Insert span via API Gateway
 */
async function insertSpanViaAPI(span, apiUrl, apiKey) {
  const fetch = require('node-fetch');
  const response = await fetch(`${apiUrl}/api/spans`, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(span)
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * Insert span via Stage-0 Lambda
 */
async function insertSpanViaStage0(span, stage0FunctionName) {
  if (!LambdaClientClass) {
    throw new Error('AWS SDK Lambda client not available');
  }
  
  const lambdaClient = new LambdaClientClass({ 
    region: process.env.AWS_REGION || 'us-east-1' 
  });
  
  // Stage-0 expects a boot_function_id, but we can use a "span_insert" helper kernel
  // For now, we'll insert directly via DB
  throw new Error('Stage-0 insertion not implemented yet - use direct DB or API');
}

/**
 * Process NDJSON file and insert spans
 */
async function processNDJSONFile(filePath, insertFn) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const results = { inserted: 0, skipped: 0, errors: [] };
  
  for (const line of lines) {
    try {
      const span = JSON.parse(line);
      await insertFn(span);
      results.inserted++;
    } catch (err) {
      if (err.code === '23505' || err.message?.includes('duplicate')) {
        results.skipped++;
      } else {
        results.errors.push({ line: line.substring(0, 100), error: err.message });
      }
    }
  }
  
  return results;
}

/**
 * Main function
 */
async function main() {
  console.log('🔄 Sincronizando spans para o ledger...\n');
  
  if (!fs.existsSync(SPANS_DIR)) {
    console.error('❌ Diretório de spans não encontrado:', SPANS_DIR);
    console.log('   Execute primeiro: node scripts/github-to-spans.js');
    process.exit(1);
  }
  
  const ndjsonFiles = fs.readdirSync(SPANS_DIR).filter(f => f.endsWith('.ndjson'));
  
  if (ndjsonFiles.length === 0) {
    console.error('❌ Nenhum arquivo NDJSON encontrado em:', SPANS_DIR);
    process.exit(1);
  }
  
  console.log(`📦 Encontrados ${ndjsonFiles.length} arquivos NDJSON\n`);
  
  // Determine insertion method
  let insertFn;
  let client;
  
  if (process.env.API_GATEWAY_URL && process.env.API_KEY) {
    // Via API Gateway
    console.log('🌐 Usando API Gateway...');
    insertFn = (span) => insertSpanViaAPI(span, process.env.API_GATEWAY_URL, process.env.API_KEY);
  } else {
    // Direct database
    console.log('💾 Usando conexão direta ao banco...');
    client = await getClient();
    await client.connect();
    await client.query('SET app.user_id = $1; SET app.tenant_id = $2;', ['github:actions', 'system']);
    
    insertFn = (span) => insertSpanDirect(client, span);
  }
  
  const totalResults = { inserted: 0, skipped: 0, errors: [] };
  
  // Process each file
  for (const file of ndjsonFiles) {
    const filePath = path.join(SPANS_DIR, file);
    console.log(`📄 Processando ${file}...`);
    
    const results = await processNDJSONFile(filePath, insertFn);
    totalResults.inserted += results.inserted;
    totalResults.skipped += results.skipped;
    totalResults.errors.push(...results.errors);
    
    console.log(`   ✅ Inseridos: ${results.inserted}, Pulados: ${results.skipped}, Erros: ${results.errors.length}\n`);
  }
  
  if (client) {
    await client.end();
  }
  
  console.log('✅ Sincronização completa!');
  console.log(`   Total inseridos: ${totalResults.inserted}`);
  console.log(`   Total pulados: ${totalResults.skipped}`);
  console.log(`   Total erros: ${totalResults.errors.length}`);
  
  if (totalResults.errors.length > 0) {
    console.log('\n⚠️  Erros:');
    totalResults.errors.slice(0, 10).forEach(err => {
      console.log(`   - ${err.error}`);
    });
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };

