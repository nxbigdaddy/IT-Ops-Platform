import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {parseConnectorCatalog,type ConnectorCandidate} from './connector-catalog'
import {publishEvidence} from './review-evidence'
const fields:Record<string,string>={configuration:'配置',connectorId:'候选连接器',protocol:'协议',capabilities:'采集能力',secretReference:'凭据引用'}
const codes:Record<string,string>={required:'缺少配置',unknown_candidate:'未知候选',required_or_too_long:'名称为空或超长',not_registered:'不属于该候选规划',count_out_of_range:'能力数量超限',invalid_name:'能力名称不符',duplicate:'能力重复',reference_required:'凭据引用必须为 secret://connector/… 形状'}
const failure:Record<'load'|'check'|'self'|'plan',string>={
 plan:'清单检查不可用或响应不符；不显示诊断正文，不回退为通过。',
 load:'候选目录载入失败或响应不符；不显示诊断正文，不回退为本地候选目录。',
 check:'连接器目录规则预检不可用或响应不符；不显示诊断正文，不回退为成功。',
 self:'目录自检不可用或响应不符；不显示诊断正文，不回退为通过。',
}
type PlanItem={connectorId:string;protocol:string;capabilities:string[];secretReference:string}
type PlanResult={validItems:number;invalidItems:number;items:{index:number;configurationValid:boolean;errors:{field:string;code:string}[]}[];failures:string[]}
function parsePlan(payload:unknown,status:number,expected:number):PlanResult{
 const p=payload as {isDemo:boolean;persistence:string;data:{configurationValid:boolean;validItems:number;invalidItems:number;errors:{field:string;code:string}[];items:{index:number;configurationValid:boolean;errors:{field:string;code:string}[]}[];connectionAttempted:boolean;executionAllowed:boolean;compatibilityVerified:boolean}}
 const data=p?.data
 if(!p||p.isDemo!==true||p.persistence!=='none'||!data||!Array.isArray(data.items)||!Array.isArray(data.errors)||data.connectionAttempted!==false||data.executionAllowed!==false||data.compatibilityVerified!==false||data.configurationValid!==(status===200)||data.configurationValid!==(data.errors.length===0&&data.items.every(item=>item.configurationValid))||data.validItems+data.invalidItems!==data.items.length||data.items.length!==expected||data.items.some((item,index)=>!item||item.index!==index||!Array.isArray(item.errors)))throw new Error()
 const planCodes:Record<string,string>={required:'缺少配置',count_out_of_range:'项目数量超出1–20'}
 if(data.errors.length>0){
  const message=data.errors.map(error=>{if(!Object.hasOwn(planCodes,error.code))throw new Error();return `${fields[error.field]??error.field}：${planCodes[error.code]}`})
  return {validItems:0,invalidItems:0,items:[],failures:[message.join('；')]}
 }
 const failures=data.items.filter(item=>!item.configurationValid).map(item=>{const message=item.errors.map(error=>{if(!Object.hasOwn(fields,error.field)||!Object.hasOwn(codes,error.code))throw new Error();return `${fields[error.field]}：${codes[error.code]}`});return `第${item.index+1}项 ${message.join('、')}`})
 return {validItems:data.validItems,invalidItems:data.invalidItems,items:data.items,failures}
}
export default function ConnectorPreflight(){
 const [catalog,setCatalog]=useState<ConnectorCandidate[]|null>(null),[loadStatus,setLoadStatus]=useState('尚未载入候选目录')
 const [candidateId,setCandidateId]=useState(''),[protocol,setProtocol]=useState(''),[capabilities,setCapabilities]=useState<string[]>([])
 const [checkStatus,setCheckStatus]=useState('尚未检查'),[busy,setBusy]=useState<'load'|'check'|'self'|'plan'|null>(null)
 const [registered,setRegistered]=useState<ConnectorCandidate|null>(null)
 const [plan,setPlan]=useState<PlanItem[]>([]),[planStatus,setPlanStatus]=useState('清单为空'),[planFailures,setPlanFailures]=useState<string[]>([])
 const [selfStatus,setSelfStatus]=useState('尚未自检')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 const candidate=catalog?.find(item=>item.id===candidateId)??null
 const allProtocols=catalog?[...new Set(catalog.flatMap(item=>item.protocols))]:[]
 const allCapabilities=catalog?[...new Set(catalog.flatMap(item=>item.plannedReadCapabilities))]:[]
 function select(next:string){
  const found=catalog?.find(item=>item.id===next)
  setCandidateId(next);setProtocol(found?.protocols[0]??'');setCapabilities(found?[found.plannedReadCapabilities[0]]:[]);setCheckStatus('尚未检查')
 }
 async function start(kind:'load'|'check'|'self'|'plan',handler:(signal:AbortSignal)=>Promise<void>){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(kind)
  const timer=setTimeout(()=>controller.abort(),10000)
  try{await handler(controller.signal)}
  catch{if(active.current===controller)setStatus(kind,controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure[kind])}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(null)}}
 }
 function setStatus(kind:'load'|'check'|'self'|'plan',text:string){(kind==='load'?setLoadStatus:kind==='check'?setCheckStatus:kind==='self'?setSelfStatus:setPlanStatus)(text)}
 function selfCheck(){return start('self',async(signal)=>{
  if(!catalog)return
  setSelfStatus('正在自检目录…')
  const items=catalog.map(item=>({connectorId:item.id,protocol:item.protocols[0],capabilities:item.plannedReadCapabilities,secretReference:`secret://connector/${item.id}`}))
  const response=await fetch('/api/v1/connector-plan-preflight',{method:'POST',signal,credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({items})})
  if(response.status!==200&&response.status!==400){await response.body?.cancel();throw new Error()}
  const payload=await readBoundedJson(response,65536)
  const plan=parsePlan(payload,response.status,items.length)
  if(active.current?.signal!==signal)return
  if(plan.failures.length>0){setSelfStatus(`目录自检未通过：${plan.failures.join('；')}${plan.items.length?'。声明之间不一致。':''}`);publishEvidence({key:'connector-selfcheck',label:'连接器目录自检',detail:`不通过：${plan.failures.join('；')}`});return}
  setSelfStatus(`目录自检通过：${plan.validItems}/${plan.items.length} 项声明内部一致；未连接、未执行。`)
  publishEvidence({key:'connector-selfcheck',label:'连接器目录自检',detail:`${plan.validItems}/${plan.items.length} 项声明内部一致`})
 })}
 function checkPlan(){return start('plan',async(signal)=>{
  if(plan.length===0)return
  setPlanStatus('正在检查清单…');setPlanFailures([])
  const response=await fetch('/api/v1/connector-plan-preflight',{method:'POST',signal,credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({items:plan})})
  if(response.status!==200&&response.status!==400){await response.body?.cancel();throw new Error()}
  const payload=await readBoundedJson(response,65536)
  const result=parsePlan(payload,response.status,plan.length)
  if(active.current?.signal!==signal)return
  setPlanFailures(result.failures)
  setPlanStatus(result.failures.length>0
   ? `清单未通过：${result.validItems}/${plan.length} 项符合目录规则；未连接、未执行。`
   : `清单通过：${result.validItems}/${plan.length} 项符合目录规则；未连接设备、未执行、兼容性未验证。`)
  publishEvidence({key:'connector-plan',label:'拟接入候选清单',detail:`${result.validItems}/${plan.length} 项符合目录规则${result.failures.length?`；${result.failures.join('；')}`:''}`})
 })}
 function load(){return start('load',async(signal)=>{
  setCatalog(null);setCandidateId('');setProtocol('');setCapabilities([]);setCheckStatus('尚未检查')
  setLoadStatus('正在载入候选目录…')
  const response=await fetch('/api/v1/connector-capabilities',{signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json'}})
  if(response.status!==200){await response.body?.cancel();throw new Error()}
  const payload=await readBoundedJson(response,262144) as {isDemo:boolean;persistence:string;data:unknown}
  const list=payload.isDemo===true&&payload.persistence==='none'?parseConnectorCatalog(payload.data):null
  if(!list)throw new Error()
  if(active.current?.signal!==signal)return
  setCatalog(list);setCandidateId('');setProtocol('');setCapabilities([]);setCheckStatus('尚未检查')
  setLoadStatus(`已载入 ${list.length} 个候选；均为规划且未实现、未验证、未开放写入。`)
  publishEvidence({key:'connector-catalog',label:'连接器候选目录',detail:`${list.length} 个候选；均为规划且未实现/未验证/未开放写入`})
 })}
 function check(){return start('check',async(signal)=>{
  if(!candidate)return
  setCheckStatus('正在检查目录规则…')
  // Never leave the previous candidate's declared facts on screen for a new request.
  setRegistered(null)
  const response=await fetch('/api/v1/connector-preflight',{method:'POST',signal,credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({connectorId:candidate.id,protocol,capabilities,secretReference:'secret://connector/demo'})})
  if(response.status!==200&&response.status!==400){await response.body?.cancel();throw new Error()}
  const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:{configurationValid:boolean;connectionAttempted:boolean;executionAllowed:boolean;compatibilityVerified:boolean;errors:{field:string;code:string}[];candidate:ConnectorCandidate|null}}
  const data=payload.data
  if(payload.isDemo!==true||payload.persistence!=='none'||!data||data.connectionAttempted!==false||data.executionAllowed!==false||data.compatibilityVerified!==false||!Array.isArray(data.errors)||data.errors.length>8||data.configurationValid!==(response.status===200)||data.configurationValid!==(data.errors.length===0))throw new Error()
  // Registered facts are only shown when they belong to the candidate we asked about.
  const registered=data.candidate
  if(registered!==null&&registered!==undefined&&(registered.id!==candidate.id||registered.status!=='planned'||registered.implemented!==false||registered.liveVerified!==false||registered.writeEnabled!==false||[registered.protocols,registered.plannedReadCapabilities,registered.targetFamilies,registered.requiredBeforeOnboarding].some(list=>!Array.isArray(list)||list.length===0||new Set(list).size!==list.length)))throw new Error()
  const messages=data.errors.map(error=>{if(!error||!Object.hasOwn(fields,error.field)||!Object.hasOwn(codes,error.code))throw new Error();return `${fields[error.field]}：${codes[error.code]}`})
  if(active.current?.signal!==signal)return
  if(active.current?.signal!==signal)return
  setRegistered(registered??null)
  setCheckStatus(data.configurationValid?'目录规则通过；未连接、未执行、兼容性未验证。':`目录规则未通过：${messages.join('；')}。未连接设备。`)
  publishEvidence({key:'connector-intent',label:'连接器单项预检',detail:`${candidate.id} / ${protocol} / ${capabilities.join('、')} → ${data.configurationValid?'规则通过':`不通过：${messages.join('；')}`}`})
 })}
 return <section aria-label="连接器只读意图预检" style={{padding:16,border:'1px solid #dce3ec',borderRadius:10}}>
  <h2>连接器只读意图预检</h2>
  <p>显式载入本机Demo候选目录后，可逐项检查协议、采集能力与凭据引用形状。固定使用合成引用 <code>secret://connector/demo</code>：不填写设备地址、不接受任何凭据值；通过不等于型号兼容、设备连通或允许执行。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={busy!==null} onClick={()=>void load()}>载入候选目录</button><button className="button" type="button" disabled={busy===null} onClick={()=>active.current?.abort()}>取消连接器预检等待</button></div>
  <p role="status">{loadStatus}</p>
  {catalog&&<>
   <label>演示候选连接器 <select aria-label="演示候选连接器" disabled={busy!==null} value={candidateId} onChange={event=>select(event.target.value)}><option value="">请选择候选</option>{catalog.map(item=><option key={item.id} value={item.id}>{item.name}（{item.category}）</option>)}</select></label>
   {candidate&&<>
    <p>目标范围：{candidate.targetFamilies.join('、')} · 厂商候选：{candidate.candidateVendors.join('、')}</p>
    <label>演示协议 <select aria-label="演示协议" disabled={busy!==null} value={protocol} onChange={event=>{setProtocol(event.target.value);setCheckStatus('尚未检查')}}>{allProtocols.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    <fieldset><legend>演示采集能力</legend>{allCapabilities.map(value=><label key={value}><input type="checkbox" style={{width:'auto',marginRight:8}} disabled={busy!==null} checked={capabilities.includes(value)} onChange={event=>{setCapabilities(previous=>event.target.checked?[...previous,value]:previous.filter(item=>item!==value));setCheckStatus('尚未检查')}}/>{value}</label>)}</fieldset>
    <p>协议与能力选项取自全部候选，因此可主动构造不匹配组合来验证拒绝路径。</p>
   </>}
  </>}
  <div className="inline-actions"><button className="button" type="button" disabled={busy!==null||!candidate||!protocol||capabilities.length===0} onClick={()=>void check()}>检查连接器目录规则</button></div>
  <p role="status">{checkStatus}</p>
  {registered&&<div className="panel-note"><p><strong>{registered.name}</strong> 已登记声明（规划，未实现/未验证）：</p><ul><li>协议：{registered.protocols.join('、')}</li><li>规划只读能力：{registered.plannedReadCapabilities.join('、')}</li><li>目标范围：{registered.targetFamilies.join('、')}</li><li>接入前需确认：{registered.requiredBeforeOnboarding.join('；')}</li></ul><p>与上方所选值不一致时以后端结论为准；这些声明不代表型号兼容或设备连通。</p></div>}
  <div className="inline-actions"><button className="button" type="button" disabled={busy!==null||!catalog} onClick={()=>void selfCheck()}>自检目录内部一致性</button></div>
  <p>自检会把每个候选声明的首个协议与全部规划能力作为一批提交，用于发现目录自身声明矛盾；不代表任何设备已接入。</p>
  <p role="status">{selfStatus}</p>
  <h3>拟接入候选清单</h3>
  <p>把当前所选候选加入清单后一次性检查最多20项组合，用于评审整批接入范围；仍不连接设备、不执行操作。</p>
  <div className="inline-actions">
   <button className="button" type="button" disabled={busy!==null||!candidate||!protocol||capabilities.length===0||plan.length>=20} onClick={()=>{setPlan(previous=>[...previous,{connectorId:candidate!.id,protocol,capabilities:[...capabilities],secretReference:`secret://connector/${candidate!.id}`}]);setPlanStatus('已加入清单；尚未检查');setPlanFailures([])}}>加入清单</button>
   <button className="button" type="button" disabled={busy!==null||plan.length===0} onClick={()=>void checkPlan()}>检查清单</button>
   <button className="button" type="button" disabled={busy!==null||plan.length===0} onClick={()=>{setPlan([]);setPlanStatus('清单已清空');setPlanFailures([])}}>清空清单</button>
  </div>
  <p role="status">{planStatus}</p>
  {plan.length>0&&<ol aria-label="拟接入候选清单">{plan.map((item,index)=><li key={`${item.connectorId}-${index}`}>{item.connectorId} · {item.protocol} · {item.capabilities.join('、')} <button className="button" type="button" disabled={busy!==null} onClick={()=>{setPlan(previous=>previous.filter((_,position)=>position!==index));setPlanStatus('已移除一项；请重新检查');setPlanFailures([])}}>移除</button></li>)}</ol>}
  {planFailures.length>0&&<ul aria-label="清单未通过项">{planFailures.map(failure=><li key={failure}>{failure}</li>)}</ul>}
 </section>
}
