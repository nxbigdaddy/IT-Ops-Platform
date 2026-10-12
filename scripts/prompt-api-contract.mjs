import assert from 'node:assert/strict';
const base=process.env.BACKEND_CONTRACT_URL||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw new Error('Only local demo endpoints allowed');
async function request(route,body){const response=await fetch(base+'/api/v1/prompts'+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});return{status:response.status,body:await response.json()};}
const list=await request('');assert.equal(list.status,200);assert.equal(list.body.isDemo,true);assert.equal(list.body.persistence,'memory');assert.equal(list.body.data.length,3);
const id='/inspection-report';const before=await request(id);const version=before.body.data.currentVersion;
const invalid=await request(id+'/versions',{expectedVersion:version,content:'{{unknown}}'});assert.equal(invalid.status,400);
const edit=await request(id+'/versions',{expectedVersion:version,content:'模拟巡检 {{asset_name}} {{inspection_result}}'});assert.equal(edit.status,201);assert.equal(edit.body.data.status,'draft');assert.equal(edit.body.data.modelExecutionEnabled,false);
const conflict=await request(id+'/versions',{expectedVersion:version,content:'模拟冲突'});assert.equal(conflict.status,409);
const restore=await request(id+'/restore',{expectedVersion:version+1,sourceVersion:version});assert.equal(restore.status,201);assert.equal(restore.body.data.currentVersion,version+2);assert.equal(restore.body.data.content,before.body.data.content);
console.log('PASS prompt API list/get, unknown-variable400, draft201, conflict409, restore201; local memory only');
