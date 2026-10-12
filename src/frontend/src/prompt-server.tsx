import { useEffect, useRef, useState } from 'react'
import { containsSensitiveText } from './data'
import { lineDiff } from './prompt-schema'
import { PromptClientError, requestPrompts, serverPromptIds, type ServerPrompt, type ServerPromptId } from './prompt-client'

type Snapshot = { detail: ServerPrompt; draft: string; source: number; needsReload: boolean }
type ActiveRequest = { controller: AbortController; timer: ReturnType<typeof setTimeout>; reason: 'timeout' | 'cancelled' | null }
const readable = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' } as const
const messages: Record<string, string> = {
  version_conflict: '版本冲突；本地编辑已保留。请明确重新加载服务器详情并比对后再提交，不会自动覆盖。',
  version_limit_reached: '服务器版本已达到 20 上限，保存和恢复均不可继续；请重新加载查看。历史不会自动淘汰。',
  already_published: '该草稿版本已发布过；发布修订不可重复。如需新的发布修订，请先保存新的草稿版本。',
  validation_failed: '服务器拒绝字段校验；请检查内容、占位符及版本。本地编辑已保留。',
  prompt_not_found: '服务器未找到此固定提示词。',
  source_version_not_found: '服务器未找到恢复来源版本，请重新加载详情。',
  invalid_response: '响应未通过 Demo / memory 信封或具体字段校验，拒绝使用；不显示原始正文。',
  http_error: '服务器请求失败；不显示原始错误正文，也不回退到 mock。',
  network_error: '网络请求失败；不回退到 mock，请检查演示接口后明确重试。',
  invalid_request: '请求参数不符合固定演示目录。',
}

export default function PromptServer() {
  const [id, setId] = useState<ServerPromptId>('alert-explanation')
  const [listed, setListed] = useState(false)
  const [snapshots, setSnapshots] = useState<Partial<Record<ServerPromptId, Snapshot>>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('尚未请求；只有点击加载才访问服务器。')
  const [http, setHttp] = useState<number | null>(null)
  const [view, setView] = useState<number | null>(null)
  const [publishedView, setPublishedView] = useState<number | null>(null)
  // Publishing requires an approval record; the shape is checked here and again on the server.
  const [approvalReference, setApprovalReference] = useState('')
  const [approvedBy, setApprovedBy] = useState('')
  const active = useRef<ActiveRequest | null>(null)
  const mounted = useRef(true)
  const snapshot = snapshots[id]
  const detail = snapshot?.detail
  const atLimit = !!detail && detail.versions.length >= 20
  const sensitive = !!snapshot && containsSensitiveText(snapshot.draft)
  const invalidDraft = !snapshot || !snapshot.draft.trim() || snapshot.draft.length > 4000 || sensitive
  const blocked = busy || !snapshot || snapshot.needsReload || atLimit
  // Client-side shape check only; the server re-checks and is the authority.
  const approvalValid = /^approval:\/\/prompt\/[a-z0-9-]{1,64}\/[1-9][0-9]{0,5}$/.test(approvalReference.trim())
    && approvedBy.trim().length > 0 && approvedBy.trim().length <= 64 && !/[\u0000-\u001F\u007F]/.test(approvedBy)
  const approvalUsed = !!detail && detail.published.some(item => item.approvalReference === approvalReference.trim() && approvalReference.trim() !== '')
  const viewed = detail ? (view !== null && detail.versions.some(version => version.version === view) ? view : detail.currentVersion) : null
  const viewedVersion = detail?.versions.find(version => version.version === viewed)
  const viewedPublished = detail && detail.published.length > 0
    ? detail.published.find(item => item.version === publishedView) ?? detail.published[0] : undefined

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (active.current) {
        clearTimeout(active.current.timer)
        active.current.controller.abort()
        active.current = null
      }
    }
  }, [])

  function patch(changes: Partial<Snapshot>) {
    setSnapshots(previous => {
      const current = previous[id]
      return current ? { ...previous, [id]: { ...current, ...changes } } : previous
    })
  }

  async function run(action: 'list' | 'detail' | 'versions' | 'restore' | 'publish') {
    if (active.current || (action !== 'list' && !listed)) return
    const mutation = action === 'versions' || action === 'restore' || action === 'publish'
    if (mutation && (blocked || (action === 'versions' && invalidDraft))) return
    const controller = new AbortController()
    const request: ActiveRequest = {
      controller, reason: null,
      timer: setTimeout(() => { request.reason = 'timeout'; controller.abort() }, 10_000),
    }
    active.current = request
    setBusy(true)
    setHttp(null)
    setStatus('请求中；10 秒超时将取消等待。')
    try {
      const body = action === 'versions' && snapshot
        ? { content: snapshot.draft, expectedVersion: snapshot.detail.currentVersion }
        : action === 'restore' && snapshot
          ? { sourceVersion: snapshot.source, expectedVersion: snapshot.detail.currentVersion }
          : action === 'publish' && snapshot
            ? { expectedVersion: snapshot.detail.currentVersion, approvalReference: approvalReference.trim(), approvedBy: approvedBy.trim() }
            : undefined
      const reply = await requestPrompts(action === 'list' ? null : id, action, controller.signal, body)
      if (controller.signal.aborted) throw new PromptClientError(reply.http, 'cancelled')
      if (!mounted.current || active.current !== request) return
      setHttp(reply.http)
      if (action === 'list') {
        setListed(true)
        setStatus('已验证服务器 Demo 固定 3 项目录；请选择 ID 并显式加载详情，未自动加载或替换编辑。')
      } else {
        const data = reply.data as ServerPrompt
        if (action === 'publish') {
          // Publishing must add exactly one revision for the draft version we sent, and change no draft.
          if (!snapshot || data.published.length !== snapshot.detail.published.length + 1
            || data.publishedVersion !== data.published.length
            || data.published[0].publishedFrom !== snapshot.detail.currentVersion
            || data.currentVersion !== snapshot.detail.currentVersion
            || data.versions.length !== snapshot.detail.versions.length) {
            throw new PromptClientError(reply.http, 'invalid_response')
          }
        } else if (mutation && snapshot && (data.currentVersion !== snapshot.detail.currentVersion + 1
          || (action === 'versions' && data.content !== snapshot.draft)
          || (action === 'restore' && data.versions[0].sourceVersion !== snapshot.source))) {
          throw new PromptClientError(reply.http, 'invalid_response')
        }
        setSnapshots(previous => ({
          ...previous,
          [id]: {
            detail: data,
            draft: mutation ? data.content : (previous[id]?.draft ?? data.content),
            source: data.versions.some(version => version.version === previous[id]?.source)
              ? previous[id]!.source : data.currentVersion,
            needsReload: false,
          },
        }))
        setStatus(action === 'publish'
          ? `已创建发布修订 v${data.publishedVersion}（来自草稿 v${data.published[0].publishedFrom}）；草稿未改变，未调用模型、未启用执行。`
          : mutation
            ? `已创建服务器内存 draft v${data.currentVersion}；未审批、未发布、未调用模型。`
            : '详情已加载；已有本地编辑保留。请比对服务器内容；替换编辑需另点明确按钮。')
        if (mutation) { setView(null); setPublishedView(null) }
      }
    } catch (error) {
      if (!mounted.current || active.current !== request) return
      const failure = error instanceof PromptClientError ? error : new PromptClientError(null, 'network_error')
      setHttp(failure.http)
      const cancelled = controller.signal.aborted
      if (mutation || failure.http === 409) patch({ needsReload: true })
      setStatus(cancelled
        ? `${request.reason === 'timeout' ? '请求超时，已取消等待' : '已取消请求等待'}；本地编辑保留。${mutation ? 'POST 取消不保证服务器回滚，可能已写入；请明确重新加载详情比对，禁止盲目重试。' : '未自动重试或回退。'}`
        : `${messages[failure.code] ?? messages.http_error}${mutation && failure.http !== 409 ? ' 写入结果可能不确定；请重新加载详情比对后再提交。' : ''}`)
    } finally {
      clearTimeout(request.timer)
      if (mounted.current && active.current === request) {
        active.current = null
        setBusy(false)
      }
    }
  }

  return (
    <section className="panel domain-panel" aria-label="服务器 Demo 版本">
      <div className="panel-head">
        <div>
          <h2>服务器 Demo 版本</h2>
          <p>独立于上方本地 7 流程；显式请求同源 /api/v1/prompts，无错误 fallback。</p>
        </div>
        <span className="badge amber">仅内存 draft · 未审批 · 未发布</span>
      </div>
      <div className="domain-body form">
        <p>仅开发演示：服务器进程重启丢失版本；本地未提交编辑离页或刷新丢失，不写浏览器存储。无真实 AI、无执行能力、无生产持久化。</p>
        <p><strong>禁止输入真实 secret：</strong>密码、令牌、私钥、生产信息及个人信息均不得输入。containsSensitiveText 仅辅助提示，非 DLP；未命中不代表安全。保存会把内容发送到演示服务器。</p>
        <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button secondary" type="button" aria-label="加载服务器提示词列表" disabled={busy} onClick={() => void run('list')}>加载服务器提示词列表</button>
          <button className="button secondary" type="button" aria-label="取消服务器请求" disabled={!busy} onClick={() => {
            if (active.current) { active.current.reason = 'cancelled'; active.current.controller.abort() }
          }}>取消服务器请求</button>
        </div>
        <p>请求最多等待 10 秒；取消 POST 仅取消等待，<strong>不保证回滚</strong>。所有错误均不使用 mock 替代。</p>
        <label htmlFor="ps-id">服务器提示词 ID</label>
        <select id="ps-id" aria-label="服务器提示词 ID" value={id} disabled={busy || !listed} onChange={event => { setId(event.target.value as ServerPromptId); setView(null) }}>
          {serverPromptIds.map(key => <option key={key} value={key}>{key}</option>)}
        </select>
        <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button secondary" type="button" aria-label="加载服务器提示词详情" disabled={busy || !listed} onClick={() => void run('detail')}>加载服务器提示词详情</button>
          <button className="button secondary" type="button" aria-label="重新加载服务器详情以比对" disabled={busy || !snapshot} onClick={() => void run('detail')}>重新加载服务器详情以比对（保留编辑）</button>
        </div>
        <p role="status" aria-live="polite" aria-label="服务器请求状态">HTTP：{http ?? '—（无响应状态）'} · {status}</p>
        {detail && snapshot && <>
          <p aria-label="服务器当前版本">{detail.name} · 当前已加载服务器版本 v{detail.currentVersion} · {detail.versions.length} / 20 · 仅内存 draft</p>
          <p>此为最近显式加载的快照，不代表实时版本。保存使用 expectedVersion={detail.currentVersion}；恢复使用所选 sourceVersion 并新增 draft，不改写历史。</p>
          <dl className="domain-facts">
            {detail.schema.map(field => <div key={field.name}>
              <dt><code>{`{{${field.name}}}`}</code></dt>
              <dd>{field.type} · {field.description} · {field.required ? '样本必填' : '样本可选'}（不是强制模板引用）</dd>
            </div>)}
          </dl>
          <label htmlFor="ps-content">服务器提示词内容（仅非敏感演示文本）</label>
          <textarea id="ps-content" aria-label="服务器提示词内容" rows={9} maxLength={4000} disabled={busy} value={snapshot.draft} onChange={event => patch({ draft: event.target.value })} />
          <p>{snapshot.draft.length} / 4000 字符 · 当前编辑{snapshot.draft === detail.content ? '与快照一致' : '尚未保存到服务器'}。</p>
          {sensitive && <p role="alert">命中敏感信息辅助提示，禁止提交。请删除真实敏感内容并改用演示占位文本；检测非 DLP。</p>}
          {snapshot.needsReload && <p role="alert">必须明确重新加载服务器详情并比对后才能再次提交；本地编辑未丢失，不自动覆盖。</p>}
          {atLimit && <p role="alert">版本已达到 20 上限：保存和恢复均已禁用，不自动淘汰历史；此 Demo 无清理入口。</p>}
          <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="button primary" type="button" aria-label="保存服务器新版本" disabled={blocked || invalidDraft} onClick={() => void run('versions')}>保存服务器新版本</button>
            <button className="button secondary" type="button" aria-label="用服务器内容替换本地编辑" disabled={busy || snapshot.needsReload} onClick={() => {
              patch({ draft: detail.content })
              setStatus('已按明确操作用最近加载的服务器内容替换本地编辑，尚未提交。')
            }}>用服务器内容替换本地编辑（丢弃未保存编辑）</button>
          </div>
          <label htmlFor="ps-source">服务器恢复来源版本</label>
          <select id="ps-source" aria-label="服务器恢复来源版本" value={snapshot.source} disabled={busy} onChange={event => patch({ source: Number(event.target.value) })}>
            {detail.versions.map(version => <option key={version.version} value={version.version}>v{version.version} · draft{version.sourceVersion ? ` · 来自 v${version.sourceVersion}` : ''}</option>)}
          </select>
          <button className="button secondary" type="button" aria-label="恢复服务器历史为新版本" disabled={blocked || !detail.versions.some(version => version.version === snapshot.source)} onClick={() => void run('restore')}>恢复服务器历史为新版本</button>
          <p>恢复成功会以所选历史内容替换本地编辑并新增服务器版本；失败保留编辑。保存与恢复均占用一个版本名额。</p>
          <h3>发布修订</h3>
          <p>发布只把当前草稿内容复制成一条不可变发布修订，不调用模型、不启用执行、也不代表已上线。发布必须填写**审批记录**：一个合成审批引用（形如 <code>approval://prompt/&lt;提示词&gt;/&lt;编号&gt;</code>）与审批人名称，二者会写入该发布修订；同一引用只能授权一次发布。没有鉴权时这只是流程校验，<strong>不是</strong>权限控制，也不替代真实审批系统。</p>
          <div className="filters">
            <label>审批引用<input aria-label="审批引用" maxLength={120} disabled={busy} value={approvalReference} placeholder="approval://prompt/alert-explanation/1" onChange={event => setApprovalReference(event.target.value)} /></label>
            <label>审批人<input aria-label="审批人" maxLength={64} disabled={busy} value={approvedBy} onChange={event => setApprovedBy(event.target.value)} /></label>
          </div>
          {!approvalValid && <p>审批引用必须形如 <code>approval://prompt/&lt;小写标识&gt;/&lt;正整数&gt;</code>，审批人需 1–64 个字符且不含控制字符。</p>}
          {approvalUsed && <p>该审批引用已用于本提示词的一条发布修订；同一引用不能重复授权。</p>}
          <button className="button primary" type="button" aria-label="发布当前草稿为发布修订" disabled={blocked || !approvalValid || detail.published.some(item => item.publishedFrom === detail.currentVersion)} onClick={() => void run('publish')}>发布当前草稿为发布修订</button>
          {detail.published.some(item => item.publishedFrom === detail.currentVersion) && <p>当前草稿版本 v{detail.currentVersion} 已发布；按钮已禁用，历史不可改写。</p>}
          {detail.published.length > 0 && <div className="table-wrap"><table aria-label="发布修订历史"><thead><tr>{['发布修订','来源草稿','发布时间','字符数','审批引用','审批人'].map(head => <th key={head}>{head}</th>)}</tr></thead><tbody>{detail.published.map(item => <tr key={item.version}><td>p{item.version}{item.version === detail.publishedVersion ? '（最新）' : ''}</td><td>v{item.publishedFrom}</td><td><time dateTime={item.publishedAt}>{item.publishedAt}</time></td><td>{item.content.length}</td><td style={{overflowWrap:'anywhere'}}>{item.approvalReference ?? '（无）'}</td><td>{item.approvedBy ?? '（无）'}</td></tr>)}</tbody></table></div>}
          {detail.published.length === 0 && <p>尚无发布修订；草稿保存与恢复都不会自动发布。</p>}
          {viewedPublished && <>
            <label htmlFor="ps-published">查看发布修订内容（只读）</label>
            <select id="ps-published" aria-label="查看发布修订内容" value={viewedPublished.version} onChange={event => setPublishedView(Number(event.target.value))}>
              {detail.published.map(item => <option key={item.version} value={item.version}>p{item.version}（来自草稿 v{item.publishedFrom}）</option>)}
            </select>
            <pre aria-label="所选发布修订内容" style={readable}>{viewedPublished.content}</pre>
            <p>发布修订不可改写：内容与来源草稿版本逐字一致，恢复草稿或另存新草稿都不会改变这条修订。</p>
            <h4>所选发布修订 → 当前草稿比对</h4>
            <p>仅逐行文本比对，不做语义判断；草稿尚未保存或尚未发布时差异属正常。</p>
            <pre aria-label="发布修订与当前草稿差异" style={readable}>{lineDiff(viewedPublished.content, snapshot.draft)}</pre>
          </>}
          <h3>服务器版本历史</h3>
          <p>历史只追加、不改写：保存与恢复都新增一条版本并各占一个名额，达到 20 后两者均被拒绝，且没有自动淘汰或删除入口。此表来自最近一次显式加载的快照。</p>
          <div className="table-wrap"><table aria-label="服务器版本历史"><thead><tr>{['版本','创建时间','来源','字符数','状态'].map(head => <th key={head}>{head}</th>)}</tr></thead><tbody>{detail.versions.map(version => <tr key={version.version}><td>v{version.version}{version.version === detail.currentVersion ? '（当前）' : ''}</td><td><time dateTime={version.createdAt}>{version.createdAt}</time></td><td>{version.sourceVersion ? `由 v${version.sourceVersion} 恢复` : '新内容'}</td><td>{version.content.length}</td><td>draft · 未审批</td></tr>)}</tbody></table></div>
          <label htmlFor="ps-view">查看历史版本内容（只读）</label>
          <select id="ps-view" aria-label="查看历史版本内容" value={viewed ?? ''} onChange={event => setView(Number(event.target.value))}>
            {detail.versions.map(version => <option key={version.version} value={version.version}>v{version.version}{version.sourceVersion ? `（来自 v${version.sourceVersion}）` : ''}</option>)}
          </select>
          <pre aria-label="所选服务器历史版本内容" style={readable}>{viewedVersion?.content ?? ''}</pre>
          <p>{viewedVersion && viewedVersion.version === detail.currentVersion ? '所选为当前版本；与上方编辑框的差异来自未保存修改。' : '所选为历史版本，只读展示，不进入编辑框；恢复它会新增一个版本，而不是改写这一条。'}</p>
          <h3>服务器快照 → 本地编辑比对</h3>
          <pre aria-label="服务器内容与本地编辑差异" style={readable}>{lineDiff(detail.content, snapshot.draft)}</pre>
        </>}
      </div>
    </section>
  )
}
