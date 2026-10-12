export type ServerFeedback = {id:string;category:string;message:string;page:string|null;createdAt:string;isDemo:true;isPersistent:false}
const feedbackFields = ['id','category','message','page','createdAt','isDemo','isPersistent']
export function validServerFeedback(value:unknown): value is ServerFeedback {
 const v=value as ServerFeedback
 return !!v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===feedbackFields.length && feedbackFields.every(key=>Object.hasOwn(v,key)) && typeof v.id==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id)
  && ['bug','suggestion','question'].includes(v.category) && typeof v.message==='string' && v.message.trim().length>0 && v.message.length<=2000
  && (v.page===null || (typeof v.page==='string' && v.page.length<=200 && v.page.startsWith('/') && !v.page.startsWith('//')))
  && typeof v.createdAt==='string' && Number.isFinite(Date.parse(v.createdAt)) && v.isDemo===true && v.isPersistent===false
}
export function validServerFeedbackList(value:unknown): value is ServerFeedback[] {
 return Array.isArray(value) && value.length<=200 && value.every(validServerFeedback) && new Set(value.map(item=>item.id.toLowerCase())).size===value.length
}
