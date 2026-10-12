import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
import {connectorMatrixRows} from './connector-matrix'
type Channel={id:string;label:string;deployment:string;prerequisites:string[];coversMatrixRows:string[];needsAgent:boolean;status:string;protocols:string[]}
type Catalog={channels:Channel[];implemented:boolean;liveVerified:boolean;writeEnabled:boolean;notes:string}
const statusLabels:Record<string,string>={planned:'计划接入',['manual-only']:'仅人工登记'}
const failure='采集通道目录读取失败或响应不符；不显示诊断正文，不回退本地判断。'
export default function CollectionChannelsPanel(){
 const [catalog,setCatalog]=useState<Catalog|null>(null)
 const [status,setStatus]=useState('尚未载入'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 const rowLabels=connectorMatrixRows.map(row=>row[0])
 const covered=catalog?new Set(catalog.channels.flatMap(channel=>channel.coversMatrixRows)):null
 // Rows the matrix shows but no planned channel claims: reported, never silently mapped.
 const uncovered=catalog?rowLabels.filter(label=>!covered!.has(label)):null
 async function run(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setCatalog(null);setStatus('正在载入采集通道目录…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/connector-collection-channels',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:Catalog}
   const data=payload.data
   if(payload.isDemo!==true||payload.persistence!=='none'||!data||!Array.isArray(data.channels)||data.channels.length<4
     ||data.implemented!==false||data.liveVerified!==false||data.writeEnabled!==false||typeof data.notes!=='string'||!data.notes.trim())throw new Error()
   if(new Set(data.channels.map(channel=>channel.id)).size!==data.channels.length)throw new Error()
   if(data.channels.some(channel=>!channel||typeof channel.id!=='string'||!channel.id.trim()||typeof channel.label!=='string'||!channel.label.trim()
     ||typeof channel.deployment!=='string'||!channel.deployment.trim()||!Array.isArray(channel.prerequisites)||channel.prerequisites.length===0
     ||channel.prerequisites.some(item=>typeof item!=='string'||!item.trim())||!Array.isArray(channel.coversMatrixRows)||channel.coversMatrixRows.length===0
     ||channel.coversMatrixRows.some(item=>typeof item!=='string'||!item.trim())||typeof channel.needsAgent!=='boolean'||!Object.hasOwn(statusLabels,channel.status)
     ||!Array.isArray(channel.protocols)||channel.protocols.length===0||channel.protocols.some(item=>typeof item!=='string'||!item.trim())))throw new Error()
   // Protocols must come from the candidate registry vocabulary; the page only checks shape and duplication.
   if(new Set(data.channels.flatMap(channel=>channel.protocols)).size<3)throw new Error()
   if(data.channels.some(channel=>new Set(channel.protocols).size!==channel.protocols.length))throw new Error()
   // A channel must never claim a row the matrix does not have.
   if(data.channels.some(channel=>channel.coversMatrixRows.some(row=>!rowLabels.includes(row))))throw new Error()
   if(active.current!==controller)return
   setCatalog(data)
   const missing=rowLabels.filter(label=>!data.channels.some(channel=>channel.coversMatrixRows.includes(label)))
   setStatus(missing.length===0
    ? `已载入 ${data.channels.length} 条采集通道，矩阵中 ${rowLabels.length} 行均有对应通道；仍无任何节点部署或凭据使用。`
    : `已载入 ${data.channels.length} 条采集通道；以下矩阵行尚无对应通道：${missing.join('、')}。`)
   publishEvidence({key:'collection-channels',label:'采集通道目录',detail:`${data.channels.length} 条通道；未覆盖 ${missing.length} 行`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label="采集通道目录">
  <div className="panel-head"><div><h2>采集通道目录（规划）</h2><p>每类设备计划用什么方式采集、需要部署什么、前置条件有哪些</p></div></div>
  <p>通道与矩阵行的对应关系由服务端给出：页面只做覆盖核对，不会自行发明通道或把某行硬套到无关通道上。全部通道均为<strong>规划</strong>：未部署节点、未使用凭据、未验证厂商版本或许可。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void run()}>载入采集通道目录</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消通道载入等待</button></div>
  <p role="status">{status}</p>
  {catalog&&<div className="table-wrap"><table aria-label="采集通道明细"><thead><tr>{['通道','部署方式','前置条件','覆盖矩阵行','承载协议','需要节点','状态'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
   {catalog.channels.map(channel=><tr key={channel.id}>
    <td><code>{channel.id}</code><br/>{channel.label}</td>
    <td>{channel.deployment}</td>
    <td>{channel.prerequisites.join('；')}</td>
    <td>{channel.coversMatrixRows.join('、')}</td>
    <td>{channel.protocols.join('、')}</td>
    <td>{channel.needsAgent?'是':'否'}</td>
    <td>{statusLabels[channel.status]}</td>
   </tr>)}
  </tbody></table></div>}
  {catalog&&uncovered&&<p className="field-note">{uncovered.length===0?`矩阵 ${rowLabels.length} 行均已被至少一条通道覆盖。`:`尚无通道覆盖的矩阵行：${uncovered.join('、')}。这是覆盖缺口，不代表该行设备不可接入。`}</p>}
  {catalog&&<p className="field-note">{catalog.notes}</p>}
 </section>
}
