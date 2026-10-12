import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
type Summary={capacity:number;count:number;pending:number;completed:number;unknown:number;remaining:number;persistent:boolean}
type Record={scope:string;operation:string;key:string;digest:string;operationId:string;state:string;resultVersion:number;resultReference:string|null}
const GUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function validSummary(value:unknown):value is Summary{
 const v=value as Summary
 if(!v||typeof v!=='object'||Array.isArray(v))return false
 if(![v.capacity,v.count,v.pending,v.completed,v.unknown,v.remaining].every(item=>Number.isInteger(item)&&item>=0))return false
 if(v.capacity<1||v.capacity>1000||v.count>v.capacity||v.remaining!==v.capacity-v.count)return false
 if(v.pending+v.completed+v.unknown!==v.count)return false
 return v.persistent===false
}
export function validRecord(value:unknown,expectedId?:string):value is Record{
 const v=value as Record
 if(!v||typeof v!=='object'||Array.isArray(v))return false
 if(typeof v.scope!=='string'||!v.scope||typeof v.operation!=='string'||!v.operation||typeof v.key!=='string'||!v.key)return false
 if(!GUID.test(String(v.operationId))||(expectedId!==undefined&&v.operationId.toLowerCase()!==expectedId.toLowerCase()))return false
 if(typeof v.digest!=='string'||!/^[0-9a-f]{64}$/.test(v.digest))return false
 if(!['pending','completed','unknown'].includes(v.state))return false
 if(!Number.isInteger(v.resultVersion)||v.resultVersion<0)return false
 return v.resultReference===null||typeof v.resultReference==='string'
}
export default function OperationLedger(){
 const [summary,setSummary]=useState<Summary|null>(null),[status,setStatus]=useState('尚未载入台账摘要')
 const [lookup,setLookup]=useState(''),[found,setFound]=useState<Record|null>(null),[lookupStatus,setLookupStatus]=useState('尚未查询操作')
 const [busy,setBusy]=useState<'summary'|'lookup'|null>(null)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function run(kind:'summary'|'lookup'){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(kind)
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   if(kind==='summary'){
    setSummary(null);setStatus('正在载入台账摘要…')
    const response=await fetch('/api/v1/demo-operations',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
    if(response.status!==200){await response.body?.cancel();throw new Error()}
    const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:unknown}
    const data=payload.isDemo===true&&payload.persistence==='none'?(validSummary(payload.data)?payload.data:null):null
    if(!data)throw new Error()
    if(active.current!==controller)return
    setSummary(data);setStatus(`台账共 ${data.count} 项（待处理 ${data.pending} · 已提交 ${data.completed} · 结果未知 ${data.unknown}），上限 ${data.capacity}。仅进程内存，重启即丢失。`)
    publishEvidence({key:'operation-ledger',label:'操作幂等台账摘要',detail:`共 ${data.count}/${data.capacity} 项；待处理 ${data.pending}、已提交 ${data.completed}、结果未知 ${data.unknown}；仅进程内存`})
   }else{
    setFound(null)
    const id=lookup.trim()
    if(!GUID.test(id)){setLookupStatus('请输入合法操作ID（GUID）后再查询。');return}
    setLookupStatus('正在按操作ID查询…')
    const response=await fetch(`/api/v1/demo-operations/${encodeURIComponent(id)}`,{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
    if(response.status===404){await response.body?.cancel();if(active.current===controller)setLookupStatus('未找到该操作记录：可能已随进程重启丢失，或本就未认领。不代表未提交，请勿凭猜测重发。');return}
    if(response.status!==200){await response.body?.cancel();throw new Error()}
    const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:unknown}
    const data=payload.isDemo===true&&payload.persistence==='memory'&&validRecord(payload.data,id)?payload.data:null
    if(!data)throw new Error()
    if(active.current!==controller)return
    setFound(data);setLookupStatus('已按操作ID查询到记录；这是对账读取，不会重放或重试该操作。')
    publishEvidence({key:'operation-lookup',label:'按操作ID对账',detail:`${data.operation} · 状态 ${data.state} · 结果版本 ${data.resultVersion}；未重放`})
   }
  }catch{if(active.current===controller)(kind==='summary'?setStatus:setLookupStatus)(controller.signal.aborted?'等待已取消或超时；没有新的结论。':kind==='summary'?'台账摘要不可用或响应不符；不显示诊断正文，不回退本地计数。':'查询失败或响应不符；不显示诊断正文，不自动重发。')}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(null)}}
 }
 return <section aria-label="操作幂等台账" style={{padding:16,border:'1px solid #dce3ec',borderRadius:10,minWidth:0}}>
  <h2>操作幂等台账（Demo内存）</h2>
  <p>带幂等键的反馈提交与任务迁移会在此登记。台账仅进程内存、单实例、无过期与墓碑，因此不是生产幂等保证；查询只用于对账，不会重放操作。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={busy!==null} onClick={()=>void run('summary')}>载入台账摘要</button><button className="button" type="button" disabled={busy===null} onClick={()=>active.current?.abort()}>取消台账请求等待</button></div>
  <p role="status">{status}</p>
  {summary&&<div className="table-wrap"><table aria-label="台账摘要"><thead><tr>{['上限','已登记','待处理','已提交','结果未知','剩余名额'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody><tr><td>{summary.capacity}</td><td>{summary.count}</td><td>{summary.pending}</td><td>{summary.completed}</td><td>{summary.unknown}</td><td>{summary.remaining}</td></tr></tbody></table></div>}
  <label style={{display:'block',overflowWrap:'anywhere'}}>按操作ID对账 <input aria-label="操作ID" style={{maxWidth:'100%'}} value={lookup} maxLength={36} onChange={event=>setLookup(event.target.value)} placeholder="粘贴操作ID（GUID）"/></label>
  <div className="inline-actions"><button className="button" type="button" disabled={busy!==null||!lookup.trim()} onClick={()=>void run('lookup')}>查询操作记录</button></div>
  <p role="status">{lookupStatus}</p>
  {found&&<ul aria-label="操作记录" style={{overflowWrap:'anywhere'}}>
   <li>操作：{found.operation} · 状态：{found.state}</li>
   <li>作用域：{found.scope} · 键：{found.key}</li>
   <li>操作ID：<code>{found.operationId}</code></li>
   <li>结果版本：{found.resultVersion} · 结果引用：{found.resultReference??'无'}</li>
  </ul>}
 </section>
}
