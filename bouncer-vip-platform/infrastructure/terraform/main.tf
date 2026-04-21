# Bouncer VIP Platform - Terraform Configuration
# AWS Infrastructure for Production Deployment

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
  
  backend "s3" {
    bucket = "bouncer-vip-terraform-state"
    key    = "production/terraform.tfstate"
    region = "af-south-1"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "BouncerVIP"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ===========================================
# Variables
# ===========================================

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "af-south-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "bouncer-vip"
}

variable "container_image" {
  description = "ECR container image URL"
  type        = string
  default     = ""
}

# ===========================================
# VPC Network
# ===========================================

module "vpc" {
  source = "./modules/vpc"
  
  environment = var.environment
  project_name = var.project_name
  cidr_block = "10.0.0.0/16"
  
  availability_zones = ["af-south-1a", "af-south-1b", "af-south-1c"]
  
  public_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnets = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]
  database_subnets = ["10.0.21.0/24", "10.0.22.0/24", "10.0.23.0/24"]
}

# ===========================================
# EKS Cluster
# ===========================================

module "eks" {
  source = "./modules/eks"
  
  cluster_name = "${var.project_name}-${var.environment}"
  cluster_version = "1.28"
  
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids
  
  eks_managed_node_groups = {
    general = {
      instance_types = ["t3.medium"]
      min_size = 2
      max_size = 10
      desired_size = 2
      capacity_type = "ON_DEMAND"
    }
    worker = {
      instance_types = ["t3.medium"]
      min_size = 2
      max_size = 20
      desired_size = 4
      capacity_type = "ON_DEMAND"
    }
    memory = {
      instance_types = ["r5.large"]
      min_size = 1
      max_size = 5
      desired_size = 2
      capacity_type = "ON_DEMAND"
    }
  }
}

# ===========================================
# RDS PostgreSQL
# ===========================================

module "rds" {
  source = "./modules/rds"
  
  identifier = "${var.project_name}-${var.environment}"
  
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.database_subnet_ids
  
  allocated_storage = 100
  max_allocated_storage = 500
  storage_type = "gp3"
  
  instance_class = "db.t3.medium"
  engine_version = "15.3"
  multi_az = true
  
  # Backup settings
  backup_retention_period = 7
  backup_window = "03:00-04:00"
  maintenance_window = "Mon:04:00-05:00"
  
  deletion_protection = true
}

# ===========================================
# ElastiCache Redis
# ===========================================

module "redis" {
  source = "./modules/redis"
  
  cluster_id = "${var.project_name}-${var.environment}"
  
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids
  
  node_type = "cache.t3.medium"
  num_cache_nodes = 2
  
  engine_version = "7.0"
  at_rest_encryption = true
  transit_encryption = true
  
  automatic_failover_enabled = true
  multi_az_enabled = true
}

# ===========================================
# NATS Jetstream
# ===========================================

module "nats" {
  source = "./modules/nats"
  
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids
  
  instance_type = "t3.medium"
  cluster_size = 3
  
  volume_size = 50
  enable_persistence = true
}

# ===========================================
# S3 Buckets
# ===========================================

module "s3" {
  source = "./modules/s3"
  
  environment = var.environment
  project_name = var.project_name
  
  buckets = {
    documents = {
      versioning = true
      lifecycle_rules = [{
        enabled = true
        expiration_days = 365
      }]
    }
    biometrics = {
      versioning = true
      lifecycle_rules = [{
        enabled = true
        transition_days = 30
        storage_class = "STANDARD_IA"
      }]
    }
    logs = {
      versioning = false
      lifecycle_rules = [{
        enabled = true
        expiration_days = 90
      }]
    }
    backups = {
      versioning = true
      lifecycle_rules = [{
        enabled = true
        transition_days = 7
        storage_class = "GLACIER"
      }]
    }
  }
}

# ===========================================
# CloudFront CDN
# ===========================================

module "cloudfront" {
  source = "./modules/cloudfront"
  
  aliases = ["api.bouncervip.com", "app.bouncervip.com"]
  
  origin_domain = module.alb.lb_dns_name
  origin_path = ""
  
  price_class = "PriceClass_All"
  
  caching_enabled = true
  compression = true
}

# ===========================================
# Application Load Balancer
# ===========================================

module "alb" {
  source = "./modules/alb"
  
  name = "${var.project_name}-${var.environment}"
  
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.public_subnet_ids
  
  enable_deletion_protection = false
  
  http_listeners = [{
    port     = 80
    protocol = "HTTP"
  }]
  
  https_listeners = [{
    port            = 443
    protocol        = "HTTPS"
    certificate_arn = var.certificate_arn
  }]
}

# ===========================================
# IAM Roles & Policies
# ===========================================

module "iam" {
  source = "./modules/iam"
  
  environment = var.environment
  project_name = var.project_name
  
  oidc_providers = {
    eks = module.eks.oidc_provider_arn
  }
}

# ===========================================
# Outputs
# ===========================================

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "eks_cluster_endpoint" {
  description = "EKS Cluster Endpoint"
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_name" {
  description = "EKS Cluster Name"
  value       = module.eks.cluster_name
}

output "rds_endpoint" {
  description = "RDS PostgreSQL Endpoint"
  value       = module.rds.endpoint
}

output "rds_port" {
  description = "RDS PostgreSQL Port"
  value       = module.rds.port
}

output "redis_endpoint" {
  description = "ElastiCache Redis Endpoint"
  value       = module.redis.configuration_endpoint_address
}

output "nats_endpoints" {
  description = "NATS Jetstream Endpoints"
  value       = module.nats.endpoints
}

output "s3_bucket_names" {
  description = "S3 Bucket Names"
  value       = values(module.s3.bucket_names)
}

output "cloudfront_distribution_id" {
  description = "CloudFront Distribution ID"
  value       = module.cloudfront.distribution_id
}

output "alb_dns_name" {
  description = "ALB DNS Name"
  value       = module.alb.lb_dns_name
}