# EcomShop — Full-Stack E-Commerce Platform

A production-ready e-commerce application with security-first architecture.

## Tech Stack

| Layer     | Technology              |
|-----------|-------------------------|
| Frontend  | Next.js 14 (App Router) |
| Backend   | Node.js + Express       |
| Database  | PostgreSQL 16           |
| Cache     | Redis 7                 |
| Proxy     | Nginx (HTTPS)           |
| Container | Docker + Compose        |

---

## Architecture

```
Browser (HTTPS)
     │
     ▼
┌─────────────┐   public_net   ┌──────────────┐
│    Nginx    │ ─────────────▶ │   Frontend   │
│  :80 / :443 │                │  Next.js :3000│
│  TLS term.  │                └──────────────┘
│  Rate limit │
│  Sec headers│   public_net   ┌──────────────┐  backend_net  ┌────────────┐
│             │ ─────────────▶ │   Backend    │ ─────────────▶ │ PostgreSQL │
└─────────────┘  /api/*        │  Express :4000│               │    :5432   │
                                │               │ ─────────────▶ ├────────────┤
                                │  Auth / RBAC  │  backend_net  │   Redis    │
                                │  Audit Log    │               │    :6379   │
                                │  MFA (TOTP)   │               └────────────┘
                                └──────────────┘
```

### Network Isolation
- **public_net** – nginx ↔ frontend, nginx ↔ backend only
- **backend_net** – backend ↔ postgres, backend ↔ redis only
- Postgres and Redis are **never** exposed to the host or public internet

---

## Security Features

### HTTPS
- Nginx terminates TLS (TLS 1.2 + 1.3 only)
- Self-signed cert for development (`nginx/generate-certs.sh`)
- HSTS, X-Frame-Options, CSP, and other security headers set globally
- HTTP automatically redirects to HTTPS

### MFA (Multi-Factor Authentication)
- TOTP-based (RFC 6238) using `otplib`
- Compatible with Google Authenticator, Authy, 1Password, etc.
- Flow: `POST /api/auth/mfa/setup` → scan QR → `POST /api/auth/mfa/verify`
- Login flow: credentials → if MFA enabled, prompt for TOTP before issuing JWT

### RBAC (Role-Based Access Control)
| Role       | Permissions                                   |
|------------|-----------------------------------------------|
| `admin`    | Full CRUD on items, view audit logs           |
| `customer` | Read items, manage own cart, checkout         |

Enforced via `requireRole('admin')` middleware on every protected route.

### Audit Log
Every mutating action is recorded in the `audit_logs` table:
- User ID, action name, entity, entity ID
- IP address, User-Agent
- Timestamp

Key logged actions: `REGISTER`, `LOGIN`, `LOGIN_FAILED`, `LOGIN_MFA_FAILED`, `LOGOUT`, `MFA_ENABLED`, `MFA_DISABLED`, `CREATE_ITEM`, `UPDATE_ITEM`, `DELETE_ITEM`, `ADD_TO_CART`, `CHECKOUT`

### JWT Security
- Tokens signed with HS256, expire in 8 hours
- Logout blacklists the token in Redis until its natural expiry
- Rate limiting: 100 req/15 min globally, 20 req/15 min on `/api/auth/`

---

## ERD

```
users
├── id (PK, UUID)
├── email (UNIQUE)
├── password_hash
├── full_name
├── role (admin | customer)
├── mfa_secret
├── mfa_enabled
├── is_active
└── created_at / updated_at

items
├── id (PK, UUID)
├── name
├── description
├── price
├── stock
├── image_url
├── is_active
├── created_by (FK → users.id)
└── created_at / updated_at

carts
├── id (PK, UUID)
├── user_id (FK → users.id)
├── status (active | checked_out | abandoned)
└── created_at / updated_at

cart_items   ← junction: carts ↔ items
├── id (PK, UUID)
├── cart_id (FK → carts.id)
├── item_id (FK → items.id)
├── quantity
└── unit_price (snapshot at time of add)

audit_logs
├── id (PK, UUID)
├── user_id (FK → users.id, nullable)
├── action
├── entity / entity_id
├── ip_address / user_agent
├── metadata (JSONB)
└── created_at
```

---

## DFD Level 1

```
         ┌──────────────────────────────────────────────────────┐
         │                   EcomShop System                    │
         │                                                      │
User ───▶│  [1. Register]  ────────────────────────▶ users DB  │
         │                                                      │
User ───▶│  [2. Login]     ──── verify ──▶ users DB            │
         │                 ◀── JWT + MFA check                  │
         │                                                      │
User ───▶│  [3. Item Mgmt] ──── read/write ──▶ items DB        │
         │                 ◀── cached read via Redis            │
         │                                                      │
User ───▶│  [4. Cart]      ──── read/write ──▶ carts DB        │
         │                 ──── stock deduct ──▶ items DB       │
         │                                                      │
         │  All 4 processes ─────────────────▶ audit_logs DB   │
         └──────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Prerequisites
- Docker ≥ 24 and Docker Compose v2
- `openssl` (for cert generation)

### 2. Clone & configure
```bash
git clone <repo>
cd ecommerce

# Create environment file
cp .env.example .env
# Edit .env with your passwords and JWT secret:
#   openssl rand -hex 64   ← use this for JWT_SECRET
nano .env
```

### 3. Generate TLS certificate
```bash
chmod +x nginx/generate-certs.sh
./nginx/generate-certs.sh
```

### 4. Build & run
```bash
docker compose up --build
```

The application will be available at **https://localhost**

> **First launch:** Accept the browser's self-signed certificate warning,
> or add `nginx/ssl/server.crt` to your system trust store.

### 5. Default admin account
```
Email:    admin@shop.local
Password: Admin@12345
```
Change this immediately after first login.

---

## API Reference

### Auth
| Method | Path                  | Auth     | Description              |
|--------|-----------------------|----------|--------------------------|
| POST   | /api/auth/register    | Public   | Register new customer    |
| POST   | /api/auth/login       | Public   | Login (+ MFA if enabled) |
| POST   | /api/auth/logout      | JWT      | Revoke token             |
| GET    | /api/auth/me          | JWT      | Get current user         |
| POST   | /api/auth/mfa/setup   | JWT      | Begin MFA setup          |
| POST   | /api/auth/mfa/verify  | JWT      | Activate MFA             |
| POST   | /api/auth/mfa/disable | JWT      | Disable MFA              |

### Items
| Method | Path            | Auth       | Description           |
|--------|-----------------|------------|-----------------------|
| GET    | /api/items      | Public     | List all items        |
| GET    | /api/items/:id  | Public     | Get single item       |
| POST   | /api/items      | Admin only | Create item           |
| PUT    | /api/items/:id  | Admin only | Update item           |
| DELETE | /api/items/:id  | Admin only | Soft-delete item      |

### Cart
| Method | Path                 | Auth | Description             |
|--------|----------------------|------|-------------------------|
| GET    | /api/cart            | JWT  | Get active cart         |
| POST   | /api/cart/items      | JWT  | Add item to cart        |
| PATCH  | /api/cart/items/:id  | JWT  | Update item quantity    |
| DELETE | /api/cart/items/:id  | JWT  | Remove item from cart   |
| POST   | /api/cart/checkout   | JWT  | Checkout (deducts stock)|

---

## Scaling

Because containers have no `container_name` set (except stateful services), you can scale stateless tiers independently:

```bash
# Scale backend to 3 replicas
docker compose up --scale backend=3

# Scale frontend to 2 replicas
docker compose up --scale frontend=2
```

Nginx will automatically load-balance across all replicas via its upstream configuration.

> PostgreSQL and Redis should use managed services (RDS, ElastiCache) in production rather than scaled containers.

---

## Production Checklist

- [ ] Replace self-signed cert with one from Let's Encrypt (`certbot`)
- [ ] Set strong, unique values for all secrets in `.env`
- [ ] Use a managed PostgreSQL instance (e.g., AWS RDS, Supabase)
- [ ] Use a managed Redis instance (e.g., AWS ElastiCache)
- [ ] Enable `ssl_stapling on` in nginx.conf once you have a real CA cert
- [ ] Set up log aggregation (e.g., Loki, Datadog)
- [ ] Configure automated database backups
- [ ] Review and tighten the CSP header in nginx.conf

---

## Project Structure

```
ecommerce/
├── docker-compose.yml
├── .env.example
├── nginx/
│   ├── nginx.conf           # Reverse proxy + HTTPS config
│   ├── generate-certs.sh    # Self-signed cert generator
│   └── ssl/                 # Certs (git-ignored)
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js         # Express app entry point
│       ├── config/
│       │   ├── db.js        # PostgreSQL pool
│       │   └── redis.js     # Redis client
│       ├── middleware/
│       │   ├── auth.js      # JWT verification
│       │   ├── rbac.js      # Role-based access control
│       │   └── auditLog.js  # Audit logging
│       ├── routes/
│       │   ├── auth.js      # Register, login, MFA, logout
│       │   ├── items.js     # Item CRUD
│       │   └── cart.js      # Cart management + checkout
│       └── db/
│           └── schema.sql   # DDL: users, items, carts, audit_logs
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.js
    └── src/
        ├── app/
        │   ├── layout.js         # Root layout
        │   ├── page.js           # Home
        │   ├── globals.css       # Design tokens + utilities
        │   ├── auth/
        │   │   ├── login/        # Login + MFA step
        │   │   └── register/     # Registration
        │   ├── items/            # Shop catalogue
        │   ├── cart/             # Cart + checkout
        │   ├── profile/          # MFA management
        │   └── dashboard/        # Admin item management
        ├── components/
        │   └── Navbar.js
        └── lib/
            ├── api.js            # Axios client + API helpers
            └── auth-context.js   # React auth state
```
