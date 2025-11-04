# Token Authorizer Lambda Function
resource "aws_lambda_function" "token_authorizer" {
  filename         = "${path.module}/../lambda/authorizers/tokenAuthorizer.zip"
  function_name    = "loglineos-token-authorizer"
  role            = aws_iam_role.lambda.arn
  handler         = "tokenAuthorizer.handler"
  runtime         = "nodejs18.x"
  timeout         = 10
  memory_size     = 256

  # Token authorizer needs VPC access to RDS
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_SECRET_ARN          = aws_secretsmanager_secret.db_password.arn
      TOKEN_PEPPER_SECRET_ARN = aws_secretsmanager_secret.token_pepper.arn
    }
  }

  tags = {
    Name = "loglineos-token-authorizer"
  }

  depends_on = [
    aws_iam_role_policy.lambda,
    aws_db_instance.loglineos,
    aws_secretsmanager_secret.token_pepper
  ]
}

# Token Pepper Secret
resource "aws_secretsmanager_secret" "token_pepper" {
  name        = "loglineos-token-pepper"
  description = "Token pepper for LogLineOS API tokens (BLAKE3 hash salt)"

  tags = {
    Name = "loglineos-token-pepper"
  }
}

resource "aws_secretsmanager_secret_version" "token_pepper" {
  secret_id = aws_secretsmanager_secret.token_pepper.id
  secret_string = jsonencode({
    pepper = random_password.token_pepper.result
  })
}

resource "random_password" "token_pepper" {
  length  = 64
  special = false
  numeric = true
}

# Update IAM policy to include token pepper secret
resource "aws_iam_role_policy" "lambda_secrets" {
  name = "loglineos-lambda-secrets-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.db_password.arn,
          aws_secretsmanager_secret.token_pepper.arn
        ]
      }
    ]
  })
}

# Lambda permission for API Gateway
resource "aws_lambda_permission" "apigw_invoke_authorizer" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.token_authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.loglineos.execution_arn}/*/*"
}

# Output
output "token_authorizer_arn" {
  description = "Token authorizer Lambda ARN"
  value       = aws_lambda_function.token_authorizer.arn
}

output "token_pepper_secret_arn" {
  description = "Token pepper secret ARN"
  value       = aws_secretsmanager_secret.token_pepper.arn
  sensitive   = true
}

