# CLAUDE.md — Divvy

## Project goal

Divvy is a **personal wealth tracker**. Its job is to give one person (or household
profile) a single, trustworthy view of everything they own and owe, in **CZK**, and
how it changes over time.

Asset classes in scope:

| Class | Status | Where it lives |
|---|---|---|
| Stocks & ETFs (positions, lots, dividends, DRIP) | ✅ built | `holdings`, `holding_lots`, `dividends_received`, `/holdings`, `/performance` |
| Crypto (holdings, staking yield) | ✅ built | `crypto_holdings`, `/crypto` |
| Cash — current accounts | ✅ built | `bank_accounts`, `/cash` |
| Savings accounts & term deposits (interest) | ✅ built (inside cash) | `bank_accounts`, `bank_interest_received` |
| Real estate (value, ownership %, mortgage, rent) | ✅ built | `real_estate`, `/realestate` |
| Bonds (govt/corporate, savings bonds, coupons, maturity, YTM, duration) | ✅ built | `bond_holdings`, `src/lib/bonds.ts`, `/bonds`; bond ETFs (`asset_type = 'bond_etf'`) count as `bond` |

Priorities, in order:
1. **Correct numbers.** A wealth tracker that is wrong is worse than none. Every
   reported figure must be explainable and reproducible from `src/lib/*`.
2. **Complete picture.** Every asset class above feeds net worth, allocation,
   returns and the income forecast through one normalised model (`buildPositions()`).
3. **Clarity.** Pages should answer "how much do I have, where, and is it on track?"
   at a glance, and say honestly when data is missing, stale or estimated.

Non-goals: trading/execution, multi-tenant SaaS, tax filing (we surface figures the
Czech return needs, but do not file).

## Stack

Next.js 14 (App Router) · TypeScript · Supabase (Postgres) · Recharts · Vitest.
Prices: StockAnalysis → Yahoo fallback (scraped); crypto: CoinGecko; FX: Frankfurter.
Deployed on Vercel with a daily cron snapshot (`/api/cron/snapshot`).

```bash
npm run dev     # localhost:3000
npm test        # Vitest — maths in src/lib
npm run lint
npm run build   # must pass with no new TS errors
```
Node ≥ 22.

## Architecture rules (non-negotiable)

- **Base currency is CZK.** Convert with `toCZK()` from `src/lib/fx.ts`; never sum
  mixed currencies. Format with `fmtCZK`, `fmtNum`, `fmtDate` — no new formatters.
- **One position model.** `src/lib/portfolio.ts` → `buildPositions()` is the single
  source of "everything I own". New asset classes (e.g. bonds) are added *there*,
  not as parallel logic in a page.
- **Maths in `src/lib/*` as pure functions**, never in components. Anything that
  changes a reported number ships with a Vitest test that pins it.
- **Data access through `useAppData()`** — don't add ad-hoc Supabase calls in pages.
- **`profile_id` on every query and insert.** A cross-profile leak is the worst bug
  this app can have. Use `updateScoped` / `deleteScoped` / `insertScoped` from
  `src/lib/db.ts`, never a bare `.eq('id', …)`.
- **Money movements go through `recordEvent()`** (`src/lib/db.ts` → the
  `record_event()` SQL function, migration 012) so the ledger and the position
  change atomically. UI entry point: `RecordModal`.
- **Freeze FX at transaction time** (`fx_rate_czk` on the row). Never re-derive
  historical CZK values from today's rate.
- **Unknown ≠ zero.** Values that can't be computed render `—`, never `NaN`, `0`
  or `Infinity`. Missing quotes fall back to cost and are labelled "at cost";
  fallback FX is labelled as such.
- **Rates are decimal fractions** in the DB (4.5% = `0.045`); the sole exception is
  `ownership_pct` (0–100).
- **Migrations**: one idempotent file per feature in `supabase/migrations/NNN_*.sql`,
  also appended to `supabase-schema.sql`. Never drop or rewrite a column.
- **Styling**: inline styles + CSS variables; reuse `src/lib/ui.ts` helpers and
  `Badge`. Asset colours: stocks `--green`, cash `--blue`, crypto `--purple`,
  real estate `--teal`, warnings/income `--amber`, negatives `--red`,
  bonds `--c-bond`, ETFs `--c-etf`. Text greys `--text3`/`--text4` are tuned for
  WCAG AA contrast — don't lighten them.
- **Empty state everywhere.** Every page must render usefully with zero rows.

## Security posture

Single-user, private deployment: anon key + RLS disabled is a *known, documented*
decision (see README). Don't silently "fix" it, but do flag anything that widens
exposure, and don't add new unauthenticated write routes. `CRON_SECRET` must stay
required.

## Review agents

Project sub-agents live in `.claude/agents/`. Each is read-only and returns a
prioritised list of findings with file:line references and a concrete fix.

| Agent | Use it for |
|---|---|
| `code-reviewer` | Code quality, architecture-rule violations, types, hooks, security, perf, tests |
| `finance-logic-reviewer` | Correctness of the financial maths: FX, returns, P&L, dividends/WHT, net worth, FIRE, Monte Carlo, bonds |
| `ux-ui-reviewer` | Information architecture, dashboard clarity, consistency, empty/error states, accessibility, responsiveness |

Run all three for a full review, e.g. *"Use the code-reviewer, finance-logic-reviewer
and ux-ui-reviewer agents in parallel to review the app, then merge their findings
into one prioritised list."* Agents suggest; they do not edit files.

## Key references

- `README.md` — how every number is computed; tunable assumptions (`src/lib/tax.ts`, etc.)
- `docs/REVIEW-2026-09-30.md` — the three-agent review this version implements
- `docs/DIVVY_V2_SPEC.md` — feature spec, conventions, definition of done
- `supabase-schema.sql` — full current schema
