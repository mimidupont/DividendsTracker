type Variant = 'green' | 'amber' | 'red' | 'blue' | 'gray'

const styles: Record<Variant, { bg: string; color: string; border: string }> = {
  green: { bg: 'var(--green-bg)', color: 'var(--green)', border: 'var(--green-bd)' },
  amber: { bg: 'var(--amber-bg)', color: 'var(--amber)', border: 'var(--amber-bd)' },
  red:   { bg: 'var(--red-bg)',   color: 'var(--red)',   border: 'var(--red-bd)'   },
  blue:  { bg: 'var(--blue-bg)',  color: 'var(--blue)',  border: 'var(--blue-bd)'  },
  gray:  { bg: '#f0ede8',         color: '#4a4f48',      border: '#d0cdc8'         },
}

export default function Badge({ children, variant = 'gray' }: { children: React.ReactNode; variant?: Variant }) {
  const s = styles[variant]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 500,
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      fontFamily: 'DM Mono, monospace',
    }}>
      {children}
    </span>
  )
}
