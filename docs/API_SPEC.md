# Bouncer VIP Platform - OpenAPI Specification

## Overview

| Item | Value |
|------|-------|
| Version | 1.0.0 |
| Title | Bouncer VIP Platform API |
| Description | Security services management platform API |
| Base URL | https://api.bouncervip.com/v1 |

---

## Authentication

All API requests require authentication via Bearer token:

```bash
curl -H "Authorization: Bearer <token>" https://api.bouncervip.com/v1/...
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/login | Login with credentials |
| POST | /auth/register | Register new user |
| POST | /auth/logout | Logout |
| POST | /auth/refresh | Refresh token |
| POST | /auth/forgot-password | Request password reset |
| POST | /auth/reset-password | Reset password |

### Request Body (Login)

```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 3600,
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "role": "admin"
    }
  }
}
```

---

## Users

### List Users

```bash
GET /users
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| page | integer | Page number (default: 1) |
| limit | integer | Items per page (default: 20) |
| role | string | Filter by role |
| status | string | Filter by status |

### Get User

```bash
GET /users/{id}
```

### Create User

```bash
POST /users
```

```json
{
  "email": "newuser@example.com",
  "first_name": "Jane",
  "last_name": "Smith",
  "phone": "+27831234567",
  "role": "officer"
}
```

### Update User

```bash
PUT /users/{id}
```

### Delete User

```bash
DELETE /users/{id}
```

---

## Officers

### List Officers

```bash
GET /officers
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| page | integer | Page number |
| limit | integer | Items per page |
| grade | string | Filter by grade (A-E) |
| status | string | Filter by status |
| skill | string | Filter by skill |

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "phone": "+27831234567",
      "grade": "B",
      "status": "active",
      "skills": ["first_aid", "fire_safety"],
      "psira_number": "PSIRA/2024/001",
      "rating": 4.5,
      "shifts_completed": 150
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

### Get Officer

```bash
GET /officers/{id}
```

### Create Officer

```bash
POST /officers
```

```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@example.com",
  "phone": "+27839876543",
  "grade": "C",
  "skills": ["first_aid"],
  "psira_number": "PSIRA/2024/002",
  "psira_expiry": "2025-12-31"
}
```

### Update Officer

```bash
PUT /officers/{id}
```

### Assign Shift

```bash
POST /officers/{id}/shifts
```

```json
{
  "shift_id": "shift-uuid"
}
```

---

## Venues

### List Venues

```bash
GET /venues
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| city | string | Filter by city |
| risk_level | string | Filter by risk level |
| status | string | Filter by status |

### Get Venue

```bash
GET /venues/{id}
```

### Create Venue

```bash
POST /venues
```

```json
{
  "name": "Sandton Convention Centre",
  "address": "161 Maude Street",
  "city": "Johannesburg",
  "province": "Gauteng",
  "latitude": -26.1076,
  "longitude": 28.0537,
  "capacity": 5000,
  "risk_level": "high",
  "contact_person": "John Manager",
  "contact_phone": "+27831234567"
}
```

### Update Venue

```bash
PUT /venues/{id}
```

---

## Bookings

### List Bookings

```bash
GET /bookings
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status |
| venue_id | string | Filter by venue |
| client_id | string | Filter by client |
| from_date | string | Filter from date |
| to_date | string | Filter to date |
| page | integer | Page number |
| limit | integer | Items per page |

### Get Booking

```bash
GET /bookings/{id}
```

### Create Booking

```bash
POST /bookings
```

```json
{
  "venue_id": "venue-uuid",
  "client_id": "client-uuid",
  "service_type": "standard",
  "requested_date": "2024-12-25",
  "start_time": "18:00",
  "end_time": "02:00",
  "officer_count": 5,
  "special_instructions": "VIP entrance security required"
}
```

### Update Booking

```bash
PUT /bookings/{id}
```

### Cancel Booking

```bash
POST /bookings/{id}/cancel
```

### Assign Officers

```bash
POST /bookings/{id}/assign
```

```json
{
  "officer_ids": ["uuid1", "uuid2", "uuid3"]
}
```

---

## Shifts

### List Shifts

```bash
GET /shifts
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| officer_id | string | Filter by officer |
| venue_id | string | Filter by venue |
| status | string | Filter by status |
| date | string | Filter by date |

### Get Shift

```bash
GET /shifts/{id}
```

### Create Shift

```bash
POST /shifts
```

```json
{
  "officer_id": "officer-uuid",
  "venue_id": "venue-uuid",
  "start_time": "2024-12-25T18:00:00Z",
  "end_time": "2024-12-26T02:00:00Z",
  "hourly_rate": 150,
  "service_type": "standard"
}
```

### Check In

```bash
POST /shifts/{id}/checkin
```

```json
{
  "latitude": -26.1076,
  "longitude": 28.0537,
  "accuracy": 10
}
```

### Check Out

```bash
POST /shifts/{id}/checkout
```

```json
{
  "notes": "All quiet, no incidents"
}
```

---

## Incidents

### List Incidents

```bash
GET /incidents
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status |
| severity | string | Filter by severity |
| type | string | Filter by type |
| venue_id | string | Filter by venue |

### Get Incident

```bash
GET /incidents/{id}
```

### Create Incident

```bash
POST /incidents
```

```json
{
  "title": "Theft at main entrance",
  "description": "Suspect stole items from vehicle",
  "incident_type": "theft",
  "severity": "high",
  "venue_id": "venue-uuid",
  "location": {
    "lat": -26.1076,
    "lng": 28.0537
  }
}
```

### Update Incident

```bash
PUT /incidents/{id}
```

### Resolve Incident

```bash
POST /incidents/{id}/resolve
```

```json
{
  "resolution": "Police called, suspect apprehended"
}
```

---

## Invoices

### List Invoices

```bash
GET /invoices
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status |
| client_id | string | Filter by client |
| from_date | string | Filter from date |
| to_date | string | Filter to date |

### Get Invoice

```bash
GET /invoices/{id}
```

### Create Invoice

```bash
POST /invoices
```

```json
{
  "client_id": "client-uuid",
  "venue_id": "venue-uuid",
  "due_date": "2024-12-31",
  "line_items": [
    {
      "description": "Security Services - December 2024",
      "quantity": 10,
      "rate": 1500
    }
  ],
  "notes": "Payment due within 30 days"
}
```

### Send Invoice

```bash
POST /invoices/{id}/send
```

### Mark as Paid

```bash
POST /invoices/{id}/paid
```

```json
{
  "payment_method": "eft",
  "reference": "EFT123456"
}
```

---

## Dashboard

### Get Stats

```bash
GET /dashboard/stats
```

**Response:**

```json
{
  "success": true,
  "data": {
    "total_officers": 50,
    "active_officers": 42,
    "total_venues": 25,
    "active_bookings": 15,
    "pending_invoices": 8,
    "open_incidents": 3,
    "monthly_revenue": 1250000,
    "attendance_rate": 94.5
  }
}
```

### Get Revenue Chart

```bash
GET /dashboard/revenue?days=30
```

### Get Booking Trends

```bash
GET /dashboard/bookings?days=30
```

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Error message",
  "details": [
    {
      "path": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### Common Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 422 | Validation Error |
| 429 | Rate Limited |
| 500 | Server Error |

---

## Rate Limiting

API requests are rate limited:

| Endpoint | Limit |
|----------|-------|
| /auth/* | 5 requests/minute |
| /api/* | 100 requests/minute |
| /search | 60 requests/minute |

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-12-25T12:00:00Z
```

---

## Versioning

API versioning is handled via URL path:

```
https://api.bouncervip.com/v1/users
https://api.bouncervip.com/v2/users  # Future versions
```

---

## Webhooks

Configure webhooks for real-time events:

```bash
POST /webhooks
```

```json
{
  "url": "https://your-server.com/webhook",
  "events": ["booking.created", "incident.reported", "invoice.paid"],
  "secret": "your-webhook-secret"
}
```

### Supported Events

| Event | Description |
|-------|-------------|
| booking.created | New booking created |
| booking.updated | Booking status changed |
| shift.started | Officer checked in |
| shift.completed | Officer checked out |
| incident.created | New incident reported |
| incident.resolved | Incident resolved |
| invoice.created | Invoice created |
| invoice.paid | Invoice paid |

---

## Pagination

List endpoints support pagination:

```bash
GET /officers?page=2&limit=50
```

**Response includes:**

```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 50,
    "total": 150,
    "pages": 3
  }
}
```

---

## Filtering

Filter results using query parameters:

```bash
GET /bookings?status=pending&venue_id=uuid&from_date=2024-01-01
```

---

## Sorting

Sort results using `sort_by` and `sort_order`:

```bash
GET /officers?sort_by=rating&sort_order=desc
```

---

## Common Data Types

### Date Format

All dates use ISO 8601 format: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`

### UUID

All IDs use UUID v4 format: `550e8400-e29b-41d4-a716-446655440000`

### Currency

All amounts in South African Rand (ZAR), stored as cents:

```json
{
  "amount": 150000  // R1,500.00
}
```
