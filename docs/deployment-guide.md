# Bouncer VIP Platform - Deployment Guide

## Overview

This guide covers deploying the Bouncer VIP Platform to various environments.

## Environments

| Environment | Purpose | URL |
|--------------|---------|-----|
| Development | Local testing | localhost:3000 |
| Staging | Pre-production testing | staging-api.bouncervip.co.za |
| Production | Live environment | api.bouncervip.co.za |

## Prerequisites

- Docker & Docker Compose
- kubectl (for Kubernetes)
- terraform (for infrastructure)
- Access to cloud provider

---

## Option 1: Docker Compose (Local/Dev)

```bash
# 1. Clone repository
git clone https://github.com/affiliatedarchitecturegroup-byte/CISD_Bouncer-VIP-Express.git
cd CISD_Bouncer-VIP-Express

# 2. Copy environment
cp config/.env.example config/.env
# Edit .env with your values

# 3. Start infrastructure
docker compose up -d

# 4. Verify
curl http://localhost:8000/health

# 5. View logs
docker compose logs -f
```

---

## Option 2: Kubernetes (Staging/Production)

### Prepare Infrastructure

```bash
# Create namespace
kubectl apply -f k8s/base/namespace.yaml

# Apply configs
kubectl apply -f k8s/base/configmap.yaml
kubectl apply -f k8s/base/deployment.yaml
kubectl apply -f k8s/base/hpa.yaml
```

### Deploy Services

```bash
# Deploy to staging
kubectl apply -k k8s/overlays/staging

# Deploy to production
kubectl apply -k k8s/overlays/production

# Check status
kubectl get pods -n bouncer-vip

# View logs
kubectl logs -n bouncer-vip -l app=bouncer-api-gateway -f
```

### Horizontal Scaling

```bash
# Scale deployment
kubectl scale deployment bouncer-api-gateway --replicas=5 -n bouncer-vip

# Or use HPA (automatic scaling)
kubectl apply -f k8s/base/hpa.yaml
```

---

## Option 3: AWS ECS/Fargate

### Using AWS CLI

```bash
# Create cluster
aws ecs create-cluster --cluster-name bouncer-vip

# Register task definition
aws ecs register-task-definition --cli-input-json file://ecs/task-definition.json

# Create service
aws ecs create-service \
  --cluster bouncer-vip \
  --service-name api-gateway \
  --task-definition bouncer-api-gateway:1 \
  --desired-count 2 \
  --launch-type FARGATE
```

---

## Option 4: AWS EKS

### Prerequisites

- eksctl installed
- kubectl configured
- AWS credentials configured

### Deploy EKS Cluster

```bash
# Create cluster
eksctl create cluster \
  --name bouncer-vip \
  --region us-east-1 \
  --nodes 3 \
  --nodegroup-name standard

# Deploy manifest
kubectl apply -f k8s/base/

# Verify
kubectl get all -n bouncer-vip
```

---

## Database Setup

### PostgreSQL

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U bouncer -d bouncer_express

# Run migrations
npm run db:migrate
```

### MongoDB

```bash
# Connect to MongoDB
docker compose exec mongodb mongosh -u bouncer

# Create collections
use bouncer_dev
db.createCollection("guests")
```

---

## Health Checks

### API Gateway

```bash
curl http://localhost:8000/health
```

### Individual Services

```bash
# Check service health
curl http://localhost:3001/health
```

### Kubernetes

```bash
kubectl get pods -n bouncer-vip
kubectl describe pod <pod-name> -n bouncer-vip
```

---

## Monitoring

### Access Grafana

```bash
# Port forward
kubectl port-forward -n bouncer-vip svc/grafana 3000:3000

# Access
open http://localhost:3000
```

### Access Prometheus

```bash
kubectl port-forward -n bouncer-vip svc/prometheus 9090:9090
```

---

## Rollback

### Kubernetes

```bash
# Rollback deployment
kubectl rollout undo deployment/bouncer-api-gateway -n bouncer-vip

# Check rollout status
kubectl rollout status deployment/bouncer-api-gateway -n bouncer-vip
```

---

## Backup & Recovery

### Database Backup

```bash
# PostgreSQL
docker compose exec postgres pg_dump -U bouncer bouncer_express > backup.sql

# MongoDB
docker compose exec mongodb mongodump --out=/dump
```

### Restore

```bash
# PostgreSQL
docker compose exec -T postgres psql -U bouncer bouncer_express < backup.sql
```

---

## Troubleshooting

### Pod not starting

```bash
kubectl describe pod <pod-name> -n bouncer-vip
kubectl logs <pod-name> -n bouncer-vip
```

### Service unreachable

```bash
kubectl get svc -n bouncer-vip
kubectl get endpoints -n bouncer-vip
```

### High memory/CPU

```bash
kubectl top pods -n bouncer-vip
kubectl top nodes
```