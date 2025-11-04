const { Client } = require('pg');

async function getClient() {
  const client = new Client({
    host: process.env.RDS_ENDPOINT || process.env.DB_HOST || 'loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com',
    port: process.env.RDS_PORT || process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'ledger_admin',
    password: process.env.DB_PASS || 'ReplaceWithStrongPassword123!',
    database: process.env.DB_NAME || 'loglineos',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  return client;
}

async function setRlsContext(client, userId, tenantId) {
  if (userId) {
    await client.query(`SET app.user_id = '${userId}'`);
  }
  if (tenantId) {
    await client.query(`SET app.tenant_id = '${tenantId}'`);
  }
}

async function insertSpan(client, span) {
  const cols = Object.keys(span).filter(k => span[k] !== undefined);
  const vals = cols.map(k => span[k]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const colNames = cols.map(c => `"${c}"`).join(', ');
  
  const query = `INSERT INTO ledger.universal_registry (${colNames}) VALUES (${placeholders}) RETURNING *`;
  const result = await client.query(query, vals);
  return result.rows[0];
}

module.exports = {
  getClient,
  setRlsContext,
  insertSpan
};
