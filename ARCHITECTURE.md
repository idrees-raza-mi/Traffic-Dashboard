# TrackPulse — Full System Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TRACKPULSE ARCHITECTURE                      │
│                                                                     │
│  Client Website                                                     │
│  ┌───────────────┐    HTTPS POST                                    │
│  │ tracking-     │───────────────────────────────────┐              │
│  │ pixel.js      │    /v1/collect (sendBeacon)       │              │
│  └───────────────┘                                   ▼              │
│                                          ┌─────────────────────┐   │
│                                          │   API Gateway       │   │
│                                          │  (Rate Limiting /   │   │
│                                          │   Auth / CORS)      │   │
│                                          └──────────┬──────────┘   │
│                                                     │              │
│                                          ┌──────────▼──────────┐   │
│                                          │  Express.js API     │   │
│                                          │                     │   │
│                                          │  POST /v1/collect   │   │
│                                          │  GET  /v1/analytics │   │
│                                          │  GET  /v1/realtime  │   │
│                                          │  POST /v1/clients   │   │
│                                          └──────┬──────┬───────┘   │
│                                                 │      │           │
│                              ┌──────────────────┘      │           │
│                              ▼                          ▼           │
│                   ┌──────────────────┐    ┌────────────────────┐   │
│                   │    MongoDB       │    │   Redis Cache      │   │
│                   │                 │    │                    │   │
│                   │  events         │    │  realtime counts   │   │
│                   │  sessions       │    │  rate limits       │   │
│                   │  clients        │    │  session dedup     │   │
│                   │  campaigns      │    └────────────────────┘   │
│                   └──────────────────┘                            │
│                                                                     │
│  Agency Dashboard                                                   │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  React / Next.js Frontend           TrackPulse Dashboard     │ │
│  │  ┌──────────┐  ┌───────────────┐  ┌──────────────────────┐  │ │
│  │  │ Overview │  │Traffic Sources│  │  Campaign Tracking   │  │ │
│  │  │ Charts   │  │  Pie + Trend  │  │  UTM Attribution     │  │ │
│  │  └──────────┘  └───────────────┘  └──────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema (MongoDB)

### Collection: `clients`
```json
{
  "_id": "ObjectId",
  "agencyId": "ObjectId",
  "name": "TechCorp Inc",
  "domain": "techcorp.io",
  "industry": "SaaS",
  "plan": "pro",
  "siteId": "tp_C1_A3B4C5D6E7",
  "pixelInstalled": true,
  "createdAt": "ISODate",
  "settings": {
    "goals": [{ "name": "signup", "path": "/thank-you" }],
    "ignoredIPs": ["10.0.0.0/8"]
  }
}
```

### Collection: `events`
```json
{
  "_id": "ObjectId",
  "siteId": "tp_C1_A3B4C5D6E7",
  "sessionId": "tp_abc123_xyz789",
  "event": "pageview",
  "url": "https://techcorp.io/pricing",
  "path": "/pricing",
  "title": "Pricing — TechCorp",
  "referrer": "https://google.com",
  "source": "seo_organic",
  "utm": {
    "source": "google",
    "medium": "cpc",
    "campaign": "summer_launch_q3",
    "term": "project management saas",
    "content": "hero_cta"
  },
  "device": "desktop",
  "os": "macos",
  "browser": "chrome",
  "screen": "1920x1080",
  "language": "en-US",
  "timezone": "America/New_York",
  "scrollDepth": 78,
  "country": "US",
  "city": "New York",
  "ip": "[hashed]",
  "timestamp": "ISODate",
  "ts": 1700000000000
}
```

### Collection: `sessions`
```json
{
  "_id": "ObjectId",
  "sessionId": "tp_abc123_xyz789",
  "siteId": "tp_C1_A3B4C5D6E7",
  "visitorId": "tp_visitor_fingerprint_hash",
  "isNew": true,
  "startedAt": "ISODate",
  "endedAt": "ISODate",
  "duration": 214,
  "pageCount": 4,
  "source": "seo_organic",
  "campaign": "summer_launch_q3",
  "converted": true,
  "conversionGoal": "signup",
  "bounced": false,
  "device": "desktop",
  "country": "US"
}
```

### Collection: `agencies`
```json
{
  "_id": "ObjectId",
  "name": "Digital Agency Inc",
  "email": "admin@agency.com",
  "passwordHash": "bcrypt_hash",
  "plan": "business",
  "clientLimit": 50,
  "createdAt": "ISODate",
  "apiKey": "sk_live_xxxxx"
}
```

### MongoDB Indexes
```javascript
// Performance-critical indexes
db.events.createIndex({ siteId: 1, timestamp: -1 });
db.events.createIndex({ siteId: 1, source: 1, timestamp: -1 });
db.events.createIndex({ sessionId: 1 });
db.events.createIndex({ "utm.campaign": 1, siteId: 1 });
db.events.createIndex({ timestamp: 1 }, { expireAfterSeconds: 63072000 }); // 2yr TTL
db.sessions.createIndex({ siteId: 1, startedAt: -1 });
db.sessions.createIndex({ visitorId: 1, siteId: 1 });
```

---

## Backend API Endpoints (Express.js)

### Public Tracking Endpoint
```
POST /v1/collect
Rate limit: 100 req/min per IP
Body: EventPayload (see tracking-pixel.js)
Response: 204 No Content

Security:
  - CORS: allow from tracked domains only
  - Rate limiting via Redis
  - IP hash (never store raw IPs)
  - Bot filtering via UA analysis
  - Payload size limit: 8KB
```

### Analytics API (Authenticated)
```
GET  /v1/analytics/:siteId/overview
     ?from=2024-01-01&to=2024-01-31
     Returns: KPI summary, trends vs previous period

GET  /v1/analytics/:siteId/sources
     ?from=&to=
     Returns: Traffic source breakdown with conversions

GET  /v1/analytics/:siteId/pages
     ?from=&to=&limit=50
     Returns: Top pages with visits, bounce, time-on-page

GET  /v1/analytics/:siteId/campaigns
     ?from=&to=
     Returns: UTM campaign performance

GET  /v1/analytics/:siteId/geo
     Returns: Visitor countries and cities

GET  /v1/analytics/:siteId/devices
     Returns: Device, OS, browser breakdown

GET  /v1/analytics/:siteId/trend
     ?period=daily|weekly|monthly&from=&to=
     Returns: Time-series data for charts

WS  /v1/realtime/:siteId
     WebSocket: live visitor count + recent events
```

### Client Management API
```
GET    /v1/clients              List all clients for agency
POST   /v1/clients              Create new client + generate siteId
GET    /v1/clients/:id          Get client details
PUT    /v1/clients/:id          Update client
DELETE /v1/clients/:id          Archive client
GET    /v1/clients/:id/pixel    Get tracking script for client
```

### Auth API
```
POST /v1/auth/register          Agency registration
POST /v1/auth/login             Returns JWT + refresh token
POST /v1/auth/refresh           Refresh JWT
POST /v1/auth/logout
```

### Reports API
```
POST /v1/reports/pdf            Generate PDF report
POST /v1/reports/share          Create shareable read-only link
POST /v1/reports/schedule       Schedule email reports
```

---

## Express.js App Structure

```
backend/
├── src/
│   ├── app.js                  Express app setup
│   ├── config/
│   │   ├── database.js         MongoDB connection
│   │   └── redis.js            Redis connection
│   ├── middleware/
│   │   ├── auth.js             JWT verification
│   │   ├── rateLimit.js        Redis-based rate limiting
│   │   ├── botFilter.js        Bot/spam detection
│   │   └── cors.js             Dynamic CORS by siteId
│   ├── routes/
│   │   ├── collect.js          POST /v1/collect (pixel endpoint)
│   │   ├── analytics.js        GET analytics routes
│   │   ├── clients.js          Client CRUD
│   │   ├── auth.js             Auth routes
│   │   └── reports.js          Report generation
│   ├── services/
│   │   ├── attribution.js      Traffic source detection logic
│   │   ├── aggregation.js      MongoDB aggregation pipelines
│   │   ├── realtime.js         WebSocket + Redis pub/sub
│   │   ├── geoip.js            MaxMind GeoIP lookup
│   │   └── pdf.js              PDF report generation (Puppeteer)
│   └── models/
│       ├── Event.js
│       ├── Session.js
│       ├── Client.js
│       └── Agency.js
└── package.json
```

---

## Key Aggregation Pipeline (MongoDB)

```javascript
// Traffic source breakdown with conversion rate
db.events.aggregate([
  { $match: {
    siteId: siteId,
    timestamp: { $gte: from, $lte: to },
    event: 'pageview'
  }},
  { $group: {
    _id: '$source',
    visits: { $sum: 1 },
    sessions: { $addToSet: '$sessionId' }
  }},
  { $lookup: {
    from: 'sessions',
    let: { source: '$_id' },
    pipeline: [
      { $match: { $expr: { $eq: ['$source', '$$source'] }, siteId, converted: true }},
      { $count: 'total' }
    ],
    as: 'conversions'
  }},
  { $project: {
    source: '$_id',
    visits: 1,
    uniqueSessions: { $size: '$sessions' },
    conversions: { $ifNull: [{ $arrayElemAt: ['$conversions.total', 0] }, 0] },
    conversionRate: { $divide: [
      { $ifNull: [{ $arrayElemAt: ['$conversions.total', 0] }, 0] },
      { $size: '$sessions' }
    ]}
  }},
  { $sort: { visits: -1 }}
]);
```

---

## Real-time WebSocket Architecture

```javascript
// Server (Node.js + ws)
const WebSocket = require('ws');
const redis = require('redis');
const sub = redis.createClient();

// When pixel fires a hit, publish to Redis channel
async function onHit(siteId, event) {
  await redis.publish(`hits:${siteId}`, JSON.stringify(event));
  await redis.incr(`realtime:${siteId}:count`);
  await redis.expire(`realtime:${siteId}:count`, 300); // 5-min window
}

// WebSocket server: subscribe to Redis, broadcast to dashboard
wss.on('connection', (ws, req) => {
  const siteId = getSiteIdFromRequest(req);
  sub.subscribe(`hits:${siteId}`);
  sub.on('message', (channel, message) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
});
```

---

## Security Implementation

```javascript
// Rate limiting middleware
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

const collectLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 100,              // 100 events per IP per minute
  store: new RedisStore({ client: redisClient }),
  keyGenerator: req => req.ip + ':' + req.body.siteId,
  skip: req => isWhitelistedIP(req.ip)
});

// Bot filter
function isBotRequest(req) {
  const ua = req.headers['user-agent'] || '';
  const BOT_PATTERNS = /bot|crawl|spider|slurp|mediapartners|googleads/i;
  if (BOT_PATTERNS.test(ua)) return true;
  if (!req.headers['accept-language']) return true;  // Bots often skip
  if (req.headers['content-length'] === '0') return true;
  return false;
}

// IP hashing (GDPR compliance — never store raw IPs)
const crypto = require('crypto');
function hashIP(ip) {
  const salt = process.env.IP_SALT;
  return crypto.createHmac('sha256', salt).update(ip).digest('hex').substr(0, 16);
}
```

---

## Deployment Guide

### Prerequisites
- Node.js 20+
- MongoDB 7+ (Atlas recommended)
- Redis 7+
- Domain with SSL certificate

### Environment Variables
```bash
# .env
NODE_ENV=production
PORT=3000
JWT_SECRET=your-256-bit-secret
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/trackpulse
REDIS_URL=redis://localhost:6379
IP_SALT=your-random-salt-for-ip-hashing
MAXMIND_LICENSE_KEY=your-geoip-license
ALLOWED_ORIGINS=https://app.trackpulse.io
```

### Docker Compose
```yaml
version: '3.8'
services:
  api:
    build: ./backend
    ports: ["3000:3000"]
    env_file: .env
    depends_on: [mongo, redis]

  dashboard:
    build: ./frontend
    ports: ["80:80"]
    environment:
      - NEXT_PUBLIC_API_URL=https://api.trackpulse.io

  mongo:
    image: mongo:7
    volumes: ["mongo_data:/data/db"]

  redis:
    image: redis:7-alpine
    volumes: ["redis_data:/data"]

volumes:
  mongo_data:
  redis_data:
```

### Deployment Commands
```bash
# 1. Clone and install
git clone https://github.com/your-agency/trackpulse
cd trackpulse && npm install

# 2. Database setup
npm run db:migrate
npm run db:seed  # Optional: demo data

# 3. Build frontend
cd frontend && npm run build

# 4. Start services
docker-compose up -d

# 5. Verify health
curl https://api.trackpulse.io/health
```

---

## Frontend Component Structure

```
frontend/src/
├── pages/
│   ├── index.jsx           Dashboard overview
│   ├── sources.jsx         Traffic sources
│   ├── campaigns.jsx       Campaign performance
│   ├── pages.jsx           Top pages
│   ├── realtime.jsx        Live visitors
│   ├── setup.jsx           Tracking script
│   └── clients/
│       ├── index.jsx       Client list
│       └── [id].jsx        Client detail
├── components/
│   ├── charts/
│   │   ├── TrendChart.jsx     Area chart (Recharts)
│   │   ├── SourcePie.jsx      Doughnut chart
│   │   ├── DeviceBar.jsx      Bar chart
│   │   └── GeoMap.jsx         World map (react-simple-maps)
│   ├── ui/
│   │   ├── StatCard.jsx
│   │   ├── DataTable.jsx
│   │   ├── Badge.jsx
│   │   └── DateRangePicker.jsx
│   └── layout/
│       ├── Sidebar.jsx
│       ├── Topbar.jsx
│       └── ClientSwitcher.jsx
├── hooks/
│   ├── useAnalytics.js     SWR data fetching
│   ├── useRealtime.js      WebSocket hook
│   └── useClient.js        Active client state
└── lib/
    ├── api.js              API client
    └── utils.js            Formatters, helpers
```

---

## UTM Attribution Logic

| Traffic Type | UTM Medium | UTM Source | Detected As |
|---|---|---|---|
| Google Search Ads | cpc | google | `google_ads` |
| Google Display | display | google | `google_display` |
| Facebook/Instagram Ads | paid_social | facebook | `facebook_ads` |
| TikTok Ads | paid_social | tiktok | `tiktok_ads` |
| LinkedIn Ads | paid_social | linkedin | `linkedin_ads` |
| Email Campaign | email | newsletter | `email` |
| Organic Google | _(referrer)_ | — | `seo_organic` |
| Direct | _(no referrer)_ | — | `direct` |
| Other website | _(referrer)_ | — | `referral` |
