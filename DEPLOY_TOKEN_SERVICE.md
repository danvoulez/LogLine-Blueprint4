# 🚀 Deploy Token Service - Quick Guide

## Credenciais (do AWS_INFRASTRUCTURE_INVENTORY.md)

- **Account ID:** 611572147468
- **Region:** us-east-1
- **DB Secret ARN:** `arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb`
- **Lambda Role:** `arn:aws:iam::611572147468:role/loglineos-lambda-role`

---

## Opção 1: Script Automático (Recomendado)

```bash
cd "/Users/voulezvous/Library/Mobile Documents/com~apple~CloudDocs/loglineos-blueprint4"
./scripts/setup-token-service.sh
```

O script faz:
1. ✅ Cria/atualiza pepper secret
2. ✅ Build do Lambda Authorizer
3. ✅ Deploy da Lambda function
4. ✅ Configura environment variables
5. ✅ Adiciona permissão para API Gateway

---

## Opção 2: Manual (Passo a Passo)

### 1. Criar Pepper Secret

```bash
aws secretsmanager create-secret \
  --name loglineos-token-pepper \
  --description "Token pepper for LogLineOS API tokens" \
  --secret-string "{\"pepper\":\"$(openssl rand -hex 64)\"}" \
  --region us-east-1
```

**Output:** Note o ARN (ex: `arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-token-pepper-XXXXX`)

### 2. Build Lambda Authorizer

```bash
cd lambda/authorizers
npm install --production
zip -r tokenAuthorizer.zip . -x "*.git*" "*.md" "node_modules/.bin/*"
cd ../..
```

### 3. Deploy Lambda Function

```bash
# Se já existe, atualizar:
aws lambda update-function-code \
  --function-name loglineos-token-authorizer \
  --zip-file fileb://lambda/authorizers/tokenAuthorizer.zip \
  --region us-east-1

aws lambda update-function-configuration \
  --function-name loglineos-token-authorizer \
  --environment "Variables={
    DB_SECRET_ARN=arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb,
    TOKEN_PEPPER_SECRET_ARN=arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-token-pepper-XXXXX
  }" \
  --region us-east-1

# Se não existe, criar:
aws lambda create-function \
  --function-name loglineos-token-authorizer \
  --runtime nodejs18.x \
  --role arn:aws:iam::611572147468:role/loglineos-lambda-role \
  --handler tokenAuthorizer.handler \
  --zip-file fileb://lambda/authorizers/tokenAuthorizer.zip \
  --timeout 10 \
  --memory-size 256 \
  --environment "Variables={
    DB_SECRET_ARN=arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb,
    TOKEN_PEPPER_SECRET_ARN=arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-token-pepper-XXXXX
  }" \
  --vpc-config "SubnetIds=<subnet-ids>,SecurityGroupIds=<sg-id>" \
  --region us-east-1
```

**Nota:** Para VPC config, você precisa das subnet IDs e security group ID. Veja `terraform/vpc.tf` ou AWS Console.

### 4. Adicionar Permissão para API Gateway

```bash
aws lambda add-permission \
  --function-name loglineos-token-authorizer \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --region us-east-1
```

---

## Opção 3: Terraform (Se já usa Terraform)

```bash
cd terraform

# Primeiro, build o package do authorizer:
cd ../lambda/authorizers
npm install --production
zip -r ../../terraform/tokenAuthorizer.zip . -x "*.git*" "*.md" "node_modules/.bin/*"
cd ../../terraform

# Aplicar:
terraform plan
terraform apply
```

---

## Próximos Passos (Depois do Deploy)

### 1. Adicionar token_issuer ao Manifest

O kernel já está em `ROW/kernels/15-token-issuer.ndjson` com ID `00000000-0000-4000-8000-000000000015`.

Adicione ao `manifest.allowed_boot_ids`:

```json
{
  "metadata": {
    "allowed_boot_ids": [
      "...",
      "00000000-0000-4000-8000-000000000015"
    ]
  }
}
```

### 2. Seed o Kernel

```bash
# Se já tem seed script:
npm run seed

# Ou via API:
curl -X POST "https://your-api.execute-api.us-east-1.amazonaws.com/dev/api/boot" \
  -H "Content-Type: application/json" \
  -d '{"action": "seed"}'
```

### 3. Emitir Primeiro Token

```bash
curl -X POST "https://your-api.execute-api.us-east-1.amazonaws.com/dev/api/boot?tenant=acme" \
  -H "Authorization: x-bootstrap-admin" \
  -H "Content-Type: application/json" \
  -d '{
    "boot_function_id": "00000000-0000-4000-8000-000000000015",
    "input": {
      "tenant_id": "acme",
      "app_id": "admin-cli",
      "scopes": [
        "/api/spans:write",
        "/api/boot:invoke",
        "/api/memory:read",
        "/api/memory:write"
      ],
      "ttl_hours": 720
    }
  }'
```

**⚠️ Salve o token retornado! Ele é mostrado apenas uma vez.**

### 4. Conectar Authorizer ao API Gateway

Se você tem API Gateway configurado, adicione o authorizer:

```hcl
# terraform/apigateway.tf (criar se não existe)
resource "aws_api_gateway_authorizer" "ledger_authz" {
  name                   = "ledger-token-authorizer"
  rest_api_id            = aws_api_gateway_rest_api.loglineos.id
  type                   = "REQUEST"
  authorizer_uri         = aws_lambda_function.token_authorizer.invoke_arn
  identity_source        = "method.request.header.Authorization"
  authorizer_result_ttl_in_seconds = 60
}

# Em cada método:
resource "aws_api_gateway_method" "spans_post" {
  ...
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.ledger_authz.id
}
```

---

## Verificação

```bash
# Verificar Lambda:
aws lambda get-function --function-name loglineos-token-authorizer --region us-east-1

# Verificar Pepper Secret:
aws secretsmanager describe-secret --secret-id loglineos-token-pepper --region us-east-1

# Testar token (depois de emitir):
curl -X POST "https://your-api.execute-api.us-east-1.amazonaws.com/dev/api/spans" \
  -H "Authorization: Bearer tok_acme_..." \
  -H "Content-Type: application/json" \
  -d '{"entity_type": "test"}'
```

---

## Troubleshooting

### Lambda não encontra secret
- Verifique IAM role tem permissão `secretsmanager:GetSecretValue`
- Verifique ARNs estão corretos nas environment variables

### Lambda timeout
- Verifique VPC config (subnets, security groups)
- Verifique RDS está acessível da VPC
- Aumente timeout se necessário

### Authorizer sempre nega
- Verifique CloudWatch logs da Lambda
- Verifique token hash no ledger
- Verifique token não está expirado/revogado

