# Bouncer VIP Platform - Architecture

## System Overview

The Bouncer VIP Express is a polyglot microservices platform designed for nightclub VIP management, guest lists, table reservations, access control, and premium experiences.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                       │
├─────────────────┬─────────────────┬──────────────┬────────────────────┤
│   Mobile App    │   Web Portal    │  Kiosk Mode  │   Staff Dashboard  │
└────────┬────────┴────────┬────────┴────┬───────┴─────────┬────────────┘
         │                 │            │               │
         └─────────────────┴────────────┴───────────────┘
                            │
                   ┌────────▼────────┐
                   │   API Gateway   │ (Kong)
                   │    :8000       │
                   └────────┬────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
┌────────▼───────┐ ┌──────▼──────┐ ┌──────▼───────┐
│  REST API     │ │  GraphQL    │ │  WebSocket  │
│  Services    │ │  API       │ │  Events    │
└──────────────┘ └────────────┘ └────────────┘
         │
         └──────────────────┬──────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
┌────────▼───────┐ ┌──────▼──────┐ ┌──────▼───────┐
│ PostgreSQL   │ │  MongoDB   │ │    Redis   │
│  :5432      │ │  :27017   │ │   :6379   │
└──────────────┘ └───────────┘ └────────────┘
                            │
                   ┌────────▼────────┐
                   │     NATS       │
                   │    :4222       │
                   └───────────────┘
```

## Service Categories

### Core Services (Phase 21-28)
- `guest-service` - Guest management
- `access-control` - Entry verification
- `vip-membership` - VIP tiers & privileges
- `table-service` - Table reservations
- `event-service` - Event management
- `staff-service` - Staff scheduling
- `security-service` - Security & surveillance
- `analytics-service` - Data & reporting

### Platform Services (Phase 29-32)
- `public-api` - REST endpoints
- `graphql-api` - GraphQL API
- `webhooks` - Event subscriptions
- `developer-portal` - API keys
- `partner-api` - Integrations

### Application Services (Phase 30)
- `guest-mobile` - Guest mobile app
- `staff-app` - Staff application
- `manager-dashboard` - Management portal
- `web-portal` - Web interface
- `kiosk-mode` - Check-in kiosks
- `admin-panel` - Admin controls

### Integration Services (Phase 31-35)
- `access-control-hw` - Hardware integration
- `payment-gateways` - Payment processing
- `ai-services` - AI/ML capabilities
- `auth-security` - Security & auth
- `monitoring-obs` - Observability

## Technology Stack

| Layer | Technology |
|-------|------------|
| API Gateway | Kong 3.4 |
| Databases | PostgreSQL 15, MongoDB 7, Redis 7 |
| Message Queue | NATS 2.10 |
| Ingress | Traefik 3.0 |
| Monitoring | Prometheus, Grafana, Tempo |
| Container | Docker, Kubernetes |
| CI/CD | GitHub Actions |

## Data Flow

1. **Request Flow**: Client → API Gateway → Service → Database
2. **Event Flow**: Service → NATS → Subscribers
3. **Cache Flow**: Service → Redis → Response
4. **Async Flow**: Service → Queue → Worker → Database

## Security

- JWT authentication
- API key validation
- Rate limiting
- Input validation
- SQL injection prevention
- XSS protection
- Audit logging

## Scaling Strategy

- Horizontal scaling with Kubernetes HPA
- Read replicas for databases
- Redis caching layer
- CDN for static assets
- Load balancing via Traefik