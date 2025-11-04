/**
 * Script para verificar se os kernels estão sendo persistidos corretamente no RDS
 * 
 * Usage:
 *   node scripts/verify-kernels-in-db.js
 * 
 * Environment variables:
 *   DB_SECRET_ARN - ARN do secret com credenciais do DB
 *   AWS_REGION - Região AWS (default: us-east-1)
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Try to load AWS SDK if available (optional)
let SecretsManager;
try {
  SecretsManager = require('@aws-sdk/client-secrets-manager').SecretsManager;
} catch (e) {
  // AWS SDK not available, will use env vars only
}

async function getClient() {
  // Try Secrets Manager first (if AWS SDK available and ARN provided)
  if (SecretsManager && process.env.DB_SECRET_ARN) {
    try {
      const secretsManager = new SecretsManager({ 
        region: process.env.AWS_REGION || 'us-east-1' 
      });
      const secret = await secretsManager.getSecretValue({ SecretId: process.env.DB_SECRET_ARN });
      const dbConfig = JSON.parse(secret.SecretString);
      
      return new Client({
        host: dbConfig.host || dbConfig.endpoint,
        database: dbConfig.dbname || dbConfig.database || 'loglineos',
        user: dbConfig.username || 'ledger_admin',
        password: dbConfig.password,
        port: dbConfig.port || 5432,
        ssl: { rejectUnauthorized: false }
      });
    } catch (e) {
      console.warn('⚠️  Erro ao obter secret, usando env vars:', e.message);
    }
  }
  
  // Fallback to environment variables
  return new Client({
    host: process.env.RDS_ENDPOINT || process.env.DB_HOST || 'loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com',
    port: process.env.RDS_PORT || process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'ledger_admin',
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'loglineos',
    ssl: { rejectUnauthorized: false }
  });
}

async function main() {
  console.log('🔍 Verificando kernels no banco de dados RDS...\n');
  
  try {
    // 1. Connect to database
    console.log('📝 Conectando ao banco de dados...');
    const client = await getClient();
    
    
    await client.connect();
    console.log('✅ Conectado ao banco de dados\n');
    
    // 2. Set RLS context
    await client.query('SET app.user_id = $1; SET app.tenant_id = $2;', ['system:verify', 'system']);
    
    // 3. Check table structure
    console.log('📊 Verificando estrutura da tabela...');
    const tableInfo = await client.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'ledger' 
        AND table_name = 'universal_registry'
      ORDER BY ordinal_position
    `);
    
    console.log(`   Tabela tem ${tableInfo.rows.length} colunas`);
    const requiredColumns = ['id', 'seq', 'entity_type', 'code', 'name', 'status'];
    const existingColumns = tableInfo.rows.map(r => r.column_name);
    const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
    
    if (missingColumns.length > 0) {
      console.log(`   ⚠️  Colunas faltando: ${missingColumns.join(', ')}`);
    } else {
      console.log('   ✅ Todas as colunas necessárias existem\n');
    }
    
    // 4. Count kernels
    console.log('📦 Contando kernels no banco...');
    const countResult = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT id) as unique_kernels,
        COUNT(*) FILTER (WHERE code IS NOT NULL AND code != '') as with_code,
        COUNT(*) FILTER (WHERE code IS NULL OR code = '') as without_code
      FROM ledger.visible_timeline
      WHERE entity_type = 'function'
    `);
    
    const stats = countResult.rows[0];
    console.log(`   Total de spans tipo 'function': ${stats.total}`);
    console.log(`   Kernels únicos (por ID): ${stats.unique_kernels}`);
    console.log(`   Com código: ${stats.with_code}`);
    console.log(`   Sem código: ${stats.without_code}\n`);
    
    // 5. List kernels
    console.log('📋 Listando kernels encontrados...');
    const kernelsResult = await client.query(`
      SELECT 
        id,
        seq,
        name,
        entity_type,
        status,
        visibility,
        LENGTH(code) as code_length,
        CASE 
          WHEN code IS NULL OR code = '' THEN '❌ SEM CÓDIGO'
          ELSE '✅ COM CÓDIGO'
        END as code_status,
        at as created_at
      FROM ledger.visible_timeline
      WHERE entity_type = 'function'
      ORDER BY at DESC
    `);
    
    console.log(`\n   Encontrados ${kernelsResult.rows.length} kernels:\n`);
    kernelsResult.rows.forEach((k, i) => {
      console.log(`   ${i + 1}. ${k.name || '(sem nome)'}`);
      console.log(`      ID: ${k.id}`);
      console.log(`      Seq: ${k.seq}`);
      console.log(`      Status: ${k.status}`);
      console.log(`      ${k.code_status} (${k.code_length || 0} chars)`);
      console.log(`      Criado: ${new Date(k.created_at).toISOString()}\n`);
    });
    
    // 6. Compare with ROW files
    console.log('🔍 Comparando com arquivos ROW/kernels/...');
    const kernelsDir = path.join(__dirname, '../ROW/kernels');
    const kernelFiles = fs.readdirSync(kernelsDir).filter(f => f.endsWith('.ndjson'));
    
    console.log(`   Arquivos NDJSON encontrados: ${kernelFiles.length}`);
    
    const fileKernels = new Map();
    for (const file of kernelFiles) {
      const filePath = path.join(kernelsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        try {
          const kernel = JSON.parse(line);
          if (kernel.entity_type === 'function' || kernel.id) {
            fileKernels.set(kernel.id, {
              id: kernel.id,
              name: kernel.name,
              file: file,
              hasCode: !!(kernel.code && kernel.code.length > 0)
            });
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    console.log(`   Kernels nos arquivos NDJSON: ${fileKernels.size}`);
    
    // Find missing kernels
    const dbKernelIds = new Set(kernelsResult.rows.map(k => k.id));
    const missingInDb = Array.from(fileKernels.keys()).filter(id => !dbKernelIds.has(id));
    const missingInFiles = Array.from(dbKernelIds).filter(id => !fileKernels.has(id));
    
    if (missingInDb.length > 0) {
      console.log(`\n   ⚠️  Kernels nos arquivos mas NÃO no banco: ${missingInDb.length}`);
      missingInDb.forEach(id => {
        const k = fileKernels.get(id);
        console.log(`      - ${k.name} (${id}) - arquivo: ${k.file}`);
      });
    }
    
    if (missingInFiles.length > 0) {
      console.log(`\n   ℹ️  Kernels no banco mas NÃO nos arquivos: ${missingInFiles.length}`);
      missingInFiles.forEach(id => {
        const k = kernelsResult.rows.find(r => r.id === id);
        console.log(`      - ${k?.name || '(sem nome)'} (${id})`);
      });
    }
    
    if (missingInDb.length === 0 && missingInFiles.length === 0) {
      console.log('\n   ✅ Todos os kernels estão sincronizados!');
    }
    
    // 7. Check code content quality
    console.log('\n📝 Verificando qualidade do código armazenado...');
    const codeQuality = await client.query(`
      SELECT 
        id,
        name,
        LENGTH(code) as code_length,
        SUBSTRING(code, 1, 100) as code_preview
      FROM ledger.visible_timeline
      WHERE entity_type = 'function'
        AND (code IS NULL OR code = '' OR LENGTH(code) < 50)
      ORDER BY name
    `);
    
    if (codeQuality.rows.length > 0) {
      console.log(`   ⚠️  ${codeQuality.rows.length} kernels com código ausente ou muito curto:`);
      codeQuality.rows.forEach(k => {
        console.log(`      - ${k.name} (${k.id}): ${k.code_length || 0} chars`);
        if (k.code_preview) {
          console.log(`        Preview: ${k.code_preview}...`);
        }
      });
    } else {
      console.log('   ✅ Todos os kernels têm código válido');
    }
    
    // 8. Check manifest
    console.log('\n📋 Verificando manifest...');
    const manifestResult = await client.query(`
      SELECT 
        id,
        seq,
        metadata->'allowed_boot_ids' as allowed_boot_ids,
        at
      FROM ledger.visible_timeline
      WHERE entity_type = 'manifest'
      ORDER BY at DESC, seq DESC
      LIMIT 1
    `);
    
    if (manifestResult.rows.length > 0) {
      const manifest = manifestResult.rows[0];
      const allowedIds = manifest.allowed_boot_ids || [];
      console.log(`   Manifest encontrado (seq ${manifest.seq})`);
      console.log(`   Allowed boot IDs: ${allowedIds.length}`);
      
      // Check if all kernels are in manifest
      const kernelIdsInManifest = new Set(allowedIds);
      const kernelsNotInManifest = kernelsResult.rows.filter(k => !kernelIdsInManifest.has(k.id));
      
      if (kernelsNotInManifest.length > 0) {
        console.log(`\n   ⚠️  ${kernelsNotInManifest.length} kernels NÃO estão no manifest:`);
        kernelsNotInManifest.forEach(k => {
          console.log(`      - ${k.name} (${k.id})`);
        });
      } else {
        console.log('   ✅ Todos os kernels estão no manifest');
      }
    } else {
      console.log('   ⚠️  Nenhum manifest encontrado!');
    }
    
    await client.end();
    
    console.log('\n✅ Verificação completa!\n');
    
  } catch (error) {
    console.error('❌ Erro:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

