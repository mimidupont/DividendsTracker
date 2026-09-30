'use client'
import { useMemo, useState } from 'react'
import { th, tdR, tdL } from '@/lib/ui'

export interface Column<T> {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  /** Numeric columns render in DM Mono with tabular figures. */
  numeric?: boolean
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => number | string | null
  render: (row: T) => React.ReactNode
  width?: number | string
}

/**
 * Shared table: sticky header, click-to-sort columns (announced via aria-sort),
 * horizontal scroll on narrow screens, numbers in a monospaced tabular face.
 */
export default function DataTable<T>({
  columns, rows, rowKey, initialSort, footer, caption, rowStyle,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  footer?: React.ReactNode
  caption?: string
  rowStyle?: (row: T) => React.CSSProperties | undefined
}) {
  const [sort, setSort] = useState(initialSort ?? null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find(c => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b)
      // Unknown values always sink to the bottom, whichever direction.
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, columns, sort])

  const toggle = (key: string) =>
    setSort(s => s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  return (
    <div className="table-wrap">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map(c => {
              const active = sort?.key === c.key
              const align = c.align ?? (c.numeric ? 'right' : 'left')
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  style={{ ...th, textAlign: align, width: c.width }}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        font: 'inherit', color: active ? 'var(--text)' : 'inherit',
                        letterSpacing: 'inherit', textTransform: 'inherit',
                      }}
                    >
                      {c.label}{active ? (sort!.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  ) : c.label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={rowKey(r)} style={rowStyle?.(r)}>
              {columns.map(c => {
                const align = c.align ?? (c.numeric ? 'right' : 'left')
                const base = align === 'left' ? tdL : tdR
                return (
                  <td
                    key={c.key}
                    className={c.numeric ? 'num' : undefined}
                    style={{ ...base, textAlign: align, fontSize: 12 }}
                  >{c.render(r)}</td>
                )
              })}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  )
}
