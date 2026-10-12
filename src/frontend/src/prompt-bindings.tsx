import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
import {downloadCsv} from './csv-export'
type Binding={feature:string;promptId:string;name:string;currentVersion:number;publishedVersion:number;publishedFrom:number;bindingStatus:string;modelExecutionEnabled:boolean;notes:string}
const statusLabels:Record<string,string>={unpublished:'尚未发布', 'published-current':'已发布且与当前草稿一致','draft-ahead':'已发布但草稿领先'}
const failure='功能绑定载入失败或响应不符；不显示诊断正文，不回退本地映射。'
export function parseBindings(value:unknown):Binding[]|null{
 if(!Array.isArray(value)||value.length<1||value.length>32)return null
 const parsed=value.map(entry=>{
  const v=entry as Binding
  if(!v||typeof v!=='object'||typeof v.feature!=='string'||!v.feature||v.feature.length>64)return null
  if(typeof v.promptId!=='string'||!v.promptId||v.promptId.length>64||typeof v.name!=='string'||!v.name||v.name.length>64)return null
  if(!Number.isInteger(v.currentVersion)||v.currentVersion<1||!Number.isInteger(v.publishedVersion)||v.publishedVersion<0||!Number.isInteger(v.publishedFrom)||v.publishedFrom<0)return null
  if(v.modelExecutionEnabled!==false||typeof v.notes!=='string'||!v.notes.trim()||v.notes.length>300)return null
  if(!Object.hasOwn(statusLabels,v.bindingStatus))return null
  if(v.publishedVersion===0){if(v.publishedFrom!==0||v.bindingStatus!=='unpublished')return null}
  else if(v.publishedFrom<1||v.publishedFrom>v.currentVersion||v.bindingStatus!==(v.publishedFrom===v.currentVersion?'published-current':'draft-ahead'))return null
  return {feature:v.feature,promptId:v.promptId,name:v.name,currentVersion:v.currentVersion,publishedVersion:v.publishedVersion,publishedFrom:v.publishedFrom,bindingStatus:v.bindingStatus,modelExecutionEnabled:false,notes:v.notes}
 })
 if(parsed.some(item=>item===null))return null
 const list=parsed as Binding[]
 return new Set(list.map(item=>item.feature)).size===list.length&&new Set(list.map(item=>item.promptId)).size===list.length?list:null
}
const coverageFailure='功能覆盖核对失败或响应不符；不显示诊断正文，不回退为本地结论。'
type Coverage={bound:{feature:string;label:string;promptIds:string[]}[];unbound:{feature:string;label:string;promptIds:string[]}[];orphanPrompts:string[];code:string}
export function parseCoverage(value:unknown):Coverage|null{
 const v=value as {bound?:unknown;unbound?:unknown;orphanPrompts?:unknown;modelExecutionEnabled?:unknown;productionEnabled?:unknown;notes?:unknown}
 if(!v||typeof v!=='object'||Array.isArray(v))return null
 if(v.modelExecutionEnabled!==false||v.productionEnabled!==false||typeof v.notes!=='string'||!v.notes.trim())return null
 const parseItems=(raw:unknown,expectOwned:boolean)=>{
  if(!Array.isArray(raw)||raw.length>32)return null
  const items=raw.map(entry=>{
   const item=entry as {feature?:unknown;label?:unknown;promptIds?:unknown}
   if(!item||typeof item!=='object'||typeof item.feature!=='string'||!item.feature||item.feature.length>64)return null
   if(typeof item.label!=='string'||!item.label||item.label.length>64)return null
   if(!Array.isArray(item.promptIds)||item.promptIds.length>8)return null
   if(!item.promptIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=64))return null
   if(expectOwned&&item.promptIds.length===0)return null
   if(!expectOwned&&item.promptIds.length!==0)return null
   return {feature:item.feature,label:item.label,promptIds:item.promptIds as string[]}
  })
  return items.some(item=>item===null)?null:items as {feature:string;label:string;promptIds:string[]}[]
 }
 const bound=parseItems(v.bound,true),unbound=parseItems(v.unbound,false)
 if(!bound||!unbound||!Array.isArray(v.orphanPrompts)||v.orphanPrompts.length>32)return null
 if(!v.orphanPrompts.every(id=>typeof id==='string'&&id.length>0&&id.length<=64))return null
 const features=[...bound,...unbound].map(item=>item.feature)
 if(new Set(features).size!==features.length)return null
 return {bound,unbound,orphanPrompts:v.orphanPrompts as string[],code:bound.length===0?'no-bound-features':unbound.length===0?'all-features-bound':'partially-bound'}
}
export default function PromptBindings(){
 const [list,setList]=useState<Binding[]|null>(null),[status,setStatus]=useState('尚未载入功能绑定'),[busy,setBusy]=useState(false)
 const [coverage,setCoverage]=useState<{bound:{feature:string;label:string;promptIds:string[]}[];unbound:{feature:string;label:string;promptIds:string[]}[];orphanPrompts:string[];code:string}|null>(null),[coverageStatus,setCoverageStatus]=useState('尚未核对功能覆盖')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setList(null);setStatus('正在载入功能绑定…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/prompt-bindings',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,131072) as {isDemo:boolean;persistence:string;data:unknown}
   const bindings=payload.isDemo===true&&payload.persistence==='memory'?parseBindings(payload.data):null
   if(!bindings)throw new Error()
   if(active.current!==controller)return
   setList(bindings)
   const counts=bindings.reduce<Record<string,number>>((all,item)=>{all[item.bindingStatus]=(all[item.bindingStatus]??0)+1;return all},{})
   setStatus(`已载入 ${bindings.length} 项功能绑定；尚未发布 ${counts.unpublished??0}、草稿领先 ${counts['draft-ahead']??0}、与草稿一致 ${counts['published-current']??0}。均未启用模型执行。`)
   publishEvidence({key:'prompt-bindings',label:'提示词功能绑定',detail:`${bindings.length} 项；尚未发布 ${counts.unpublished??0}、草稿领先 ${counts['draft-ahead']??0}、与草稿一致 ${counts['published-current']??0}；未启用模型执行`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 async function loadCoverage(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setCoverage(null);setCoverageStatus('正在核对功能覆盖…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/prompt-feature-coverage',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,131072) as {isDemo:boolean;persistence:string;data:unknown}
   const data=payload.isDemo===true&&payload.persistence==='memory'?parseCoverage(payload.data):null
   if(!data)throw new Error()
   if(active.current!==controller)return
   setCoverage(data)
   setCoverageStatus(`已核对 ${data.bound.length+data.unbound.length} 个计划功能：已登记提示词 ${data.bound.length}、尚无提示词 ${data.unbound.length}、未注册归属 ${data.orphanPrompts.length}。未启用模型执行。`)
   publishEvidence({key:'prompt-coverage',label:'功能提示词覆盖',detail:`已登记 ${data.bound.length}、尚无提示词 ${data.unbound.length}、未注册归属 ${data.orphanPrompts.length}；未启用模型执行`})
  }catch{if(active.current===controller)setCoverageStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':coverageFailure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel domain-panel" aria-label="功能与提示词绑定">
  <div className="panel-head"><div><h2>功能与提示词绑定</h2><p>显式读取后端绑定视图，查看每个功能当前草稿与最近发布修订的关系</p></div></div>
  <div className="domain-body">
   <p>绑定状态只描述“草稿版本”与“最近一条发布修订”的关系，<strong>不</strong>启用模型执行、不代表审批通过或已上线；本原型没有真实发布生效入口。</p>
   <div className="form-actions" style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="button secondary" type="button" disabled={busy} onClick={()=>void load()}>载入功能绑定</button><button className="button secondary" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消绑定载入等待</button></div>
   <p role="status">{status}</p>
   {list&&<div className="table-wrap"><table aria-label="功能绑定清单"><thead><tr>{['功能','提示词','草稿版本','发布修订','来源草稿','绑定状态','模型执行'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
    {list.map(item=><tr key={item.feature}><td>{item.feature}</td><td><code>{item.promptId}</code> · {item.name}</td><td>v{item.currentVersion}</td><td>{item.publishedVersion?`p${item.publishedVersion}`:'—'}</td><td>{item.publishedFrom?`v${item.publishedFrom}`:'—'}</td><td>{statusLabels[item.bindingStatus]}</td><td>未启用</td></tr>)}
   </tbody></table></div>}
   {list&&<div className="inline-actions"><button className="button" type="button" onClick={()=>downloadCsv('prompt-bindings-template.csv',
    ['feature','promptId','name','currentVersion','publishedVersion','publishedFrom','bindingStatus','modelExecutionEnabled','首批纳入','部门意见'],
    list.map(item=>[item.feature,item.promptId,item.name,String(item.currentVersion),String(item.publishedVersion),String(item.publishedFrom),statusLabels[item.bindingStatus],'否','','']))}>导出功能绑定 CSV（含批注列）</button></div>}
   {list&&<p className="field-note">{list[0].notes}</p>}
   <div className="inline-actions"><button className="button secondary" type="button" disabled={busy} onClick={()=>void loadCoverage()}>核对功能覆盖</button></div>
   <p role="status">{coverageStatus}</p>
   {coverage&&<>
    <div className="table-wrap"><table aria-label="功能覆盖核对"><thead><tr>{['计划功能','提示词归属','状态'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
     {coverage.bound.map(item=><tr key={item.feature}><td>{item.label} · <code>{item.feature}</code></td><td style={{overflowWrap:'anywhere'}}>{item.promptIds.join('、')}</td><td>已登记提示词</td></tr>)}
     {coverage.unbound.map(item=><tr key={item.feature}><td>{item.label} · <code>{item.feature}</code></td><td>—</td><td>尚无提示词（规划中）</td></tr>)}
     {coverage.orphanPrompts.map(id=><tr key={`orphan-${id}`}><td>未注册功能</td><td><code>{id}</code></td><td>提示词归属的功能未登记</td></tr>)}
    </tbody></table></div>
    <p className="field-note">结论代码：{coverage.code} · 已登记 {coverage.bound.length} · 尚无提示词 {coverage.unbound.length} · 未注册归属 {coverage.orphanPrompts.length} · 启用模型执行：否 · 生产就绪：否。</p>
   </>}
  </div>
 </section>
}
