# 🔄 Plano de Renomeação: LogLine-Blueprint4 → LogLine-Deploy

## ✅ Justificativa

**LogLine-Ruleset:**
- Documentos funcionais e importantes
- Especificações perenes
- Blueprints, specs, regras

**LogLine-Deploy:**
- Código de deploy e infraestrutura
- Lambdas, Terraform, scripts
- CI/CD, workflows
- Implementação executável

**Separação clara:**
- 📚 Ruleset = Documentação/Especificação
- 🚀 Deploy = Código/Implementação

---

## 📋 Checklist de Migração

### 1. GitHub (Fazer Primeiro)

- [ ] Renomear repositório no GitHub:
  - Settings → General → Repository name
  - De: `LogLine-Blueprint4`
  - Para: `LogLine-Deploy`

- [ ] GitHub redireciona automaticamente (URLs antigas ainda funcionam)

### 2. Atualizar Referências Locais

#### Arquivos a atualizar:

- [x] `README.md` - Título e descrição
- [x] `package.json` - name e description
- [x] `DEVELOPMENT_WORKFLOW.md` - URLs GitHub
- [x] `REPOSITORY_INFO.md` - Nome e URLs
- [x] `SETUP_GITHUB.md` - Referências
- [x] `CI_CD_TO_LEDGER.md` - GITHUB_REPOSITORY
- [x] `scripts/github-to-spans.js` - repo default
- [x] Outros docs com URLs (verificar)

### 3. Git Remote

```bash
# Ver remote atual
git remote -v

# Atualizar URL (se necessário)
git remote set-url origin https://github.com/danvoulez/LogLine-Deploy.git

# Ou manter (GitHub redireciona)
# git remote set-url origin git@github.com:danvoulez/LogLine-Deploy.git
```

### 4. Secrets & Actions (GitHub)

- [ ] Verificar se secrets ainda funcionam (devem funcionar automaticamente)
- [ ] Workflows continuam funcionando (URLs internas são relativas)

### 5. Documentação Externa

- [ ] Atualizar links em outros repositórios (se houver)
- [ ] Atualizar bookmarks
- [ ] Atualizar referências em `LogLine-Ruleset`

---

## 🚀 Execução

### Passo 1: Renomear no GitHub

1. Acesse: https://github.com/danvoulez/LogLine-Blueprint4/settings
2. Settings → General → Repository name
3. Mude para: `LogLine-Deploy`
4. Confirme

### Passo 2: Atualizar Local

```bash
# Atualizar remote (opcional, GitHub redireciona)
git remote set-url origin https://github.com/danvoulez/LogLine-Deploy.git

# Verificar
git remote -v
```

### Passo 3: Atualizar Arquivos

Este documento lista todos os arquivos que precisam atualização. Execute as mudanças e commit.

---

## 📝 Notas

- ✅ GitHub redireciona URLs antigas automaticamente (30 dias)
- ✅ Secrets e Actions continuam funcionando
- ✅ Webhooks podem precisar atualização (se houver)
- ✅ Clone novo: `git clone https://github.com/danvoulez/LogLine-Deploy.git`

---

**Status:** Plano criado, pronto para execução 🚀

