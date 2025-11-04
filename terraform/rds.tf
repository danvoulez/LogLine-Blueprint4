# Security Group for RDS
resource "aws_security_group" "rds" {
  name        = "loglineos-rds-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Managed by Terraform"
  vpc_id      = aws_vpc.loglineos.id

  ingress {
    description     = "PostgreSQL from VPC"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "loglineos-rds-sg"
  }
}

# DB Subnet Group
resource "aws_db_subnet_group" "loglineos" {
  name       = "loglineos-rds-subnets"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "loglineos-rds-subnets"
  }
}

# RDS PostgreSQL Instance
resource "aws_db_instance" "loglineos" {
  identifier             = "loglineos-ledger-${var.environment}"
  engine                 = "postgres"
  engine_version         = "15.4"
  instance_class         = var.db_instance_class
  allocated_storage      = var.db_allocated_storage
  max_allocated_storage  = 100
  storage_type           = "gp3"
  storage_encrypted      = true

  db_name  = "loglineos"
  username = "ledger_admin"
  password = jsondecode(aws_secretsmanager_secret_version.db_password.secret_string)["password"]

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.loglineos.name

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:00-mon:05:00"

  skip_final_snapshot       = var.environment == "dev" ? true : false
  final_snapshot_identifier = var.environment == "dev" ? null : "loglineos-final-snapshot-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  
  performance_insights_enabled = var.environment == "prod" ? true : false

  tags = {
    Name = "loglineos-ledger-${var.environment}"
  }
}

# Secrets Manager for DB credentials
resource "aws_secretsmanager_secret" "db_password" {
  name        = "loglineos-${var.environment}-db"
  description = "Database credentials for LogLineOS ${var.environment}"

  tags = {
    Name = "loglineos-${var.environment}-db"
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({
    username = "ledger_admin"
    password = var.db_password != "" ? var.db_password : random_password.db_password.result
    engine   = "postgres"
    host     = aws_db_instance.loglineos.address
    port     = 5432
    dbname   = "loglineos"
  })
}

variable "db_password" {
  description = "Database password (leave empty to auto-generate)"
  type        = string
  default     = ""
  sensitive   = true
}

resource "random_password" "db_password" {
  length  = 32
  special = true
}

