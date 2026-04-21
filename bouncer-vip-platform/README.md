# Bouncer VIP Platform - Deployment Guide

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15+
- Redis 7+
- NATS 2.10+

## Quick Start (Local Development)

### 1. Clone and Setup

```bash
cd bouncer-vip-platform
cp .env.example .env
# Edit .env with your values
```

### 2. Start Infrastructure

```bash
cd infrastructure/docker
docker-compose up -d postgres redis nats
```

### 3. Run Database Migrations

```bash
# Connect to postgres and run migrations
docker-compose exec postgres psql -U bouncer -d bouncer_express -f /docker-entrypoint-initdb.d/001_initial_schema.sql
```

### 4. Start Services

```bash
# Start each service
cd services/api-gateway && npm run dev
cd services/crm && npm run dev
# ... repeat for other services
```

### Or use Docker Compose for all services

```bash
cd infrastructure/docker
docker-compose up -d
```

## Production Deployment

### Using Kubernetes

```bash
# Apply Kubernetes manifests
kubectl apply -f infrastructure/k8s/

# Check deployment status
kubectl get pods -n bouncer-vip
```

### Environment Variables

See `.env.example` for required environment variables.

## Service Ports

| Service | Port |
|---------|------|
| API Gateway | 3000 |
| CRM | 3001 |
| Scheduling | 3002 |
| On-Demand | 3003 |
| Monitoring | 3004 |
| ERP | 3005 |
| Workflow | 3006 |
| Guard App | 3007 |
| Biometrics | 3008 |
| Penalty | 3009 |
| AI Recruitment | 3010 |
| PSIRA Compliance | 3011 |
| Analytics | 3012 |
| Notifications | 3013 |
| Audit | 3014 |

## Infrastructure Services

| Service | Port |
|---------|------|
| PostgreSQL | 5432 |
| Redis | 6379 |
| NATS | 4222 |
| Mailhog (SMTP) | 1025 |

## Smart Contracts

Deploy to Polygon:

```bash
cd smart-contracts
npm install
npm run compile
npm run deploy:mumbai  # Testnet
npm run deploy:amoy    # Mainnet
```

## Monitoring

- Prometheus metrics available at `/metrics` on each service
- Health checks at `/health`

## License

MIT