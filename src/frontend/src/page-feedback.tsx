import { createContext, useContext, useState, type ReactNode } from 'react'
export type FeedbackComposer = {
  // Adds one schema-valid local feedback record; returns the new total or null when rejected.
  add: (module: string, priority: string, text: string) => number | null
  count: number
}
const context = createContext<FeedbackComposer | null>(null)
export function FeedbackComposerProvider({ value, children }: { value: FeedbackComposer; children: ReactNode }) {
  return <context.Provider value={value}>{children}</context.Provider>
}
export function useFeedbackComposer(): FeedbackComposer | null {
  return useContext(context)
}
const priorities = ['一般', '重要', '阻塞验收']
// Inline recorder so a reviewer can comment on the page they are looking at without losing filters.
export function PageFeedback({ module, note }: { module: string; note?: string }) {
  const composer = useFeedbackComposer()
  const [priority, setPriority] = useState(priorities[0])
  const [text, setText] = useState('')
  const [status, setStatus] = useState('尚未记录本页意见')
  if (!composer) return <section className="panel domain-panel" aria-label={`记录本页意见（${module}）`}>
    <div className="panel-head"><div><h2>记录本页意见</h2></div></div>
    <div className="domain-body"><p role="status">本页意见记录不可用：反馈通道未初始化，未记录任何内容。</p></div>
  </section>
  function submit() {
    if (!text.trim()) return
    const total = composer!.add(module, priority, text)
    if (total === null) { setStatus('检测到疑似敏感内容或记录无效，已阻止保存；未写入任何反馈。'); return }
    setText('')
    setStatus(`已记录到本机反馈（共 ${total} 条，模块：${module}）；未提交到后端，也不代表部门签认。`)
  }
  return <section className="panel domain-panel" aria-label={`记录本页意见（${module}）`}>
    <div className="panel-head"><div><h2>记录本页意见</h2><p>{note ?? '在本页直接记录意见，列表筛选与选中项保持不变'}</p></div></div>
    <div className="domain-body">
      <p>仅写入当前浏览器的模拟反馈（与“验收反馈”页同一份数据），不提交到后端、不发送通知；请勿填写人员姓名、真实设备信息或任何凭据。</p>
      <label>优先级<select aria-label={`本页意见优先级（${module}）`} value={priority} onChange={event => setPriority(event.target.value)}>{priorities.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>本页意见<textarea aria-label={`本页意见内容（${module}）`} rows={3} maxLength={600} value={text} onChange={event => { setText(event.target.value); setStatus('尚未记录本页意见') }} placeholder="例如：希望在筛选后一键导出当前结果。" /></label>
      <div className="inline-actions"><button className="button" type="button" disabled={!text.trim()} onClick={submit}>记录本页意见</button></div>
      <p role="status">{status}</p>
    </div>
  </section>
}
