# Development AI Rules

**Bouncer VIP Express - Software Development Guidelines**

---

## Source File Size Guidelines

| Guideline | LoC Range | Description |
|-----------|-----------|-------------|
| **Target Average** | 300–500 | Primary target for source files |
| **Hard Limit** | 850 | Maximum unless justified |
| **Allowed Exceptions** | 1500+ | Only when required for complex logic |

### When Exceptions Are Allowed

- Complex domain models with extensive validation
- Large migration files with multiple schema changes
- Aggregation microservices with multiple concerned
- Complex state machines
- Files requiring extensive inline documentation

### Enforcement

- Split files approaching 850 LoC
- Use modular architecture (shared modules, helpers)
- Prefer composition over monolithic files

---

## Code Quality Standards

### Single Responsibility
Each service/module owns one bounded context. No multi-purpose files.

### API-First Design
Define Protocol Buffers before implementation. REST is fallback.

### Database-per-Service
Isolated data stores per microservice. No shared databases.

### Event-Driven Architecture
State changes emit domain events to NATS JetStream. Consumers process independently.

### Idempotency Required
All write operations must implement idempotency keys.

### Observability Built-In
Every service emits:
- Structured JSON logs
- Prometheus metrics
- OpenTelemetry traces

---

## Language-Specific Standards

### TypeScript/JavaScript
- Strict TypeScript configuration
- ESLint + Prettier
- Jest for unit tests

### Go
- golint + gofmt
- Standard library preferred
- Unit tests with standard testing package

### Python
- type hints required
- ruff for linting
- pytest for testing

---

## Security Requirements

- No secrets in code (use environment variables)
- Input validation with Zod (TypeScript) or Pydantic (Python)
- OWASP Top 10 considerations
- Rate limiting on all endpoints
- mTLS for internal services

---

## Testing Strategy

- Unit tests for pure functions
- Integration tests for API endpoints
- Contract tests for service communication
- Minimum 80% code coverage for critical paths

---

*Version 1.0 - Bouncer VIP Express Development Guidelines*