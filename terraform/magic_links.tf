# DynamoDB Table for Magic Links

resource "aws_dynamodb_table" "magic_links" {
  name         = "magic_links"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "token"

  attribute {
    name = "token"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = {
    Name        = "LogLineOS Magic Links"
    Environment = var.environment
    Service     = "auth"
  }
}

