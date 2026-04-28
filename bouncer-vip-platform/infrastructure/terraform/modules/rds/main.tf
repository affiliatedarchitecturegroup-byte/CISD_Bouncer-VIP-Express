# RDS Module for Bouncer VIP Platform
variable "identifier" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allocated_storage" { type = number }
variable "max_allocated_storage" { type = number }
variable "storage_type" { type = string }
variable "instance_class" { type = string }
variable "engine_version" { type = string }
variable "multi_az" { type = bool }
variable "backup_retention_period" { type = number }
variable "deletion_protection" { type = bool }

resource "aws_db_subnet_group" "main" {
  name       = var.identifier
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "main" {
  identifier             = var.identifier
  engine               = "postgres"
  engine_version       = var.engine_version
  instance_class       = var.instance_class
  allocated_storage    = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type        = var.storage_type
  storage_encrypted  = true
  
  db_name  = "bouncer_express"
  username = "bouncer"
  password = "CHANGE_IN_PRODUCTION"
  
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  
  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_period
  backup_window         = "03:00-04:00"
  maintenance_window    = "Mon:04:00-05:00"
  
  deletion_protection = var.deletion_protection
  skip_final_snapshot = !var.deletion_protection
}

resource "aws_security_group" "rds" {
  name        = "${var.identifier}-rds"
  description = "RDS security group"
  vpc_id      = var.vpc_id
  ingress {
    from_port = 5432; to_port = 5432; protocol = "tcp"; cidr_blocks = ["10.0.0.0/16"]
  }
  egress {
    from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"]
  }
}

output "endpoint" { value = aws_db_instance.main.endpoint }
output "port" { value = aws_db_instance.main.port }
output "arn" { value = aws_db_instance.main.arn }