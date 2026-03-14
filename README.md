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
