#!/usr/bin/env node
/**
 * 🔍 Ledger X-Ray - Análise Completa do Ledger na AWS
 * 
 * Verifica:
 * - Estrutura do banco (tabelas, colunas, índices)
 * - Kernels persistidos
 * - Spans por tipo
 * - Políticas RLS
 * - Estatísticas gerais
 * - Integridade dos dados
 */

const { Client } = require('pg');
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
const fs = require('fs');
const path = require('path');

// Cores para output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

async function getDbClient() {
  const secrets = new SecretsManager({ 
    region: process.env.AWS_REGION || 'us-east-1' 
  });
  
  let dbSecret;
  try {
    dbSecret = await secrets.getSecretValue({ 
      SecretId: process.env.DB_SECRET_ARN 
    });
  } catch (err) {
    if (err.name === 'ResourceNotFoundException' || !process.env.DB_SECRET_ARN) {
      // Fallback para variáveis de ambiente
      log('⚠️  Secrets Manager não configurado, usando variáveis de ambiente', 'yellow');
      return new Client({
        host: process.env.DB_HOST,
        database: process.env.DB_NAME || 'loglineos',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT || 5432,
        ssl: { rejectUnauthorized: false }
      });
    }
    throw err;
  }
  
  const dbCfg = JSON.parse(dbSecret.SecretString);
  return new Client({
    host: dbCfg.host,
    database: dbCfg.database,
    user: dbCfg.username,
    password: dbCfg.password,
    port: dbCfg.port || 5432,
    ssl: { rejectUnauthorized: false }
  });
}

async function checkSchema(client) {
  logSection('📊 1. ESTRUTURA DO SCHEMA');
  
  // Verificar se schema existe
  const { rows: schemas } = await client.query(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name = 'ledger'
  `);
  
  if (schemas.length === 0) {
    log('❌ Schema "ledger" não existe!', 'red');
    return false;
  }
  log('✅ Schema "ledger" existe', 'green');
  
  // Verificar tabela principal
  const { rows: tables } = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'ledger' 
      AND table_name = 'universal_registry'
  `);
  
  if (tables.length === 0) {
    log('❌ Tabela "ledger.universal_registry" não existe!', 'red');
    return false;
  }
  log('✅ Tabela "ledger.universal_registry" existe', 'green');
  
  // Verificar colunas principais
  const { rows: columns } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'ledger' 
      AND table_name = 'universal_registry'
    ORDER BY ordinal_position
  `);
  
  log('\n📋 Colunas da tabela:');
  const criticalColumns = [
    'id', 'seq', 'entity_type', 'who', 'did', 'this', 'at', 
    'status', 'metadata', 'owner_id', 'tenant_id', 'visibility',
    'payload_hash', 'sig_alg', 'sig_key_id', 'signature'
  ];
  
  columns.forEach(col => {
    const isCritical = criticalColumns.includes(col.column_name);
    const marker = isCritical ? '🔑' : '  ';
    log(`${marker} ${col.column_name.padEnd(20)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'YES' ? '(nullable)' : '(NOT NULL)'}`, 
        isCritical ? 'cyan' : 'reset');
  });
  
  // Verificar índices
  const { rows: indexes } = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'ledger' 
      AND tablename = 'universal_registry'
    ORDER BY indexname
  `);
  
  log('\n📇 Índices:');
  indexes.forEach(idx => {
    log(`   ${idx.indexname}`, 'cyan');
  });
  
  return true;
}

async function checkRLS(client) {
  logSection('🔒 2. POLÍTICAS RLS (Row-Level Security)');
  
  // Verificar se RLS está habilitado
  const { rows: rlsStatus } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'ledger' 
      AND tablename = 'universal_registry'
  `);
  
  if (rlsStatus.length > 0) {
    const enabled = rlsStatus[0].rowsecurity;
    log(`RLS Status: ${enabled ? '✅ HABILITADO' : '❌ DESABILITADO'}`, 
        enabled ? 'green' : 'red');
    
    if (enabled) {
      // Listar políticas
      const { rows: policies } = await client.query(`
        SELECT policyname, permissive, roles, cmd, qual
        FROM pg_policies
        WHERE schemaname = 'ledger' 
          AND tablename = 'universal_registry'
      `);
      
      if (policies.length > 0) {
        log('\n📜 Políticas RLS:');
        policies.forEach(policy => {
          log(`   ${policy.policyname} (${policy.cmd})`, 'cyan');
        });
      } else {
        log('⚠️  Nenhuma política RLS encontrada', 'yellow');
      }
    }
  }
}

async function checkKernels(client) {
  logSection('⚙️  3. KERNELS PERSISTIDOS');
  
  // Contar kernels
  const { rows: kernelCount } = await client.query(`
    SELECT COUNT(DISTINCT id) as total
    FROM ledger.visible_timeline
    WHERE entity_type = 'function'
      AND status = 'active'
  `);
  
  log(`Total de kernels ativos: ${kernelCount[0].total}`, 'green');
  
  // Listar kernels
  const { rows: kernels } = await client.query(`
    SELECT id, name, seq, at, status,
           (metadata->>'description')::text as description
    FROM ledger.visible_timeline
    WHERE entity_type = 'function'
      AND status = 'active'
    ORDER BY at ASC
  `);
  
  if (kernels.length > 0) {
    log('\n📦 Kernels:');
    kernels.forEach(k => {
      const name = k.name || 'unnamed';
      const desc = k.description ? ` - ${k.description.substring(0, 50)}...` : '';
      log(`   ${k.id}`, 'cyan');
      log(`      Nome: ${name} (seq=${k.seq}, status=${k.status})${desc}`, 'reset');
    });
  }
  
  // Verificar manifest
  const { rows: manifest } = await client.query(`
    SELECT metadata
    FROM ledger.visible_timeline
    WHERE entity_type = 'manifest'
      AND status = 'active'
    ORDER BY seq DESC
    LIMIT 1
  `);
  
  if (manifest.length > 0) {
    const allowedIds = manifest[0].metadata?.allowed_boot_ids || [];
    log(`\n📋 Manifest: ${allowedIds.length} kernels permitidos`, 'green');
    log(`   IDs permitidos: ${allowedIds.slice(0, 5).join(', ')}${allowedIds.length > 5 ? '...' : ''}`, 'cyan');
  }
}

async function checkSpans(client) {
  logSection('📊 4. ESTATÍSTICAS DE SPANS');
  
  // Contagem por tipo
  const { rows: spanTypes } = await client.query(`
    SELECT 
      entity_type,
      COUNT(*) as total,
      COUNT(DISTINCT id) as unique_ids,
      MIN(at) as first_span,
      MAX(at) as last_span
    FROM ledger.visible_timeline
    GROUP BY entity_type
    ORDER BY total DESC
    LIMIT 20
  `);
  
  log('📈 Top 20 tipos de spans:');
  spanTypes.forEach(row => {
    log(`   ${row.entity_type.padEnd(30)} ${String(row.total).padStart(8)} spans (${row.unique_ids} únicos)`, 'cyan');
  });
  
  // Total geral
  const { rows: total } = await client.query(`
    SELECT COUNT(*) as total
    FROM ledger.visible_timeline
  `);
  
  log(`\n📊 Total geral: ${total[0].total} spans`, 'green');
  
  // Spans por status
  const { rows: byStatus } = await client.query(`
    SELECT status, COUNT(*) as count
    FROM ledger.visible_timeline
    GROUP BY status
    ORDER BY count DESC
  `);
  
  log('\n📊 Spans por status:');
  byStatus.forEach(row => {
    log(`   ${row.status.padEnd(20)} ${String(row.count).padStart(8)}`, 'cyan');
  });
  
  // Spans por tenant
  const { rows: byTenant } = await client.query(`
    SELECT tenant_id, COUNT(*) as count
    FROM ledger.visible_timeline
    WHERE tenant_id IS NOT NULL
    GROUP BY tenant_id
    ORDER BY count DESC
    LIMIT 10
  `);
  
  if (byTenant.length > 0) {
    log('\n📊 Top 10 tenants:');
    byTenant.forEach(row => {
      log(`   ${(row.tenant_id || 'NULL').padEnd(20)} ${String(row.count).padStart(8)} spans`, 'cyan');
    });
  }
}

async function checkSignatures(client) {
  logSection('🔐 5. ASSINATURAS (Signatures)');
  
  // Verificar spans assinados
  const { rows: signed } = await client.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN signature IS NOT NULL THEN 1 END) as signed,
      COUNT(CASE WHEN payload_hash IS NOT NULL THEN 1 END) as has_hash,
      COUNT(CASE WHEN sig_key_id IS NOT NULL THEN 1 END) as has_key_id
    FROM ledger.visible_timeline
    WHERE entity_type IN ('function', 'api_token_issued', 'wallet_opened', 'api_key_request')
  `);
  
  const total = signed[0].total;
  const signedCount = signed[0].signed;
  const hasHash = signed[0].has_hash;
  const hasKeyId = signed[0].has_key_id;
  
  log(`Total de spans verificáveis: ${total}`);
  log(`Assinados: ${signedCount} (${((signedCount/total)*100).toFixed(1)}%)`, 
      signedCount > 0 ? 'green' : 'yellow');
  log(`Com hash: ${hasHash} (${((hasHash/total)*100).toFixed(1)}%)`, 
      hasHash > 0 ? 'green' : 'yellow');
  log(`Com key_id: ${hasKeyId} (${((hasKeyId/total)*100).toFixed(1)}%)`, 
      hasKeyId > 0 ? 'green' : 'yellow');
}

async function checkIntegrity(client) {
  logSection('🔍 6. INTEGRIDADE DOS DADOS');
  
  // Verificar sequências
  const { rows: seqIssues } = await client.query(`
    SELECT id, COUNT(*) as count, 
           MIN(seq) as min_seq, MAX(seq) as max_seq
    FROM ledger.visible_timeline
    GROUP BY id
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 10
  `);
  
  if (seqIssues.length > 0) {
    log(`✅ Versionamento: ${seqIssues.length} spans têm versões (seq > 0)`, 'green');
    seqIssues.forEach(row => {
      log(`   ${row.id}: ${row.count} versões (seq ${row.min_seq} → ${row.max_seq})`, 'cyan');
    });
  } else {
    log('⚠️  Nenhum span versionado encontrado', 'yellow');
  }
  
  // Verificar spans órfãos (sem owner_id)
  const { rows: orphans } = await client.query(`
    SELECT COUNT(*) as count
    FROM ledger.visible_timeline
    WHERE owner_id IS NULL
  `);
  
  if (orphans[0].count > 0) {
    log(`⚠️  ${orphans[0].count} spans sem owner_id`, 'yellow');
  } else {
    log('✅ Todos os spans têm owner_id', 'green');
  }
  
  // Verificar metadata válido
  const { rows: invalidMeta } = await client.query(`
    SELECT COUNT(*) as count
    FROM ledger.visible_timeline
    WHERE metadata IS NULL OR metadata::text = '{}'
  `);
  
  if (invalidMeta[0].count > 0) {
    log(`⚠️  ${invalidMeta[0].count} spans com metadata vazio`, 'yellow');
  } else {
    log('✅ Metadata válido em todos os spans', 'green');
  }
}

async function checkRecentActivity(client) {
  logSection('⏰ 7. ATIVIDADE RECENTE');
  
  // Últimas 24 horas
  const { rows: recent24h } = await client.query(`
    SELECT COUNT(*) as count
    FROM ledger.visible_timeline
    WHERE at > NOW() - INTERVAL '24 hours'
  `);
  
  log(`Últimas 24h: ${recent24h[0].count} spans criados`, 'green');
  
  // Última semana
  const { rows: recentWeek } = await client.query(`
    SELECT COUNT(*) as count
    FROM ledger.visible_timeline
    WHERE at > NOW() - INTERVAL '7 days'
  `);
  
  log(`Última semana: ${recentWeek[0].count} spans criados`, 'green');
  
  // Últimos spans criados
  const { rows: latest } = await client.query(`
    SELECT id, entity_type, who, did, at
    FROM ledger.visible_timeline
    ORDER BY at DESC
    LIMIT 10
  `);
  
  if (latest.length > 0) {
    log('\n📝 Últimos 10 spans:');
    latest.forEach(row => {
      const date = new Date(row.at).toLocaleString('pt-BR');
      log(`   [${date}] ${row.entity_type} - ${row.who} ${row.did}`, 'cyan');
    });
  }
}

async function checkPerformance(client) {
  logSection('⚡ 8. PERFORMANCE & TAMANHO');
  
  // Tamanho da tabela
  const { rows: tableSize } = await client.query(`
    SELECT 
      pg_size_pretty(pg_total_relation_size('ledger.universal_registry')) as total_size,
      pg_size_pretty(pg_relation_size('ledger.universal_registry')) as table_size,
      pg_size_pretty(pg_indexes_size('ledger.universal_registry')) as indexes_size
  `);
  
  if (tableSize.length > 0) {
    log(`Tamanho total: ${tableSize[0].total_size}`, 'green');
    log(`Tabela: ${tableSize[0].table_size}`, 'cyan');
    log(`Índices: ${tableSize[0].indexes_size}`, 'cyan');
  }
  
  // Contagem aproximada (mais rápido)
  const { rows: approx } = await client.query(`
    SELECT reltuples::bigint as estimate
    FROM pg_class
    WHERE relname = 'universal_registry'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'ledger')
  `);
  
  if (approx.length > 0) {
    log(`Estimativa de linhas: ${approx[0].estimate?.toLocaleString() || 'N/A'}`, 'cyan');
  }
}

async function main() {
  log('\n🔍 LEDGER X-RAY - Análise Completa do Ledger na AWS\n', 'bright');
  
  const client = await getDbClient();
  
  try {
    await client.connect();
    log('✅ Conectado ao banco de dados\n', 'green');
    
    // Executar todas as verificações
    await checkSchema(client);
    await checkRLS(client);
    await checkKernels(client);
    await checkSpans(client);
    await checkSignatures(client);
    await checkIntegrity(client);
    await checkRecentActivity(client);
    await checkPerformance(client);
    
    logSection('✅ ANÁLISE COMPLETA');
    log('Todos os checks foram executados com sucesso!', 'green');
    
  } catch (error) {
    log(`\n❌ Erro: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Executar
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };

