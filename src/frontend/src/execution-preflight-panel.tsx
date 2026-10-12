import ScenarioPanel from './scenario-panel'
import {makeScenarioParser} from './scenario-preflight'
const ruleLabels:Record<string,string>={resourcePresent:'存在可信资源快照',authorization:'角色与站点授权',digestComputed:'按当前草稿重算动作摘要',approvalBinding:'审批绑定与有效期'}
const codeLabels:Record<string,string>={valid_snapshot_only:'三道门禁全部通过（仅快照自洽）',resource_required:'缺少资源快照',role_denied:'角色不允许请求执行',site_scope_denied:'站点超出授权范围',self_approval_denied:'禁止自批',independent_approval_required:'需要独立来源的批准',invalid_operation_draft:'草稿无法规范化，摘要不可重算',approval_required:'缺少审批',invalid_change:'变更本身不合法',approval_revoked:'审批已撤销',approval_consumed:'审批已被使用',approval_time_invalid:'审批时间无效或已过期',approval_binding_mismatch:'审批与当前草稿不匹配'}
const parser=makeScenarioParser({codes:codeLabels,ruleNames:Object.keys(ruleLabels),validField:'eligible',itemsField:'stages',extra:raw=>raw.approvalConsumed===false&&raw.productionEnabled===false})
export default function ExecutionPreflightPanel(){
 return <ScenarioPanel loadUrl="/api/v1/execution-scenarios" runUrl="/api/v1/execution-preflight" parser={parser} labels={{
  title:'执行门禁组合预检',
  intro:'按真实顺序运行三道门禁：角色与站点授权 → 按当前草稿重算动作摘要 → 审批绑定与有效期。调用方无法另外传入一个与当前参数脱节的摘要；任一场景都不启用执行、不消费审批，也不含真实鉴权与可信存储。',
  loadLabel:'载入执行门禁场景',runLabel:'运行执行门禁',cancelLabel:'取消门禁预检等待',selectLabel:'合成门禁场景',tableLabel:'执行阶段结果',
  loadOk:count=>`已载入 ${count} 个执行门禁场景；结论由后端组合预检实际求值，且任何场景都不启用执行或消费审批。`,
  loadFailed:'执行门禁场景载入失败或响应不符；不显示诊断正文，不回退为本地判定。',
  checkPending:'正在提交执行门禁场景…',
  checkFailed:'执行门禁预检失败或响应不符；不显示诊断正文，不推断为可执行。',
  allowed:scenario=>`场景“${scenario.label}”：三道门禁均通过；仍不启用执行、不消费审批，真实系统还需可信存储、并发版本控制与事务消费。`,
  denied:(scenario,stopped)=>`场景“${scenario.label}”在“${stopped}”处停止：${codeLabels[scenario.code]}。`,
  note:'启用执行：否 · 消费审批：否 · 生产就绪：否。',
  ruleLabels,codeLabels,
  evidence:{loadKey:'execution-scenarios',loadLabel:'执行门禁场景目录',checkKey:'execution-preflight',checkLabel:'执行门禁预检'},
  description:scenario=>scenario.description,
 }} />
}
