import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const providers=[
 {id:'openai-compatible',name:'OpenAI-compatible API',status:'planned',planned:true,implemented:false,verified:false,packageAvailable:false,outboundEnabled:false,notes:'整体接入未实现；仅离线Chat Completions文本契约适配与合成测试，无网络传输。'},
 {id:'anthropic',name:'Anthropic API',status:'planned',planned:true,implemented:false,verified:false,packageAvailable:false,outboundEnabled:false,notes:'整体接入未实现；仅离线Messages文本契约适配与合成测试，无密钥读取。'},
 {id:'local-model',name:'本地模型 API',status:'planned',planned:true,implemented:false,verified:false,packageAvailable:false,outboundEnabled:false,notes:'本地模型仍需权限与审计；当前没有请求或模型验证。'},
];
const LOAD_OK='已载入 3 个AI协议候选；均未实现、未验证、未开放外连。';
const PROTOCOL_OK='已载入 2 个可用协议；仅为离线契约，无网络传输、无凭据读取、无真实模型验证。';
const PROTOCOL_FAIL='协议目录载入失败或响应不符；不显示诊断正文，不回退为本地协议清单。';
const protocols=[{protocol:'OpenAiCompatible',displayName:'OpenAI兼容 Chat Completions',requestContract:'chat-completions.request.v1',responseContract:'chat-completions.synthetic-response.v1',adapterImplemented:true,transportImplemented:false,liveVerified:false,credentialRead:false},{protocol:'Anthropic',displayName:'Anthropic Messages',requestContract:'messages.request.v1',responseContract:'messages.synthetic-response.v1',adapterImplemented:true,transportImplemented:false,liveVerified:false,credentialRead:false}];
const LOAD_FAIL='候选能力目录载入失败或响应不符；不显示诊断正文，不回退为本地说明。';
let body=providers,gets=0,protocolBody=protocols,protocolGets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/ai-providers'))gets++;if(request.url().endsWith('/ai-protocols'))protocolGets++;});
 else await page.route('**/api/v1/ai-providers',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:body})})});
 if(!live)await page.route('**/api/v1/ai-protocols',route=>{protocolGets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:protocolBody})})});
 let previewOverride=null,previewPosts=0;
 if(!live)await page.route('**/api/v1/ai-contract-preflight',route=>{previewPosts++;const draft=route.request().postDataJSON();const preview={protocol:draft.protocol,model:'demo-model',networkVerified:false,transportImplemented:false,credentialRead:false,syntheticInput:true,request:{model:'demo-model',messages:[{role:'system',content:draft.system},{role:'user',content:draft.user}],max_tokens:draft.maxTokens,temperature:draft.temperature,stream:false},...previewOverride};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:true,errors:[],preview}})});});
 await page.goto(base+'/ai');
 const panel=page.getByRole('region',{name:'后端AI协议候选能力'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();assert.equal(gets,1);
 assert.equal(await panel.locator('tbody tr').count(),3);
 assert.equal(await panel.getByRole('cell',{name:'OpenAI-compatible API',exact:true}).count(),1);
 assert.equal(await panel.getByRole('cell',{name:'尚未安装',exact:true}).count(),3);
 // The annotation sheet must keep the AI candidates marked as planned and unverified.
 const downloadWait=page.waitForEvent('download');await panel.getByRole('button',{name:'导出AI协议候选明细 CSV（含批注列）'}).click();
 const file=await downloadWait;assert.equal(file.suggestedFilename(),'AI协议-candidates-template.csv');
 const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
 const csv=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'').trim().split('\n');
 assert.equal(csv[0],'id,name,packageAvailable,planned,implemented,verified,outboundEnabled,notes,首批纳入,部门意见');
 assert.equal(csv.length,4);assert.ok(csv.slice(1).every(line=>line.includes(',是,否,否,否,')));
 assert.equal(await panel.getByText(/目录标识仅用于展示/).count(),1);
 const protocolPanel=page.getByRole('region',{name:'可用AI协议'});await protocolPanel.waitFor();
 assert.equal(await protocolPanel.locator('tbody').count(),0);assert.equal(protocolGets,0);
 await protocolPanel.getByRole('button',{name:'载入可用协议'}).click();await protocolPanel.getByText(PROTOCOL_OK,{exact:true}).waitFor();assert.equal(protocolGets,1);
 assert.equal(await protocolPanel.locator('tbody tr').count(),2);
 assert.equal(await protocolPanel.getByRole('cell',{name:'OpenAiCompatible',exact:true}).count(),1);
 assert.equal(await protocolPanel.getByText(/预检只接受本表列出的协议/).count(),1);
 const previewButton=protocolPanel.getByRole('row',{name:/OpenAiCompatible/}).getByRole('button',{name:'预览请求形状'});
 const previewPre=protocolPanel.getByLabel('出站请求形状');
 await previewButton.click();await protocolPanel.getByText(/已构建 OpenAiCompatible 的请求形状；仅合成输入，未发送、无网络、无凭据。/).waitFor();
 const previewText=await previewPre.textContent();
 assert.ok(previewText.includes('"model": "demo-model"'),previewText);assert.ok(previewText.includes('"stream": false'),previewText);
 assert.equal(await protocolPanel.getByText(/它不发送请求、不解析凭据、也不验证模型行为/).count(),1);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'ai candidate page overflows');await page.setViewportSize({width:1280,height:720});
 if(!live){
  for(const bad of [[{...protocols[0],transportImplemented:true}],[{...protocols[0],liveVerified:true}],[{...protocols[0],credentialRead:true}],[protocols[0],protocols[0]],[]]){
   protocolBody=bad;await protocolPanel.getByRole('button',{name:'载入可用协议'}).click();await protocolPanel.getByText(PROTOCOL_FAIL,{exact:true}).waitFor();assert.equal(await protocolPanel.locator('tbody').count(),0);
  }
  protocolBody=protocols;await protocolPanel.getByRole('button',{name:'载入可用协议'}).click();await protocolPanel.getByText(PROTOCOL_OK,{exact:true}).waitFor();
  for(const bad of [{networkVerified:true},{transportImplemented:true},{credentialRead:true},{syntheticInput:false},{protocol:'Anthropic'},{model:'other-model'},{request:{model:'demo-model',apiKey:'sk-synthetic-placeholder-1234567890'}}]){
   previewOverride=bad;await previewButton.click();await protocolPanel.getByText('请求形状预览不可用或响应不符；不显示诊断正文，未发送任何请求。',{exact:true}).waitFor();assert.equal(await previewPre.count(),0);
  }
  previewOverride=null;await previewButton.click();await protocolPanel.getByText(/已构建 OpenAiCompatible 的请求形状/).waitFor();
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/ai-contract-preflight',hold);
  await previewButton.click();await protocolPanel.getByText('正在构建 OpenAiCompatible 的请求形状…',{exact:true}).waitFor();assert.equal(await previewPre.count(),0);
  await protocolPanel.getByRole('button',{name:'取消预览等待'}).click();await protocolPanel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/ai-contract-preflight',hold);await previewButton.click();await protocolPanel.getByText(/已构建 OpenAiCompatible 的请求形状/).waitFor();
 }
 if(!live){
  for(const bad of [
   providers.map((item,index)=>index===0?{...item,implemented:true}:item),
   providers.map((item,index)=>index===0?{...item,verified:true}:item),
   providers.map((item,index)=>index===0?{...item,outboundEnabled:true}:item),
   providers.map((item,index)=>index===0?{...item,planned:false}:item),
   providers.map((item,index)=>index===0?{...item,notes:' '}:item),
   [providers[0],providers[0]],
   Array.from({length:9},(_,index)=>({...providers[index%3],id:providers[index%3].id+index})),
  ]){
   body=bad;await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText(LOAD_FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  }
  body=providers;await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/ai-providers',hold);
  await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText('正在载入候选能力…',{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  await panel.getByRole('button',{name:'取消候选载入等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/ai-providers',hold);await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
 }
 console.log(`PASS AI protocol candidates ${live?'actual local HTTP':'injected'}: explicit load, three candidates, accepted protocol list, outbound request shape preview, narrow layout, invalid claims and cancel.`);
}finally{await browser.close();}
