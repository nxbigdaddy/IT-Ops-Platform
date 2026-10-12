export type EvidenceEntry = { key: string; label: string; detail: string }
type Stored = EvidenceEntry & { order: number }
const entries = new Map<string, Stored>()
const listeners = new Set<() => void>()
let order = 0
// Only already-validated conclusions are published; entries never carry submitted free text or secrets.
export function publishEvidence(entry: EvidenceEntry): void {
  if (!entry.key || !entry.label || entry.detail.length > 200) return
  entries.set(entry.key, { ...entry, order: order++ })
  listeners.forEach(listener => listener())
}
export function clearEvidence(): void {
  entries.clear(); order = 0; listeners.forEach(listener => listener())
}
export function evidenceSnapshot(): EvidenceEntry[] {
  return [...entries.values()].sort((left, right) => left.order - right.order).map(({ key, label, detail }) => ({ key, label, detail }))
}
export function subscribeEvidence(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
