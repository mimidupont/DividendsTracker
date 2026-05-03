# Divvy — Dividend Tracker (Redesigned)

Personal dividend portfolio tracker built with Next.js 14, Supabase, and TypeScript.

---

## Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript
- **Styling**: Inline styles with CSS variables · Instrument Serif + DM Mono + Geist
- **Database**: Supabase (PostgreSQL)
- **AI features**: Claude API with web search (live yields, DRIP, ex-dates)
- **Charts**: Recharts
- **FX rates**: Frankfurter.app (free, no key needed)

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — 5 metric cards, holdings table, dividend log |
| `/holdings` | Full holdings table with live yields, edit, add lot, delete |
| `/received` | Dividend payments log with DRIP tracking |
| `/projected` | Multi-year income projections by holding |
| `/calendar` | Ex-dividend calendar — upcoming dates via AI search |
| `/currency` | Currency exposure breakdown with visual bars |
| `/tax` | Czech tax summary — gross/WHT/net for daňové přiznání |

---

## Key features

### ✎ Edit positions
Click the pencil icon on any row in Holdings to edit shares, price, currency, exchange.

### + Add lot
Click the + icon to add a new purchase lot to an existing holding.
- Recalculates weighted average price automatically
- Saves lot history to `holding_lots` table

### ⟳ Check dividends (DRIP)
Clicks Claude + web search to find confirmed dividend payments for all your holdings.
- Shows pending DRIP events with reinvestment details
- "Apply DRIP" button: logs the dividend + adds fractional shares to your position
- Uses net-of-WHT amount for reinvestment calculation

### Ex-dividend calendar
Uses Claude + web search to find upcoming ex-dividend dates for all dividend payers.
Color-coded urgency: red = within 7 days, amber = within 21 days, green = later.

### Live dividend yields
Holdings page fetches current yields via Claude + web search.
Falls back to projected yield from the database if live fetch fails.

### FX rates
Click "↻ FX rates" on the dashboard to fetch live rates from frankfurter.app.
Falls back to hardcoded defaults (USD 23.50, EUR 25.60) if unavailable.

---

## Deploy

### 1. Supabase setup

1. Create a new project at supabase.com
2. SQL Editor → New query → paste `supabase-schema.sql` → Run
3. Settings → API → copy Project URL and anon key

### 2. Environment variables

```bash
cp .env.local.example .env.local
# Fill in:
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Vercel deploy

1. Push to GitHub
2. Import at vercel.com
3. Add the two env vars above
4. Deploy — Next.js is auto-detected

### 4. Local development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

---

## Updating prices

Edit `src/lib/prices.ts` — the `PRICES` object maps ticker symbols to last-known prices in native currency.

For live prices, connect a market data API (Yahoo Finance, Polygon.io) and replace `getPrice()` in `src/lib/prices.ts`.

---

## Database tables

| Table | Purpose |
|-------|---------|
| `holdings` | Current positions with weighted avg price |
| `holding_lots` | Individual purchase lots (for history) |
| `dividends_received` | Logged dividend payments with DRIP tracking |
| `dividend_projections` | Editable annual forecasts per ticker per year |
