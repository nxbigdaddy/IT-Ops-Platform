import {useEffect,useRef,useState} from 'react'
import {publishEvidence} from './review-evidence'
import {loadScenarios,runScenario,type Scenario,type ScenarioParser} from './scenario-preflight'
export type ScenarioPanelLabels = {
  title: string
  intro: string
  loadLabel: string
  runLabel: string
  cancelLabel: string
  selectLabel: string
  tableLabel: string
  loadOk: (count:number)=>string
  loadFailed: string
  checkFailed: string
  checkPending: string
  allowed: (scenario:Scenario)=>string
  denied: (scenario:Scenario, stopped:string)=>string
  note: string
  ruleLabels: Record<string,string>
  codeLabels: Record<string,string>
  evidence: { loadKey: string; loadLabel: string; checkKey: string; checkLabel: string }
  description: (scenario:Scenario)=>string
}
// One implementation for every read-only rule view; each panel supplies its own wording and parser.
export default function ScenarioPanel({ loadUrl, runUrl, parser, labels }:{
  loadUrl: string; runUrl: string; parser: ScenarioParser; labels: ScenarioPanelLabels
}){
  const [list,setList]=useState<Scenario[]|null>(null),[status,setStatus]=useState(`尚未载入${labels.title}`),[selected,setSelected]=useState('')
  const [result,setResult]=useState<Scenario|null>(null),[checkStatus,setCheckStatus]=useState('尚未预检')
  const [busy,setBusy]=useState<'load'|'check'|null>(null)
  const active=useRef<AbortController|null>(null)
  useEffect(()=>()=>{active.current?.abort();active.current=null},[])
  async function run(kind:'load'|'check'){
    if(active.current)return
    const controller=new AbortController();active.current=controller;setBusy(kind)
    const timer=setTimeout(()=>controller.abort(),10000)
    try{
      if(kind==='load'){
        setList(null);setSelected('');setResult(null);setStatus(`正在载入${labels.title}…`)
        const scenarios=await loadScenarios(loadUrl,controller.signal,parser)
        if(active.current!==controller)return
        setList(scenarios);setSelected(scenarios[0].id);setStatus(labels.loadOk(scenarios.length))
        publishEvidence({key:labels.evidence.loadKey,label:labels.evidence.loadLabel,detail:`${scenarios.length} 个场景由后端规则求值；不授权执行`})
      }else{
        if(!list||!list.some(item=>item.id===selected))return
        setResult(null);setCheckStatus(labels.checkPending)
        const scenario=await runScenario(runUrl,selected,controller.signal,parser)
        if(active.current!==controller)return
        setResult(scenario)
        const stopped=scenario.rules.find(rule=>!rule.passed)
        setCheckStatus(scenario.valid?labels.allowed(scenario):labels.denied(scenario,labels.ruleLabels[stopped?.name??'']??stopped?.name??''))
        publishEvidence({key:labels.evidence.checkKey,label:labels.evidence.checkLabel,detail:`${scenario.label} → ${labels.codeLabels[scenario.code]}；未授权执行`})
      }
    }catch{if(active.current===controller)(kind==='load'?setStatus:setCheckStatus)(controller.signal.aborted?'等待已取消或超时；没有新的结论。':kind==='load'?labels.loadFailed:labels.checkFailed)}
    finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(null)}}
  }
  const current=list?.find(item=>item.id===selected)
  return <section aria-label={labels.title} style={{padding:16,border:'1px solid #dce3ec',borderRadius:10,minWidth:0}}>
    <h2>{labels.title}（只读规则）</h2>
    <p>{labels.intro}</p>
    <div className="inline-actions"><button className="button" type="button" disabled={busy!==null} onClick={()=>void run('load')}>{labels.loadLabel}</button><button className="button" type="button" disabled={busy===null} onClick={()=>active.current?.abort()}>{labels.cancelLabel}</button></div>
    <p role="status">{status}</p>
    {list&&<>
      <label>{labels.selectLabel} <select aria-label={labels.selectLabel} disabled={busy!==null} value={selected} onChange={event=>{setSelected(event.target.value);setResult(null);setCheckStatus('尚未预检')}}>{list.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <p className="field-note">场景说明：{current?labels.description(current):''}</p>
      <div className="inline-actions"><button className="button" type="button" disabled={busy!==null||!selected} onClick={()=>void run('check')}>{labels.runLabel}</button></div>
    </>}
    <p role="status">{checkStatus}</p>
    {result&&<div className="table-wrap"><table aria-label={labels.tableLabel}><thead><tr>{['规则','结果'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
      {result.rules.map(rule=><tr key={rule.name}><td>{labels.ruleLabels[rule.name]}</td><td>{rule.passed?'通过':'未通过'}</td></tr>)}
    </tbody></table></div>}
    {result&&<p className="field-note">结论代码：{result.code} · {labels.note}</p>}
  </section>
}
