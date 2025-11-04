# Terraform Infrastructure - LogLineOS Blueprint4

Infraestrutura AWS recriada baseada no inventário atual.

## Recursos

- **VPC** com subnets públicas e privadas
- **RDS PostgreSQL** (db.t3.micro)
- **3 Lambda Functions** (stage0-loader, db-migration, diagnostic)
- **Security Groups** para RDS e Lambda
- **Secrets Manager** para credenciais do banco
- **IAM Roles** e policies

## Uso

### Inicializar Terraform

```bash
cd terraform
terraform init
```

### Planejar mudanças

```bash
terraform plan
```

### Aplicar infraestrutura

```bash
terraform apply
```

### Destruir (cuidado!)

```bash
terraform destroy
```

## Variáveis

Crie um arquivo `terraform.tfvars`:

```hcl
environment         = "dev"
aws_region          = "us-east-1"
db_instance_class   = "db.t3.micro"
db_allocated_storage = 20
# db_password = ""  # Deixe vazio para auto-gerar
```

## Notas

- O RDS precisa de um `deploy.zip` na raiz do projeto para as Lambdas
- As Lambdas estão configuradas para usar VPC (subnets privadas)
- Secrets Manager armazena credenciais do banco automaticamente

