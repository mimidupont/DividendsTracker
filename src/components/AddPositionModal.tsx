'use client'
import RecordModal from './RecordModal'

/**
 * A new position is its first purchase. Recording it as a buy (with its real
 * date) freezes the FX rate it was paid at and puts it in the ledger, which a
 * bare insert into `holdings` did not.
 */
export default function AddPositionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  return <RecordModal preset={{ kind: 'buy', asset: 'stock' }} onClose={onClose} onSaved={onSaved} />
}
