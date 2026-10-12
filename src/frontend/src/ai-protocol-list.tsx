import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {containsSensitiveText} from './data'
import {parseAcceptedProtocols,type AcceptedProtocol} from './ai-protocols'
import {publishEvidence} from './review-evidence'
const failure='协议目录载入失败或响应不符；不显示诊断正文，不回退为本地协议清单。'
const previewFailure='请求形状预览不可用或响应不符；不显示诊断正文，未发送任何请求。'
export default function AiProtocolList(){
 const [list,setList]=useState<AcceptedProtocol[]|null>(null),[status,setStatus]=useState('尚未载入协议目录'),[busy,setBusy]=useState(false)
 const [preview,setPreview]=useState<{protocol:string;text:string}|null>(null),[previewStatus,setPreviewStatus]=useState('尚未预览请求形状'),[previewBusy,setPreviewBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 const previewActive=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null;previewActive.current?.abort();previewActive.current=null},[])
 async function previewRequest(protocol:string){
  if(previewActive.current)return
  const controller=new AbortController();previewActive.current=controller;setPreviewBusy(true)
  setPreview(null);setPreviewStatus(`正在构建 ${protocol} 的请求形状…`)
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/ai-contract-preflight',{method:'POST',signal:controller.signal,redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({protocol,model:'demo-model',system:'演示系统提示',user:'演示用户文本',maxTokens:256,temperature:0.2})})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:{configurationValid:boolean;preview:{protocol:string;model:string;networkVerified:boolean;transportImplemented:boolean;credentialRead:boolean;syntheticInput:boolean;request:unknown}|null;errors:unknown[]}}
   const data=payload.data
   if(payload.isDemo!==true||payload.persistence!=='none'||!data||data.configurationValid!==true||!data.preview
     ||data.preview.protocol!==protocol||data.preview.model!=='demo-model'||data.preview.networkVerified!==false
     ||data.preview.transportImplemented!==false||data.preview.credentialRead!==false||data.preview.syntheticInput!==true
     ||!data.preview.request||typeof data.preview.request!=='object')throw new Error()
   const text=JSON.stringify(data.preview.request,null,2)
   if(text.length>4096||containsSensitiveText(text))throw new Error()
   if(previewActive.current!==controller)return
   setPreview({protocol,text})
   setPreviewStatus(`已构建 ${protocol} 的请求形状；仅合成输入，未发送、无网络、无凭据。`)
   publishEvidence({key:`ai-request-${protocol}`,label:`AI请求形状（${protocol}）`,detail:`已构建载荷形状（${text.length} 字符）model/messages/stream=false；未发送`})
  }catch{if(previewActive.current===controller)setPreviewStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':previewFailure)}
  finally{clearTimeout(timer);if(previewActive.current===controller){previewActive.current=null;setPreviewBusy(false)}}
 }
 async function load(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setList(null);setStatus('正在载入协议目录…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/ai-protocols',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:unknown}
   const protocols=payload.isDemo===true&&payload.persistence==='none'?parseAcceptedProtocols(payload.data):null
   if(!protocols)throw new Error()
   if(active.current!==controller)return
   setList(protocols);setStatus(`已载入 ${protocols.length} 个可用协议；仅为离线契约，无网络传输、无凭据读取、无真实模型验证。`)
   publishEvidence({key:'ai-protocols',label:'AI协议目录',detail:`${protocols.length} 个协议：${protocols.map(item=>item.protocol).join('、')}；无网络传输/凭据读取`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label="可用AI协议">
  <div className="panel-head"><div><h2>可用AI协议（预检接受值）</h2><p>显式读取后端协议目录；这些取值才是配置预检会接受的协议标识</p></div></div>
  <p>上方候选目录的标识仅用于展示，与本表协议取值属于不同命名空间：预检只接受本表列出的协议，其余取值会被判为不支持。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void load()}>载入可用协议</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消协议载入等待</button></div>
  <p role="status">{status}</p>
  {list&&<div className="table-wrap"><table aria-label="可用AI协议清单"><thead><tr>{['协议取值','显示名','请求契约','合成响应契约','联网/凭据','出站请求形状'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
   {list.map(item=><tr key={item.protocol}><td><code>{item.protocol}</code></td><td>{item.displayName}</td><td style={{overflowWrap:'anywhere'}}>{item.requestContract}</td><td style={{overflowWrap:'anywhere'}}>{item.responseContract}</td><td>均未实现</td><td><button className="button" type="button" disabled={previewBusy} onClick={()=>void previewRequest(item.protocol)}>预览请求形状</button></td></tr>)}
  </tbody></table></div>}
  <p>请求形状预览用固定的合成模型标识与演示文本构建将要发送的载荷形状，便于核对数据最小化；它不发送请求、不解析凭据、也不验证模型行为。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={!previewBusy} onClick={()=>previewActive.current?.abort()}>取消预览等待</button></div>
  <p role="status">{previewStatus}</p>
  {preview&&<pre aria-label="出站请求形状" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:320,overflow:'auto'}}>{preview.text}</pre>}
 </section>
}
