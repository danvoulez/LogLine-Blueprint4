const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  const client = new Client({
    host: process.env.RDS_ENDPOINT || process.env.DB_HOST || 'loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com',
    port: process.env.RDS_PORT || process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'ledger_admin',
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'loglineos',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    const sql = fs.readFileSync(path.join(__dirname, '../config/schema.sql'), 'utf8');
    await client.query(sql);
    
    console.log('✅ Schema created/updated');
    
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: 'Schema migrated successfully' })
    };
  } catch (error) {
    console.error('❌ Migration error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message, stack: error.stack })
    };
  } finally {
    await client.end();
  }
};
