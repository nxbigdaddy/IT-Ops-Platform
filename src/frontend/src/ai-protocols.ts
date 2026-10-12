export type AcceptedProtocol = { protocol: string; displayName: string; requestContract: string; responseContract: string }
// Protocols the preflight accepts, as published by the server. Local copies would drift.
export function parseAcceptedProtocols(value: unknown): AcceptedProtocol[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null
  const parsed = value.map(entry => {
    const v = entry as Partial<AcceptedProtocol> & Record<string, unknown>
    if (!v || typeof v !== 'object') return null
    if (typeof v.protocol !== 'string' || !/^[A-Za-z][A-Za-z0-9]{1,63}$/.test(v.protocol)) return null
    for (const key of ['displayName', 'requestContract', 'responseContract'] as const) {
      const text = v[key]
      if (typeof text !== 'string' || !text || text.length > 100) return null
    }
    if (v.adapterImplemented !== true || v.transportImplemented !== false || v.liveVerified !== false || v.credentialRead !== false) return null
    return { protocol: v.protocol, displayName: v.displayName as string, requestContract: v.requestContract as string, responseContract: v.responseContract as string }
  })
  if (parsed.some(item => item === null)) return null
  const list = parsed as AcceptedProtocol[]
  return new Set(list.map(item => item.protocol)).size === list.length ? list : null
}
