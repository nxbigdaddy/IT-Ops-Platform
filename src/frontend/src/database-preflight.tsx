import { useEffect, useRef, useState } from 'react'
import { readBoundedJson } from './bounded-json'
import { parseProviderValues, type ProviderValue } from './database-provider-values'
import { publishEvidence } from './review-evidence'
export default function DatabasePreflight(){
 const [provider,setProvider]=useState<number|null>(null),[values,setValues]=useState<ProviderValue[]|null>(null),[loadStatus,setLoadStatus]=useState('尚未载入候选取值'),[facts,setFacts]=useState<{name:string;packageAvailable:boolean;singleInstanceOnly:boolean;requiredVerification:string[]}|null>(null),[apis,setApis]=useState(1),[workers,setWorkers]=useState(1),[busy,setBusy]=useState(false),[result,setResult]=useState('尚未预检'),[host,setHost]=useState('db-01.invalid')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setValues(null);setProvider(null);setLoadStatus('正在载入候选取值…');setResult('尚未预检')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/database-provider-values',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:unknown}
   const list=payload.isDemo===true&&payload.persistence==='none'?parseProviderValues(payload.data):null
   if(!list)throw new Error()
   if(active.current!==controller)return
   setValues(list);setProvider(list[0].value)
   setLoadStatus(`已载入 ${list.length} 个平台持久化候选取值；取值由服务端下发，未连接数据库。`)
  }catch{if(active.current===controller)setLoadStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':'候选取值载入失败或响应不符；不显示诊断正文，不回退为本地候选清单。')}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 async function check(){
  if(active.current||provider===null)return
  const controller=new AbortController();active.current=controller;setBusy(true);setResult('正在检查离线配置规则')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/database-preflight',{method:'POST',redirect:'error',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({provider,host,secretReference:'secret://database/demo',apiInstances:apis,workerInstances:workers,automaticFallback:false})})
   if(response.status!==200&&response.status!==400){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:{configurationValid:boolean;connectionAttempted:boolean;productionReady:boolean;errors:{field:string;code:string}[];candidate:{name:string;packageAvailable:boolean;singleInstanceOnly:boolean;adapterImplemented:boolean;liveVerified:boolean;productionEnabled:boolean;requiredVerification:string[]}|null}}
   const data=payload.data
   if(payload.isDemo!==true||payload.persistence!=='none'||!data||data.connectionAttempted!==false||data.productionReady!==false||!Array.isArray(data.errors)||data.errors.length>10||data.configurationValid!==(response.status===200)||data.configurationValid!==(data.errors.length===0))throw new Error()
   // Preconditions are only trustworthy if they are internally consistent with the catalog flags.
   const facts=data.candidate
   if(facts!==null&&facts!==undefined&&(typeof facts.name!=='string'||!facts.name||facts.name.length>64||typeof facts.packageAvailable!=='boolean'||typeof facts.singleInstanceOnly!=='boolean'||facts.adapterImplemented!==false||facts.liveVerified!==false||facts.productionEnabled!==false||!Array.isArray(facts.requiredVerification)||facts.requiredVerification.length<1||facts.requiredVerification.length>16||!facts.requiredVerification.every((value:string)=>typeof value==='string'&&value.length>0&&value.length<=64)||new Set(facts.requiredVerification).size!==facts.requiredVerification.length))throw new Error()
   if(active.current===controller)setFacts(facts??null)
   const codes:Record<string,string>={required:'缺少配置',unsupported:'不支持的候选',reference_required:'需要凭据引用',out_of_range:'实例数超出范围',forbidden:'禁止自动回退',sqlite_single_instance_only:'SQLite仅允许1个API和最多1个Worker',not_documentation_target:'主机必须是文档保留地址或 .invalid/.example 主机名'}
   const fields:Record<string,string>={configuration:'配置',provider:'数据库候选',host:'主机',secretReference:'凭据引用',apiInstances:'API实例数',workerInstances:'Worker实例数',automaticFallback:'自动回退',topology:'部署拓扑'}
   const messages=data.errors.map(error=>{if(!error||!Object.hasOwn(fields,error.field)||!Object.hasOwn(codes,error.code))throw new Error();return `${fields[error.field]}：${codes[error.code]}`})
   if(active.current===controller)publishEvidence({key:'database-preflight',label:'数据库部署预检',detail:`候选值 ${provider} · API ${apis} · Worker ${workers} → ${data.configurationValid?'规则通过':`不通过：${messages.join('；')}`}；未连接数据库`})
   if(active.current===controller)setResult(data.configurationValid?'配置规则通过；未连接数据库，未保存，非生产就绪':`配置规则未通过：${messages.join('；')}。未连接数据库，未保存。`)
  }catch{if(active.current===controller)setResult(controller.signal.aborted?'数据库预检等待已取消或超时；不代表服务器回滚，请按需重新检查。':'预检不可用或响应不符；未显示诊断正文，不回退为成功。')}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 function clear(){setResult('配置已更改，请重新预检');setFacts(null)}
 return <section aria-label="数据库部署预检" style={{padding:16,border:'1px solid #dce3ec',borderRadius:10}}><h2>数据库部署预检</h2><p>只检查离线规则，不保存配置、不解析凭据、不连接数据库。主机只接受文档保留地址或以 .invalid/.example 结尾的合成主机名；固定虚构引用 secret://database/demo；自动回退关闭。</p><div className="inline-actions"><button className="button" disabled={busy} onClick={()=>void load()}>载入候选取值</button></div><p role="status">{loadStatus}</p><div className="filters"><label>数据库候选<select aria-label="数据库候选" disabled={busy||!values} value={provider===null?'':String(provider)} onChange={e=>{setProvider(Number(e.target.value));clear()}}>{values?values.map(item=><option key={item.value} value={item.value}>{item.displayName}（值 {item.value}）</option>):<option value="">请先载入候选取值</option>}</select></label><label>数据库主机（合成）<input aria-label="数据库主机" disabled={busy} maxLength={253} value={host} onChange={e=>{setHost(e.target.value);clear()}} placeholder="db-01.invalid"/></label><label>API实例数<input type="number" min={1} max={32} disabled={busy} value={apis} onChange={e=>{setApis(Number(e.target.value));clear()}}/></label><label>Worker实例数<input type="number" min={0} max={128} disabled={busy} value={workers} onChange={e=>{setWorkers(Number(e.target.value));clear()}}/></label><button className="button" disabled={busy||provider===null||!Number.isInteger(apis)||apis<1||apis>32||!Number.isInteger(workers)||workers<0||workers>128} onClick={()=>void check()}>检查数据库部署规则</button><button className="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消数据库预检等待</button></div><p role="status">{result}</p>{facts&&<div className="panel-note"><p><strong>{facts.name}</strong> 的前置条件（尚未完成，仅为待验证清单）：</p><ul>{facts.requiredVerification.map(item=><li key={item}>{item}</li>)}</ul><p>依赖包：{facts.packageAvailable?'已声明，无业务适配':'尚未安装'}；单实例限制：{facts.singleInstanceOnly?'是':'否'}。通过规则不等于已连接、已迁移或生产就绪。</p></div>}</section>
}
