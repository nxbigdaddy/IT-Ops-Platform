import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readBoundedJson } from '../src/frontend/src/bounded-json.ts';

export async function preflight(base, fetcher = fetch) {
 const origin=new URL(base);
 if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||origin.protocol!=='http:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/') throw new Error('Preflight accepts only local HTTP demo origins.');
 for(const [route,validate] of [
  ['/health/live',b=>b?.isDemo===true&&b.status==='alive'],
  ['/api/v1/connector-capabilities',b=>b?.isDemo===true&&b.persistence==='none'&&Array.isArray(b.data)&&b.data.length===10&&b.data.every(c=>c.status==='planned'&&c.implemented===false&&c.liveVerified===false)]
 ]) {
  let response;try {response=await fetcher(new URL(route,origin),{signal:AbortSignal.timeout(5000),redirect:'error',headers:{Accept:'application/json'}});}catch{throw new Error(`Demo unavailable at ${route}; start frontend and backend, then retry. No service was started automatically.`);}
  if(response.status!==200){await response.body?.cancel();throw new Error(`Demo preflight ${route}: HTTP ${response.status}; wait for startup or restart an outdated backend.`);}
  let body;try{body=await readBoundedJson(response,262144);}catch{throw new Error(`Demo preflight ${route}: expected JSON within 256KiB, check the frontend proxy and backend startup.`);}
  if(!validate(body))throw new Error(`Demo preflight ${route}: wrong version or Demo contract; no production readiness claim.`);
 }
 return true;
}
async function selfTest(){
 const good=async url=>new Response(JSON.stringify(url.pathname==='/health/live'?{status:'alive',isDemo:true}:{isDemo:true,persistence:'none',data:Array.from({length:10},()=>({status:'planned',implemented:false,liveVerified:false}))}));
 assert.equal(await preflight('http://127.0.0.1:5173',good),true);
 await assert.rejects(()=>preflight('https://external.invalid',good),/local HTTP/);
 await assert.rejects(()=>preflight('http://localhost:5173',async()=>{throw new Error('synthetic');}),/unavailable/);
 await assert.rejects(()=>preflight('http://localhost:5173',async()=>new Response('synthetic',{status:503})),/HTTP 503/);
 await assert.rejects(()=>preflight('http://localhost:5173',async()=>new Response('<html>fixture</html>')),/expected JSON/);
 await assert.rejects(()=>preflight('http://localhost:5173',async()=>new Response('{}')),/wrong version/);
 await assert.rejects(()=>preflight('http://localhost:5173?mock=value',good),/local HTTP/);
 await assert.rejects(()=>preflight('http://localhost:5173#fragment',good),/local HTTP/);
 await assert.rejects(()=>preflight('http://mock:mock@localhost:5173',good),/local HTTP/);
 await assert.rejects(()=>preflight('http://localhost:5173/path',good),/local HTTP/);
 await assert.rejects(()=>preflight('http://localhost:5173',async()=>new Response('x'.repeat(262145))),/within 256KiB/);
 console.log('PASS 11 preflight checks; injected responses only.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.includes('--self-test'))await selfTest();else{await preflight(process.env.PROTOTYPE_URL||'http://127.0.0.1:5173');console.log('PASS local Demo preflight; not production readiness.');}}catch(error){console.error(error.message);process.exitCode=1;}}
