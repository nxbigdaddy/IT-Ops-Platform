import ScenarioPanel from './scenario-panel'
import {makeScenarioParser} from './scenario-preflight'
const ruleLabels:Record<string,string>={identityPresent:'存在身份标识',resourceWellFormed:'资源与站点合法',knownPermission:'角色与动作已定义',siteScopeAllows:'站点在授权范围内',roleAllowsAction:'角色允许该动作',independentApprover:'审批人与申请人不同',independentApproval:'存在独立来源的批准'}
const codeLabels:Record<string,string>={allowed:'允许（仅快照判定）',identity_required:'缺少身份',resource_required:'缺少资源',unknown_permission:'未知角色或动作',site_scope_denied:'站点超出授权范围',role_denied:'角色不允许该动作',self_approval_denied:'禁止自批',independent_approval_required:'需要独立来源的批准'}
const actions=['Read','EditDraft','ApproveChange','RequestExecution']
const parser=makeScenarioParser({codes:codeLabels,ruleNames:Object.keys(ruleLabels),validField:'allowed',extra:raw=>typeof raw.role==='string'&&raw.role.length>0&&raw.role.length<=32&&typeof raw.action==='string'&&actions.includes(raw.action)&&typeof raw.siteId==='string'&&raw.siteId.length<=64&&raw.productionEnabled===false})
export default function AuthorizationPreflight(){
 return <ScenarioPanel loadUrl="/api/v1/authorization-scenarios" runUrl="/api/v1/authorization-preflight" parser={parser} labels={{
  title:'角色与站点授权预检',
  intro:'用后端预置的合成场景运行既有授权规则：角色允许的动作、站点范围、批准独立性。无通配站点、无大小写折叠、管理员也没有旁路。判定为“允许”只是快照结论，不授权执行，也不代表真实鉴权已实现。',
  loadLabel:'载入授权场景',runLabel:'运行授权规则',cancelLabel:'取消授权预检等待',selectLabel:'合成授权场景',tableLabel:'授权规则结果',
  loadOk:count=>`已载入 ${count} 个授权场景；角色、站点与批准独立性均由后端规则实际求值，任何结果都不授权执行。`,
  loadFailed:'授权场景载入失败或响应不符；不显示诊断正文，不回退为本地判定。',
  checkPending:'正在提交授权场景…',
  checkFailed:'授权预检失败或响应不符；不显示诊断正文，不推断为允许。',
  allowed:scenario=>`场景“${scenario.label}”：判定为允许；仍不授权执行，生产系统还需真实鉴权、审计与站点数据来源。`,
  denied:(scenario,stopped)=>`场景“${scenario.label}”被拒绝：${codeLabels[scenario.code]}（未通过：${stopped}）。`,
  note:'授权执行：否 · 生产就绪：否。',
  ruleLabels,codeLabels,
  evidence:{loadKey:'authorization-scenarios',loadLabel:'授权场景目录',checkKey:'authorization-preflight',checkLabel:'授权规则预检'},
  description:scenario=>scenario.description,
 }} />
}
