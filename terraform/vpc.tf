# VPC for LogLineOS
resource "aws_vpc" "loglineos" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "loglineos-vpc"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "loglineos" {
  vpc_id = aws_vpc.loglineos.id

  tags = {
    Name = "loglineos-igw"
  }
}

# Public Subnets
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.loglineos.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  map_public_ip_on_launch = true

  tags = {
    Name = "loglineos-public-${count.index + 1}"
    Type = "public"
  }
}

# Private Subnets (for RDS)
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.loglineos.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "loglineos-private-${count.index + 1}"
    Type = "private"
  }
}

# Route Table for Public Subnets
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.loglineos.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.loglineos.id
  }

  tags = {
    Name = "loglineos-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

data "aws_availability_zones" "available" {
  state = "available"
}

