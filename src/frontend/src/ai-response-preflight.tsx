import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
type Scenario={id:string;protocol:string;label:string;description:string;accepted:boolean;code:string;outputPreview:string|null;inputTokens:number;outputTokens:number;liveCallPerformed:boolean;transportImplemented:boolean;productionEnabled:boolean;notes:string}
const protocols=['OpenAiCompatible','Anthropic']
const failure='响应契约场景载入失败或响应不符；不显示诊断正文，不回退为本地结论。'
export function parseScenarios(value:unknown):Scenario[]|null{
 if(!Array.isArray(value)||value.length<1||value.length>32)return null
 const list=value.map(entry=>{
  const v=entry as Scenario
  if(!v||typeof v!=='object'||typeof v.id!=='string'||!v.id||v.id.length>64)return null
  if(typeof v.label!=='string'||!v.label||v.label.length>80||typeof v.description!=='string'||!v.description||v.description.length>200)return null
  if(!protocols.includes(v.protocol))return null
  if(typeof v.accepted!=='boolean'||typeof v.code!=='string'||!v.code||v.code.length>64)return null
  if(v.liveCallPerformed!==false||v.transportImplemented!==false||v.productionEnabled!==false)return null
  if(typeof v.notes!=='string'||!v.notes.trim())return null
  if(!Number.isInteger(v.inputTokens)||v.inputTokens<0||!Number.isInteger(v.outputTokens)||v.outputTokens<0)return null
  if(v.accepted){
   if(v.code!=='accepted'||typeof v.outputPreview!=='string'||!v.outputPreview.trim())return null
  }else if(v.code==='accepted'||v.outputPreview!==null||v.inputTokens!==0||v.outputTokens!==0)return null
  return {id:v.id,protocol:v.protocol,label:v.label,description:v.description,accepted:v.accepted,code:v.code,outputPreview:v.outputPreview,inputTokens:v.inputTokens,outputTokens:v.outputTokens,liveCallPerformed:false,transportImplemented:false,productionEnabled:false,notes:v.notes}
 })
 if(list.some(item=>item===null))return null
 const parsed=list as Scenario[]
 return new Set(parsed.map(item=>item.id)).size===parsed.length?parsed:null
}
export default function AiResponsePreflight(){
 const [list,setList]=useState<Scenario[]|null>(null),[status,setStatus]=useState('尚未载入响应契约场景'),[busy,setBusy]=useState(false)
 const [selected,setSelected]=useState('')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setList(null);setStatus('正在载入响应契约场景…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/ai-response-scenarios',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,262144) as {isDemo:boolean;persistence:string;data:unknown}
   const scenarios=payload.isDemo===true&&payload.persistence==='none'?parseScenarios(payload.data):null
   if(!scenarios)throw new Error()
   if(active.current!==controller)return
   const accepted=scenarios.filter(item=>item.accepted).length
   setList(scenarios);setSelected(scenarios[0].id)
   setStatus(`已载入 ${scenarios.length} 个响应契约场景：接受 ${accepted}、拒绝 ${scenarios.length-accepted}；全部为服务端合成响应，未发起网络请求、未调用模型。`)
   publishEvidence({key:'ai-response-scenarios',label:'AI响应契约场景',detail:`${scenarios.length} 个场景（接受 ${accepted}、拒绝 ${scenarios.length-accepted}）；未发起网络请求`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 const current=list?.find(item=>item.id===selected)
 return <section className="panel domain-panel" aria-label="AI响应契约预检">
  <div className="panel-head"><div><h2>响应契约预检（合成响应）</h2><p>用服务端预置的合成响应对照离线适配器解析规则，查看哪些字段会被拒绝</p></div></div>
  <div className="domain-body">
   <p>场景由后端生成并交由真实解析器判定；本页<strong>不</strong>发起网络请求、不读取凭据、不调用模型。解析通过只表示离线契约自洽，不代表厂商兼容或真实调用成功。</p>
   <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void load()}>载入响应契约场景</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消响应契约等待</button></div>
   <p role="status">{status}</p>
   {list&&<>
    <label>合成响应场景 <select aria-label="合成响应场景" value={selected} onChange={event=>setSelected(event.target.value)}>{list.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <p className="field-note">场景说明：{current?.description}</p>
    <div className="table-wrap"><table aria-label="响应契约场景清单"><thead><tr>{['场景','协议','结论','结论代码','输入/输出标记','说明'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
     {list.map(item=><tr key={item.id}><td><code>{item.id}</code></td><td>{item.protocol}</td><td>{item.accepted?'接受':'拒绝'}</td><td>{item.code}</td><td>{item.accepted?`${item.inputTokens}/${item.outputTokens}`:'—'}</td><td style={{overflowWrap:'anywhere'}}>{item.description}</td></tr>)}
    </tbody></table></div>
    {current&&<p className="field-note">当前场景：{current.accepted?`解析成功，输出预览「${current.outputPreview}」`:`解析被拒（${current.code}）`} · 网络请求：否 · 生产就绪：否。</p>}
   </>}
  </div>
 </section>
}
