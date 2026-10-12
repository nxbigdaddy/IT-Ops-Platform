export type ConnectorCandidate = {id:string;name:string;category:string;protocols:string[];targetFamilies:string[];candidateVendors:string[];plannedReadCapabilities:string[];requiredBeforeOnboarding:string[];status:'planned';implemented:false;liveVerified:false;writeEnabled:false}
const bounded=(value:unknown):value is string[]=>Array.isArray(value)&&value.length>0&&value.length<=16&&value.every(item=>typeof item==='string'&&item.length>0&&item.length<=100)
export function parseConnectorCandidate(value:unknown):ConnectorCandidate|null{
 const v=value as ConnectorCandidate&{status?:unknown;implemented?:unknown;liveVerified?:unknown;writeEnabled?:unknown}
 if(!v||typeof v!=='object'||typeof v.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(v.id)||typeof v.name!=='string'||!v.name||v.name.length>100||typeof v.category!=='string')return null
 if(v.status!=='planned'||v.implemented!==false||v.liveVerified!==false||v.writeEnabled!==false)return null
 if(!bounded(v.protocols)||!bounded(v.targetFamilies)||!bounded(v.candidateVendors)||!bounded(v.plannedReadCapabilities))return null
 // Onboarding preconditions are part of the contract: a candidate without them is not shown at all.
 if(!bounded(v.requiredBeforeOnboarding)||new Set(v.requiredBeforeOnboarding).size!==v.requiredBeforeOnboarding.length)return null
 return {id:v.id,name:v.name,category:v.category,protocols:[...v.protocols],targetFamilies:[...v.targetFamilies],candidateVendors:[...v.candidateVendors],plannedReadCapabilities:[...v.plannedReadCapabilities],requiredBeforeOnboarding:[...v.requiredBeforeOnboarding],status:'planned',implemented:false,liveVerified:false,writeEnabled:false}
}
// A bounded range rather than a magic count: the registry is expected to grow, and the
// safety-relevant invariants are the per-item flags plus server-side membership checks.
export function parseConnectorCatalog(value:unknown):ConnectorCandidate[]|null{
 if(!Array.isArray(value)||value.length<1||value.length>32)return null
 const parsed=value.map(parseConnectorCandidate)
 if(parsed.some(item=>item===null))return null
 const list=parsed as ConnectorCandidate[]
 return new Set(list.map(item=>item.id)).size===list.length?list:null
}
