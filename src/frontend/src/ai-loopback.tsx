import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
type Protocol={protocol:string;displayName:string}
type Scenario={id:string;label:string;description:string;openAiCode:string;anthropicCode:string}
type Outcome={status:string;code:string|null;httpStatus:number;responseBytes:number;elapsedMilliseconds:number;text:string|null;usage:{inputTokens:number;outputTokens:number;totalTokens:number}|null;stopReason:string|null;loopbackOnly:boolean;credentialRead:boolean;productionTransportImplemented:boolean;syntheticStubOnly:boolean;notes:string;sentRequestJson:string}
const statusLabels:Record<string,string>={parsed:'已解析（本机桩）',refused:'已拒绝（未连接）',timeout:'超时',unreachable:'不可达',rejected:'被拒绝/解析失败'}
const codeLabels:Record<string,string>={endpoint_not_loopback:'端点不是本机回环',unsupported_protocol:'协议不在保留范围',loopback_timeout:'超过5秒未响应',loopback_unreachable:'本机端口不可达',response_too_large:'响应超过256KiB',http_status_not_ok:'桩返回非200',invalid_json:'响应不是合法JSON',exactly_one_choice_required:'choices数量不为1',invalid_output_length:'输出为空或超长',unsupported_stop_reason:'结束原因不支持'}
const failure='回环往返失败或响应不符；不显示诊断正文，不回退本地判断。'
export default function AiLoopbackPanel(){
 const [protocols,setProtocols]=useState<Protocol[]|null>(null),[protocol,setProtocol]=useState('')
 const [scenarios,setScenarios]=useState<Scenario[]|null>(null),[behaviour,setBehaviour]=useState('')
 const selected=scenarios?.find(item=>item.id===behaviour)
 const [maxTokens,setMaxTokens]=useState(256),[temperature,setTemperature]=useState(0.2)
 const [outcome,setOutcome]=useState<Outcome|null>(null)
 const [status,setStatus]=useState('尚未载入协议与桩行为'),[busy,setBusy]=useState<'load'|'run'|null>(null)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 function start(kind:'load'|'run',job:(signal:AbortSignal)=>Promise<void>){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(kind)
  const timer=setTimeout(()=>controller.abort(),15000)
  void job(controller.signal).catch(()=>{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)})
   .finally(()=>{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(null)}})
 }
 async function loadProtocols(signal:AbortSignal){
  setProtocols(null);setScenarios(null);setOutcome(null);setStatus('正在载入协议与桩行为…')
  const [protocolResponse,scenarioResponse]=await Promise.all([
   fetch('/api/v1/ai-protocols',{signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}}),
   fetch('/api/v1/ai-loopback-stub-scenarios',{signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}}),
  ])
  if(protocolResponse.status!==200||scenarioResponse.status!==200){await protocolResponse.body?.cancel();await scenarioResponse.body?.cancel();throw new Error()}
  const payload=await readBoundedJson(protocolResponse,65536) as {isDemo:boolean;persistence:string;data:Protocol[]}
  const scenarioPayload=await readBoundedJson(scenarioResponse,65536) as {isDemo:boolean;persistence:string;data:Scenario[]}
  if(payload.isDemo!==true||!Array.isArray(payload.data)||payload.data.length<2||payload.data.some(item=>!item||typeof item.protocol!=='string'||!item.protocol||typeof item.displayName!=='string'))throw new Error()
  // The behaviour catalog is server-owned: the page never invents a behaviour or an expected code.
  if(scenarioPayload.isDemo!==true||!Array.isArray(scenarioPayload.data)||scenarioPayload.data.length<2
   ||scenarioPayload.data.some(item=>!item||typeof item.id!=='string'||!item.id.trim()||typeof item.label!=='string'||!item.label.trim()
    ||typeof item.description!=='string'||!item.description.trim()||typeof item.openAiCode!=='string'||!item.openAiCode.trim()
    ||typeof item.anthropicCode!=='string'||!item.anthropicCode.trim())
   ||new Set(scenarioPayload.data.map(item=>item.id)).size!==scenarioPayload.data.length)throw new Error()
  if(active.current?.signal!==signal)return
  setProtocols(payload.data);setProtocol(payload.data[0].protocol)
  setScenarios(scenarioPayload.data);setBehaviour(scenarioPayload.data[0].id)
  setStatus(`已载入 ${payload.data.length} 个协议与 ${scenarioPayload.data.length} 个桩行为；往返仍只指向本机回环桩。`)
 }
 async function run(signal:AbortSignal){
  setOutcome(null);setStatus('正在本机回环往返…（服务端会请求自身的合成桩端点）')
  const response=await fetch('/api/v1/ai-loopback-exchange',{method:'POST',signal,redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({protocol,model:'demo-model',system:'演示系统提示：仅用于适配验证',user:'演示用户文本：仅用于适配验证',maxTokens,temperature,stubBehaviour:behaviour})})
  if(response.status!==200&&response.status!==502){await response.body?.cancel();throw new Error()}
  const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:Outcome}
  const data=payload.data
  if(payload.isDemo!==true||payload.persistence!=='none'||!data)throw new Error()
  if(!Object.hasOwn(statusLabels,data.status)||data.loopbackOnly!==true||data.credentialRead!==false||data.productionTransportImplemented!==false||data.syntheticStubOnly!==true||typeof data.notes!=='string'||!data.notes.trim())throw new Error()
  if(!Number.isInteger(data.httpStatus)||data.httpStatus<0||data.httpStatus>599||!Number.isInteger(data.responseBytes)||data.responseBytes<0||data.responseBytes>262144||!Number.isInteger(data.elapsedMilliseconds)||data.elapsedMilliseconds<0)throw new Error()
  if(data.code!==null&&!Object.hasOwn(codeLabels,data.code))throw new Error()
  // The echoed request must be our own synthetic payload and must contain nothing credential-shaped.
  if(typeof data.sentRequestJson!=='string')throw new Error()
  const sent=data.sentRequestJson.trim()
  if(sent.length>262144||(!sent.startsWith('{')&&sent!=='')
    ||/(authorization|api[_-]?key|apikey|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\s*["']?\s*[:=]/i.test(sent)
    ||/Bearer\s+[A-Za-z0-9._-]{8,}/.test(sent)||/sk-[A-Za-z0-9]{8,}/.test(sent)||/AKIA[0-9A-Z]{12,}/.test(sent))throw new Error()
  if(data.status==='parsed'&&!sent.startsWith('{'))throw new Error()
  if(sent){try{const parsedSent=JSON.parse(sent);if(typeof parsedSent!=='object'||parsedSent===null||Array.isArray(parsedSent)||typeof parsedSent.model!=='string')throw new Error()}catch{throw new Error()}}
  const parsed=data.status==='parsed'
  if(parsed!==(response.status===200))throw new Error()
  if(parsed){
   if(!data.text||!data.text.includes('[合成桩响应]')||!data.text.includes('未调用任何模型')||!data.usage||!data.stopReason)throw new Error()
   const {inputTokens,outputTokens,totalTokens}=data.usage
   if(!Number.isInteger(inputTokens)||!Number.isInteger(outputTokens)||totalTokens!==inputTokens+outputTokens)throw new Error()
  }else if(data.text!==null||data.usage!==null||data.stopReason!==null)throw new Error()
  if(active.current?.signal!==signal)return
  setOutcome(data)
  setStatus(parsed
   ? `本机回环往返完成：HTTP ${data.httpStatus}，${data.responseBytes} 字节，${data.elapsedMilliseconds} 毫秒；结果来自合成桩，不是模型推理。`
   : `回环往返未取得解析结果：${statusLabels[data.status]}${data.code?`（${codeLabels[data.code]}）`:''}；未连接任何真实提供方。`)
  publishEvidence({key:'ai-loopback',label:'本机回环往返',detail:`${data.status} · HTTP ${data.httpStatus} · ${data.elapsedMilliseconds}ms`})
 }
 return <section className="panel" aria-label="本机回环往返验证">
  <div className="panel-head"><div><h2>本机回环往返验证（合成桩）</h2><p>用真实 HTTP 请求验证请求构造与响应解析，目标永远是本机自身</p></div></div>
  <p>该端点默认请求<strong>本机自身</strong>的合成桩（取自当前连接端口），不读取凭据、不连接任何真实提供方；结论恒为“仅回环、未读凭据、未实现生产传输、仅合成桩”。它不是模型推理，也不代表外部 AI 接入能力。</p>
  <div className="inline-actions">
   <button className="button" type="button" disabled={busy!==null} onClick={()=>start('load',loadProtocols)}>载入协议与桩行为</button>
   <button className="button" type="button" disabled={busy!==null||!protocol} onClick={()=>start('run',run)}>发起本机回环往返</button>
   <button className="button" type="button" disabled={busy===null} onClick={()=>active.current?.abort()}>取消回环往返等待</button>
  </div>
  {protocols&&<div className="filters">
   <label>协议<select aria-label="回环协议" disabled={busy!==null} value={protocol} onChange={event=>{setProtocol(event.target.value);setOutcome(null);setStatus('尚未发起往返')}}>{protocols.map(item=><option key={item.protocol} value={item.protocol}>{item.displayName}</option>)}</select></label>
   <label>最大输出令牌<input aria-label="回环最大输出" type="number" min={1} max={4096} disabled={busy!==null} value={maxTokens} onChange={event=>setMaxTokens(Number(event.target.value))}/></label>
   <label>温度<input aria-label="回环温度" type="number" step={0.1} min={0} max={2} disabled={busy!==null} value={temperature} onChange={event=>setTemperature(Number(event.target.value))}/></label>
   <label>桩行为<select aria-label="桩行为" disabled={busy!==null} value={behaviour} onChange={event=>{setBehaviour(event.target.value);setOutcome(null);setStatus('尚未发起往返')}}>{scenarios?.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
  </div>}
  {selected&&<p className="field-note">桩行为说明：{selected.description}；预期结论代码 OpenAI 兼容：<code>{selected.openAiCode}</code>，Anthropic Messages：<code>{selected.anthropicCode}</code>。</p>}
  <p role="status">{status}</p>
  {outcome&&<dl className="domain-facts">
   <div><dt>结论</dt><dd>{statusLabels[outcome.status]}{outcome.code?` · ${codeLabels[outcome.code]}`:''}</dd></div>
   <div><dt>HTTP / 字节 / 耗时</dt><dd>{outcome.httpStatus} · {outcome.responseBytes} 字节 · {outcome.elapsedMilliseconds} 毫秒</dd></div>
   <div><dt>结束原因</dt><dd>{outcome.stopReason??'—'}</dd></div>
   <div><dt>用量</dt><dd>{outcome.usage?`输入 ${outcome.usage.inputTokens} · 输出 ${outcome.usage.outputTokens} · 合计 ${outcome.usage.totalTokens}`:'—'}</dd></div>
   <div><dt>返回文本</dt><dd style={{overflowWrap:'anywhere'}}>{outcome.text??'（未解析出文本）'}</dd></div>
   <div><dt>安全标记</dt><dd>仅回环：是 · 读取凭据：否 · 生产传输：未实现 · 仅合成桩：是</dd></div>
   <div><dt>说明</dt><dd>{outcome.notes}</dd></div>
   <div><dt>本次实际发送（合成，无凭据）</dt><dd><pre style={{...{overflowWrap:'anywhere'},whiteSpace:'pre-wrap',margin:0}}>{outcome.sentRequestJson||'（未发送任何请求体）'}</pre></dd></div>
  </dl>}
 </section>
}
