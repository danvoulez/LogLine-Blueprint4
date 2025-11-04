const { getClient, setRlsContext } = require('./db');

async function query() {
  const client = await getClient();
  await setRlsContext(client, 'system:query', 'system');
  
  try {
    console.log('📊 LogLineOS Ledger Status\n');
    console.log('='.repeat(60));
    
    // Total spans
    const total = await client.query('SELECT count(*) FROM ledger.universal_registry');
    console.log(`\n📦 Total spans: ${total.rows[0].count}\n`);
    
    // By entity type
    const byType = await client.query(`
      SELECT entity_type, count(*) as count, 
             array_agg(DISTINCT status) as statuses
      FROM ledger.universal_registry 
      GROUP BY entity_type 
      ORDER BY count DESC
    `);
    
    console.log('📋 By entity_type:');
    for (const row of byType.rows) {
      console.log(`  ${row.entity_type.padEnd(20)} ${row.count.toString().padStart(3)} spans  [${row.statuses.join(', ')}]`);
    }
    
    // Kernels
    const kernels = await client.query(`
      SELECT id, name, status, language, runtime, visibility
      FROM ledger.universal_registry 
      WHERE entity_type = 'function'
      ORDER BY name
    `);
    
    if (kernels.rows.length > 0) {
      console.log(`\n🔧 Kernels (${kernels.rows.length}):`);
      for (const k of kernels.rows) {
        console.log(`  ${k.name.padEnd(30)} [${k.status}] ${k.language}/${k.runtime}`);
        console.log(`    └─ ${k.id}`);
      }
    }
    
    // Manifests
    const manifests = await client.query(`
      SELECT id, name, metadata->>'allowed_boot_ids' as boot_ids
      FROM ledger.universal_registry 
      WHERE entity_type = 'manifest'
    `);
    
    if (manifests.rows.length > 0) {
      console.log(`\n📋 Manifests (${manifests.rows.length}):`);
      for (const m of manifests.rows) {
        const bootIds = JSON.parse(m.boot_ids || '[]');
        console.log(`  ${m.name}`);
        console.log(`    └─ Allowed boot IDs: ${bootIds.length}`);
      }
    }
    
    // Executions
    const executions = await client.query(`
      SELECT id, parent_id, status, duration_ms, at
      FROM ledger.universal_registry 
      WHERE entity_type = 'execution'
      ORDER BY at DESC
      LIMIT 5
    `);
    
    if (executions.rows.length > 0) {
      console.log(`\n⚡ Recent executions (last 5):`);
      for (const e of executions.rows) {
        console.log(`  ${e.at.toISOString()} [${e.status}] ${e.duration_ms}ms`);
        console.log(`    └─ execution: ${e.id}`);
        console.log(`    └─ parent:    ${e.parent_id}`);
      }
    }
    
    // Boot events
    const boots = await client.query(`
      SELECT id, related_to, at
      FROM ledger.universal_registry 
      WHERE entity_type = 'boot_event'
      ORDER BY at DESC
      LIMIT 5
    `);
    
    if (boots.rows.length > 0) {
      console.log(`\n🚀 Recent boot events (last 5):`);
      for (const b of boots.rows) {
        console.log(`  ${b.at.toISOString()}`);
        console.log(`    └─ boot: ${b.id}`);
        if (b.related_to && b.related_to.length > 0) {
          console.log(`    └─ functions: ${b.related_to.join(', ')}`);
        }
      }
    }
    
    // Providers
    const providers = await client.query(`
      SELECT id, name, metadata
      FROM ledger.universal_registry 
      WHERE entity_type = 'provider'
      ORDER BY name
    `);
    
    if (providers.rows.length > 0) {
      console.log(`\n🌐 Providers (${providers.rows.length}):`);
      for (const p of providers.rows) {
        const meta = p.metadata || {};
        console.log(`  ${p.name.padEnd(30)} ${meta.type || 'unknown'} [${meta.default_model || 'no-model'}]`);
        console.log(`    └─ ${p.id}`);
      }
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('❌ Query error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Lambda handler
exports.handler = async (event, context) => {
  try {
    await query();
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: 'Query completed' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// CLI mode
if (require.main === module) {
  query().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
