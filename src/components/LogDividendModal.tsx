'use client'
import RecordModal from './RecordModal'

/**
 * Logging a dividend records it in the dividend log and the ledger together,
 * with the payment-date FX rate and a withholding default for the issuer's
 * country (editable — the broker's figure wins).
 */
export default function LogDividendModal({
  symbol, onClose, onSaved,
}: { symbol?: string; onClose: () => void; onSaved: () => void }) {
  return <RecordModal preset={{ kind: 'dividend', symbol }} onClose={onClose} onSaved={onSaved} />
}
