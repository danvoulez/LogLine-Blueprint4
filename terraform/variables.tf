variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "token_pepper" {
  description = "Token pepper (64 hex chars). Leave empty to auto-generate."
  type        = string
  sensitive   = true
  default     = ""
}
