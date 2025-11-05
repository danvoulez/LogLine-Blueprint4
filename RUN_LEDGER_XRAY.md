# 🔍 Como Executar Ledger X-Ray

## Problema

O RDS está em uma **VPC privada** e não é acessível diretamente da máquina local.

## Solução: Executar via Lambda

### Opção 1: Invocar Lambda diretamente

```bash
aws lambda invoke \
  --function-name loglineos-ledger-xray \
  --region us-east-1 \
  --payload '{}' \
  response.json

cat response.json | jq
```

### Opção 2: Criar endpoint no API Gateway

Depois de deployar, criar endpoint:
```
GET /api/ledger/xray
```

### Opção 3: Deploy da Lambda primeiro

```bash
cd lambda/ledger_xray
npm install --production
zip -r ../../ledger_xray.zip .

aws lambda create-function \
  --function-name loglineos-ledger-xray \
  --runtime nodejs18.x \
  --role arn:aws:iam::611572147468:role/loglineos-lambda-role \
  --handler index.handler \
  --zip-file fileb://../../ledger_xray.zip \
  --timeout 60 \
  --memory-size 512 \
  --vpc-config SubnetIds=subnet-xxx,subnet-yyy,SecurityGroupIds=sg-xxx \
  --environment Variables={DB_SECRET_ARN=arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb,AWS_REGION=us-east-1}
```

---

## Status Atual

✅ **Lambda criada** em `lambda/ledger_xray/`  
⏳ **Próximo passo:** Deploy da Lambda e invocar

---

**Próximo passo:** Deploy da Lambda? 🚀

