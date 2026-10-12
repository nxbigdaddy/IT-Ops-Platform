import { useState, type ReactNode } from 'react'
import { BookOpen, CheckCircle2, ChevronRight, CircleHelp, Clock3, HardDrive, Search, ShieldCheck, Sparkles } from 'lucide-react'

const observedAt = '2026-10-10 09:45 · 固定模拟快照'

function Tag({ children, tone = 'blue' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function DomainIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="domain-intro">
      <div className="domain-intro-icon"><ShieldCheck size={24} /></div>
      <div><h2>{title}</h2><p>{children}</p><small>{observedAt} · 非实时 · 无真实执行</small></div>
      <Tag>READ ONLY / DEMO</Tag>
    </div>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="panel domain-panel">
      <div className="panel-head"><div><h2>{title}</h2>{note && <p>{note}</p>}</div></div>
      {children}
    </section>
  )
}

function Filter({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; placeholder: string
}) {
  return (
    <div className="search-input domain-search">
      <Search size={17} />
      <input aria-label={label} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  )
}

function Facts({ rows }: { rows: [string, string][] }) {
  return <dl className="domain-facts">{rows.map(([key, value]) => (
    <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
  ))}</dl>
}

function Evidence({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="domain-evidence">
      <summary><CircleHelp size={16} />{title}<ChevronRight size={16} /></summary>
      <div>{children}</div>
    </details>
  )
}

function NoResults() {
  return <div className="empty"><Search size={26} /><p>没有匹配的模拟记录</p><small>请调整关键词或筛选条件。</small></div>
}

const directory = [
  { id: 'demo.user01', name: '示例用户 01', type: '用户', unit: 'OU=Finance', status: '启用', groups: ['GG-Finance-Read', 'GG-All-Staff'], note: '普通成员账号；样本不包含密码与真实人员信息。' },
  { id: 'demo.user02', name: '示例用户 02', type: '用户', unit: 'OU=Operations', status: '已禁用', groups: ['GG-IT-Read'], note: '停用示例；不提供启用、解锁或重置密码操作。' },
  { id: 'GG-Finance-Read', name: '财务只读组', type: '组', unit: 'OU=SecurityGroups', status: '安全组', groups: ['demo.user01'], note: '全局安全组；展示直接成员，不等于完整嵌套组授权。' },
  { id: 'GG-IT-Read', name: '运维只读组', type: '组', unit: 'OU=SecurityGroups', status: '安全组', groups: ['demo.user02'], note: '固定成员样本；生产中还需核实嵌套组、令牌与复制延迟。' },
]

export function DirectoryPage() {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('全部对象')
  const [selectedId, setSelectedId] = useState(directory[0].id)
  const items = directory.filter(item => `${item.id} ${item.name} ${item.unit}`.toLowerCase().includes(query.toLowerCase()) && (type === '全部对象' || item.type === type))
  const selected = items.find(item => item.id === selectedId)
  return (
    <>
      <DomainIntro title="目录可见，权限有界">只读检索演示目录中的用户与组。无 LDAP 连接，不查询真实 AD。</DomainIntro>
      <div className="domain-grid">
        <Panel title="AD 目录对象" note="demo.example.invalid · 4 个脱敏样本">
          <div className="filters">
            <Filter label="搜索目录对象" value={query} onChange={setQuery} placeholder="搜索用户、组或 OU" />
            <select aria-label="目录对象类型" value={type} onChange={event => setType(event.target.value)}>
              {['全部对象', '用户', '组'].map(value => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div className="domain-list">
            {items.map(item => (
              <button key={item.id} className={`domain-list-item ${selected?.id === item.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id}>
                <span><strong>{item.name}</strong><small>{item.id}</small></span>
                <Tag tone={item.status === '已禁用' ? 'amber' : 'blue'}>{item.type} · {item.status}</Tag>
                <ChevronRight size={16} />
              </button>
            ))}
            {!items.length && <NoResults />}
          </div>
          <div className="panel-note">显示 {items.length} / {directory.length} 项 · 点击对象查看只读详情</div>
        </Panel>
        <Panel title="目录对象详情" note="成员关系仅为固定样本">
          {selected ? (
            <div className="domain-body">
              <h3>{selected.name}</h3>
              <Facts rows={[[ '对象标识', selected.id ], [ '所属容器', selected.unit ], [ '对象状态', selected.status ], [ '数据来源', '内置 AD 模拟快照' ]]} />
              <h3>{selected.type === '用户' ? '直接所属组' : '直接成员'}</h3>
              <div className="domain-tags">{selected.groups.map(group => <Tag key={group}>{group}</Tag>)}</div>
              <Evidence title="展开目录诊断证据"><p>{selected.note}</p><p>证据 DIR-001：目录来源为本地样本，未验证域控制器连通性、权限或账号实际状态。</p></Evidence>
            </div>
          ) : <div className="empty">请选择筛选结果中的对象查看详情。</div>}
        </Panel>
      </div>
        </>
  )
}

const permissions = [
  { name: '部门资料 / 公共', path: '\\demo-fs\department\public', inherit: '已启用继承', subject: 'GG-All-Staff', share: '读取', ntfs: '继承允许：读取与执行', result: '允许读取', tone: 'green', evidence: '父目录 Department 向子目录继承读取权限。样本中共享层允许读取、NTFS 层也允许读取，因此两层交集为读取。' },
  { name: '财务资料 / 受限', path: '\\demo-fs\department\finance', inherit: '已启用继承', subject: 'demo.user01（含限制组）', share: '更改', ntfs: '继承允许读取 + 显式拒绝写入', result: '写入被拒绝', tone: 'red', evidence: '在该样本的规范排序 ACL 中，显式拒绝写入 ACE 命中示例访问令牌；父级读取允许不授予写入。拒绝仅针对写入，不代表读取被拒绝。' },
  { name: '归档资料 / 独立', path: '\\demo-fs\archive', inherit: '继承已断开', subject: 'GG-IT-Read', share: '读取', ntfs: '显式允许：修改', result: '仅允许读取', tone: 'amber', evidence: '该目录未继续接收父目录 ACE；NTFS 修改权限仍受共享层读取权限限制。断开继承本身不等于拒绝全部访问。' },
]

export function PermissionsPage() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('全部结果')
  const items = permissions.filter(item => `${item.name} ${item.path} ${item.subject}`.toLowerCase().includes(query.toLowerCase()) && (scope === '全部结果' || item.result === scope))
  return (
    <>
      <DomainIntro title="把“为什么无权访问”讲清楚">共享权限与 NTFS 权限分层解释；所有访问判定均为预置案例，不是真实 ACL 计算器。</DomainIntro>
      <Panel title="共享权限分析" note="仅展示，不修改继承、成员关系或访问控制列表">
        <div className="filters">
          <Filter label="搜索共享权限" value={query} onChange={setQuery} placeholder="共享目录、主体或路径" />
          <select aria-label="权限结果筛选" value={scope} onChange={event => setScope(event.target.value)}>
            {['全部结果', ...permissions.map(item => item.result)].map(value => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="domain-card-list">
          {items.map(item => (
            <article className="domain-resource" key={item.path}>
              <div className="domain-resource-head"><div><h3>{item.name}</h3><small className="mono">{item.path}</small></div><Tag tone={item.tone}>{item.result}</Tag></div>
              <Facts rows={[[ '访问主体', item.subject ], [ '继承状态', item.inherit ], [ '共享层权限', item.share ], [ 'NTFS 层权限', item.ntfs ]]} />
              <Evidence title={`展开权限解释 · ${item.name}`}><p>{item.evidence}</p><p>证据 ACL-DEMO：固定模拟 ACL。生产判定还需完整 ACE 顺序、嵌套组、访问令牌、所有者与特殊权限；本页不作真实授权结论。</p></Evidence>
            </article>
          ))}
          {!items.length && <NoResults />}
        </div>
      </Panel>
        </>
  )
}

const printers = [
  { id: 'PRINT-02', name: '行政共享打印', state: '等待处理', toner: 12, location: '行政办公区 · 2F', jobs: [ { id: 'JOB-201', name: '示例文档 A', pages: 8, state: '等待纸张' }, { id: 'JOB-202', name: '示例文档 B', pages: 3, state: '排队中' } ] },
  { id: 'PRINT-03', name: '研发共享打印', state: '就绪', toner: 76, location: '研发中心 · 3F', jobs: [ { id: 'JOB-301', name: '示例文档 C', pages: 2, state: '打印中（快照）' } ] },
  { id: 'PRINT-04', name: '会议区打印', state: '离线', toner: 0, location: '会议中心 · 1F', jobs: [] },
]

export function PrintingPage() {
  const [query, setQuery] = useState('')
  const [printerId, setPrinterId] = useState(printers[0].id)
  const items = printers.filter(printer => `${printer.id} ${printer.name} ${printer.location}`.toLowerCase().includes(query.toLowerCase()))
  const selected = items.find(printer => printer.id === printerId)
  return (
    <>
      <DomainIntro title="队列、耗材与异常，一眼看见">作业标题均为虚构占位。队列不会自动更新，不提供取消作业、清空队列或重启服务。</DomainIntro>
      <div className="domain-grid">
        <Panel title="打印设备" note="3 台模拟设备 · 选择设备查看队列">
          <div className="filters"><Filter label="搜索打印设备" value={query} onChange={setQuery} placeholder="设备、编号或位置" /></div>
          <div className="domain-list">
            {items.map(printer => (
              <button key={printer.id} className={`domain-list-item ${selected?.id === printer.id ? 'is-selected' : ''}`} onClick={() => setPrinterId(printer.id)} aria-pressed={selected?.id === printer.id}>
                <span><strong>{printer.name}</strong><small>{printer.id} · {printer.location}</small></span>
                <Tag tone={printer.state === '就绪' ? 'green' : 'amber'}>{printer.state}</Tag>
              </button>
            ))}
            {!items.length && <NoResults />}
          </div>
        </Panel>
        <Panel title="只读打印队列" note={selected ? `${selected.id} · ${selected.jobs.length} 个模拟作业` : '选择左侧设备'}>
          {selected ? (
            <div className="domain-body">
              <div className="domain-resource-head"><h3>{selected.name}</h3><Tag tone="amber">非实时观测</Tag></div>
              <Facts rows={[[ '设备状态', selected.state ], [ '耗材余量', selected.state === '离线' ? '未知（采集不可用）' : `${selected.toner}%` ]]} />
              {selected.jobs.length ? selected.jobs.map(job => (
                <div className="domain-job" key={job.id}><span><strong>{job.name}</strong><small>{job.id} · {job.pages} 页</small></span><Tag>{job.state}</Tag></div>
              )) : <p className="warning">暂无队列快照。设备离线，不能据此断言没有待打印作业。</p>}
              <Evidence title="展开打印诊断证据">
                <p>{selected.state === '等待处理' ? 'PRT-006：耗材 12%，低于示例阈值 15%；首个作业等待纸张。耗材不足与缺纸为不同信号，应分别人工确认。' : selected.state === '离线' ? 'PRT-008：心跳缺失，耗材与队列未知。先核实采集通道，不能直接认定设备故障。' : 'PRT-007：样本中设备就绪，存在 1 个打印中作业；状态来自同一固定快照。'}</p>
                <p>仅展示模拟诊断，不已执行任何打印维护操作。</p>
              </Evidence>
            </div>
          ) : <div className="empty">请选择筛选结果中的打印设备。</div>}
        </Panel>
      </div>
        </>
  )
}

const vms = [
  { id: 'VM-DEMO-01', name: '文件服务示例', host: 'ESX-01', state: '运行中', cpu: '4 vCPU', memory: '16 GiB', evidence: '内存使用率 62%；虚拟磁盘使用率 86%，需要核实来宾系统空间。运行中不代表业务服务健康。' },
  { id: 'VM-DEMO-02', name: '应用服务示例', host: 'ESX-02', state: '运行中', cpu: '8 vCPU', memory: '32 GiB', evidence: 'CPU 使用率 31%；无新鲜来宾工具心跳，业务可用性未知。' },
  { id: 'VM-DEMO-03', name: '恢复演练示例', host: 'ESX-02', state: '已关机', cpu: '2 vCPU', memory: '8 GiB', evidence: '计划内停机样本。没有启动、关机、迁移或快照删除能力。' },
]

export function VirtualizationPage() {
  const [query, setQuery] = useState('')
  const [state, setState] = useState('全部电源状态')
  const items = vms.filter(vm => `${vm.id} ${vm.name} ${vm.host}`.toLowerCase().includes(query.toLowerCase()) && (state === '全部电源状态' || vm.state === state))
  return (
    <>
      <DomainIntro title="容量与业务状态分开观察">演示集群 DEMO-CLUSTER 的容量分配与虚机状态。未连接 vSphere、Hyper-V 或 Proxmox。</DomainIntro>
      <div className="domain-capacity-grid">
        {[{ label: 'CPU 使用', value: '38%', used: 38, note: '24 核中约 9.1 核 · 使用率样本' }, { label: '内存使用', value: '72%', used: 72, note: '184 / 256 GiB · 使用容量样本' }, { label: '存储使用', value: '84%', used: 84, note: '8.4 / 10 TiB · 超过示例阈值 80%' }].map(metric => (
          <section className="panel domain-capacity" key={metric.label}>
            <div className="domain-resource-head"><h3>{metric.label}</h3><HardDrive size={20} /></div>
            <strong>{metric.value}</strong>
            <div className={`domain-meter ${metric.used >= 80 ? 'is-warning' : ''}`} role="meter" aria-label={metric.label} aria-valuenow={metric.used} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${metric.used}%` }} /></div>
            <small>{metric.note}</small>
          </section>
        ))}
      </div>
      <Panel title="虚拟机清单" note="电源状态 ≠ 业务健康；容量快照不代表可调度余量">
        <div className="filters">
          <Filter label="搜索虚拟机" value={query} onChange={setQuery} placeholder="虚机、宿主或编号" />
          <select aria-label="虚机电源状态" value={state} onChange={event => setState(event.target.value)}>{['全部电源状态', '运行中', '已关机'].map(value => <option key={value}>{value}</option>)}</select>
        </div>
        <div className="domain-card-list">
          {items.map(vm => (
            <article className="domain-resource" key={vm.id}>
              <div className="domain-resource-head"><div><h3>{vm.name}</h3><small>{vm.id} · {vm.host}</small></div><Tag tone={vm.state === '运行中' ? 'green' : 'amber'}>{vm.state}</Tag></div>
              <Facts rows={[[ '配置 CPU', vm.cpu ], [ '配置内存', vm.memory ]]} />
              <Evidence title={`展开虚机证据 · ${vm.id}`}><p>{vm.evidence}</p><p>来源：内置虚拟化快照 · {observedAt}。未校验 HA 预留、超分比或迁移约束。</p></Evidence>
            </article>
          ))}
          {!items.length && <NoResults />}
        </div>
      </Panel>
        </>
  )
}

const backupJobs = [
  { id: 'BAK-101', name: '文件服务每日备份', target: 'FS-01', backup: '成功', recovery: '未验证', point: '2026-10-10 02:00', rpo: '24 小时（目标）', proof: '备份任务返回成功，生成恢复点；没有挂载、读取校验或应用一致性验证证据，恢复能力未知。' },
  { id: 'BAK-102', name: '业务应用每日备份', target: 'APP-DEMO-01', backup: '成功', recovery: '验证通过', point: '2026-10-10 03:00', rpo: '24 小时（目标）', proof: '固定模拟演练 RESTORE-021：2026-10-09 在隔离环境恢复、校验示例文件摘要并完成应用探测；耗时 18 分钟。仅说明该演练样本，不保证后续恢复点。' },
  { id: 'BAK-103', name: '配置归档备份', target: 'CONFIG-DEMO', backup: '失败', recovery: '验证失败', point: '2026-10-08 01:00', rpo: '24 小时（目标）', proof: '最新备份任务示例错误 REPO_UNAVAILABLE。历史恢复点验证出现摘要不一致；最新备份失败与历史验证失败是两个独立事件。' },
]

export function BackupPage() {
  const [query, setQuery] = useState('')
  const [recovery, setRecovery] = useState('全部验证状态')
  const items = backupJobs.filter(job => `${job.name} ${job.id} ${job.target}`.toLowerCase().includes(query.toLowerCase()) && (recovery === '全部验证状态' || job.recovery === recovery))
  return (
    <>
      <DomainIntro title="备份成功，不等于能够恢复">两条独立证据链：任务完成情况与恢复验证结果。此页不发起备份，也不执行恢复演练。</DomainIntro>
      <div className="domain-summary">
        <div><CheckCircle2 size={23} /><span><strong>2 / 3</strong><small>备份任务成功（样本）</small></span></div>
        <div><ShieldCheck size={23} /><span><strong>1 / 3</strong><small>恢复验证通过（样本）</small></span></div>
        <div><Clock3 size={23} /><span><strong>1 项未验证</strong><small>未知不计为通过</small></span></div>
      </div>
      <Panel title="备份与恢复巡检" note="目标 RPO / RTO 是策略，不代表已达成">
        <div className="filters">
          <Filter label="搜索备份任务" value={query} onChange={setQuery} placeholder="任务、对象或编号" />
          <select aria-label="恢复验证状态" value={recovery} onChange={event => setRecovery(event.target.value)}>{['全部验证状态', '未验证', '验证通过', '验证失败'].map(value => <option key={value}>{value}</option>)}</select>
        </div>
        <div className="domain-card-list">
          {items.map(job => (
            <article className="domain-resource" key={job.id}>
              <div className="domain-resource-head"><div><h3>{job.name}</h3><small>{job.id} · {job.target}</small></div></div>
              <div className="domain-dual-status">
                <div><span>备份任务</span><Tag tone={job.backup === '成功' ? 'green' : 'red'}>{job.backup}</Tag></div>
                <div><span>恢复验证</span><Tag tone={job.recovery === '验证通过' ? 'green' : job.recovery === '验证失败' ? 'red' : 'amber'}>{job.recovery}</Tag></div>
              </div>
              <Facts rows={[[ '最近恢复点（样本）', job.point ], [ '策略 RPO', job.rpo ], [ '策略 RTO', '4 小时（目标，未普遍验证）' ]]} />
              <Evidence title={`展开巡检证据 · ${job.id}`}><p>{job.proof}</p><p>来源：预置任务与演练记录。时间为固定样本，不随当前日期计算实时 SLA。</p></Evidence>
            </article>
          ))}
          {!items.length && <NoResults />}
        </div>
      </Panel>
        </>
  )
}

const articles = [
  { id: 'KB-DEMO-001', title: '共享访问被拒绝，先看哪一层？', category: '共享权限', excerpt: '区分共享与 NTFS 两层权限，检查令牌、继承和显式拒绝。', body: '先确认访问路径和请求的具体操作，再核对共享层权限与 NTFS ACL。读取和写入要分别分析。固定案例中的显式拒绝写入，不代表所有操作都被拒绝。', question: '为什么能读共享目录却不能写入？', answer: '【固定模拟答复】可能是共享层只授予读取，或 NTFS 层存在适用的写入拒绝。请先核实访问主体与两层 ACL；目前没有真实权限证据，不能作实际授权判断。' },
  { id: 'KB-DEMO-002', title: '备份成功后的恢复验证清单', category: '备份恢复', excerpt: '恢复点可用性、隔离恢复、文件校验与应用探测要独立记录。', body: '备份任务成功只说明任务报告成功。恢复验证需要指定恢复点、隔离环境、数据校验、应用探测与耗时记录。未验证必须保持未知，不能展示为健康通过。', question: '备份成功是否代表一定能恢复？', answer: '【固定模拟答复】不代表。样本 BAK-101 的备份成功，但恢复验证未完成。应在授权的隔离环境开展恢复演练并保存校验证据；本助手不会执行恢复操作。' },
  { id: 'KB-DEMO-003', title: '打印队列阻塞的只读排查', category: '办公支持', excerpt: '分开观察设备状态、首个作业、纸张与耗材，不直接清空队列。', body: '先观察设备可达性、首个作业状态以及纸张和耗材告警。采集离线时将队列标记为未知。取消作业或重启服务可能影响其他使用者，应由授权人员评估。', question: '打印排队时可以直接清空队列吗？', answer: '【固定模拟答复】不建议。请先人工确认首个作业、纸张与耗材状态，并评估影响。样本 PRINT-02 同时存在等待纸张与低耗材，二者需分别确认；未执行清理。' },
]

export function KnowledgePage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部分类')
  const [articleId, setArticleId] = useState(articles[0].id)
  const [answerId, setAnswerId] = useState<string | null>(null)
  const items = articles.filter(article => `${article.title} ${article.id} ${article.excerpt}`.toLowerCase().includes(query.toLowerCase()) && (category === '全部分类' || article.category === category))
  const selected = articles.find(article => article.id === articleId)!
  const answer = articles.find(article => article.id === answerId)
  return (
    <>
      <DomainIntro title="有出处的建议，不越界的助手">知识条目与引用均为本地固定模拟内容；未调用模型、未检索外部知识，也不发送任何数据。</DomainIntro>
      <div className="domain-grid">
        <Panel title="部门知识库" note="3 篇演示条目 · 仅用于交互评审">
          <div className="filters">
            <Filter label="搜索知识库" value={query} onChange={setQuery} placeholder="标题、编号或关键词" />
            <select aria-label="知识分类" value={category} onChange={event => setCategory(event.target.value)}>{['全部分类', ...articles.map(article => article.category)].map(value => <option key={value}>{value}</option>)}</select>
          </div>
          <div className="domain-list">
            {items.map(article => (
              <button key={article.id} className={`domain-list-item ${article.id === articleId ? 'is-selected' : ''}`} onClick={() => setArticleId(article.id)} aria-pressed={article.id === articleId}>
                <BookOpen size={20} /><span><strong>{article.title}</strong><small>{article.id} · {article.category}</small><p>{article.excerpt}</p></span><ChevronRight size={16} />
              </button>
            ))}
            {!items.length && <NoResults />}
          </div>
          <article className="domain-article" id="knowledge-reference" aria-live="polite">
            <Tag>本地模拟引用</Tag><h3>{selected.title}</h3><small>{selected.id} · v1.0 · 示例编辑组 · 2026-10-10</small><p>{selected.body}</p>
          </article>
        </Panel>
        <Panel title="AI 助手 · 固定场景演示" note="按钮选择预置问题；不是自由问答，也不是模型生成">
          <div className="domain-body">
            <div className="domain-assistant-heading"><Sparkles size={25} /><div><h3>建议可追溯，执行留给人</h3><small>本地模板 · 外发关闭 · 无工具调用</small></div></div>
            <div className="domain-questions">{articles.map(article => (
              <button className="button" key={article.id} onClick={() => setAnswerId(article.id)}>{article.question}<ChevronRight size={16} /></button>
            ))}</div>
            {answer ? (
              <div className="domain-answer" aria-live="polite">
                <Tag tone="amber">固定模拟输出 / 非 AI 生成</Tag>
                <h3>{answer.question}</h3><p>{answer.answer}</p>
                <div className="domain-citation"><small>唯一依据 · 本地演示条目 v1.0</small><button className="text-button" onClick={() => { setArticleId(answer.id); setQuery(''); setCategory('全部分类'); document.getElementById('knowledge-reference')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }}><BookOpen size={15} />查看引用 {answer.id}</button></div>
                <p className="field-note">证据缺口：未获取任何真实日志、配置或设备状态。建议需人工核实，不能据此自动执行。</p>
              </div>
            ) : <div className="domain-assistant-empty"><Sparkles size={32} /><p>选择一个示例问题</p><small>体验“建议 → 引用 → 人工核实”的只读链路</small></div>}
          </div>
        </Panel>
      </div>
        </>
  )
}