# 🚀 Setup GitHub e CI/CD - LogLineOS Blueprint4

## Passos para conectar ao GitHub

### 1. Criar repositório no GitHub

1. Acesse: https://github.com/new
2. Nome: `LogLine-Blueprint4` (ou `LogLineOS-Blueprint4` se preferir)
3. Owner: `danvoulez`
4. Público ou Privado (sua escolha)
5. NÃO inicialize com README (já temos um)

### 2. Configurar Git local

```bash
# Adicionar remote
git remote add origin https://github.com/danvoulez/LogLine-Blueprint4.git

# Ou se usar SSH:
git remote add origin git@github.com:danvoulez/LogLineOS-Blueprint4.git
```

### 3. Fazer primeiro commit e push

```bash
# Adicionar tudo
git add .

# Commit inicial
git commit -m "Initial commit: LogLineOS Blueprint4 complete implementation"

# Push para GitHub
git branch -M main
git push -u origin main
```

### 4. Configurar Secrets no GitHub

1. Acesse: https://github.com/danvoulez/LogLine-Blueprint4/settings/secrets/actions
2. Adicione os seguintes secrets:

```
AWS_ACCESS_KEY_ID = <sua-access-key>
AWS_SECRET_ACCESS_KEY = <sua-secret-key>
```

**⚠️ IMPORTANTE:** Use os valores reais das suas credenciais AWS. Não commite credenciais no código!

### 5. CI/CD Automático

O workflow `.github/workflows/deploy.yml` já está configurado para:

- ✅ **Deploy automático** quando push em `main`/`master`
- ✅ **Deploy Terraform** manual (workflow_dispatch) ou com `[terraform]` no commit
- ✅ **Testes** automáticos (quando disponíveis)

### 6. GitHub App (se já tiver)

Se você já tem GitHub App configurado, pode:
- Usar as credenciais do App em vez de secrets manuais
- Configurar permissões específicas para AWS

## 🔄 Workflow de Deploy

### Deploy Automático (Lambda)
- Push em `main` → Deploy automático das Lambdas

### Deploy Terraform (Infraestrutura)
- Workflow manual: Actions → Deploy Infrastructure → Run workflow
- Ou commit com `[terraform]` na mensagem

## 📝 Próximos Passos

1. Criar repositório no GitHub
2. Adicionar remote local
3. Fazer push inicial
4. Configurar secrets
5. Testar CI/CD fazendo um push

