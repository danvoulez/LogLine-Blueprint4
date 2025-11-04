# DynamoDB Tables for Auth & Wallet System

# Tokens table
resource "aws_dynamodb_table" "auth_api_tokens" {
  name           = "auth_api_tokens"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "token_hash"

  attribute {
    name = "token_hash"
    type = "S"
  }

  attribute {
    name = "wallet_id"
    type = "S"
  }

  global_secondary_index {
    name     = "wallet_id-index"
    hash_key = "wallet_id"
  }

  tags = {
    Name        = "LogLineOS Auth Tokens"
    Environment = var.environment
    Service     = "auth"
  }
}

# Wallets table
resource "aws_dynamodb_table" "wallets" {
  name         = "wallets"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "wallet_id"

  attribute {
    name = "wallet_id"
    type = "S"
  }

  tags = {
    Name        = "LogLineOS Wallets"
    Environment = var.environment
    Service     = "wallet"
  }
}

# Nonces table (for anti-replay)
resource "aws_dynamodb_table" "nonces" {
  name         = "nonces"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "k"

  attribute {
    name = "k"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name        = "LogLineOS Nonces"
    Environment = var.environment
    Service     = "wallet"
  }
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

