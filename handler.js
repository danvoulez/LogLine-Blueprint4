/**
 * Universal Lambda handler
 * Routes to migrate, seed, or stage0_loader based on event payload
 * 
 * Usage:
 *   POST { "action": "migrate" } - Run schema migration
 *   POST { "action": "seed" } - Seed ledger with kernels + manifest
 *   POST { "action": "boot", "boot_function_id": "...", "input": {...} } - Execute kernel via stage0
 *   Any other payload - Defaults to stage0_loader (backward compatibility)
 */

const migrate = require('./migrate');
const { seed } = require('./seed');
const stage0 = require('./stage0_loader');
const query = require('./query');

exports.handler = async (event, context) => {
  console.log('📥 Event:', JSON.stringify(event, null, 2));
  
  const action = event.action || (event.httpMethod ? null : 'boot');
  
  try {
    switch (action) {
      case 'migrate':
        console.log('🔧 Running migration...');
        return await migrate.handler(event, context);
      
      case 'seed':
        console.log('🌱 Running seed...');
        await seed();
        return {
          statusCode: 200,
          body: JSON.stringify({ ok: true, message: 'Seed completed successfully' })
        };
      
      case 'query':
        console.log('📊 Running query...');
        return await query.handler(event, context);
      
      case 'boot':
      default:
        console.log('🚀 Running stage0 loader...');
        return await stage0.handler(event, context);
    }
  } catch (error) {
    console.error('❌ Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message, 
        stack: error.stack,
        action 
      })
    };
  }
};