const fs = require('fs');
const path = require('path');
const { getClient, setRlsContext, insertSpan } = require('./db');
const { signSpan } = require('./crypto');

async function seed() {
  const client = await getClient();
  await setRlsContext(client, 'system:seed', 'system');
  
  console.log('✅ Connected to database\n');
  
  try {
    // Read all kernel files (hardened versions take precedence)
    const kernelFiles = ['01-kernels-hardened.ndjson', '01-kernels.ndjson', '06-prompt-helper.ndjson', '07-memory-kernel.ndjson', '08-enrollment-kernel.ndjson', '09-prompt-build.ndjson', '10-prompt-runner.ndjson', '11-prompt-eval.ndjson', '12-prompt-bandit.ndjson', '13-memory-upsert.ndjson', '14-memory-search.ndjson'];
    const kernelMap = new Map(); // Deduplicate by ID, last wins (hardened first)
    
    for (const file of kernelFiles) {
      const kernelsPath = path.join(__dirname, `ROW/kernels/${file}`);
      if (fs.existsSync(kernelsPath)) {
        const kernelsData = fs.readFileSync(kernelsPath, 'utf8');
        const fileKernels = kernelsData.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
        for (const kernel of fileKernels) {
          kernelMap.set(kernel.id, kernel); // Overwrite if exists (hardened takes precedence)
        }
      }
    }
    
    const kernels = Array.from(kernelMap.values());
    console.log(`📦 Seeding ${kernels.length} kernels (hardened versions preferred)...\n`);
    
    for (const kernel of kernels) {
      const span = {
        id: kernel.id,
        seq: kernel.seq || 0,
        entity_type: kernel.entity_type || 'function',
        who: kernel.who || 'system:seed',
        did: kernel.did || 'defined',
        this: kernel.this || 'function',
        at: kernel.at || new Date().toISOString(),
        name: kernel.name,
        code: kernel.code,
        language: kernel.language,
        runtime: kernel.runtime,
        status: kernel.status || 'active',
        visibility: kernel.visibility || 'public',
        owner_id: kernel.owner_id || 'system',
        tenant_id: kernel.tenant_id || 'system',
        description: kernel.description
      };
      
      // Sign span (without private key for now - just hash)
      await signSpan(span);
      
      try {
        await insertSpan(client, span);
        console.log(`  ✓ ${span.name} (${span.id}) - inserted`);
      } catch (err) {
        if (err.code === '23505') {
          // Update existing span with new seq
          const { rows: seqRows } = await client.query(
            'SELECT COALESCE(MAX(seq), -1) as max_seq FROM ledger.universal_registry WHERE id = $1',
            [span.id]
          );
          span.seq = seqRows[0].max_seq + 1;
          await insertSpan(client, span);
          console.log(`  ↻ ${span.name} (${span.id}) - updated to seq ${span.seq}`);
        } else {
          throw err;
        }
      }
    }
    
    // Read manifest
    const manifestPath = path.join(__dirname, 'ROW/manifest/03-manifest.ndjson');
    if (fs.existsSync(manifestPath)) {
      const manifestData = fs.readFileSync(manifestPath, 'utf8');
      const manifests = manifestData.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
      
      console.log(`\n📋 Seeding ${manifests.length} manifests...\n`);
      
      for (const manifest of manifests) {
        const span = {
          id: manifest.id,
          seq: manifest.seq || 0,
          entity_type: 'manifest',
          who: 'system:seed',
          did: 'defined',
          this: 'manifest',
          at: manifest.at || new Date().toISOString(),
          name: manifest.name,
          status: 'active',
          visibility: 'public',
          owner_id: 'system',
          tenant_id: 'system',
          metadata: manifest.metadata
        };
        
        await signSpan(span);
        
        try {
          await insertSpan(client, span);
          console.log(`  ✓ ${span.name} (${span.id}) - inserted`);
        } catch (err) {
          if (err.code === '23505') {
            // Update existing manifest with new seq
            const { rows: seqRows } = await client.query(
              'SELECT COALESCE(MAX(seq), -1) as max_seq FROM ledger.universal_registry WHERE id = $1',
              [span.id]
            );
            span.seq = seqRows[0].max_seq + 1;
            await insertSpan(client, span);
            console.log(`  ↻ ${span.name} (${span.id}) - updated to seq ${span.seq}`);
          } else {
            throw err;
          }
        }
      }
    }
    
    // Read policies
    const policiesPath = path.join(__dirname, 'ROW/policies/02-policies.ndjson');
    if (fs.existsSync(policiesPath)) {
      const policiesData = fs.readFileSync(policiesPath, 'utf8');
      const policies = policiesData.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
      
      console.log(`\n🛡️  Seeding ${policies.length} policies...\n`);
      
      for (const policy of policies) {
        const span = {
          id: policy.id,
          seq: policy.seq || 0,
          entity_type: 'policy',
          who: 'system:seed',
          did: 'defined',
          this: 'policy',
          at: policy.at || new Date().toISOString(),
          name: policy.name,
          description: policy.description,
          status: policy.status || 'active',
          visibility: policy.visibility || 'public',
          owner_id: policy.owner_id || 'system',
          tenant_id: policy.tenant_id || 'system',
          metadata: policy.metadata
        };
        
        await signSpan(span);
        
        try {
          await insertSpan(client, span);
          console.log(`  ✓ ${span.name} (${span.id}) - inserted`);
        } catch (err) {
          if (err.code === '23505') {
            const { rows: seqRows } = await client.query(
              'SELECT COALESCE(MAX(seq), -1) as max_seq FROM ledger.universal_registry WHERE id = $1',
              [span.id]
            );
            span.seq = seqRows[0].max_seq + 1;
            await insertSpan(client, span);
            console.log(`  ↻ ${span.name} (${span.id}) - updated to seq ${span.seq}`);
          } else {
            throw err;
          }
        }
      }
    }
    
    // Read providers
    const providersPath = path.join(__dirname, 'ROW/providers/04-providers.ndjson');
    if (fs.existsSync(providersPath)) {
      const providersData = fs.readFileSync(providersPath, 'utf8');
      const providers = providersData.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
      
      console.log(`\n🌐 Seeding ${providers.length} providers...\n`);
      
      for (const provider of providers) {
        const span = {
          id: provider.id,
          seq: provider.seq || 0,
          entity_type: 'provider',
          who: 'system:seed',
          did: 'defined',
          this: 'provider',
          at: provider.at || new Date().toISOString(),
          name: provider.name,
          description: provider.description,
          status: provider.status || 'active',
          visibility: provider.visibility || 'public',
          owner_id: provider.owner_id || 'system',
          tenant_id: provider.tenant_id || 'system',
          metadata: provider.metadata
        };
        
        await signSpan(span);
        
        try {
          await insertSpan(client, span);
          console.log(`  ✓ ${span.name} (${span.id}) - inserted`);
        } catch (err) {
          if (err.code === '23505') {
            const { rows: seqRows } = await client.query(
              'SELECT COALESCE(MAX(seq), -1) as max_seq FROM ledger.universal_registry WHERE id = $1',
              [span.id]
            );
            span.seq = seqRows[0].max_seq + 1;
            await insertSpan(client, span);
            console.log(`  ↻ ${span.name} (${span.id}) - updated to seq ${span.seq}`);
          } else {
            throw err;
          }
        }
      }
    }
    
    // Read prompts
    const promptsPath = path.join(__dirname, 'ROW/prompts/05-prompts.ndjson');
    if (fs.existsSync(promptsPath)) {
      const promptsData = fs.readFileSync(promptsPath, 'utf8');
      const prompts = promptsData.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
      
      console.log(`\n💬 Seeding ${prompts.length} prompts...\n`);
      
      for (const prompt of prompts) {
        const span = {
          id: prompt.id,
          seq: prompt.seq || 0,
          entity_type: 'prompt',
          who: 'system:seed',
          did: 'defined',
          this: 'prompt',
          at: prompt.at || new Date().toISOString(),
          name: prompt.name,
          description: prompt.description,
          status: prompt.status || 'active',
          visibility: prompt.visibility || 'public',
          owner_id: prompt.owner_id || 'system',
          tenant_id: prompt.tenant_id || 'system',
          metadata: prompt.metadata
        };
        
        await signSpan(span);
        
        try {
          await insertSpan(client, span);
          console.log(`  ✓ ${span.name} (${span.id}) - inserted`);
        } catch (err) {
          if (err.code === '23505') {
            const { rows: seqRows } = await client.query(
              'SELECT COALESCE(MAX(seq), -1) as max_seq FROM ledger.universal_registry WHERE id = $1',
              [span.id]
            );
            span.seq = seqRows[0].max_seq + 1;
            await insertSpan(client, span);
            console.log(`  ↻ ${span.name} (${span.id}) - updated to seq ${span.seq}`);
          } else {
            throw err;
          }
        }
      }
    }
    
    // Read prompt blocks, variants, and evals
    const promptSeedFiles = ['09-prompt-blocks.ndjson', '10-prompt-variants.ndjson', '11-prompt-evals.ndjson'];
    for (const file of promptSeedFiles) {
      const filePath = path.join(__dirname, `ROW/prompts/${file}`);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        const items = data.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
        
        const entityTypeMap = {
          '09-prompt-blocks.ndjson': 'prompt_block',
          '10-prompt-variants.ndjson': 'prompt_variant',
          '11-prompt-evals.ndjson': 'prompt_eval'
        };
        const entityType = entityTypeMap[file] || 'prompt_block';
        
        console.log(`\n📝 Seeding ${items.length} ${entityType} from ${file}...\n`);
        
        for (const item of items) {
          const span = {
            id: item.id,
            seq: item.seq || 0,
            entity_type: entityType,
            who: item.who || 'system:seed',
            did: item.did || 'defined',
            this: item.this || entityType,
            at: item.at || new Date().toISOString(),
            name: item.name,
            description: item.description,
            status: item.status || 'active',
            visibility: item.visibility || 'public',
            owner_id: item.owner_id || 'system',
            tenant_id: item.tenant_id || 'system',
            metadata: item.metadata,
            content: item.content,
            input: item.input
          };
          
          await signSpan(span);
          
          try {
            await insertSpan(client, span);
            console.log(`  ✓ ${span.name || entityType} (${span.id}) - inserted`);
          } catch (err) {
            if (err.code === '23505') {
              const { rows: seqRows } = await client.query(
                'SELECT COALESCE(MAX(seq), -1) as max_seq FROM ledger.universal_registry WHERE id = $1',
                [span.id]
              );
              span.seq = seqRows[0].max_seq + 1;
              await insertSpan(client, span);
              console.log(`  ↻ ${span.name || entityType} (${span.id}) - updated to seq ${span.seq}`);
            } else {
              throw err;
            }
          }
        }
      }
    }
    
    // Count results
    const result = await client.query('SELECT count(*) FROM ledger.universal_registry');
    console.log(`\n🎉 Total spans in ledger: ${result.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Seed error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run if called directly
if (require.main === module) {
  seed().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seed };
