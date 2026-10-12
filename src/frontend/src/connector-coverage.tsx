import {useEffect,useRef,useState} from 'react'
import {readBoundedJson} from './bounded-json'
import {parseConnectorCatalog,type ConnectorCandidate} from './connector-catalog'
import {connectorMatrixRows,matrixCandidateMapping} from './connector-matrix'
import {downloadCsv} from './csv-export'
import {assets} from './data'
import {coverageOfAssetKinds} from './asset-connector-map'
type Coverage = {
  candidates: ConnectorCandidate[]
  unmapped: string[]
  unknown: string[]
  uncoveredRows: string[]
  protocolNotes: { row: string; displayed: string; registered: string[] }[]
}
const failure = '目录覆盖核对失败或响应不符；不显示诊断正文，不回退为本地结论。'
export function coverageOf(catalog: ConnectorCandidate[]): Coverage {
  const ids = new Set(catalog.map(item => item.id))
  const mapped = new Set(Object.values(matrixCandidateMapping).flat())
  const protocolNotes = connectorMatrixRows.flatMap(row => {
    const found = catalog.filter(item => (matrixCandidateMapping[row[0]] ?? []).includes(item.id))
    if (found.length === 0) return []
    const registered = [...new Set(found.flatMap(item => item.protocols))]
    const displayed = row[3]
    return registered.some(value => displayed.includes(value)) ? [] : [{ row: row[0], displayed, registered }]
  })
  return {
    candidates: catalog,
    unmapped: catalog.filter(item => !mapped.has(item.id)).map(item => item.id),
    unknown: [...mapped].filter(id => !ids.has(id)),
    uncoveredRows: connectorMatrixRows.map(row => row[0]).filter(label => !matrixCandidateMapping[label]),
    protocolNotes,
  }
}
export default function ConnectorCoverage(){
 // Local demo inventory grouped by kind; the mapping table is the single place that judges coverage.
 const assetCoverage = coverageOfAssetKinds(
   Object.entries(assets.reduce<Record<string, number>>((all, asset) => { all[asset.kind] = (all[asset.kind] ?? 0) + 1; return all }, {}))
     .map(([kind, count]) => ({ kind, count })).sort((left, right) => left.kind.localeCompare(right.kind, 'zh-Hans-CN')),
   matrixCandidateMapping)
 const [coverage,setCoverage]=useState<Coverage|null>(null),[status,setStatus]=useState('尚未核对'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function run(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  setCoverage(null);setStatus('正在载入后端目录并核对矩阵…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch('/api/v1/connector-capabilities',{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const payload=await readBoundedJson(response,262144) as {isDemo:boolean;persistence:string;data:unknown}
   const catalog=payload.isDemo===true&&payload.persistence==='none'?parseConnectorCatalog(payload.data):null
   if(!catalog)throw new Error()
   if(active.current!==controller)return
   const result=coverageOf(catalog)
   setCoverage(result)
   const issues=result.unmapped.length+result.unknown.length+result.uncoveredRows.length
   setStatus(issues===0
    ? `页面矩阵与后端目录覆盖一致：${result.candidates.length}/${result.candidates.length} 个候选均有对应行。此核对不验证协议等价或设备兼容。`
    : `发现 ${issues} 处覆盖差异：后端未覆盖 ${result.unmapped.length}、矩阵指向未知候选 ${result.unknown.length}、矩阵行未映射 ${result.uncoveredRows.length}。`)
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'等待已取消或超时；没有新的结论。':failure)}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section className="panel" aria-label="矩阵覆盖核对">
  <div className="panel-head"><div><h2>矩阵覆盖核对</h2><p>显式读取后端候选目录，检查上表每一行是否覆盖已注册候选，避免目录新增后页面未同步</p></div></div>
  <p>只比较候选标识覆盖关系，并额外提示矩阵协议文案与后端登记协议不一致的行；不判定协议、能力或厂商等价性，也不代表任何设备已验证或可接入。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={()=>void run()}>核对矩阵覆盖</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消覆盖核对等待</button></div>
  <p role="status">{status}</p>
  {coverage&&<>
   {(coverage.unmapped.length>0||coverage.unknown.length>0||coverage.uncoveredRows.length>0)&&<ul>
    {coverage.unmapped.map(id=><li key={`unmapped-${id}`}>后端候选 <code>{id}</code> 没有任何矩阵行覆盖。</li>)}
    {coverage.unknown.map(id=><li key={`unknown-${id}`}>矩阵引用了不存在的候选 <code>{id}</code>。</li>)}
    {coverage.uncoveredRows.map(label=><li key={`row-${label}`}>矩阵行「{label}」没有映射到任何候选。</li>)}
   </ul>}
   {coverage.protocolNotes.length>0&&<div className="panel-note"><p>以下矩阵行的“协议 / 路径”文案未包含其覆盖候选的任何已登记协议，仅供人工核对，不作为错误判定：</p><ul>{coverage.protocolNotes.map(note=><li key={note.row}>「{note.row}」显示 <code>{note.displayed}</code>，后端登记：{note.registered.join('、')}</li>)}</ul></div>}
   <div className="table-wrap"><table aria-label="矩阵与候选映射"><thead><tr>{['矩阵行','覆盖候选','后端区域','后端协议','接入前需确认（候选声明）'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
    {connectorMatrixRows.map(row=>{
     const ids=matrixCandidateMapping[row[0]]??[]
     const found=coverage.candidates.filter(item=>ids.includes(item.id))
     return <tr key={row[0]}>
      <td>{row[0]}</td>
      <td style={{overflowWrap:'anywhere'}}>{found.length?found.map(item=>item.name).join('、'):'未覆盖'}</td>
      <td>{found.length?[...new Set(found.map(item=>item.category))].join('、'):'—'}</td>
      <td style={{overflowWrap:'anywhere'}}>{found.length?[...new Set(found.flatMap(item=>item.protocols))].join('、'):'—'}</td>
      <td style={{overflowWrap:'anywhere'}}>{found.length?[...new Set(found.flatMap(item=>item.requiredBeforeOnboarding))].join('；'):'—'}</td>
     </tr>
    })}
   </tbody></table></div>
   <h3>候选目录明细（后端声明，供逐项批注）</h3>
   <p>下表逐候选列出后端登记内容，全部为规划且未实现、未验证、未开放写入；可导出 CSV 并由部门补充“是否首批/部门意见”两列。</p>
   <div className="table-wrap"><table aria-label="候选目录明细"><thead><tr>{['候选','类别','协议','规划只读能力','目标范围','厂商候选','接入前需确认','实现/验证/写入'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
    {coverage.candidates.map(item=><tr key={`detail-${item.id}`}>
     <td><code>{item.id}</code> · {item.name}</td>
     <td>{item.category}</td>
     <td style={{overflowWrap:'anywhere'}}>{item.protocols.join('、')}</td>
     <td style={{overflowWrap:'anywhere'}}>{item.plannedReadCapabilities.join('、')}</td>
     <td style={{overflowWrap:'anywhere'}}>{item.targetFamilies.join('、')}</td>
     <td style={{overflowWrap:'anywhere'}}>{item.candidateVendors.join('、')}</td>
     <td style={{overflowWrap:'anywhere'}}>{item.requiredBeforeOnboarding.join('；')}</td>
     <td>未实现/未验证/未开放</td>
    </tr>)}
   </tbody></table></div>
   <div className="inline-actions"><button className="button" type="button" onClick={()=>downloadCsv('connector-candidates-template.csv',
    ['id','name','category','protocols','plannedReadCapabilities','targetFamilies','candidateVendors','requiredBeforeOnboarding','status','implemented','liveVerified','writeEnabled','首批纳入','部门意见'],
    coverage.candidates.map(item=>[item.id,item.name,item.category,item.protocols.join('|'),item.plannedReadCapabilities.join('|'),item.targetFamilies.join('|'),item.candidateVendors.join('|'),item.requiredBeforeOnboarding.join('|'),item.status,'否','否','否','','']))}>导出候选明细 CSV（含批注列）</button></div>
   <h3>资产类别 → 候选覆盖（本机模拟资产）</h3>
   <p>把本机模拟资产的类别与矩阵行对照，指出哪些类别目前<strong>没有</strong>对应候选连接器；未映射表示接入计划中尚无该类别，不代表设备不可接入。</p>
   <div className="table-wrap"><table aria-label="资产类别覆盖"><thead><tr>{['资产类别','模拟数量','对应矩阵行','覆盖候选','状态'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>
    {assetCoverage.map(item=><tr key={`asset-${item.kind}`}>
     <td>{item.kind}</td>
     <td>{item.count}</td>
     <td>{item.rows.length?item.rows.join('、'):'—'}</td>
     <td style={{overflowWrap:'anywhere'}}>{item.candidates.length?item.candidates.join('、'):'—'}</td>
     <td>{item.covered?'已有候选':'尚无候选（未映射）'}</td>
    </tr>)}
   </tbody></table></div>
   <p className="field-note">未映射类别：{assetCoverage.filter(item=>!item.covered).map(item=>item.kind).join('、')||'无'}。该对照只说明接入计划覆盖情况，不验证协议等价或设备兼容。</p>
  </>}
 </section>
}
