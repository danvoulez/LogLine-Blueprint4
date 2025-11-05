# 🚀 Opções de Deploy - LogLineOS

## Opção 1: GitHub Actions (Recomendado para CI/CD)

### Vantagens
- ✅ Histórico completo no GitHub
- ✅ Deploy automático em push
- ✅ Logs centralizados
- ✅ Não precisa configurar AWS CLI localmente

### Desvantagens
- ⚠️ Repositório mistura código + docs + workspace
- ⚠️ Depende de secrets do GitHub

### Como usar
1. Push para `main` → Deploy automático
2. Workflow: `.github/workflows/deploy-all-lambdas.yml`
3. Deploya todas as Lambdas (antigas + novas)

---

## Opção 2: AWS CLI/API Direto (Mais Controle)

### Vantagens
- ✅ Controle total sobre quando deployar
- ✅ Não precisa GitHub
- ✅ Pode usar em scripts locais
- ✅ Mais rápido (sem esperar Actions)

### Desvantagens
- ⚠️ Sem histórico automático
- ⚠️ Precisa configurar AWS CLI
- ⚠️ Logs ficam no CloudWatch

### Como usar

#### Script Local (Recomendado)
```bash
# Deploy todas as Lambdas
./scripts/deploy-auth-wallet.sh dev

# Ou deploy individual
cd lambda/auth_service
npm install --production
zip -r ../../auth.zip .
aws lambda update-function-code \
  --function-name loglineos-auth-service \
  --zip-file fileb://../../auth.zip
```

#### Via AWS API (Programático)
```javascript
const AWS = require('@aws-sdk/client-lambda');
const fs = require('fs');

const lambda = new AWS.LambdaClient({ region: 'us-east-1' });

const zip = fs.readFileSync('lambda.zip');
await lambda.send(new UpdateFunctionCodeCommand({
  FunctionName: 'loglineos-auth-service',
  ZipFile: zip
}));
```

---

## Opção 3: Híbrido (Melhor dos Dois Mundos)

### Estrutura Recomendada

```
loglineos-blueprint4/
├── .github/workflows/          # CI/CD (deploy automático)
├── lambda/                     # Código das Lambdas
├── terraform/                  # Infraestrutura
├── scripts/                    # Scripts de deploy local
├── docs/                       # Documentação
└── ROW/                        # Dados/seed
```

### Workflow
1. **Desenvolvimento local**: Usa `scripts/deploy-auth-wallet.sh` para testes
2. **Deploy produção**: Push para `main` → GitHub Actions deploya tudo
3. **Infraestrutura**: Terraform via Actions (manual ou `[terraform]` no commit)

---

## Recomendação

### Para Desenvolvimento
- Use **AWS CLI local** (`./scripts/deploy-auth-wallet.sh`)
- Mais rápido para iterar
- Testa antes de commitar

### Para Produção
- Use **GitHub Actions** (deploy automático)
- Histórico completo
- Deploy consistente

### Para Organizar Repositório
Se quiser separar melhor:

1. **Criar repositório separado para código:**
   ```
   loglineos-core/          # Código puro
   loglineos-docs/          # Documentação
   loglineos-blueprint4/    # Workspace completo (atual)
   ```

2. **Ou usar monorepo com estrutura clara:**
   ```
   .
   ├── services/           # Lambdas
   ├── infrastructure/     # Terraform
   ├── docs/              # Documentação
   └── data/              # ROW/
   ```

---

## Scripts Disponíveis

### Deploy Completo
```bash
./scripts/deploy-auth-wallet.sh dev
```

### Deploy Individual
```bash
# Auth Service
cd lambda/auth_service && npm install --production && zip -r ../../auth.zip . && \
aws lambda update-function-code --function-name loglineos-auth-service --zip-file fileb://../../auth.zip

# Wallet Service
cd lambda/wallet_service && npm install --production && zip -r ../../wallet.zip . && \
aws lambda update-function-code --function-name loglineos-wallet-service --zip-file fileb://../../wallet.zip
```

### Deploy via Terraform
```bash
cd terraform
terraform init
terraform apply -var="environment=dev"
```

---

## Decisão

**Status Atual:** GitHub Actions configurado + Scripts locais disponíveis

**Recomendação:** 
- ✅ Manter ambos (flexibilidade)
- ✅ Usar Actions para produção
- ✅ Usar scripts locais para desenvolvimento

**Próximo passo:** Organizar repositório se quiser (opcional)

