# Bouncer VIP Express - API Reference

## Base URLs

| Environment | URL |
|-------------|-----|
| Production | `https://api.bouncervip.co.za/v1` |
| Staging | `https://staging-api.bouncervip.co.za/v1` |
| Development | `http://localhost:3000/v1` |

## Authentication

### Bearer Token (JWT)
```bash
curl -H "Authorization: Bearer <token>" https://api.bouncervip.co.za/v1/guests
```

### API Key
```bash
curl -H "X-API-Key: <key>" https://api.bouncervip.co.za/v1/guests
```

## Endpoints

### Guests

#### List Guests
```http
GET /guests?page=1&limit=20&status=active
```

Response:
```json
{
  "data": [
    {
      "id": "guest_123",
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "status": "active",
      "vip_tier": "gold",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

#### Create Guest
```http
POST /guests
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "notes": "Regular guest, prefers corner booth"
}
```

#### Get Guest
```http
GET /guests/{id}
```

#### Update Guest
```http
PUT /guests/{id}
Content-Type: application/json

{
  "vip_tier": "platinum"
}
```

#### Delete Guest
```http
DELETE /guests/{id}
```

---

### VIP Memberships

#### List Memberships
```http
GET /vip/memberships
```

#### Create Membership
```http
POST /vip/memberships
Content-Type: application/json

{
  "guest_id": "guest_123",
  "tier": "gold",
  "start_date": "2024-01-01",
  "end_date": "2024-12-31"
}
```

#### List Tiers
```http
GET /vip/tiers
```

Response:
```json
{
  "tiers": [
    {
      "name": "bronze",
      "benefits": ["Priority entry", "Dedicated host"],
      "annual_fee": 5000
    },
    {
      "name": "silver",
      "benefits": ["Priority entry", "Dedicated host", "Free drinks"],
      "annual_fee": 15000
    },
    {
      "name": "gold",
      "benefits": ["Priority entry", "Dedicated host", "Free bottle service", "VIP lounge"],
      "annual_fee": 50000
    },
    {
      "name": "platinum",
      "benefits": ["All gold benefits", "Personal security", "Limousine service"],
      "annual_fee": 150000
    },
    {
      "name": "diamond",
      "benefits": ["All platinum benefits", "Private booth", "Direct line to management"],
      "annual_fee": 500000
    }
  ]
}
```

---

### Access Control

#### Verify Access
```http
POST /access/verify
Content-Type: application/json

{
  "guest_id": "guest_123",
  "ticket_id": "TICKET-ABC123"
}
```

Response:
```json
{
  "allowed": true,
  "guest": {
    "id": "guest_123",
    "name": "John Doe",
    "vip_tier": "gold"
  },
  "check_in_time": "2024-01-15T22:30:00Z"
}
```

---

### Table Reservations

#### List Tables
```http
GET /tables?date=2024-01-15
```

Response:
```json
{
  "tables": [
    {
      "id": "table_1",
      "name": "Table 1",
      "capacity": 8,
      "location": "main_floor",
      "price": 5000,
      "available": true
    }
  ]
}
```

#### Reserve Table
```http
POST /tables/reserve
Content-Type: application/json

{
  "guest_id": "guest_123",
  "table_id": "table_1",
  "date": "2024-01-15",
  "time": "22:00",
  "guests": 6,
  "notes": "Birthday celebration"
}
```

---

### Events

#### List Events
```http
GET /events?date=2024-01-15
```

#### Create Event
```http
POST /events
Content-Type: application/json

{
  "name": "Saturday Night Live",
  "date": "2024-01-20T21:00:00Z",
  "venue": "Main Floor",
  "description": "Live DJ performance",
  "capacity": 500,
  "dress_code": "smart_casual"
}
```

---

### Staff

#### List Shifts
```http
GET /staff/shifts?date=2024-01-15
```

#### Create Shift
```http
POST /staff/shifts
Content-Type: application/json

{
  "staff_id": "staff_456",
  "date": "2024-01-15",
  "start_time": "21:00",
  "end_time": "05:00",
  "role": "bar_server"
}
```

---

## Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 400 | BAD_REQUEST | Invalid input |
| 401 | UNAUTHORIZED | Invalid or missing auth |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Resource not found |
| 429 | RATE_LIMITED | Too many requests |
| 500 | INTERNAL_ERROR | Server error |

Error format:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Guest not found",
    "details": {}
  }
}
```

## Rate Limits

| Tier | Requests/minute |
|------|-----------------|
| Free | 60 |
| Bronze | 120 |
| Silver | 300 |
| Gold | 600 |
| Platinum | 1000 |
| Diamond | Unlimited |

## Webhooks

Subscribe to events:
```http
POST /webhooks
Content-Type: application/json

{
  "url": "https://your-server.com/webhook",
  "events": ["guest.checkin", "vip.upgrade"],
  "secret": "whsec_xxx"
}
```

Supported events:
- `guest.created`
- `guest.updated`
- `guest.checkin`
- `vip.upgrade`
- `vip.downgrade`
- `table.reserved`
- `event.cancelled`