import {useEffect,useRef,useState,type ReactNode} from 'react'
import {readBoundedJson} from './bounded-json'
import {downloadCsv} from './csv-export'
export type ProviderCandidate={id:string;name:string;packageAvailable:boolean;notes:string}
export function parseProviderCandidates(value:unknown):ProviderCandidate[]|null{
 if(!Array.isArray(value)||value.length===0||value.length>8)return null
 const parsed=value.map(entry=>{
  const v=entry as ProviderCandidate&{planned?:unknown;implemented?:unknown;verified?:unknown;outboundEnabled?:unknown}
  if(!v||typeof v!=='object'||typeof v.id!=='string'||!v.id||v.id.length>64||typeof v.name!=='string'||!v.name||v.name.length>64)return null
  if(typeof v.notes!=='string'||v.notes.trim().length===0||v.notes.length>500||typeof v.packageAvailable!=='boolean')return null
  if(v.planned!==true||v.implemented!==false||v.verified!==false||v.outboundEnabled!==false)return null
  return {id:v.id,name:v.name,packageAvailable:v.packageAvailable,notes:v.notes}
 })
 if(parsed.some(item=>item===null))return null
 const list=parsed as ProviderCandidate[]
 return new Set(list.map(item=>item.id)).size===list.length?list:null
}
const failure='候选能力目录载入失败或响应不符；不显示诊断正文，不回退为本地说明。'
export default function ProviderCandidates({label,title,subtitle,endpoint,subject,children}:{label:string;title:string;subtitle:string;endpoint:string;subject:string;children?:ReactNode}){
 const [list,setList]=useState<ProviderCandidate[]|null>(null),[status,setStatus]=useState('尚未载入候选能力'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setList(null);setStatus('正在载入候选能力…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch(endpoint,{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,131072) as {isDemo:boolean;persistence:string;data:unknown}
   const candidates=payload.isDemo===true&&payload.persistence==='none'?parseProviderCandidates(payload.data):null
   if(!candidates)throw new Error()
   if(active.current!==controller)return
   setList(candidates);setStatus(`已载入 ${candidates.length} 个${subject}候选；均未实现、未验证、未开放外连。`)
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label={label}><div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
  {children}
  <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void load()}>载入候选能力</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消候选载入等待</button></div>
  <p role="status">{status}</p>
  {list&&<div className="table-wrap"><table aria-label={`${subject}候选明细`}><thead><tr>{['候选','依赖包声明','适配实现','实测验证','必测与说明'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>{list.map(item=><tr key={item.id}><td>{item.name}</td><td>{item.packageAvailable?'已声明（无业务适配）':'尚未安装'}</td><td>否</td><td>否</td><td style={{overflowWrap:'anywhere'}}>{item.notes}</td></tr>)}</tbody></table></div>}
  {list&&<div className="inline-actions"><button className="button" type="button" onClick={()=>downloadCsv(`${subject}-candidates-template.csv`,['id','name','packageAvailable','planned','implemented','verified','outboundEnabled','notes','首批纳入','部门意见'],list.map(item=>[item.id,item.name,item.packageAvailable?'是':'否','是','否','否','否',item.notes,'','']))}>导出{subject}候选明细 CSV（含批注列）</button></div>}
 </section>
}
