# Relay — lender orchestration demo

A React dashboard with Tailwind CSS and a small Node.js API. The demo fans one synthetic application out to mock lender APIs, applies per-lender timeouts and one retry, aggregates responses, and records an audit trail.

> All lenders, offers, rates, and responses are fictional. This project is not affiliated with Rupyy and does not collect personal or financial identity data.

## Requirements

- Node.js 18 or newer
- npm

## Install and run

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally [http://localhost:5173](http://localhost:5173)). The `dev` script starts the API on port 3000 and the Vite React app; Vite proxies `/api` requests to the API.

For production:

```sh
npm run build
npm start
```

The Node server serves the generated React app from `dist` and handles `/api` routes. Set `PORT` to change its port.

## Try the demo

1. Run a match with **Healthy network** to see three concurrent lender responses.
2. Choose **One lender times out**. Harbor exceeds the request deadline, is retried once, and returns as unavailable while the other offers are preserved.
3. Inspect the live event stream for request, retry, offer, and completion events.
4. To demonstrate idempotency, send the same `Idempotency-Key` twice to the API. The second call returns the original application instead of creating another.

Example API request:

```sh
curl -s http://localhost:3000/api/applications \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: demo-request-001' \
  -d '{"product":"used-car","amount":450000,"tenure":36,"scenario":"one-timeout"}'
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health and mock-mode indicator |
| `POST` | `/api/applications` | Validate and orchestrate an application; requires `Idempotency-Key` |
| `GET` | `/api/applications/:id` | Read an application and its event history |
| `GET` | `/api/events` | Read the latest 30 in-memory events |

Application and event state is in memory and resets when the API restarts. A production design would persist idempotency records and application state, use durable event delivery, authenticate callers, apply lender-specific circuit breakers and rate limits, and protect personal data.

## Stack

- React 19 with Vite
- Tailwind CSS 4 via the Vite plugin
- Node.js built-in HTTP server for the API and production static hosting
- No UI component library or lender SDKs
