output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.loglineos.id
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.loglineos.address
}

output "rds_port" {
  description = "RDS port"
  value       = aws_db_instance.loglineos.port
}

output "lambda_functions" {
  description = "Lambda function ARNs"
  value = {
    stage0_loader = aws_lambda_function.stage0_loader.arn
    db_migration  = aws_lambda_function.db_migration.arn
    diagnostic    = aws_lambda_function.diagnostic.arn
  }
}

output "db_secret_arn" {
  description = "Secrets Manager ARN for database credentials"
  value       = aws_secretsmanager_secret.db_password.arn
  sensitive   = true
}

