// Which planning matrix rows cover each local demo asset kind. Empty means: no connector candidate is planned
// for that kind yet, and the gap must be reported rather than quietly mapped onto an unrelated row.
export const assetKindMatrixRows: Record<string, string[]> = {
  '交换机': ['网络'],
  '服务器': ['Linux', '系统'],
  '防火墙': ['安全'],
  '虚拟化': ['虚拟化'],
  '终端': ['终端'],
  '打印机': ['打印'],
  '存储': [],
  '软件授权': [],
}
export type AssetCoverageRow = { kind: string; count: number; rows: string[]; candidates: string[]; covered: boolean }
export function coverageOfAssetKinds(
  kinds: readonly { kind: string; count: number }[],
  candidateRows: Readonly<Record<string, string[]>>,
): AssetCoverageRow[] {
  return kinds.map(item => {
    const rows = assetKindMatrixRows[item.kind] ?? []
    const candidates = [...new Set(rows.flatMap(row => candidateRows[row] ?? []))].sort()
    return { kind: item.kind, count: item.count, rows, candidates, covered: candidates.length > 0 }
  })
}
