/**
 * 🔍 Ledger X-Ray Lambda
 * 
 * Executa análise completa do ledger e retorna resultados em JSON
 * 
 * Environment variables:
 *   DB_SECRET_ARN - ARN do secret com credenciais do DB
 *   AWS_REGION - Região AWS
 */

// Adaptar o script para retornar JSON estruturado
const { Client } = require('pg');
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');

async function getDbClient() {
  const secrets = new SecretsManager({ 
    region: process.env.AWS_REGION || 'us-east-1' 
  });
  
  const dbSecret = await secrets.getSecretValue({ 
    SecretId: process.env.DB_SECRET_ARN 
  });
  
  const dbCfg = JSON.parse(dbSecret.SecretString);
  return new Client({
    host: dbCfg.host,
    database: dbCfg.database || dbCfg.dbname,
    user: dbCfg.username,
    password: dbCfg.password,
    port: dbCfg.port || 5432,
    ssl: { rejectUnauthorized: false }
  });
}

async function runXRay() {
  const client = await getDbClient();
  await client.connect();
  
  const results = {
    timestamp: new Date().toISOString(),
    schema: {},
    kernels: [],
    spans: {},
    signatures: {},
    integrity: {},
    activity: {},
    performance: {}
  };
  
  try {
    // 1. Schema
    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'ledger' AND table_name = 'universal_registry'
      ORDER BY ordinal_position
    `);
    results.schema.columns = columns;
    
    const { rows: indexes } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'ledger' AND tablename = 'universal_registry'
    `);
    results.schema.indexes = indexes.map(i => i.indexname);
    
    // 2. Kernels
    const { rows: kernels } = await client.query(`
      SELECT id, name, seq, at, status, metadata
      FROM ledger.visible_timeline
      WHERE entity_type = 'function' AND status = 'active'
      ORDER BY at ASC
    `);
    results.kernels = kernels;
    
    // 3. Spans
    const { rows: spanTypes } = await client.query(`
      SELECT entity_type, COUNT(*) as total, COUNT(DISTINCT id) as unique_ids
      FROM ledger.visible_timeline
      GROUP BY entity_type
      ORDER BY total DESC
    `);
    results.spans.by_type = spanTypes;
    
    const { rows: total } = await client.query(`
      SELECT COUNT(*) as total FROM ledger.visible_timeline
    `);
    results.spans.total = parseInt(total[0].total);
    
    const { rows: byStatus } = await client.query(`
      SELECT status, COUNT(*) as count
      FROM ledger.visible_timeline
      GROUP BY status
      ORDER BY count DESC
    `);
    results.spans.by_status = byStatus;
    
    // 4. Signatures
    const { rows: signed } = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN signature IS NOT NULL THEN 1 END) as signed,
        COUNT(CASE WHEN payload_hash IS NOT NULL THEN 1 END) as has_hash
      FROM ledger.visible_timeline
      WHERE entity_type IN ('function', 'api_token_issued', 'wallet_opened')
    `);
    results.signatures = signed[0];
    
    // 5. Activity
    const { rows: recent24h } = await client.query(`
      SELECT COUNT(*) as count
      FROM ledger.visible_timeline
      WHERE at > NOW() - INTERVAL '24 hours'
    `);
    results.activity.last_24h = parseInt(recent24h[0].count);
    
    const { rows: latest } = await client.query(`
      SELECT id, entity_type, who, did, at
      FROM ledger.visible_timeline
      ORDER BY at DESC
      LIMIT 10
    `);
    results.activity.latest = latest;
    
    // 6. Performance
    const { rows: tableSize } = await client.query(`
      SELECT 
        pg_size_pretty(pg_total_relation_size('ledger.universal_registry')) as total_size,
        pg_size_pretty(pg_relation_size('ledger.universal_registry')) as table_size
    `);
    results.performance = tableSize[0];
    
  } finally {
    await client.end();
  }
  
  return results;
}

exports.handler = async (event) => {
  console.log('🔍 Executando Ledger X-Ray...');
  
  try {
    const results = await runXRay();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: true,
        ...results
      }, null, 2)
    };
    
  } catch (error) {
    console.error('❌ Erro no X-Ray:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: error.message,
        stack: error.stack
      }, null, 2)
    };
  }
};

