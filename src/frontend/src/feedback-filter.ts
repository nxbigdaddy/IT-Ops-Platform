export type FeedbackFilters = { state: string; department: string; priority: string; query: string }
type SearchableFeedback = { id: string; module: string; text: string; state: string; department: string; priority: string }
export function filterFeedback<T extends SearchableFeedback>(items: readonly T[], filters: FeedbackFilters): T[] {
  const query = filters.query.trim().toLowerCase()
  return items.filter(item => (filters.state === '全部状态' || item.state === filters.state)
    && (filters.department === '全部部门' || item.department === filters.department)
    && (filters.priority === '全部优先级' || item.priority === filters.priority)
    && (!query || `${item.id} ${item.module} ${item.text}`.toLowerCase().includes(query)))
}
