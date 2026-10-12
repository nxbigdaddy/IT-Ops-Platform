import { useEffect, useRef, useState } from 'react'
import type { Store } from './data'
import { feedbackImportMaxBytes, mergeFeedbackImport, previewFeedbackImport } from './feedback-transfer'

export default function FeedbackImport({ store, update, notify }: { store: Store; update: (fn: (s: Store) => Store) => void; notify: (message: string) => void }) {
  const [open, setOpen] = useState(false), [raw, setRaw] = useState<string | null>(null), [error, setError] = useState(''), [reading, setReading] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null), generation = useRef(0)
  useEffect(() => { if (open) dialog.current?.showModal() }, [open])
  useEffect(() => () => { generation.current++ }, [])
  const preview = raw === null ? null : previewFeedbackImport(raw, store.feedback)
  function close() { generation.current++; setOpen(false); setRaw(null); setError(''); setReading(false) }
  async function selectFile(file?: File) {
    const token = ++generation.current
    setRaw(null); setError(''); setReading(false)
    if (!file) return
    if (file.size > feedbackImportMaxBytes) { setError('文件超过 256 KB 上限，未读取内容。'); return }
    setReading(true)
    try {
      const content = await file.text()
      if (generation.current === token) setRaw(content)
    } catch { if (generation.current === token) setError('文件读取失败，请重新选择 JSON 文件。') }
    finally { if (generation.current === token) setReading(false) }
  }
  return <><button className="button compact" onClick={() => setOpen(true)}>导入 JSON</button>{open && <dialog ref={dialog} aria-label="导入反馈预览" onCancel={close}>
    <div className="panel-head"><h2>导入反馈预览</h2><button className="icon-button" aria-label="关闭导入预览" onClick={close}>×</button></div>
    <div className="form"><p className="warning">仅在当前浏览器模拟合并，不上传文件、不连接后端。请只选择人工确认无敏感信息的模拟反馈；自动检测不保证识别全部敏感内容。</p>
      <label>选择反馈 JSON 文件<input type="file" accept=".json,application/json" aria-label="选择反馈 JSON 文件" onChange={e => { void selectFile(e.target.files?.[0]) }}/></label>
      <p className="field-note">上限 256 KB；仅接受 schemaVersion 1 / mode mock 的现有导出格式。按编号去重，已有反馈内容及状态优先，文件内同编号保留第一条。无效内容整批拒绝，不会静默删除字段。</p>
      {reading && <p role="status">正在本地读取文件…</p>}{error && <p role="alert">{error}</p>}
      {preview && <section aria-label="反馈导入统计"><p role="status">共 {preview.total} 条：新增 {preview.added} 条 · 重复 {preview.duplicate} 条 · 无效 {preview.invalid} 条</p>
        <p>确认后按创建时间保留最新 100 条，预计保留 {preview.retained} 条，超限移除 {preview.dropped} 条最旧反馈（可能包含现有记录）。同编号记录不覆盖现有状态。</p>
        {preview.errors.length > 0 && <div role="alert"><strong>导入已拒绝；请修正后重新选择文件。未修改任何反馈。</strong><ul>{preview.errors.map((message, i) => <li key={i}>{message}</li>)}</ul>{preview.invalid > 8 && <p>另有 {preview.invalid - 8} 条无效记录。</p>}</div>}
        {!preview.errors.length && !preview.added && <p>没有可新增反馈，无需合并。</p>}
        {!!preview.candidates.length && <details><summary>查看已验证内容（最多 10 条）</summary><ul>{preview.candidates.slice(0, 10).map((row, i) => <li key={i}><strong>{row.id} · {row.module} · {row.state}</strong><p>{row.text}</p></li>)}</ul></details>}
      </section>}
      <div className="dialog-actions"><button className="button" onClick={close}>取消</button><button className="button primary" disabled={reading || !preview?.canMerge} onClick={() => {
        if (raw === null || !preview?.canMerge) return
        update(current => ({ ...current, feedback: mergeFeedbackImport(raw, current.feedback) }))
        close(); notify('已在当前浏览器合并模拟反馈；重复编号未覆盖，最多保留最新 100 条')
      }}>确认合并</button></div>
    </div>
  </dialog>}</>
}
