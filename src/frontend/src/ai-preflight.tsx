import { useEffect, useRef, useState } from 'react'
import { readBoundedJson } from './bounded-json'
import { parseAcceptedProtocols, type AcceptedProtocol } from './ai-protocols'
type Protocol=AcceptedProtocol
export default function AiPreflight(){
 const [provider,setProvider]=useState(''),[protocols,setProtocols]=useState<Protocol[]|null>(null),[loadStatus,setLoadStatus]=useState('尚未载入协议目录'),[timeout,setTimeoutSeconds]=useState(10),[output,setOutput]=useState(100),[budget,setBudget]=useState(200),[busy,setBusy]=useState(false),[result,setResult]=useState('尚未检查AI配置')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setProtocols(null);setProvider('');setLoadStatus('正在载入协议目录…');setResult('尚未检查AI配置')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/ai-protocols',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:unknown}
   const list=payload.isDemo===true&&payload.persistence==='none'?parseAcceptedProtocols(payload.data):null
   if(!list)throw new Error()
   if(active.current!==controller)return
   setProtocols(list);setProvider(list[0].protocol)
   setLoadStatus(`已载入 ${list.length} 个可用协议；均为离线契约，无网络传输、无凭据读取、无真实模型验证。`)
  }catch{if(active.current===controller)setLoadStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':'协议目录载入失败或响应不符；不显示诊断正文，不回退为本地协议清单。')}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 async function check(){
  if(active.current||!protocols)return
  const controller=new AbortController();active.current=controller;setBusy(true);setResult('正在检查AI离线规则')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/ai-preflight',{method:'POST',redirect:'error',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({provider,endpoint:'https://ai.example.invalid/v1',model:'demo-model',secretReference:'secret://ai/demo',timeoutSeconds:timeout,maxOutputTokens:output,requestBudgetTokens:budget})})
   if(response.status!==200&&response.status!==400){await response.body?.cancel();throw new Error()}
   const envelope=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:{configurationValid:boolean;networkVerified:boolean;liveCallEnabled:boolean;errors:{field:string;code:string}[]}}
   const data=envelope.data
   if(envelope.isDemo!==true||envelope.persistence!=='none'||!data||data.networkVerified!==false||data.liveCallEnabled!==false||!Array.isArray(data.errors)||data.errors.length>10||data.configurationValid!==(response.status===200)||data.configurationValid!==(data.errors.length===0))throw new Error()
   const fields:Record<string,string>={configuration:'配置',provider:'协议',endpoint:'地址',model:'模型',secretReference:'凭据引用',timeoutSeconds:'超时秒数',maxOutputTokens:'输出token',requestBudgetTokens:'请求预算'}
   const codes:Record<string,string>={required:'缺少配置',unsupported:'不支持',invalid:'无效',reference_required:'需要引用',out_of_range:'超出范围或小于输出token',invalid_https_endpoint:'HTTPS地址不合规',host_not_approved:'主机未批准',not_reserved_demo_model:'模型标识必须是保留的 demo- 前缀'}
   const errors=data.errors.map(error=>{if(!error||!Object.hasOwn(fields,error.field)||!Object.hasOwn(codes,error.code))throw new Error();return `${fields[error.field]}：${codes[error.code]}`})
   if(active.current===controller)setResult(data.configurationValid?'AI配置规则通过；未验证网络，未调用模型，未保存':`AI配置规则未通过：${errors.join('；')}。未调用模型。`)
  }catch{if(active.current===controller)setResult(controller.signal.aborted?'AI预检等待已取消或超时；不代表服务器回滚，请按需重新检查。':'AI预检不可用或响应不符；不显示诊断正文，不回退为成功。')}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 function changed(){setResult('AI配置已更改，请重新检查')}
 const valid=Number.isInteger(timeout)&&timeout>=1&&timeout<=60&&Number.isInteger(output)&&output>=1&&output<=32768&&Number.isInteger(budget)&&budget>=1&&budget<=1000000
 return <section aria-label="AI离线配置预检" style={{padding:16,border:'1px solid #dce3ec',borderRadius:10}}><h2>AI离线配置预检</h2><p>固定保留域名 ai.example.invalid、虚构模型 demo-model 和引用 secret://ai/demo；无密钥输入，不联网调用模型，不保存。模型标识只接受保留的 demo- 前缀，真实厂商模型名会被拒绝。</p><div className="inline-actions"><button className="button" disabled={busy} onClick={()=>void load()}>载入后端协议目录</button></div><p role="status">{loadStatus}</p><div className="filters"><label>AI协议<select aria-label="AI预检协议" disabled={busy||!protocols} value={provider} onChange={e=>{setProvider(e.target.value);changed()}}>{protocols?protocols.map(item=><option key={item.protocol} value={item.protocol}>{item.displayName}（{item.protocol}）</option>):<option value="">请先载入后端协议目录</option>}</select></label><label>超时秒数<input aria-label="AI预检超时" type="number" min={1} max={60} disabled={busy} value={timeout} onChange={e=>{setTimeoutSeconds(Number(e.target.value));changed()}}/></label><label>输出token<input aria-label="AI预检输出token" type="number" min={1} max={32768} disabled={busy} value={output} onChange={e=>{setOutput(Number(e.target.value));changed()}}/></label><label>请求预算<input aria-label="AI预检预算" type="number" min={1} max={1000000} disabled={busy} value={budget} onChange={e=>{setBudget(Number(e.target.value));changed()}}/></label><button className="button" disabled={busy||!valid||!protocols} onClick={()=>void check()}>检查AI离线规则</button><button className="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消AI预检等待</button></div><p role="status">{result}</p></section>
}
