# DynamoDB Table for Email Verifications

resource "aws_dynamodb_table" "email_verifications" {
  name         = "email_verifications"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }

  attribute {
    name = "token"
    type = "S"
  }

  global_secondary_index {
    name     = "token-index"
    hash_key = "token"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = {
    Name        = "LogLineOS Email Verifications"
    Environment = var.environment
    Service     = "email"
  }
}

