import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
type Check={name:string;status:string;verified:boolean;detail:string}
type Report={status:string;ready:boolean;checks:Check[];blockers:string[];note:string}
const nameLabels:Record<string,string>={persistence:'持久化',authentication:'身份认证',migrations:'迁移',externalNetwork:'外部网络',demoApi:'演示API'}
const failure='就绪自检读取失败或响应不符；不显示诊断正文，不回退本地判断。'
export default function ReadinessPanel(){
 const [report,setReport]=useState<Report|null>(null)
 const [status,setStatus]=useState('尚未读取'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function run(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setReport(null);setStatus('正在读取就绪自检…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/health/ready',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   // A 200 here would mean the prototype claims production readiness: refuse to display it as good news.
   if(response.status!==503){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as Report
   const data=payload
   if(!data||data.status!=='notReady'||data.ready!==false||typeof data.note!=='string'||!data.note.trim())throw new Error()
   if(!Array.isArray(data.checks)||data.checks.length<5||!Array.isArray(data.blockers)||data.blockers.length<3)throw new Error()
   if(data.checks.some(check=>!check||!Object.hasOwn(nameLabels,check.name)||typeof check.status!=='string'||!check.status||typeof check.verified!=='boolean'||typeof check.detail!=='string'||!check.detail.trim()))throw new Error()
   if(data.blockers.some(blocker=>typeof blocker!=='string'||!blocker.trim()))throw new Error()
   // Verified components must never include authentication, migrations or the network posture.
   for(const name of ['authentication','migrations','externalNetwork'])
    if(data.checks.find(check=>check.name===name)!.verified)throw new Error()
   // No path, connection string or credential may leak into the report.
   const serialized=JSON.stringify(data)
   if(/[A-Za-z]:\\\\|\/tmp\/|\.db\b|Password=|Host=/i.test(serialized))throw new Error()
   if(active.current!==controller)return
   setReport(data)
   const verified=data.checks.filter(check=>check.verified).map(check=>nameLabels[check.name])
   setStatus(`就绪结论：不可用（503）——阻断项 ${data.blockers.length} 条。已核实的组件：${verified.length>0?verified.join('、'):'无'}。`)
   publishEvidence({key:'readiness',label:'生产就绪自检',detail:`notReady · 阻断项 ${data.blockers.length} 条`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label="生产就绪自检（只读）">
  <div className="panel-head"><div><h2>生产就绪自检（只读）</h2><p>逐项说明现在为什么不能上生产，而不是一句“未就绪”</p></div></div>
  <p>该视图读取服务端 <code>/health/ready</code>：**始终为 503 且就绪为否**；若某次返回 200 或声称就绪，本面板会判为异常并拒绝展示。报告不回显数据库路径或连接串。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void run()}>读取就绪自检</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消就绪自检等待</button></div>
  <p role="status">{status}</p>
  {report&&<div className="table-wrap"><table aria-label="就绪检查项"><thead><tr>{['检查项','状态','已核实','说明'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
   {report.checks.map(check=><tr key={check.name}>
    <td>{nameLabels[check.name]}</td>
    <td><code>{check.status}</code></td>
    <td>{check.verified?'是':'否'}</td>
    <td>{check.detail}</td>
   </tr>)}
  </tbody></table></div>}
  {report&&<div className="panel-note"><p>阻断项（必须全部解决才可能就绪）：</p><ul>{report.blockers.map(blocker=><li key={blocker}>{blocker}</li>)}</ul><p>{report.note}</p></div>}
 </section>
}
