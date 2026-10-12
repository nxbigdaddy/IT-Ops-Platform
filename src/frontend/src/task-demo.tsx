import { useEffect, useRef, useState } from 'react'
import { readBoundedJson } from './bounded-json'
import { publishEvidence } from './review-evidence'
const names = ['待审批','已批准','排队中','运行中（模拟）','成功','失败','已取消','结果未知']
const actions: Record<number,string[]> = {0:['Approve','Cancel'],1:['Enqueue','Cancel'],2:['Start','Cancel'],3:['Succeed','Fail','Timeout'],7:['ReconcileSucceeded','ReconcileFailed']}
const labels: Record<string,string> = {Approve:'模拟批准',Cancel:'模拟取消',Enqueue:'模拟排队',Start:'模拟开始',Succeed:'模拟成功',Fail:'模拟失败',Timeout:'模拟超时',ReconcileSucceeded:'模拟核实成功',ReconcileFailed:'模拟核实失败'}
const targets: Record<string,number> = {Approve:1,Enqueue:2,Start:3,Succeed:4,Fail:5,Cancel:6,Timeout:7,ReconcileSucceeded:4,ReconcileFailed:5}
function clientTransitions(): Set<string> {
 const set = new Set<string>()
 for (const [state, events] of Object.entries(actions)) for (const event of events) set.add(`${state}|${event}|${targets[event]}`)
 return set
}
type Vocabulary = { states: { value: number; name: string }[]; events: string[]; transitions: { from: number; event: string; to: number }[] }
function parseVocabulary(value: unknown): Vocabulary | null {
 const v = value as Vocabulary
 if (!v || typeof v !== 'object' || !Array.isArray(v.states) || !Array.isArray(v.events) || !Array.isArray(v.transitions)) return null
 if (v.states.length < 1 || v.states.length > 16 || !v.states.every((item, index) => item && typeof item === 'object' && item.value === index && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 40)) return null
 if (!v.events.every(item => typeof item === 'string' && item.length > 0 && item.length <= 40) || new Set(v.events).size !== v.events.length) return null
 if (!v.transitions.every(item => item && typeof item === 'object' && Number.isInteger(item.from) && Number.isInteger(item.to) && item.from >= 0 && item.from < v.states.length && item.to >= 0 && item.to < v.states.length && typeof item.event === 'string' && v.events.includes(item.event))) return null
 if (new Set(v.transitions.map(item => `${item.from}|${item.event}`)).size !== v.transitions.length) return null
 return v
}
class SafeTaskError extends Error {}
type Task = {id:string;snapshot:{state:number;version:number}}
function taskValue(value: unknown): Task {
 const v=value as Task & {isDemo?:boolean;executed?:boolean;persistence?:string;mode?:string}
 if(!v || typeof v.id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id) || v.isDemo!==true || v.executed!==false || v.persistence!=='memory' || v.mode!=='state-simulation-only' || !v.snapshot || !Number.isInteger(v.snapshot.state) || !names[v.snapshot.state] || !Number.isInteger(v.snapshot.version) || v.snapshot.version<1) throw new SafeTaskError('任务模拟契约不符')
 return {id:v.id,snapshot:{...v.snapshot}}
}
export default function TaskDemo(){
 const [task,setTask]=useState<Task|null>(null),[busy,setBusy]=useState(false),[stale,setStale]=useState(false),[status,setStatus]=useState('尚未创建')
 const [history,setHistory]=useState<{label:string;version:number;event:string;from:number;to:number}[]|null>(null)
 const active=useRef<AbortController|null>(null)
 const [attempt,setAttempt]=useState<{event:string;expectedVersion:number}|null>(null)
 const [verified,setVerified]=useState(false),[vocabularyStatus,setVocabularyStatus]=useState('尚未核对状态词汇表；状态标签与事件目标表必须与后端一致才允许操作')
 const [vocabulary,setVocabulary]=useState<{states:number;events:number;transitions:number}|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function loadVocabulary(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true);setVerified(false)
  setVocabularyStatus('正在核对状态词汇表…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/demo-task-vocabulary',{signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:unknown}
   const vocabulary=payload.isDemo===true&&payload.persistence==='none'?parseVocabulary(payload.data):null
   if(!vocabulary)throw new Error()
   const serverTransitions=new Set(vocabulary.transitions.map(item=>`${item.from}|${item.event}|${item.to}`))
   const localTransitions=clientTransitions()
   const sameStates=vocabulary.states.length===names.length
   const sameEvents=vocabulary.events.length===Object.keys(labels).length&&vocabulary.events.every(event=>Object.hasOwn(labels,event))
   const sameTransitions=serverTransitions.size===localTransitions.size&&[...serverTransitions].every(item=>localTransitions.has(item))
   if(active.current!==controller)return
   if(!sameStates||!sameEvents||!sameTransitions)
   {
    setVocabulary(null)
    setVocabularyStatus('后端状态词汇表与本界面的状态标签或事件目标表不一致；已禁用迁移、历史与导出，避免误标状态。')
    return
   }
   setVerified(true)
   setVocabulary({states:vocabulary.states.length,events:vocabulary.events.length,transitions:vocabulary.transitions.length})
   setVocabularyStatus(`已核对：${vocabulary.states.length} 个状态、${vocabulary.events.length} 个事件、${vocabulary.transitions.length} 条允许迁移均与后端规则一致。`)
   publishEvidence({key:'task-vocabulary',label:'任务状态词汇表',detail:`${vocabulary.states.length} 状态 / ${vocabulary.events.length} 事件 / ${vocabulary.transitions.length} 条迁移与后端一致`})
  }catch{if(active.current===controller)setVocabularyStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':'状态词汇表载入失败或响应不符；不显示诊断正文，未核对的映射不用于操作。')}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 function exportEvidence(){
  if(!task||history===null||busy||stale||!verified||!vocabulary)return
  // Structured transitions plus the verified vocabulary, so the labels in this file can be audited.
  const evidence={schemaVersion:1,isDemo:true,executed:false,persistence:'memory',productionAudit:false,
   stateLabelsVerified:true,vocabulary,taskId:task.id,state:names[task.snapshot.state],stateValue:task.snapshot.state,version:task.snapshot.version,transitions:history}
  const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`demo-task-${task.id}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 async function run(event?:string,expectedOverride?:number){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const mutation=!!event && event!=='history'
   const path=event==='create'?'/api/v1/demo-tasks':`/api/v1/demo-tasks/${task!.id}${event==='history'?'/snapshot':event?'/transitions':''}`
   const expected=expectedOverride??task?.snapshot.version??1
   // Deterministic key: the same intended transition is idempotent, a different one is not.
   const keyed=mutation&&event!=='create'
   if(keyed)setAttempt({event:event!,expectedVersion:expected})
   const response=await fetch(path,{method:mutation?'POST':'GET',signal:controller.signal,redirect:'error',credentials:'omit',headers:{Accept:'application/json',...(mutation&&event!=='create'?{'Content-Type':'application/json'}:{})},...(mutation&&event!=='create'?{body:JSON.stringify({event,expectedVersion:expected,idempotencyKey:`${task!.id}:${event}:${expected}`})}:{})})
   if(!response.ok){await response.body?.cancel();throw new SafeTaskError(`HTTP ${response.status}`)}
   if(response.status!==(event==='create'?201:200)){await response.body?.cancel();throw new SafeTaskError('任务HTTP状态不符')}
   const payload=await readBoundedJson(response) as {isDemo:boolean;persistence:string;data:unknown}
   if(payload.isDemo!==true||payload.persistence!=='memory')throw new SafeTaskError('Demo信封不符')
   if(event==='history'){
    const snapshot=payload.data as {task:unknown;history:unknown}
     const current=taskValue(snapshot?.task)
     if(current.id!==task!.id)throw new SafeTaskError('任务ID不匹配，拒绝切换')
     if(current.snapshot.version<task!.snapshot.version||(current.snapshot.version===task!.snapshot.version&&current.snapshot.state!==task!.snapshot.state))throw new SafeTaskError('任务版本不一致，拒绝覆盖')
     const entries=snapshot.history as {sequence:number;taskId:string;event:number;from:number;to:number;version:number}[]
    const eventNames=['Approve','Enqueue','Start','Succeed','Fail','Cancel','Timeout','ReconcileSucceeded','ReconcileFailed']
    if(!Array.isArray(entries)||entries.length>5||entries.length!==current.snapshot.version-1)throw new SafeTaskError('历史版本不一致，请刷新任务')
    const lines=entries.map((entry,index)=>{
     if(!entry||entry.taskId!==task!.id||!Number.isSafeInteger(entry.sequence)||entry.sequence<1||(index>0&&entry.sequence<=entries[index-1].sequence)||entry.version!==index+2||!Number.isInteger(entry.event)||!eventNames[entry.event]||!Number.isInteger(entry.from)||!names[entry.from]||!Number.isInteger(entry.to)||!names[entry.to]||entry.from!==(index?entries[index-1].to:0)||(index===entries.length-1&&entry.to!==current.snapshot.state))throw new SafeTaskError('历史模拟契约不符')
     if(!(actions[entry.from]||[]).includes(eventNames[entry.event])||targets[eventNames[entry.event]]!==entry.to)throw new SafeTaskError('历史事件与状态不符')
     return {label:`版本 ${entry.version} · ${labels[eventNames[entry.event]]} · ${names[entry.from]} → ${names[entry.to]}`,version:entry.version,event:eventNames[entry.event],from:entry.from,to:entry.to}
    })
    if(active.current===controller){setTask(current);setStale(false);setHistory(lines);setStatus('已读取内存迁移记录；不是生产审计日志')}
    return
   }
   const replayed=event&&event!=='create'&&event!=='history'?(payload.data as {replayedVersion?:unknown}).replayedVersion:null
   if(replayed!==null&&replayed!==undefined&&(!Number.isInteger(replayed)||(replayed as number)<1))throw new SafeTaskError('幂等重放版本不符，拒绝采用')
   const next=taskValue(event?(payload.data as {task:unknown}).task:payload.data)
   if(event!=='create' && next.id!==task!.id)throw new SafeTaskError('任务ID不匹配，拒绝切换')
   if(event==='create' && (next.snapshot.version!==1 || next.snapshot.state!==0))throw new SafeTaskError('创建任务初始状态不符')
   if(replayed!==null&&replayed!==undefined)
   {
    if((replayed as number)>next.snapshot.version)throw new SafeTaskError('幂等重放版本超出当前版本，拒绝采用')
    if(active.current!==controller)return
    setTask(next);setHistory(null);setStale(false)
    setStatus(`服务器已确认该操作此前提交过（结果版本 v${replayed}），本次未重复推进版本；未执行任何命令。`)
    return
   }
   if(task && event!=='create' && (next.snapshot.version<task.snapshot.version || (event && next.snapshot.version!==task.snapshot.version+1) || (next.snapshot.version===task.snapshot.version && next.snapshot.state!==task.snapshot.state)))throw new SafeTaskError('任务版本不一致，拒绝覆盖')
   if(active.current!==controller)return
   setTask(next);setHistory(null);setStale(false);setStatus(`HTTP ${response.status} · 仅模拟状态，未执行`)
  }catch(error){if(active.current===controller){setHistory(null);setStale(true);setStatus(`${controller.signal.aborted?'等待已取消/超时':error instanceof SafeTaskError?error.message:'网络或响应无效；未显示诊断正文'}；不回退，不代表回滚。已有任务请刷新；创建失败勿盲目重复提交。`)}}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section aria-label="任务状态模拟" style={{padding:16,border:'1px solid #dce3ec',borderRadius:10}}><h2>任务状态模拟</h2><p>仅本机内存；批准/运行/核实均为演示事件，不执行命令，不代表真实审批。刷新页面会丢失当前任务引用。</p><div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void loadVocabulary()}>核对任务状态词汇表</button></div><p role="status">{vocabularyStatus}</p><p role="status">{status}</p>{task&&<p style={{overflowWrap:'anywhere'}}>模拟任务编号：<code aria-label="模拟任务编号">{task.id}</code></p>}{task&&<p>状态：{verified?names[task.snapshot.state]:'未核对词汇表'}{verified?` · 版本：${task.snapshot.version}`:''}</p>}<div className="inline-actions"><button className="button" disabled={busy||!!task||stale} onClick={()=>void run('create')}>创建模拟任务</button><button className="button" disabled={busy||!task} onClick={()=>void run()}>刷新模拟任务</button>{task&&verified&&(actions[task.snapshot.state]||[]).map(event=><button key={event} className="button" disabled={busy||stale} onClick={()=>void run(event)}>{labels[event]}</button>)}<button className="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消任务请求等待</button><button className="button" disabled={busy||!task||stale||!verified} onClick={()=>void run('history')}>读取模拟迁移记录</button><button className="button" disabled={busy||stale||!task||![4,5,6].includes(task.snapshot.state)} onClick={()=>{setTask(null);setHistory(null);setStatus('已结束本次查看；服务器记录仍保留，未删除，可创建下一项模拟任务')}}>结束本次查看</button><button className="button" disabled={busy||stale||!task||history===null||!verified} onClick={exportEvidence}>导出模拟任务证据</button><button className="button" disabled={busy||!attempt||!task||!verified} onClick={()=>void run(attempt!.event,attempt!.expectedVersion)}>重发上次迁移（同幂等键）</button></div><p>迁移请求携带确定性的幂等键（任务+事件+预期版本）：重发同一请求只会得到服务器已记录的结果版本，不会再次推进状态；换事件或换版本则是新请求。状态标签与事件目标表必须先与后端词汇表核对一致，否则不显示状态、迁移、历史与导出。</p>{history!==null&&<div aria-label="模拟迁移记录"><p>进程内状态记录，不含操作者和时间，不是生产审计日志。</p>{history.length?<ol>{history.map((item,index)=><li key={index}>{item.label}</li>)}</ol>:<p>暂无成功迁移</p>}</div>}</section>
}
