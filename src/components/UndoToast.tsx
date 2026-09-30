'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

const UNDO_MS = 5000

interface Pending {
  id: string
  label: string
  commit: () => Promise<{ error: string | null }>
  onDone?: () => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Deletes with a 5-second undo instead of a blocking window.confirm().
 *
 * The row disappears immediately (callers filter on `pendingIds`); the real
 * delete runs only when the toast expires. "Undo" cancels it outright, so
 * nothing ever has to be re-created.
 */
export function useUndoableDelete() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  pendingRef.current = pending

  const run = useCallback(async (p: Pending) => {
    setPending(cur => (cur?.id === p.id ? null : cur))
    const { error } = await p.commit()
    if (error) setError(`Could not delete ${p.label}: ${error}`)
    p.onDone?.()
  }, [])

  const schedule = useCallback((
    id: string, label: string,
    commit: () => Promise<{ error: string | null }>,
    onDone?: () => void,
  ) => {
    setError(null)
    // Only one pending delete at a time: flush the previous one now.
    const prev = pendingRef.current
    if (prev) { clearTimeout(prev.timer); void run(prev) }
    const p: Pending = { id, label, commit, onDone, timer: setTimeout(() => void run(p), UNDO_MS) }
    setPending(p)
  }, [run])

  const undo = useCallback(() => {
    const p = pendingRef.current
    if (!p) return
    clearTimeout(p.timer)
    setPending(null)
  }, [])

  // Leaving the page commits rather than silently dropping the delete.
  useEffect(() => () => {
    const p = pendingRef.current
    if (p) { clearTimeout(p.timer); void p.commit() }
  }, [])

  const pendingIds = new Set(pending ? [pending.id] : [])

  const toast = (pending || error) ? (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
        background: 'var(--text)', color: '#fff', borderRadius: 8, padding: '10px 14px',
        fontSize: 12, display: 'flex', gap: 14, alignItems: 'center', boxShadow: '0 6px 24px rgba(0,0,0,0.2)',
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      {pending ? <>
        <span>Deleted {pending.label}</span>
        <button type="button" onClick={undo} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.5)', color: '#fff',
          borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 12,
        }}>Undo</button>
      </> : <>
        <span>{error}</span>
        <button type="button" onClick={() => setError(null)} aria-label="Dismiss" style={{
          background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16,
        }}>×</button>
      </>}
    </div>
  ) : null

  return { schedule, pendingIds, toast }
}
