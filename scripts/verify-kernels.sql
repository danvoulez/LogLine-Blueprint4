-- Script SQL para verificar kernels no banco de dados
-- Execute: psql -h <host> -U ledger_admin -d loglineos -f scripts/verify-kernels.sql

-- Set RLS context
SET app.user_id = 'system:verify';
SET app.tenant_id = 'system';

-- 1. Verificar estrutura da tabela
SELECT 
  'Estrutura da tabela' as check_type,
  COUNT(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'ledger' 
  AND table_name = 'universal_registry';

-- 2. Contar kernels
SELECT 
  'Total de kernels' as metric,
  COUNT(*) as total,
  COUNT(DISTINCT id) as unique_kernels,
  COUNT(*) FILTER (WHERE code IS NOT NULL AND code != '') as with_code,
  COUNT(*) FILTER (WHERE code IS NULL OR code = '') as without_code,
  COUNT(*) FILTER (WHERE LENGTH(code) > 1000) as with_large_code
FROM ledger.visible_timeline
WHERE entity_type = 'function';

-- 3. Listar todos os kernels
SELECT 
  id,
  seq,
  name,
  entity_type,
  status,
  visibility,
  LENGTH(code) as code_length,
  CASE 
    WHEN code IS NULL OR code = '' THEN 'SEM CÓDIGO'
    WHEN LENGTH(code) < 100 THEN 'CÓDIGO MUITO CURTO'
    ELSE 'OK'
  END as code_status,
  at as created_at,
  SUBSTRING(code, 1, 100) as code_preview
FROM ledger.visible_timeline
WHERE entity_type = 'function'
ORDER BY at DESC;

-- 4. Verificar manifest
SELECT 
  id,
  seq,
  metadata->'allowed_boot_ids' as allowed_boot_ids,
  jsonb_array_length(metadata->'allowed_boot_ids') as allowed_count,
  at
FROM ledger.visible_timeline
WHERE entity_type = 'manifest'
ORDER BY at DESC, seq DESC
LIMIT 1;

-- 5. Verificar se kernels do manifest estão no banco
WITH manifest_ids AS (
  SELECT 
    jsonb_array_elements_text(metadata->'allowed_boot_ids')::uuid as kernel_id
  FROM ledger.visible_timeline
  WHERE entity_type = 'manifest'
  ORDER BY at DESC, seq DESC
  LIMIT 1
)
SELECT 
  m.kernel_id,
  CASE 
    WHEN k.id IS NOT NULL THEN '✅ EXISTE'
    ELSE '❌ NÃO EXISTE'
  END as status,
  k.name,
  k.status as kernel_status
FROM manifest_ids m
LEFT JOIN ledger.visible_timeline k ON k.id = m.kernel_id AND k.entity_type = 'function'
ORDER BY status DESC, m.kernel_id;

-- 6. Verificar kernels sem código válido
SELECT 
  id,
  name,
  LENGTH(code) as code_length,
  CASE 
    WHEN code IS NULL THEN 'NULL'
    WHEN code = '' THEN 'VAZIO'
    WHEN LENGTH(code) < 50 THEN 'MUITO CURTO'
    ELSE 'OK'
  END as issue,
  SUBSTRING(code, 1, 200) as preview
FROM ledger.visible_timeline
WHERE entity_type = 'function'
  AND (code IS NULL OR code = '' OR LENGTH(code) < 50)
ORDER BY name;

-- 7. Resumo por arquivo NDJSON esperado
-- (IDs dos kernels conhecidos)
SELECT 
  CASE 
    WHEN id = '00000000-0000-4000-8000-000000000001' THEN 'run_code_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000002' THEN 'observer_bot_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000003' THEN 'request_worker_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000004' THEN 'policy_agent_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000005' THEN 'provider_exec_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000006' THEN 'prompt_fetch_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000007' THEN 'memory_store_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000008' THEN 'app_enrollment_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000009' THEN 'memory_upsert_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000014' THEN 'memory_search_kernel'
    WHEN id = '00000000-0000-4000-8000-000000000015' THEN 'token_issuer_kernel'
    ELSE 'unknown'
  END as expected_name,
  id,
  name as actual_name,
  seq,
  status,
  LENGTH(code) as code_length,
  CASE 
    WHEN code IS NULL OR code = '' THEN '❌ SEM CÓDIGO'
    WHEN LENGTH(code) < 100 THEN '⚠️ CÓDIGO CURTO'
    ELSE '✅ OK'
  END as status_check
FROM ledger.visible_timeline
WHERE entity_type = 'function'
  AND id IN (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000015'
  )
ORDER BY id;

