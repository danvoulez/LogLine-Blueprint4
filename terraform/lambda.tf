# Security Group for Lambda (allows outbound to RDS)
resource "aws_security_group" "lambda" {
  name        = "loglineos-lambda-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Security group for Lambda functions"
  vpc_id      = aws_vpc.loglineos.id

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "loglineos-lambda-sg"
  }
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda" {
  name = "loglineos-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "loglineos-lambda-role"
  }
}

# IAM Policy for Lambda
resource "aws_iam_role_policy" "lambda" {
  name = "loglineos-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.db_password.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface"
        ]
        Resource = "*"
      }
    ]
  })
}

# Lambda Functions
resource "aws_lambda_function" "stage0_loader" {
  filename         = "${path.module}/../deploy.zip"
  function_name    = "loglineos-stage0-loader"
  role            = aws_iam_role.lambda.arn
  handler         = "index.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 512

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      RUNTIME_ENV    = var.environment
      RDS_PORT       = "5432"
      RDS_ENDPOINT   = aws_db_instance.loglineos.address
      DB_SECRET_ARN  = aws_secretsmanager_secret.db_password.arn
      LOG_LEVEL      = "info"
      WRITE_TOKEN    = "CHANGE_ME_WRITE_TOKEN"
    }
  }

  tags = {
    Name = "loglineos-stage0-loader"
  }

  depends_on = [
    aws_iam_role_policy.lambda,
    aws_db_instance.loglineos
  ]
}

resource "aws_lambda_function" "db_migration" {
  filename         = "${path.module}/../deploy.zip"
  function_name    = "loglineos-db-migration"
  role            = aws_iam_role.lambda.arn
  handler         = "index.handler"
  runtime         = "nodejs18.x"
  timeout         = 60
  memory_size     = 512

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      RUNTIME_ENV    = var.environment
      RDS_PORT       = "5432"
      RDS_ENDPOINT   = aws_db_instance.loglineos.address
      DB_SECRET_ARN  = aws_secretsmanager_secret.db_password.arn
      LOG_LEVEL      = "info"
    }
  }

  tags = {
    Name = "loglineos-db-migration"
  }

  depends_on = [
    aws_iam_role_policy.lambda,
    aws_db_instance.loglineos
  ]
}

resource "aws_lambda_function" "diagnostic" {
  filename         = "${path.module}/../deploy.zip"
  function_name    = "loglineos-diagnostic"
  role            = aws_iam_role.lambda.arn
  handler         = "index.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 512

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      RUNTIME_ENV    = var.environment
      RDS_PORT       = "5432"
      RDS_ENDPOINT   = aws_db_instance.loglineos.address
      DB_SECRET_ARN  = aws_secretsmanager_secret.db_password.arn
      LOG_LEVEL      = "info"
    }
  }

  tags = {
    Name = "loglineos-diagnostic"
  }

  depends_on = [
    aws_iam_role_policy.lambda,
    aws_db_instance.loglineos
  ]
}

