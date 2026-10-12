import { useState } from 'react'
import PromptServer from './prompt-server'
import PromptBindings from './prompt-bindings'
import { appendDraft, fixedSafetyPolicy, identifyVariables, lineDiff, promptLimits, promptSchemas, sensitiveHints, simulatePrompt, type PromptFunction, type PromptVersion } from './prompt-schema'

const functions = Object.keys(promptSchemas) as PromptFunction[]
type Workspace = { template: string; samples: Record<string, string>; versions: PromptVersion[]; baseline: number }
function initialWorkspace(kind: PromptFunction): Workspace {
  const schema = promptSchemas[kind]
  return { template: schema.template, samples: Object.fromEntries(schema.variables.map(spec => [spec.name, spec.example])), versions: appendDraft([], schema.template, '内置 mock 草稿'), baseline: 1 }
}
const outputStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' } as const

export default function PromptGovernance() {
  const [kind, setKind] = useState<PromptFunction>('告警研判')
  const [workspaces, setWorkspaces] = useState<Record<PromptFunction, Workspace>>(() => Object.fromEntries(functions.map(name => [name, initialWorkspace(name)])) as Record<PromptFunction, Workspace>)
  const [message, setMessage] = useState('仅使用内置或自行编写的非敏感 mock 样本。')
  const [output, setOutput] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const current = workspaces[kind]
  const schema = promptSchemas[kind]
  const result = simulatePrompt(kind, current.template, current.samples)
  const baseline = current.versions.find(version => version.version === current.baseline)
  const saveBlocked = !current.template.trim() || current.template.length > promptLimits.template || sensitiveHints(current.template).length > 0
  function update(patch: Partial<Workspace>) {
    setWorkspaces(previous => ({ ...previous, [kind]: { ...previous[kind], ...patch } }))
    setOutput(null)
    setPreview(false)
    setMessage('编辑已更新；旧模拟结果和发布预览已清除。')
  }
  function save() {
    if (saveBlocked) return
    const versions = appendDraft(current.versions, current.template)
    update({ versions, baseline: versions.some(version => version.version === current.baseline) ? current.baseline : versions[0].version })
    setMessage(`已保存本机内存草稿 v${versions.at(-1)!.version}，未审批、未发布。样本不进入版本记录。`)
  }
  function rollback() {
    if (!baseline) return
    const versions = appendDraft(current.versions, baseline.template, `从 v${baseline.version} 回滚生成草稿`)
    update({ template: baseline.template, versions, baseline: versions.some(version => version.version === baseline.version) ? baseline.version : versions[0].version })
    setMessage(`从 v${baseline.version} 生成新草稿 v${versions.at(-1)!.version}，原历史未改写，未审批、未发布。`)
  }
  return <>
    <section className="panel domain-panel" aria-labelledby="prompt-governance-title">
      <div className="panel-head"><div><h2 id="prompt-governance-title">提示词治理 · 独立模拟工作区</h2><p>与原提示词页并行；本机 mock，无真实 AI、无网络外发、无执行能力。</p></div><span className="badge amber">未审批 · 未发布</span></div>
      <div className="domain-body">
        <p><strong>固定安全策略：</strong>{fixedSafetyPolicy}</p>
        <p>模板中的“忽略规则”“授予权限”等文字仅作文本，不能修改安全策略。此原型不代表生产授权或审批系统。</p>
        <p>仅组件内存保存，离开页面或刷新即清空；不读取或写入 localStorage，没有持久化损坏数据入口。每项功能最多保留最近 {promptLimits.versions} 个版本，旧版本自动淘汰；历史输入仍做结构和长度过滤。</p>
        <p>敏感信息检测仅为辅助提示，<strong>非 DLP</strong>，可能漏报或误报；未命中不代表安全，请勿输入真实密码、令牌、私钥或个人信息。</p>
      </div>
    </section>
    <section className="panel domain-panel">
      <div className="panel-head"><h2>功能与变量 Schema</h2></div>
      <div className="domain-body">
        <label htmlFor="pg-function">提示词功能</label>{' '}
        <select id="pg-function" value={kind} onChange={event => { setKind(event.target.value as PromptFunction); setOutput(null); setPreview(false); setMessage('已切换功能；各功能草稿和样本在本次页面内独立保存。') }}>{functions.map(name => <option key={name}>{name}</option>)}</select>
        <dl className="domain-facts">{schema.variables.map(spec => <div key={spec.name}><dt><code>{`{{${spec.name}}}`}</code></dt><dd>{spec.label} · 字符串 · {spec.required ? '样本必填' : '模板引用时样本必填'} · 最多 {promptLimits.sample} 字符</dd></div>)}</dl>
        <p>占位符区分大小写；允许英文名和下划线（后续可含数字），例如 {'{{asset_name}}'}。未引用的可选变量可留空；所有必填变量即使模板未引用也需样本。</p>
      </div>
    </section>
    <div className="domain-grid">
      <section className="panel domain-panel">
        <div className="panel-head"><h2>模板草稿与测试样本</h2></div>
        <div className="domain-body">
          <label htmlFor="pg-template">{kind}模板（最多 {promptLimits.template} 字符）</label>
          <textarea id="pg-template" rows={9} maxLength={promptLimits.template} value={current.template} onChange={event => update({ template: event.target.value })} />
          <p><small>{current.template.length} / {promptLimits.template} 字符 · 已识别变量：{identifyVariables(current.template).join('、') || '无'}</small></p>
          {schema.variables.map(spec => <div className="form-field" key={`${kind}-${spec.name}`}><label htmlFor={`pg-sample-${spec.name}`}>{spec.label}测试样本（{spec.name}）{spec.required ? ' · 必填' : ' · 引用时必填'}</label><input id={`pg-sample-${spec.name}`} maxLength={promptLimits.sample} value={current.samples[spec.name] ?? ''} onChange={event => update({ samples: { ...current.samples, [spec.name]: event.target.value } })} /></div>)}
          <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <button className="button secondary" type="button" disabled={saveBlocked} onClick={save}>保存草稿</button>
            <button className="button primary" type="button" disabled={!result.ok} onClick={() => { setOutput(result.output); setMessage('模拟成功：仅单次变量替换，未调用模型或工具。') }}>模拟测试</button>
            <button className="button secondary" type="button" disabled={!result.ok} onClick={() => { setPreview(true); setMessage('已生成发布预览；未审批、未发布。') }}>发布预览（不发布）</button>
          </div>
          <p><small>保存草稿允许未完成的变量配置；模拟测试和发布预览必须通过全部校验。</small></p>
          {saveBlocked && <p role="alert">草稿保存被阻止：模板为空、过长或命中敏感信息辅助提示。</p>}
          {!!result.errors.length && <div role="status"><strong>模拟测试 / 发布预览已阻止：</strong><ul>{result.errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        </div>
      </section>
      <section className="panel domain-panel">
        <div className="panel-head"><h2>版本比较与回滚</h2><span className="badge blue">{current.versions.length} / {promptLimits.versions} 草稿</span></div>
        <div className="domain-body">
          <label htmlFor="pg-baseline">比较基线 / 回滚来源</label>{' '}
          <select id="pg-baseline" value={current.baseline} onChange={event => update({ baseline: Number(event.target.value) })}>{current.versions.map(version => <option key={version.version} value={version.version}>v{version.version} · {version.origin} · 未发布</option>)}</select>
          <p>比较：所选保存版本 → 当前编辑模板。朴素逐行比较，− 为旧行、+ 为新行；插入行可能导致后续行逐一变化，并非智能合并。</p>
          <pre aria-label="模板逐行差异" style={outputStyle}>{lineDiff(baseline?.template ?? '', current.template)}</pre>
          <button className="button secondary" type="button" disabled={!baseline} onClick={rollback}>回滚为新草稿</button>
          <p><small>回滚会用所选版本覆盖当前未保存模板，并立即生成新草稿；不会覆盖历史版本或改变测试样本。</small></p>
        </div>
      </section>
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {output !== null && <section className="panel domain-panel"><div className="panel-head"><h2>模拟渲染结果 · 非 AI 生成</h2></div><div className="domain-body"><p>仅一次替换；样本中的占位符不继续展开。固定安全策略保持不变。</p><pre style={outputStyle}>{output}</pre></div></section>}
    {preview && <section className="panel domain-panel"><div className="panel-head"><h2>发布预览 · 未审批 · 未发布</h2><span className="badge amber">仅预览</span></div><div className="domain-body"><p>预览对象：{kind}的当前编辑模板（可能尚未保存）。不提交审批、不假冒审批角色、不修改生效版本；本原型没有真实发布入口。</p><p>{fixedSafetyPolicy}</p><pre style={outputStyle}>{current.template}</pre><button className="button secondary" type="button" onClick={() => setPreview(false)}>关闭发布预览</button></div></section>}
    <PromptServer />
    <PromptBindings />
  </>
}
