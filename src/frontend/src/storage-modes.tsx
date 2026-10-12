import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
type Port={port:string;purpose:string;implementation:string;configuredByFile:boolean;durable:boolean;productionReady:boolean;limits:string[]}
const implementationLabels:Record<string,string>={memory:'进程内内存',['development-file']:'本机开发文件',sqlite:'SQLite数据库（本地开发）',postgres:'PostgreSQL（未接服务器）'}
const failure='存储模式读取失败或响应不符；不显示诊断正文，不回退本地判断。'
export default function StorageModesPanel(){
 const [result,setResult]=useState<{ports:Port[];notes:string}|null>(null)
 const [status,setStatus]=useState('尚未读取'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function run(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setResult(null);setStatus('正在读取存储模式…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/storage-modes',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:{ports:Port[];anyDurable:boolean;productionReady:boolean;notes:string}}
   const data=payload.data
   if(payload.isDemo!==true||payload.persistence!=='none'||!data||!Array.isArray(data.ports)||data.ports.length!==4
     ||data.anyDurable!==false||data.productionReady!==false||typeof data.notes!=='string'||!data.notes.trim())throw new Error()
   if(data.ports.some(port=>!port||typeof port.port!=='string'||!port.port||typeof port.purpose!=='string'||!port.purpose
     ||!Object.hasOwn(implementationLabels,port.implementation)||typeof port.configuredByFile!=='boolean'
     ||port.durable!==false||port.productionReady!==false||!Array.isArray(port.limits)||port.limits.length===0||port.limits.some(limit=>typeof limit!=='string'||!limit.trim())))throw new Error()
   // Any mix of implementations is legitimate, including an all-relational demo; the port set must be complete.
   if(!data.ports.some(port=>port.port==="IPromptCatalog")||!data.ports.some(port=>port.port==="IDemoFeedbackStore"))throw new Error()
   // A configured path must never be reflected back into the page.
   if(/[A-Za-z]:\\|\/tmp\/|\.json/.test(JSON.stringify(data.ports)))throw new Error()
   if(active.current!==controller)return
   setResult({ports:data.ports,notes:data.notes})
   const fileBacked=data.ports.filter(port=>port.implementation==='development-file').length
   setStatus(`已读取 ${data.ports.length} 个端口的当前实现：${fileBacked} 个为本机开发文件，其余为进程内内存；两种都不构成持久化承诺。`)
   publishEvidence({key:'storage-modes',label:'存储模式',detail:`${fileBacked}/${data.ports.length} 为开发文件实现；durable=false`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label="存储模式（只读）">
  <div className="panel-head"><div><h2>存储模式（只读）</h2><p>当前进程实际解析到的持久化实现，用于区分“端口可替换”与实际能力</p></div></div>
  <p>此表由服务端按当前配置返回，<strong>不含任何文件路径、连接串或凭据</strong>。无论显示哪种实现，本原型的可持久化标记与生产就绪标记都必须为否：文件实现仅用于本机开发，没有事务、并发写者或多实例协调。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void run()}>读取存储模式</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消存储模式等待</button></div>
  <p role="status">{status}</p>
  {result&&<div className="table-wrap"><table aria-label="存储模式明细"><thead><tr>{['端口','用途','当前实现','由文件配置','可持久化','生产就绪','已知限制'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
   {result.ports.map(port=><tr key={port.port}>
    <td><code>{port.port}</code></td>
    <td>{port.purpose}</td>
    <td>{implementationLabels[port.implementation]}</td>
    <td>{port.configuredByFile?'是':'否'}</td>
    <td>否</td>
    <td>否</td>
    <td>{port.limits.join('；')}</td>
   </tr>)}
  </tbody></table></div>}
  {result&&<p className="field-note">{result.notes}</p>}
 </section>
}
