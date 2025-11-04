# 📋 Inventário de Infraestrutura AWS - LogLineOS Blueprint4

**Data:** 2025-01-27  
**Account ID:** 611572147468  
**Region:** us-east-1  
**User:** danvoulez

---

## 🔍 Recursos Encontrados

### Lambda Functions (3)

| Nome | Runtime | Memory | Timeout | Status |
|------|---------|--------|---------|--------|
| `loglineos-db-migration` | nodejs18.x | 512 MB | 60s | ✅ Ativo |
| `loglineos-diagnostic` | nodejs18.x | 512 MB | 30s | ✅ Ativo |
| `loglineos-stage0-loader` | nodejs18.x | 512 MB | 30s | ✅ Ativo |

### RDS PostgreSQL

| Item | Valor |
|------|-------|
| **Instance ID** | `loglineos-ledger-dev` |
| **Engine** | PostgreSQL |
| **Status** | available |
| **Endpoint** | `loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com` |
| **Port** | 5432 |
| **Database** | `loglineos` (assumido) |
| **User** | `ledger_admin` (conforme código) |
| **VPC** | `vpc-09de461cf9d450d0c` (loglineos-vpc) |
| **Subnet Group** | `loglineos-rds-subnets` |
| **Security Group** | `sg-0d2f84ecea2a3eab1` (Managed by Terraform) |

### VPCs

| ID | CIDR | Name |
|----|------|------|
| `vpc-01929754208bd94ec` | 172.31.0.0/16 | Default VPC |
| `vpc-08c855028640f79be` | 10.0.0.0/16 | LogLineOSStack-prod/LogLineOSVpc |
| `vpc-09de461cf9d450d0c` | 10.0.0.0/16 | **loglineos-vpc** (usado pelo RDS) |

### IAM Roles

| Nome | ARN |
|------|-----|
| `loglineos-lambda-role` | `arn:aws:iam::611572147468:role/loglineos-lambda-role` |

### Secrets Manager

| Nome | ARN |
|------|-----|
| `loglineos-dev-db` | `arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb` |
| `loglineos/prod/database` | `arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos/prod/database-b4fMhJ` |

### Lambda Environment Variables

**loglineos-stage0-loader:**
- `RUNTIME_ENV=dev`
- `RDS_PORT=5432`
- `RDS_ENDPOINT=loglineos-ledger-dev.cux46u4k2vtj.us-east-1.rds.amazonaws.com`
- `DB_SECRET_ARN=arn:aws:secretsmanager:us-east-1:611572147468:secret:loglineos-dev-db-S8Z6Qb`
- `LOG_LEVEL=info`
- `WRITE_TOKEN=CHANGE_ME_WRITE_TOKEN`

---

## 📝 Observações

### ✅ Recursos Confirmados
- 3 Lambda functions funcionando
- 1 RDS PostgreSQL instance ativa
- IAM roles configuradas

### ❓ Não Encontrados (mas mencionados em código)
- API Gateway REST (`23vffkk5ra`) - pode ter sido deletado
- API Gateway WebSocket (`srn6e3ggl7`) - deletado conforme cleanup script
- VPC/Subnets - precisa verificar
- Security Groups - precisa verificar

### 🔧 Próximos Passos
1. Verificar VPC e Security Groups do RDS
2. Verificar se há API Gateway REST ativo
3. Documentar variáveis de ambiente das Lambdas
4. Mapear IAM policies associadas às roles

---

## 🚨 Descoberta Importante: Terraform Foi Usado!

**🔍 Evidência encontrada:**
- Security Group tem descrição: **"Managed by Terraform"**
- Subnet Group: `loglineos-rds-subnets` (padrão Terraform)
- VPC: `loglineos-vpc` (padrão Terraform)

**📁 Conclusão:**
A infraestrutura **FOI criada com Terraform**, mas o código **não está neste repositório**.

**Possíveis localizações:**
1. Outro repositório Git (ex: `ledger-aws` mencionado no REALINHAMENTO.md)
2. Pasta local não versionada: `/Users/Amarilho/Documents/ledger-aws/infrastructure/terraform/`
3. Estado do Terraform pode estar em S3 ou localmente

**📝 Próximos Passos:**
1. Procurar código Terraform em outros diretórios
2. Verificar se há state file do Terraform
3. Criar documentação baseada no inventário atual

