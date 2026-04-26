# Bouncer VIP Express - Technical Development Plan

## ⚠️ CONFIDENTIAL - NOT FOR DISTRIBUTION

**Company:** Bouncer VIP Express (Pty) Ltd  
**Region:** Greater Durban · KZN North Coast · South Coast  
**Version:** 1.0  
**Date:** 21 April 2026

---

## Platform Overview

Bouncer VIP Express is a polyglot microservices platform comprising two interconnected systems:

### 1. Bouncer VIP Platform
AI-powered enterprise orchestration system for professional security deployment
- CRM Module
- Scheduling Engine
- On-Demand Booking Service
- Digital Monitoring & Live Operations
- ERP (Payroll, Billing, Compliance)
- Workflow Automation Engine
- Client Portal
- Guard Mobile Application
- Analytics & Intelligence Dashboard
- Biometric Clock-in/out & Penalty Engine
- AI Recruitment & Onboarding Pipeline

### 2. Express - Supply Chain OS
Cloud-native supply chain operating system for hospitality industry
- Warehouse Management System (WMS)
- Cold Chain IoT Architecture
- AI Demand Forecasting Engine
- Logistics & Fleet Management
- Last-Mile Delivery (B2C)
- Supplier Integration Network
- Express ERP & Billing

---

## Technology Stack (Per Development Guidelines)

### Frontend & Mobile
- **Web:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Guard App:** React Native 0.74+
- **Express App:** Flutter 3.19+

### Backend Services (Polyglot)
- **Primary:** Node.js 20+ (TypeScript), Go 1.21+
- **Specialized:** Python 3.11+ (AI/ML), Rust (high-performance), Java 21 (enterprise), Elixir 1.15 (real-time)

### Infrastructure & DevOps
- **Orchestration:** Coolify OSS on AWS EC2
- **Ingress:** Traefik 3.x
- **API Gateway:** Kong OSS 3.x
- **Event Streaming:** NATS JetStream
- **Secrets:** Infisical OSS

### Database
- **Relational:** PostgreSQL 15+
- **Document:** MongoDB 7.0
- **Cache:** Redis 7+
- **Time-series:** InfluxDB 3.x

### Blockchain
- **App-chain:** Polygon CDK
- **Smart Contracts:** Solidity 0.8.x, Hardhat + Foundry Forge

### AI & ML
- **ML Platform:** PyTorch, TensorFlow
- **LLM:** OpenAI API, Anthropic Claude
- **Vector DB:** Pinecone, pgvector

### Biometrics
- **Facial Recognition:** AWS Rekognition / Azure Face API
- **Liveness Detection:** on-device + server-side

---

## Monorepo Structure

```
CISD_Bouncer-VIP-Express/
├── bouncer-vip-platform/
│   ├── services/
│   │   ├── crm/
│   │   ├── scheduling/
│   │   ├── on-demand/
│   │   ├── monitoring/
│   │   ├── erp/
│   │   ├── workflow/
│   │   ├── client-portal/
│   │   ├── guard-app/
│   │   └── analytics/
│   ├── shared/
│   │   ├── lib/
│   │   ├── ui/
│   │   ├── utils/
│   │   └── config/
│   ├── infrastructure/
│   │   ├── terraform/
│   │   ├── ansible/
│   │   ├── kubernetes/
│   │   └── docker/
│   └── smart-contracts/
│       ├── contracts/
│       ├── scripts/
│       └── test/
├── express-platform/
│   ├── services/
│   │   ├── wms/
│   │   ├── cold-chain/
│   │   ├── logistics/
│   │   ├── demand-forecast/
│   │   ├── last-mile/
│   │   ├── supplier/
│   │   ├── b2c-delivery/
│   │   └── express-erp/
│   ├── shared/
│   ├── infrastructure/
│   └── smart-contracts/
├── infrastructure/
│   └── docker/
│       ├── grafana/
│       ├── prometheus/
│       └── tempo/
└── docker-compose.yml
```

---

## Development Directives

### Phase 1 — Core Security Launch (Months 0-3)
Priority: Generate revenue, establish brand, validate market
- Sign 10-15 anchor venue clients
- Deploy Bouncer VIP web platform: CRM, scheduling, client portal (read-only), basic monitoring
- Guard App v1: shift calendar, GPS clock-in, incident reporting
- ERP v1: payroll calculation, basic invoice generation

### Phase 2 — Biometrics, Blockchain & AI (Months 4-7)
Priority: Differentiate through technology
- Deploy Polygon CDK app-chain (testnet Month 4, mainnet Month 5)
- Launch biometric clock-in/out on Guard App — facial recognition + geofence
- Activate Penalty Engine
- Deploy AI Recruitment Pipeline

### Phase 3 — Express Launch (Months 8-14)
Priority: Launch supply chain OS
- Launch Express WMS and cold chain IoT monitoring
- Onboard Express venue clients — Storage as a Service
- Launch B2C refrigerated delivery fleet
- Launch Express App — B2C last-mile delivery

---

## Getting Started

### Prerequisites

- **Runtime:** Node.js 20+, Go 1.21+, Python 3.11+
- **Containers:** Docker & Docker Compose
- **Cloud (deployment):** AWS CLI, kubectl, terraform

### Quick Start (Local Development)

```bash
# 1. Clone and install
git clone https://github.com/affiliatedarchitecturegroup-byte/CISD_Bouncer-VIP-Express.git
cd CISD_Bouncer-VIP-Express
npm install

# 2. Copy environment template
cp config/.env.example config/.env

# 3. Start infrastructure
docker compose up -d

# 4. Verify services
curl http://localhost:8000/health

# 5. Run development servers
npm run dev
```

### Using Makefile

```bash
make install        # Install dependencies
make docker-up     # Start containers
make dev           # Run dev servers
make docker-down   # Stop containers
make k8s-deploy    # Deploy to Kubernetes
```

### Docker Development

```bash
# Build and start all services
docker compose build
docker compose up -d

# View logs
docker compose logs -f

# Stop and clean
docker compose down -v
```

### Environment Variables

Copy `config/.env.example` to `.env` and configure:

```bash
# Database
POSTGRES_PASSWORD=dev_password
MONGO_PASSWORD=dev_password

# API Keys
KONG_PASSWORD=dev_password
GRAFANA_PASSWORD=dev_password
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all dev servers |
| `npm run build` | Build all services |
| `npm run test` | Run tests |
| `npm run lint` | Lint code |
| `npm run format` | Format code |
| `make docker-up` | Start Docker |
| `make k8s-deploy` | Deploy to K8s |

---

## Engineering Principles

1. **Single Responsibility** — Each service owns one bounded context
2. **Database-per-Service** — Services maintain isolated data stores
3. **API-First Design** — All interfaces defined in Protocol Buffer before implementation
4. **Event-Driven by Default** — State changes emit domain events to NATS JetStream
5. **Idempotency Guaranteed** — All write operations implement idempotency keys
6. **Circuit Breaking** — All service clients wrapped with circuit breaker
7. **Observability Built-In** — Every service emits structured logs, metrics, traces
8. **Zero-Trust Internal Network** — mTLS enforced between all internal services

---

## Security & Compliance

- PSIRA compliance tracking
- POPIA biometric data handling
- OWASP Top 10 security practices
- Annual penetration testing
- Quarterly biometric data audits

---

## Contact

**Investor enquiries:** invest@bouncervip.co.za  
**Technical:** tech@bouncervip.co.za  
**Phone:** +27 (0) 31 000 0000

> © 2025 Bouncer VIP Express (Pty) Ltd · All Rights Reserved  
> CONFIDENTIAL — NOT FOR DISTRIBUTION