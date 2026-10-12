import { useEffect, useState } from 'react'
import { clearEvidence, evidenceSnapshot, subscribeEvidence } from './review-evidence'
import { prototypeBuildId } from './nav'
export default function ReviewEvidence(){
 const [items,setItems]=useState(()=>evidenceSnapshot())
 useEffect(()=>subscribeEvidence(()=>setItems(evidenceSnapshot())),[])
 function exportEvidence(){
  const payload={schemaVersion:1,isDemo:true,productionEvidence:false,persistence:'none',buildId:prototypeBuildId,generatedAt:new Date().toISOString(),note:'本次会话已核验的Demo结论摘要；不含提交正文与凭据，不能作为生产或验收证据。',items}
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download='demo-review-evidence.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <section aria-label="本次会话评审证据" style={{padding:16,border:'1px solid #dce3ec',borderRadius:10,minWidth:0}}>
  <h2>本次会话评审证据</h2>
  <p>只汇总本次会话中已由后端确认过的结论（协议清单、目录预检、清单校验、数据库前置条件、任务词汇表、台账摘要、反馈回执等），便于把“我看到的结果”随反馈一起提交。</p>
  <p>不包含提交正文、凭据或设备地址；这是 Demo 证据，<strong>不能</strong>作为生产就绪或部门验收证明。刷新页面即清空，跨页共享同一份清单。</p>
  <div className="inline-actions"><button className="button" type="button" disabled={items.length===0} onClick={exportEvidence}>导出本页评审证据（{items.length} 项）</button><button className="button" type="button" disabled={items.length===0} onClick={clearEvidence}>清空证据清单</button></div>
  <p role="status">{items.length===0?'尚无已核验结论；请先在上方各面板显式载入或检查。':`已记录 ${items.length} 项已核验结论；导出会带上当前构建标识 ${prototypeBuildId}。`}</p>
  {items.length>0&&<div className="table-wrap"><table aria-label="证据清单"><thead><tr>{['来源','结论'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>{items.map(item=><tr key={item.key}><td>{item.label}</td><td style={{overflowWrap:'anywhere'}}>{item.detail}</td></tr>)}</tbody></table></div>}
 </section>
}
