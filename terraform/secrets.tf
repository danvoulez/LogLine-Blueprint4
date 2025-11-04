# Secrets Manager Secrets

# Token pepper
resource "aws_secretsmanager_secret" "token_pepper" {
  name        = "loglineos-token-pepper"
  description = "Pepper for token hashing (Argon2id)"

  tags = {
    Name        = "LogLineOS Token Pepper"
    Environment = var.environment
    Service     = "auth"
  }
}

resource "aws_secretsmanager_secret_version" "token_pepper" {
  secret_id = aws_secretsmanager_secret.token_pepper.id
  secret_string = jsonencode({
    pepper = var.token_pepper
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

variable "token_pepper" {
  description = "Token pepper (64 hex chars)"
  type        = string
  sensitive   = true
  default     = "" # Generate if empty
}

# Generate pepper if not provided
resource "random_password" "token_pepper" {
  count   = var.token_pepper == "" ? 1 : 0
  length  = 64
  special = false
  upper   = false
}

locals {
  final_pepper = var.token_pepper != "" ? var.token_pepper : random_password.token_pepper[0].result
}

output "token_pepper_secret_arn" {
  value       = aws_secretsmanager_secret.token_pepper.arn
  description = "ARN of token pepper secret"
  sensitive   = true
}

