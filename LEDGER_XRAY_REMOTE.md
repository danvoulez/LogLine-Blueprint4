# 🔍 Ledger X-Ray - Executar Remotamente

## Problema

O RDS está em uma **VPC privada** e não é acessível diretamente da máquina local.

## Soluções

### Opção 1: Executar via Lambda (Recomendado)

Criar uma Lambda function que executa o X-Ray e retorna os resultados:

```javascript
// lambda/ledger-xray/index.js
const { main } = require('../../scripts/ledger-xray');

exports.handler = async (event) => {
  const results = await main();
  return {
    statusCode: 200,
    body: JSON.stringify(results, null, 2)
  };
};
```

**Vantagens:**
- ✅ Lambda está na mesma VPC
- ✅ Acesso direto ao RDS
- ✅ Sem necessidade de túnel

### Opção 2: SSH Tunnel / Bastion Host

Se você tem um bastion host ou EC2 na mesma VPC:

```bash
# Criar túnel SSH
ssh -L 5432:loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com:5432 \
    user@bastion-host

# Em outro terminal, executar X-Ray
export DB_HOST="localhost"
export DB_PORT="5432"
npm run ledger:xray
```

### Opção 3: AWS Systems Manager Session Manager

Se você tem SSM configurado:

```bash
# Criar port forwarding via SSM
aws ssm start-session \
  --target i-1234567890abcdef0 \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5432"],"localPortNumber":["5432"]}'
```

### Opção 4: Via API Gateway (Criar Endpoint)

Criar um endpoint `/api/ledger/xray` que chama uma Lambda interna:

```bash
curl https://api.loglineos.com/api/ledger/xray
```

---

## Recomendação: Lambda Function

**Criar Lambda `ledger-xray`:**

1. Copiar código do script para Lambda
2. Lambda precisa estar na mesma VPC do RDS
3. Adicionar permissão de Secrets Manager
4. Criar endpoint no API Gateway (opcional)

**Executar:**
```bash
aws lambda invoke \
  --function-name loglineos-ledger-xray \
  --payload '{}' \
  response.json

cat response.json
```

---

## Status Atual

❌ **Não é possível executar localmente** - RDS está em VPC privada  
✅ **Solução:** Criar Lambda function para executar remotamente

---

**Próximo passo:** Criar Lambda `ledger-xray`? 🚀

