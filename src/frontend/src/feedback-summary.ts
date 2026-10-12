export function summarizeFeedback(items: readonly { state: string; priority: string }[]) {
  const accepted = items.filter(item => item.state === '已验收').length
  return {
    total: items.length,
    accepted,
    open: items.length - accepted,
    blockers: items.filter(item => item.priority === '阻塞验收' && item.state !== '已验收').length,
  }
}
