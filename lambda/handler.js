// handler.js — Node 18.x (CommonJS)
// Ações suportadas: diagnose | migrate | seed | verify | files
// Requer: arquivo schema.sql no mesmo diretório. Opcional: seed.sql
// Opcional: pacote "pg" (se não existir, o diagnose avisa e ainda testa TCP)

"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");

// --------- Helpers básicos ---------
function getEnv() {
  const url = process.env.DATABASE_URL || "";
  const host = process.env.PGHOST || "";
  const port = +(process.env.PGPORT || 5432);
  const user = process.env.PGUSER || "";
  const password = process.env.PGPASSWORD || "";
  const database = process.env.PGDATABASE || "";
  return { url, host, port, user, password, database };
}

function hasModule(name) {
  try { require.resolve(name); return true; } catch { return false; }
}

function readFileIfExists(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function listFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    out.push({ name, dir, isDir: st.isDirectory(), size: st.size });
  }
  return out;
}

function tcpProbe({ host, port, timeoutMs = 3000 }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let done = false;

    const finish = (ok, err) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve({ ok, ms: Date.now() - t0, error: err ? String(err.message || err) : undefined });
    };

    sock.connect(port, host, () => finish(true));
    sock.setTimeout(timeoutMs, () => finish(false, new Error("timeout")));
    sock.on("error", (e) => finish(false, e));
  });
}

async function getPgClient() {
  // carregamento lazy
  if (!hasModule("pg")) throw new Error("Módulo 'pg' não encontrado. Instale ou use um Lambda Layer.");
  const { Client } = require("pg");
  const env = getEnv();

  if (env.url) {
    return new Client({ connectionString: env.url, ssl: { rejectUnauthorized: false } });
  }
  if (!env.host) throw new Error("Defina DATABASE_URL ou PGHOST/PG*");
  return new Client({
    host: env.host,
    port: env.port || 5432,
    user: env.user,
    password: env.password,
    database: env.database,
    ssl: { rejectUnauthorized: false }
  });
}

async function runSQL(sql) {
  const client = await getPgClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

async function withClient(fn) {
  const client = await getPgClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// --------- Ações ---------
async function actionDiagnose() {
  const env = getEnv();

  // 1) Runtime/ambiente
  const runtime = {
    node: process.version,
    arch: process.arch,
    memory: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    region: process.env.AWS_REGION,
  };

  // 2) Arquivos mais importantes
  const cwd = __dirname;
  const filesTop = listFiles(cwd);
  const hasSchema = fs.existsSync(path.join(cwd, "schema.sql"));
  const hasSeed = fs.existsSync(path.join(cwd, "seed.sql"));
  const hasPackageJson = fs.existsSync(path.join(cwd, "package.json"));
  const hasNodeModulesPg = fs.existsSync(path.join(cwd, "node_modules/pg"));

  // 3) Teste de escrita em /tmp
  let tmpWrite = false;
  try {
    fs.writeFileSync("/tmp/probe.txt", "ok");
    tmpWrite = true;
  } catch {}

  // 4) Teste rápido TCP (sem 'pg') para host/port
  let tcp = null;
  try {
    let host, port;
    if (env.url) {
      const m = env.url.match(/postgres(?:ql)?:\/\/[^@]+@([^:/]+):?(\d+)?\//i);
      host = m && m[1];
      port = (m && m[2]) ? +m[2] : (env.port || 5432);
    } else {
      host = env.host;
      port = env.port || 5432;
    }
    if (host) tcp = await tcpProbe({ host, port, timeoutMs: 3000 });
  } catch (e) {
    tcp = { ok: false, error: String(e) };
  }

  // 5) Se tiver 'pg', tenta SELECT NOW()
  let dbCheck = null;
  if (hasModule("pg")) {
    try {
      dbCheck = await withClient(async (c) => {
        const v = await c.query("SELECT version() as v, NOW() as now");
        // opcional: ver se existe a tabela universal_registry
        const t = await c.query(`
          SELECT to_regclass('public.universal_registry') AS exists
        `);
        return {
          version: v.rows[0]?.v,
          now: v.rows[0]?.now,
          universal_registry: t.rows[0]?.exists ? true : false
        };
      });
    } catch (e) {
      dbCheck = { error: String(e.message || e) };
    }
  }

  return {
    ok: true,
    summary: {
      hasDATABASE_URL: !!env.url,
      hasPGHOST: !!env.host,
      hasPgModule: hasModule("pg"),
      hasNodeModulesPg,
      hasSchema,
      hasSeed,
      tmpWrite,
      tcpOk: tcp ? tcp.ok : null,
    },
    runtime,
    filesTop,
    tcp,
    dbCheck,
    hints: [
      !hasModule("pg") ? "Instale 'pg' (npm i pg) e suba com node_modules/ ou use um Lambda Layer oficial." : null,
      !env.url && !env.host ? "Defina DATABASE_URL OU PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT." : null,
      tcp && !tcp.ok ? "Lambda não alcança o banco: verifique VPC/SG (RDS privado) ou use endpoint público (Supabase)." : null,
      hasSchema ? null : "schema.sql não encontrado no diretório — necessário para migrate."
    ].filter(Boolean)
  };
}

async function actionMigrate() {
  const sql = readFileIfExists(path.join(__dirname, "schema.sql"));
  if (!sql) throw new Error("schema.sql não encontrado ao lado do handler");
  await runSQL(sql);
  return { migrated: true };
}

async function actionSeed() {
  const seedSql = readFileIfExists(path.join(__dirname, "seed.sql"));
  if (seedSql) {
    await runSQL(seedSql);
    return { seeded: "seed.sql" };
  }
  // fallback básico (ajuste para suas tabelas)
  return await withClient(async (c) => {
    try {
      await c.query(
        `INSERT INTO tenants (id, name) VALUES ($1,$2)
         ON CONFLICT (id) DO NOTHING`,
        ["demo", "Demo Tenant"]
      );
      return { seeded: "inline" };
    } catch (e) {
      return { seeded: false, error: String(e.message || e) };
    }
  });
}

async function actionVerify() {
  return await withClient(async (c) => {
    const now = await c.query("SELECT NOW() as now");
    let spans = null;
    try {
      const r = await c.query("SELECT count(*)::int AS n FROM universal_registry");
      spans = r.rows[0].n;
    } catch {
      spans = "table_missing";
    }
    return { now: now.rows[0].now, universal_registry_count: spans };
  });
}

function actionFiles() {
  return { cwd: __dirname, files: listFiles(__dirname) };
}

// --------- Export Lambda ---------
exports.handler = async (event = {}) => {
  const action = String(event.action || "diagnose").toLowerCase();
  try {
    if (action === "diagnose") return await actionDiagnose();
    if (action === "migrate")  return await actionMigrate();
    if (action === "seed")     return await actionSeed();
    if (action === "verify")   return await actionVerify();
    if (action === "files")    return actionFiles();
    return { ok: false, error: "Ação inválida. Use: diagnose | migrate | seed | verify | files" };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};
