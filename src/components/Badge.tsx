type Variant = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'live'

const styles: Record<Variant, React.CSSProperties> = {
  green: { background: 'var(--green-bg)', color: 'var(--green)',  border: '1px solid var(--green-bd)' },
  amber: { background: 'var(--amber-bg)', color: 'var(--amber)',  border: '1px solid var(--amber-bd)' },
  red:   { background: 'var(--red-bg)',   color: 'var(--red)',    border: '1px solid var(--red-bd)'   },
  blue:  { background: 'var(--blue-bg)',  color: 'var(--blue)',   border: '1px solid var(--blue-bd)'  },
  gray:  { background: 'var(--bg3)',      color: 'var(--text3)',  border: '1px solid var(--border2)'  },
  live:  { background: '#e6f1fb',         color: '#185fa5',       border: '1px solid #a8c2e8'         },
}

export default function Badge({
  children,
  variant = 'gray',
  style,
}: {
  children: React.ReactNode
  variant?: Variant
  style?: React.CSSProperties
}) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '1px 7px',
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 500,
      fontFamily: "'DM Mono', monospace",
      whiteSpace: 'nowrap',
      ...styles[variant],
      ...style,
    }}>
      {children}
    </span>
  )
}
