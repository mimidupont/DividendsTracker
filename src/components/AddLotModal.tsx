'use client'
import type { Holding } from '@/lib/supabase'
import RecordModal from './RecordModal'

/**
 * "Add lot" is a purchase: it goes through the Record flow so the lot, the
 * position's average cost *and rate*, and the ledger row are written together.
 */
export default function AddLotModal({
  holding, onClose, onSaved,
}: { holding: Holding; onClose: () => void; onSaved: () => void }) {
  return <RecordModal preset={{ kind: 'buy', asset: 'stock', symbol: holding.symbol }} onClose={onClose} onSaved={onSaved} />
}
