import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {downloadCsv} from './csv-export'
import {publishEvidence} from './review-evidence'
type Step={id:string;table:string;purpose:string;keyColumns:string[];uniqueConstraints:string[];notes:string;executed:boolean;productionEnabled:boolean}
const failure='迁移计划载入失败或响应不符；不显示诊断正文，不回退为本地计划。'
export function parsePlan(value:unknown):Step[]|null{
 if(!Array.isArray(value)||value.length<1||value.length>32)return null
 const steps=value.map(entry=>{
  const v=entry as Step
  if(!v||typeof v!=='object'||typeof v.id!=='string'||!v.id||v.id.length>64)return null
  if(typeof v.table!=='string'||!v.table||v.table.length>64||typeof v.purpose!=='string'||!v.purpose||v.purpose.length>200)return null
  if(typeof v.notes!=='string'||!v.notes.trim()||v.notes.length>400)return null
  if(v.executed!==false||v.productionEnabled!==false)return null
  const columns=(list:unknown)=>Array.isArray(list)&&list.length>0&&list.length<=8&&list.every(item=>typeof item==='string'&&item.length>0&&item.length<=64)
  if(!columns(v.keyColumns)||!columns(v.uniqueConstraints))return null
  return {id:v.id,table:v.table,purpose:v.purpose,keyColumns:v.keyColumns,uniqueConstraints:v.uniqueConstraints,notes:v.notes,executed:false,productionEnabled:false}
 })
 if(steps.some(step=>step===null))return null
 const list=steps as Step[]
 return new Set(list.map(step=>step.id)).size===list.length&&new Set(list.map(step=>step.table)).size===list.length?list:null
}
export default function MigrationPlanPanel(){
 const [plan,setPlan]=useState<Step[]|null>(null),[status,setStatus]=useState('尚未载入迁移计划'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setPlan(null);setStatus('正在载入迁移计划…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/migration-plan',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,131072) as {isDemo:boolean;persistence:string;data:unknown}
   const steps=payload.isDemo===true&&payload.persistence==='none'?parsePlan(payload.data):null
   if(!steps)throw new Error()
   if(active.current!==controller)return
   setPlan(steps)
   setStatus(`已载入 ${steps.length} 步迁移计划；全部为未执行，未创建任何表或约束。`)
   publishEvidence({key:'migration-plan',label:'持久化迁移计划',detail:`${steps.length} 步计划；全部未执行，未创建表或约束`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel domain-panel" aria-label="持久化迁移计划">
  <div className="panel-head"><div><h2>持久化迁移计划（未执行）</h2><p>列出未来持久化必须建立的表与唯一约束，用于技术评审；本原型不创建任何表</p></div></div>
  <div className="domain-body">
   <p>计划来自后端只读端点，所有步骤均标记为<strong>未执行</strong>；它描述迁移目标，不代表已实现持久化、迁移或事务能力，也不代表任何数据已写入数据库。</p>
   <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void load()}>载入迁移计划</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消迁移计划等待</button></div>
   <p role="status">{status}</p>
   {plan&&<>
    <div className="table-wrap"><table aria-label="迁移计划清单"><thead><tr>{['步骤','目标表','主键/标识列','唯一约束','说明','执行状态'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
     {plan.map(step=><tr key={step.id}><td><code>{step.id}</code></td><td>{step.table}</td><td style={{overflowWrap:'anywhere'}}>{step.keyColumns.join('、')}</td><td style={{overflowWrap:'anywhere'}}>{step.uniqueConstraints.join('、')}</td><td style={{overflowWrap:'anywhere'}}>{step.notes}</td><td>未执行</td></tr>)}
    </tbody></table></div>
    <div className="inline-actions"><button className="button" type="button" onClick={()=>downloadCsv('migration-plan-template.csv',
     ['id','table','purpose','keyColumns','uniqueConstraints','notes','executed','productionEnabled','评审结论','部门意见'],
     plan.map(step=>[step.id,step.table,step.purpose,step.keyColumns.join('|'),step.uniqueConstraints.join('|'),step.notes,'否','否','','']))}>导出迁移计划 CSV（含批注列）</button></div>
   </>}
  </div>
 </section>
}
