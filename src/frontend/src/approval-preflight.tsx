import ScenarioPanel from './scenario-panel'
import {makeScenarioParser} from './scenario-preflight'
const ruleLabels:Record<string,string>={approvalPresent:'存在审批证据',changeWellFormed:'变更字段合法',notRevoked:'审批未被撤销',notConsumed:'审批未被使用',timeWindowValid:'审批在有效期内',independentApprover:'审批人与申请人不同',bindingMatches:'资源、版本与动作摘要一致'}
const codeLabels:Record<string,string>={valid_snapshot_only:'快照自洽（仅表示规则通过）',approval_required:'缺少审批',invalid_change:'变更本身不合法',approval_revoked:'审批已撤销',approval_consumed:'审批已被使用',approval_time_invalid:'审批时间无效或已过期',independent_approval_required:'必须由他人审批（禁止自批）',approval_binding_mismatch:'审批与变更不匹配'}
const parser=makeScenarioParser({codes:codeLabels,ruleNames:Object.keys(ruleLabels),extra:raw=>raw.productionEnabled===false})
export default function ApprovalPreflight(){
 return <ScenarioPanel loadUrl="/api/v1/approval-scenarios" runUrl="/api/v1/approval-preflight" parser={parser} labels={{
  title:'审批绑定预检',
  intro:'用后端预置的合成场景运行既有审批规则：资源、版本、动作摘要、审批人独立性与有效期。任何结果都不授权执行，也不代表真实审批已存在；生产系统还需授权、审计、审批消费与任务入队。',
  loadLabel:'载入审批场景',runLabel:'运行审批规则',cancelLabel:'取消审批预检等待',selectLabel:'合成审批场景',tableLabel:'审批规则结果',
  loadOk:count=>`已载入 ${count} 个审批场景；全部由后端规则实际求值，且任何场景都不授权执行。`,
  loadFailed:'审批场景载入失败或响应不符；不显示诊断正文，不回退为本地判定。',
  checkPending:'正在提交审批场景…',
  checkFailed:'审批预检失败或响应不符；不显示诊断正文，不推断为通过。',
  allowed:scenario=>`场景“${scenario.label}”：全部规则通过；仍不授权执行，真实系统还需授权、审计与审批消费。`,
  denied:(scenario,stopped)=>`场景“${scenario.label}”被拒绝：${codeLabels[scenario.code]}（未通过：${stopped}）。`,
  note:'授权执行：否 · 生产就绪：否。',
  ruleLabels,codeLabels,
  evidence:{loadKey:'approval-scenarios',loadLabel:'审批场景目录',checkKey:'approval-preflight',checkLabel:'审批绑定预检'},
  description:scenario=>scenario.description,
 }} />
}
