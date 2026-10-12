import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
const codeLabels:Record<string,string>={required:'不能为空',too_long:'超过4000字符',multiple_statements:'不允许多条语句',comments_not_allowed:'不允许注释',not_read_only:'仅允许 SELECT / SHOW / WITH…SELECT'}
const keywordLabel=(code:string)=>`命中写入关键字：${code.replace('write_keyword_','').toUpperCase()}`
const functionLabel=(code:string)=>`命中已知写入函数：${code.replace('write_function_','')}`
const failure='监控查询预检失败或响应不符；不显示诊断正文，不回退为本地判断。'
const samples=['select datname, state from pg_stat_activity','show status','select 1; select 2','select * into backup_table from t']
export default function MonitoredQueryPanel(){
 const [statement,setStatement]=useState(samples[0]),[result,setResult]=useState<{valid:boolean;kind:string;length:number;codes:string[];notes:string}|null>(null)
 const [status,setStatus]=useState('尚未检查'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function check(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setResult(null);setStatus('正在检查查询规则…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/monitored-query-preflight',{method:'POST',signal:controller.signal,redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({statement})})
   if(response.status!==200&&response.status!==400){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:{configurationValid:boolean;errors:{field:string;code:string}[];statementKind:string;length:number;executionAttempted:boolean;connectionAttempted:boolean;readOnlyOnly:boolean;notes:string}}
   const data=payload.data
   if(payload.isDemo!==true||payload.persistence!=='none'||!data||!Array.isArray(data.errors)||data.errors.length>16||data.executionAttempted!==false||data.connectionAttempted!==false||data.readOnlyOnly!==true||typeof data.notes!=='string'||!data.notes.trim())throw new Error()
   if(!['select','show','with','unsupported','none'].includes(data.statementKind))throw new Error()
   if(!Number.isInteger(data.length)||data.length<0||data.length>4000)throw new Error()
   if(data.configurationValid!==(response.status===200)||data.configurationValid!==(data.errors.length===0))throw new Error()
   if(data.errors.some(error=>!error||error.field!=='statement'||typeof error.code!=='string'||!error.code))throw new Error()
   if(active.current!==controller)return
   const codes=data.errors.map(error=>error.code)
   setResult({valid:data.configurationValid,kind:data.statementKind,length:data.length,codes,notes:data.notes})
   setStatus(data.configurationValid
    ? `查询规则通过：识别为 ${data.statementKind.toUpperCase()}，未命中写入特征（${data.length} 字符）。仍不会执行、不会连接数据库。`
    : `查询被拒绝：${codes.map(code=>code.startsWith('write_function_')?functionLabel(code):code.startsWith('write_keyword_')?keywordLabel(code):(codeLabels[code]??code)).join('；')}。`)
   publishEvidence({key:'monitored-query',label:'监控查询白名单',detail:`${data.statementKind} · ${data.configurationValid?'通过':'拒绝'}`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label="监控查询白名单预检">
  <div className="panel-head"><div><h2>监控查询白名单预检</h2><p>把计划用于只读采集的语句交给规则筛查，确认不会命中写入特征</p></div></div>
  <p>只做关键字与函数名单筛查，<strong>不做语法解析</strong>：通过只表示未命中已知写入特征，不能证明语句无副作用。不连接数据库、不执行语句、不保存内容。</p>
  <label>计划只读语句<textarea aria-label="计划只读语句" rows={3} maxLength={4000} value={statement} onChange={event=>{setStatement(event.target.value);setResult(null);setStatus('尚未检查')}}/></label>
  <div className="inline-actions">
   <button className="button" type="button" disabled={busy||!statement.trim()} onClick={()=>void check()}>检查查询规则</button>
   <button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消查询预检等待</button>
   <button className="button" type="button" disabled={busy} onClick={()=>{setStatement(samples[0]);setResult(null);setStatus('尚未检查')}}>填入允许示例</button>
   <button className="button" type="button" disabled={busy} onClick={()=>{setStatement(samples[3]);setResult(null);setStatus('尚未检查')}}>填入应拒绝示例</button>
  </div>
  <p role="status">{status}</p>
  {result&&<div className="panel-note"><p>识别类型：{result.kind.toUpperCase()} · 长度：{result.length} · 执行：否 · 连接：否。</p>{result.codes.length>0&&<ul>{result.codes.map(code=><li key={code}>{code}</li>)}</ul>}<p>{result.notes}</p></div>}
 </section>
}
