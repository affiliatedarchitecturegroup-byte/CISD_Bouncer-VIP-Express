# VPC Module for Bouncer VIP Platform
variable "environment" { type = string }
variable "project_name" { type = string }
variable "cidr_block" { type = string }
variable "availability_zones" { type = list(string) }
variable "public_subnets" { type = list(string) }
variable "private_subnets" { type = list(string) }
variable "database_subnets" { type = list(string) }

resource "aws_vpc" "main" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = { Name = "${var.project_name}-vpc-${var.environment}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags = { Name = "${var.project_name}-igw-${var.environment}" }
}

resource "aws_eip" "nat" {
  count  = length(var.availability_zones)
  domain = "vpc"
  tags = { Name = "${var.project_name}-nat-${count.index}" }
}

resource "aws_nat_gateway" "main" {
  count         = length(var.availability_zones)
  subnet_id     = aws_subnet.public[count.index].id
  allocation_id = aws_eip.nat[count.index].id
}

resource "aws_subnet" "public" {
  count             = length(var.public_subnets)
  vpc_id           = aws_vpc.main.id
  cidr_block       = var.public_subnets[count.index]
  availability_zone = var.availability_zones[count.index]
  tags = { Name = "${var.project_name}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = length(var.private_subnets)
  vpc_id           = aws_vpc.main.id
  cidr_block       = var.private_subnets[count.index]
  availability_zone = var.availability_zones[count.index]
  tags = { Name = "${var.project_name}-private-${count.index}" }
}

resource "aws_subnet" "database" {
  count             = length(var.database_subnets)
  vpc_id           = aws_vpc.main.id
  cidr_block       = var.database_subnets[count.index]
  availability_zone = var.availability_zones[count.index]
  tags = { Name = "${var.project_name}-database-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0", gateway_id = aws_internet_gateway.main.id }
}

resource "aws_route_table" "private" {
  count  = length(var.availability_zones)
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0", nat_gateway_id = aws_nat_gateway.main[count.index].id }
}

resource "aws_route_table_association" "public" {
  count          = length(var.public_subnets)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "default" {
  name        = "${var.project_name}-default"
  description = "Default security group"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port = 443; to_port = 443; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port = 80; to_port = 80; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"]
  }
}

output "vpc_id" { value = aws_vpc.main.id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "database_subnet_ids" { value = aws_subnet.database[*].id }
output "security_group_id" { value = aws_security_group.default.id }