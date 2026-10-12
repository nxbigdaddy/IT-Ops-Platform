import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {publishEvidence} from './review-evidence'
const codes:Record<string,string>={required:'不能为空',too_long:'超过253字符',normalization_required:'必须为小写且无首尾空格',not_documentation_target:'仅允许文档保留地址或 .invalid/.example 主机名',duplicate:'重复项',count_out_of_range:'数量需为1–50',out_of_range:'超出允许区间',timeout_not_below_interval:'超时必须小于采集间隔'}
const windowFields:Record<string,string>={intervalSeconds:'采集间隔（60–86400秒）',concurrency:'并发（1–8）',timeoutSeconds:'单次超时（5–300秒）'}
const sample=['app-01.invalid','db-02.example','192.0.2.10','198.51.100.7','203.0.113.9','2001:db8::1']
const failure='目标清单校验失败或响应不符；不显示诊断正文，不回退本地判断。'
export default function TargetScope(){
 const [input,setInput]=useState(sample.join('\n')),[status,setStatus]=useState('尚未校验'),[busy,setBusy]=useState(false)
 const [results,setResults]=useState<{index:number;field:string;code:string}[]|null>(null),[accepted,setAccepted]=useState(0)
 const [interval,setIntervalSeconds]=useState(300),[concurrency,setConcurrency]=useState(2),[timeout,setTimeoutSeconds]=useState(30)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 const lines=input.split('\n').filter((line,index,all)=>!(index===all.length-1&&line.trim()===''))
 const oversize=lines.length>50||lines.some(line=>line.length>253)
 const hostProblems=(results??[]).filter(item=>item.field==='host'||item.field==='hosts')
 const windowProblems=(results??[]).filter(item=>item.field!=='host'&&item.field!=='hosts')
 async function check(){
  if(active.current||oversize)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setResults(null);setStatus('正在校验目标清单…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/connector-target-scope',{method:'POST',signal:controller.signal,redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({hosts:lines,intervalSeconds:interval,concurrency:concurrency,timeoutSeconds:timeout})})
   if(response.status!==200&&response.status!==400){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:{configurationValid:boolean;errors:{index:number;field:string;code:string}[];accepted:number;connectionAttempted:boolean;executionAllowed:boolean;syntheticOnly:boolean}}
   const data=payload.data
   if(payload.isDemo!==true||payload.persistence!=='none'||!data||!Array.isArray(data.errors)||data.errors.length>50||data.connectionAttempted!==false||data.executionAllowed!==false||data.syntheticOnly!==true||!Number.isInteger(data.accepted)||data.accepted<0||data.accepted>lines.length||data.configurationValid!==(response.status===200)||data.configurationValid!==(data.errors.length===0)||data.errors.some(error=>!error||!Number.isInteger(error.index)||error.index<0||error.index>=lines.length||!Object.hasOwn(windowFields,error.field)&&error.field!=='host'&&error.field!=='hosts'||!Object.hasOwn(codes,error.code)))throw new Error()
   if(data.configurationValid&&data.accepted!==lines.length)throw new Error()
   if(active.current!==controller)return
   setResults(data.errors.map(error=>({index:error.index,field:error.field,code:error.code})));setAccepted(data.accepted)
   setStatus(data.configurationValid
    ? `清单通过：${data.accepted}/${lines.length} 个目标均为文档保留地址或合成主机名；未解析DNS、未连接。`
    : `清单未通过：${data.accepted}/${lines.length} 个可用，${data.errors.length} 处问题。未连接任何目标。`)
   publishEvidence({key:'connector-targets',label:'采集目标清单',detail:`${data.accepted}/${lines.length} 个合成目标可用${data.errors.length?`；${data.errors.length} 处问题`:'；未连接'}`})
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label="采集目标清单校验">
  <div className="panel-head"><div><h2>采集目标清单校验</h2><p>只接受文档保留网段与合成主机名，从规则上避免真实设备地址进入原型</p></div></div>
  <p>允许：<code>192.0.2.0/24</code>、<code>198.51.100.0/24</code>、<code>203.0.113.0/24</code>、<code>2001:db8::/32</code>，以及小写、以 <code>.invalid</code> 或 <code>.example</code> 结尾的主机名。每行一个，最多50个；不解析DNS、不连接、不保存。</p>
  <label>合成目标清单（每行一个）<textarea aria-label="合成目标清单" rows={6} maxLength={8192} value={input} onChange={event=>{setInput(event.target.value);setResults(null);setStatus('尚未校验')}}/></label>
  <div className="filters">
   <label>采集间隔（秒）<input aria-label="采集间隔" type="number" min={60} max={86400} disabled={busy} value={interval} onChange={event=>{setIntervalSeconds(Number(event.target.value));setResults(null);setStatus('尚未校验')}}/></label>
   <label>并发<input aria-label="采集并发" type="number" min={1} max={8} disabled={busy} value={concurrency} onChange={event=>{setConcurrency(Number(event.target.value));setResults(null);setStatus('尚未校验')}}/></label>
   <label>单次超时（秒）<input aria-label="单次超时" type="number" min={5} max={300} disabled={busy} value={timeout} onChange={event=>{setTimeoutSeconds(Number(event.target.value));setResults(null);setStatus('尚未校验')}}/></label>
  </div>
  <p className="field-note">窗口参数由服务端校验区间（间隔60–86400秒、并发1–8、超时5–300秒且必须小于间隔）；通过只表示参数在允许区间，不代表已排期、已限速或已接入。</p>
  <div className="inline-actions">
   <button className="button" type="button" disabled={busy} onClick={()=>{setInput(sample.join('\n'));setResults(null);setStatus('尚未校验')}}>填入示例清单</button>
   <button className="button" type="button" disabled={busy||oversize||lines.length===0} onClick={()=>void check()}>校验目标清单</button>
   <button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消目标校验等待</button>
  </div>
  {oversize&&<p role="status">当前输入超过上限（最多50行、每行253字符）；请精简后再校验。</p>}
  <p role="status">{status}</p>
  {results&&hostProblems.length>0&&<div className="table-wrap"><table aria-label="目标清单问题"><thead><tr>{['行号','目标','问题'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
   {hostProblems.map(item=><tr key={`${item.index}-${item.code}`}><td>{item.index+1}</td><td style={{overflowWrap:'anywhere'}}>{lines[item.index]||'（空行）'}</td><td>{codes[item.code]}</td></tr>)}
  </tbody></table></div>}
  {results&&windowProblems.length>0&&<ul aria-label="采集窗口问题">{windowProblems.map(item=><li key={`${item.field}-${item.code}`}>{windowFields[item.field]}：{codes[item.code]}</li>)}</ul>}
  {results&&results.length===0&&<p>所有 {accepted} 个目标均通过规则，采集窗口参数也在允许区间内；仍未连接任何目标。</p>}
 </section>
}
