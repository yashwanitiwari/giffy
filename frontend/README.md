# Giffy Frontend

Next.js (App Router) web app for Giffy — the sender wizard, dashboard, and receiver claim pages, styled after the frosted-glass concept: the fractal glass background (`public/background.jpg`), `bg-white/10 backdrop-blur-xl border-white/20` glass cards, a floating glass navbar, and Geist type — consistently on every page.

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing: plain-language explanation + CTA into `/create` |
| `/create` | Sender wizard: connect Freighter → (optional) SEP-24 Buy Funds → compose → review → sign → success with claim link + QR |
| `/dashboard` | Gifts sent by the connected wallet, live remaining time, Reclaim action once expired |
| `/claim/[token]` | Receiver page: preview, countdown, connect + claim; terminal states for claimed/expired/invalid |

## Stack

- Next.js 15 / React 19 / TypeScript / Tailwind CSS 3
- `@stellar/freighter-api` v6 for connect / network detection / signing (all signatures happen in the user's own wallet — README §7.3)
- SWR for dashboard/claim data fetching, `qrcode.react` for the claim QR

## Running

```bash
cp .env.example .env.local   # defaults point at the backend on :4000
npm install
npm run dev                  # http://localhost:3000
```

Requires the backend running (see `/backend`) and the [Freighter](https://www.freighter.app/) extension set to **Test Net** for any signing flow.
