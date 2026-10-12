export type ProviderValue = { value: number; name: string; displayName: string }
// Numeric preflight values come from the server; guessing them from array order would silently drift.
export function parseProviderValues(value: unknown): ProviderValue[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null
  const parsed = value.map(entry => {
    const v = entry as Partial<ProviderValue>
    if (!v || typeof v !== 'object') return null
    if (!Number.isInteger(v.value) || (v.value as number) < 0 || (v.value as number) > 63) return null
    if (typeof v.name !== 'string' || !/^[A-Za-z][A-Za-z0-9]{1,31}$/.test(v.name)) return null
    if (typeof v.displayName !== 'string' || !v.displayName || v.displayName.length > 64) return null
    return { value: v.value as number, name: v.name, displayName: v.displayName }
  })
  if (parsed.some(item => item === null)) return null
  const list = parsed as ProviderValue[]
  return new Set(list.map(item => item.value)).size === list.length && new Set(list.map(item => item.name)).size === list.length ? list : null
}
