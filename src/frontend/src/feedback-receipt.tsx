import { useEffect, useRef, useState } from 'react'
import { readBoundedJson } from './bounded-json'
import { validServerFeedback } from './server-feedback-contract'
export default function FeedbackReceipt({ receipt }: { receipt: Record<string, unknown> }) {
 const [status,setStatus]=useState('尚未核对'),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function check(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true);setStatus('正在核对内存记录…')
  const timer=setTimeout(()=>controller.abort(),10000)
  try{
   const response=await fetch(`/api/v1/feedback/${encodeURIComponent(String(receipt.id))}`,{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json'}})
   if(response.status===404){await response.body?.cancel();if(active.current===controller)setStatus('未找到内存记录：可能已淘汰或服务重启；不代表从未保存，请勿自动重提。');return}
   if(response.status!==200){await response.body?.cancel();throw new Error()}
   const body=await readBoundedJson(response,65536) as {isDemo:boolean;persistence:string;data:Record<string,unknown>}
   if(body.isDemo!==true||body.persistence!=='memory'||!validServerFeedback(body.data)||!['id','category','message','page','createdAt'].every(key=>body.data[key]===receipt[key]))throw new Error()
   if(active.current===controller)setStatus('核对一致：读取时记录仍在内存中，不保证后续保留。')
  }catch{if(active.current===controller)setStatus(controller.signal.aborted?'核对等待已取消或超时；未取得新结论，可重新核对。':'核对失败或响应不符；未显示诊断正文，不自动重新提交。')}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <aside aria-label="反馈内存回执" style={{overflowWrap:'anywhere'}}><p>反馈编号：<code>{String(receipt.id)}</code></p><p>服务器记录时间：<time dateTime={String(receipt.createdAt)}>{String(receipt.createdAt)}</time></p><p>仅进程内存回执；重启或容量淘汰后可能无法查询，不是持久化凭证。</p><button className="button" type="button" disabled={busy} onClick={()=>void check()}>核对内存记录</button><button className="button" type="button" disabled={!busy} onClick={()=>active.current?.abort()}>取消核对等待</button><p role="status">{status}</p></aside>
}
