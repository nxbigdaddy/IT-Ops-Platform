import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {parseConnectorCandidate,type ConnectorCandidate} from './connector-catalog'
const failure='被监控目标候选载入失败或响应不符；不显示诊断正文，不回退为本地说明。'
export default function MonitoredTargets(){
 const [candidate,setCandidate]=useState<ConnectorCandidate|null>(null),[status,setStatus]=useState('尚未载入'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function run(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setCandidate(null);setStatus('正在载入被监控目标候选…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/connector-capabilities/demo-db-monitor',{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:unknown}
   const parsed=payload.isDemo===true&&payload.persistence==='none'?parseConnectorCandidate(payload.data):null
   if(!parsed||parsed.id!=='demo-db-monitor')throw new Error()
   if(active.current!==controller)return
   setCandidate(parsed)
   setStatus('已载入被监控数据库目标候选；仍为规划，未连接、未采集、未验证。')
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label="被监控数据库目标">
  <div className="panel-head"><div><h2>被监控数据库目标（≠ 平台持久化）</h2><p>显式读取独立候选，列出计划只读采集的数据库引擎</p></div></div>
  <p>这是<strong>被采集对象</strong>的规划，与上方“数据库提供程序”的平台自身持久化选型是两件事：监控某数据库不代表平台使用它，平台选 PostgreSQL 也不代表已具备监控能力。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void run()}>载入被监控目标候选</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消目标载入等待</button></div>
  <p role="status">{status}</p>
  {candidate&&<dl className="domain-facts">
   <div><dt>候选标识</dt><dd><code>{candidate.id}</code> · {candidate.category}</dd></div>
   <div><dt>计划覆盖引擎</dt><dd>{candidate.targetFamilies.join('、')}</dd></div>
   <div><dt>采集路径</dt><dd>{candidate.protocols.join('、')}</dd></div>
   <div><dt>计划只读能力</dt><dd>{candidate.plannedReadCapabilities.join('、')}</dd></div>
   <div><dt>厂商候选</dt><dd>{candidate.candidateVendors.join('、')}</dd></div>
   <div><dt>当前状态</dt><dd>规划 · 未实现 · 未验证 · 未开放写入；需要只读账号、采集频率与支持矩阵另行评审。</dd></div>
  </dl>}
 </section>
}
