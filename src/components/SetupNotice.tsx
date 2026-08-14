'use client'

/** Which migration file creates each v2 table. */
const MIGRATION_FOR: Record<string, string> = {
  transactions: '001_transactions.sql',
  asset_metadata: '002_asset_metadata.sql',
  allocation_targets: '003_allocation_targets.sql',
  benchmark_prices: '004_benchmarks.sql',
  benchmark_config: '004_benchmarks.sql',
  financial_plan: '006_financial_plan.sql',
  expense_log: '006_financial_plan.sql',
  scenarios: '007_scenarios.sql',
  market_assumptions: '008_market_assumptions.sql',
}

/**
 * Shown when a page depends on a table that does not exist yet.
 *
 * Without this the page renders its ordinary empty state, which is
 * indistinguishable from "you have not added any data" — so the page looks
 * broken and gives no clue that a migration is the fix.
 */
export default function SetupNotice({ tables }: { tables: string[] }) {
  if (tables.length === 0) return null

  const files = Array.from(new Set(tables.map(t => MIGRATION_FOR[t]).filter(Boolean)))

  return (
    <div style={{
      background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)',
      borderRadius: 10, padding: '14px 18px', marginBottom: 16,
      fontSize: 12, color: 'var(--amber)', lineHeight: 1.7,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        ⚠ Database migration not run yet
      </div>
      <div style={{ color: 'var(--text2)' }}>
        This page needs {tables.length === 1 ? 'a table' : 'tables'} that {tables.length === 1 ? 'does' : 'do'} not
        exist in your Supabase project yet: <code style={{ color: 'var(--amber)' }}>{tables.join(', ')}</code>.
        <br /><br />
        Open the Supabase SQL editor and run{' '}
        {files.length > 0
          ? <>{files.map((f, i) => (
              <span key={f}>
                {i > 0 && ', '}
                <code style={{ color: 'var(--amber)' }}>supabase/migrations/{f}</code>
              </span>
            ))}</>
          : <code style={{ color: 'var(--amber)' }}>supabase-schema.sql</code>}
        . Every migration is idempotent, so re-running the whole
        {' '}<code style={{ color: 'var(--amber)' }}>supabase-schema.sql</code> is also safe.
      </div>
    </div>
  )
}
