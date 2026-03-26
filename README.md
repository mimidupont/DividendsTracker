# Divvy — Dividend Tracker

Personal dividend portfolio tracker built with Next.js, Supabase, and Tailwind CSS.
Deployed on Vercel.

---

## Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript
- **Styling**: Tailwind CSS + inline styles
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Vercel
- **Charts**: Recharts

---

## Deploy in 4 steps

### 1. Supabase — set up the database

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Once created, go to **SQL Editor** → **New query**
3. Paste the entire contents of `supabase-schema.sql` and click **Run**
4. This creates your tables and seeds your current portfolio data
5. Go to **Settings → API** and copy:
   - `Project URL`
   - `anon public` key

### 2. GitHub — push the code

```bash
# In this project folder:
git init
git add .
git commit -m "initial commit"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/dividend-tracker.git
git branch -M main
git push -u origin main
```

### 3. Vercel — deploy

1. Go to [vercel.com](https://vercel.com) and click **Add New Project**
2. Import your GitHub repository
3. Under **Environment Variables**, add:
   ```
   NEXT_PUBLIC_SUPABASE_URL      = your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY = your-anon-key
   ```
4. Click **Deploy** — Vercel auto-detects Next.js, no config needed

### 4. Local development (optional)

```bash
# Copy env template
cp .env.local.example .env.local
# Fill in your Supabase URL and key in .env.local

npm install
npm run dev
# Open http://localhost:3000
```

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — portfolio overview, metrics, charts |
| `/holdings` | All positions with P&L, filterable by dividend/non-dividend |
| `/received` | Dividend payments log with WHT tracking |
| `/projected` | 2027 income projections by holding |

---

## Updating your portfolio

### Add a new holding
In Supabase → Table Editor → `holdings` → Insert row

### Log a dividend payment
Use the **+ Log dividend** button on the dashboard or `/received` page

### Update projections
In Supabase → Table Editor → `dividend_projections` → edit rows

### Update current prices
Edit the `PRICES` object in `src/app/page.tsx` and `src/app/holdings/page.tsx`
(Future improvement: connect to a market data API)

---

## Future improvements

- [ ] Connect to a free market data API (e.g. Yahoo Finance) for live prices
- [ ] Add IBKR statement import (CSV upload)
- [ ] Email/push alerts for upcoming ex-dividend dates
- [ ] Multi-year projection charts
- [ ] Tax report export for Czech tax return
