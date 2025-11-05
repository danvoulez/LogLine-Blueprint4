# 🔄 Workflow de Desenvolvimento - LogLineOS

## Fluxo Normal (Quando Documentos/Código Estão Prontos)

### 1. Verificar Mudanças

```bash
# Ver o que mudou
git status

# Ver diferenças (opcional)
git diff
```

### 2. Adicionar Arquivos

```bash
# Adicionar tudo (recomendado)
git add -A

# Ou arquivos específicos
git add ROW/kernels/ novo-kernel.ndjson
git add lambda/auth_service/index.js
git add docs/ novo-doc.md
```

### 3. Commit

```bash
# Commit com mensagem descritiva
git commit -m "feat: add new kernel for X"

# Ou mensagem mais detalhada
git commit -m "feat: implement ledger-native API key issuance

- Add api_key_issuer kernel
- Modify Auth Service to only create spans
- Add status endpoint
- All operations now ledger-native"
```

**Convenções de mensagem:**
- `feat:` - Nova funcionalidade
- `fix:` - Correção de bug
- `docs:` - Documentação
- `refactor:` - Refatoração
- `chore:` - Tarefas de manutenção
- `ci:` - Mudanças em CI/CD

### 4. Push para GitHub

```bash
# Push para main
git push origin main
```

**O que acontece automaticamente:**
- ✅ GitHub Actions detecta push
- ✅ Executa workflows configurados
- ✅ Deploy automático (se configurado)

---

## Workflows Automáticos (GitHub Actions)

### Ao fazer push em `main`:

1. **`deploy-ledger-native.yml`**
   - Cria spans `deployment_request`
   - Envia para ledger
   - Stage-0 executa `deployment_executor` kernel

2. **`sync-to-ledger.yml`**
   - Transforma código em spans
   - Sincroniza com ledger

3. **`deploy-all-lambdas.yml`** (opcional)
   - Deploy direto das Lambdas (se necessário)

---

## Quando Usar Cada Workflow

### Deploy Ledger-Native (Recomendado)

**Quando:** Mudanças em código/Lambdas/kernels

**Fluxo:**
```
git push origin main
    ↓
GitHub Action cria deployment_request spans
    ↓
Spans → Ledger
    ↓
Kernel deployment_executor processa
    ↓
Deploy automático na AWS
```

**Vantagem:** Auditável, governado, constitucional

### Deploy Direto (Fallback)

**Quando:** 
- Emergência (precisa deploy rápido)
- Testes locais
- Workflow ledger-native não funcionando

**Como:**
```bash
# Manual via AWS CLI
./scripts/deploy-auth-wallet.sh dev

# Ou via GitHub Actions manual
# Actions → Deploy All Lambda Functions → Run workflow
```

---

## Checklist Antes de Commit

### ✅ Documentação
- [ ] Documentação atualizada (se necessário)
- [ ] README atualizado (se mudanças grandes)
- [ ] Comentários no código (se complexo)

### ✅ Código
- [ ] Código testado localmente (se possível)
- [ ] Sem credenciais hardcoded
- [ ] Sem console.logs desnecessários

### ✅ Kernels
- [ ] Kernel adicionado ao manifest (`allowed_boot_ids`)
- [ ] Kernel segue padrão do ledger
- [ ] Kernel tem `seq` correto (0 para novo, incrementar se atualização)

### ✅ Spans
- [ ] Spans seguem schema correto
- [ ] Campos obrigatórios presentes
- [ ] Metadata estruturado

---

## Fluxo Completo de Exemplo

### Cenário: Criar novo kernel

1. **Criar kernel:**
   ```bash
   # Criar arquivo
   vim ROW/kernels/22-meu-kernel.ndjson
   ```

2. **Adicionar ao manifest:**
   ```bash
   # Editar manifest
   vim ROW/manifest/03-manifest.ndjson
   # Adicionar ID do kernel aos allowed_boot_ids
   ```

3. **Documentar (opcional):**
   ```bash
   # Criar doc explicando
   vim docs/MEU_KERNEL.md
   ```

4. **Commit:**
   ```bash
   git add ROW/kernels/22-meu-kernel.ndjson \
          ROW/manifest/03-manifest.ndjson \
          docs/MEU_KERNEL.md
   git commit -m "feat: add meu_kernel for X functionality"
   ```

5. **Push:**
   ```bash
   git push origin main
   ```

6. **GitHub Actions:**
   - ✅ Cria spans
   - ✅ Envia para ledger
   - ✅ Kernel disponível no Stage-0

---

## Verificar Status

### Após Push

1. **GitHub Actions:**
   - Acesse: https://github.com/danvoulez/LogLine-Blueprint4/actions
   - Veja workflow rodando
   - Verifique logs se falhar

2. **Ledger:**
   ```bash
   # Verificar spans no ledger
   node scripts/verify-kernels-in-db.js
   ```

3. **AWS Lambda:**
   ```bash
   # Verificar Lambda atualizada
   aws lambda get-function --function-name loglineos-stage0-loader
   ```

---

## Troubleshooting

### Commit rejeitado

```bash
# Atualizar com remote
git pull origin main --rebase

# Resolver conflitos se houver
# Depois push novamente
git push origin main
```

### Workflow falhou

1. Ver logs no GitHub Actions
2. Verificar secrets configurados
3. Verificar permissões AWS
4. Tentar deploy manual como fallback

### Kernel não aparece

1. Verificar se está no manifest
2. Verificar se span foi criado no ledger
3. Verificar se Stage-0 tem permissão (manifest)

---

## Dicas

### Commits frequentes
- ✅ Commite pequenas mudanças frequentemente
- ✅ Mensagens claras e descritivas
- ✅ Um commit por funcionalidade

### Branching (Opcional)
```bash
# Se quiser trabalhar em branch
git checkout -b feature/nova-funcionalidade
# ... trabalhar ...
git commit -m "feat: ..."
git push origin feature/nova-funcionalidade
# Criar PR no GitHub (opcional)
```

### Rollback
```bash
# Se precisar desfazer commit local (não pushado)
git reset HEAD~1

# Se já pushou (criar novo commit)
git revert HEAD
git push origin main
```

---

## Resumo Rápido

```bash
# 1. Verificar mudanças
git status

# 2. Adicionar
git add -A

# 3. Commit
git commit -m "tipo: descrição"

# 4. Push
git push origin main

# 5. GitHub Actions faz o resto! ✅
```

---

**Status:** Pronto para uso  
**Próximo passo:** Continue desenvolvendo no IDE, quando pronto: `git add`, `git commit`, `git push` 🚀

