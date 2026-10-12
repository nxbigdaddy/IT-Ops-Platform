import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const protocols=[{protocol:'OpenAiCompatible',displayName:'OpenAI兼容 Chat Completions'},{protocol:'Anthropic',displayName:'Anthropic Messages'}];
const scenarios=[
 {id:'valid',label:'合法响应',description:'经真实适配器解析出文本、用量与结束原因',openAiCode:'parsed',anthropicCode:'parsed'},
 {id:'provider_error',label:'提供方错误对象',description:'响应含 error 字段，被适配器拒绝',openAiCode:'provider_error_not_supported',anthropicCode:'provider_error_not_supported'},
 {id:'tool_calls',label:'工具调用字段',description:'响应含 tool_calls，被适配器拒绝',openAiCode:'tools_not_supported',anthropicCode:'tools_not_supported'},
];
const notes='只与本机回环桩端点通信；请求内容为合成文本，不读取凭据，也不发往任何真实提供方。';
const sentRequestJson=JSON.stringify({model:'demo-model',messages:[{role:'system',content:'演示系统提示：仅用于适配验证'},{role:'user',content:'演示用户文本：仅用于适配验证'}],max_tokens:256,temperature:0.2,stream:false});
const parsed=()=>({sentRequestJson,status:'parsed',code:null,httpStatus:200,responseBytes:396,elapsedMilliseconds:42,text:'[合成桩响应] 收到 12 字符输入；未调用任何模型，也未读取凭据。',usage:{inputTokens:12,outputTokens:32,totalTokens:44},stopReason:'stop',loopbackOnly:true,credentialRead:false,productionTransportImplemented:false,syntheticStubOnly:true,notes});
const rejected=(code)=>({...parsed(),status:'rejected',code,httpStatus:200,text:null,usage:null,stopReason:null});
const FAIL='回环往返失败或响应不符；不显示诊断正文，不回退本地判断。';
let exchange=parsed(),loads=0,runs=0;
// The scenario route answers from a queue so each request gets exactly the body intended for it.
const pendingScenarios=[];
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/ai-loopback-exchange'))runs++;});
 else{
  await page.route('**/api/v1/ai-protocols',route=>{loads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:protocols})})});
  await page.route('**/api/v1/ai-loopback-stub-scenarios',route=>{loads++;const body=pendingScenarios.length>0?pendingScenarios.shift():scenarios;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:body})})});
  await page.route('**/api/v1/ai-loopback-exchange',route=>{runs++;const posted=route.request().postDataJSON();assert.equal(posted.model,'demo-model');assert.ok(posted.user.includes('仅用于适配验证'));assert.ok(scenarios.some(item=>item.id===posted.stubBehaviour),'the posted behaviour must come from the server catalog: '+posted.stubBehaviour);const payload=exchange;return route.fulfill({status:payload.status==='parsed'?200:502,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:payload})})});
 }
 await page.goto(base+'/ai');
 const panel=page.getByRole('region',{name:'本机回环往返验证'});await panel.waitFor();
 const statusLine=panel.locator('p[role=status]');
 // Poll the status text directly: getByText on the status element itself is brittle for long exact strings.
 const waitForStatus=async(predicate,label)=>{const deadline=Date.now()+15000;let last='';while(Date.now()<deadline){last=await statusLine.innerText();if(predicate(last))return last;await page.waitForTimeout(100)}throw new Error('status never matched '+label+'; last: '+last)};
 assert.equal(await panel.locator('.domain-facts').count(),0);assert.equal(runs,0);
 assert.ok((await panel.innerText()).includes('不读取凭据'));
 await panel.getByRole('button',{name:'载入协议与桩行为'}).click();
 await panel.getByLabel('回环协议').waitFor();
 if(!live){
  assert.equal(loads,2);assert.equal(await panel.getByLabel('回环协议').locator('option').count(),2);
  assert.equal(await panel.getByLabel('桩行为').locator('option').count(),3);
  const note=await panel.locator('.field-note').innerText();
  assert.ok(note.includes('经真实适配器解析出文本、用量与结束原因')&&note.includes('parsed'),note);
  // Picking another behaviour must be reflected in the note and in the posted body.
  await panel.getByLabel('桩行为').selectOption('tool_calls');
  assert.ok((await panel.locator('.field-note').innerText()).includes('tools_not_supported'),await panel.locator('.field-note').innerText());
  await panel.getByLabel('桩行为').selectOption('valid');
  // A behaviour catalog that is empty, duplicated or missing codes must be refused outright.
  for(const invalid of [[],[...scenarios,...scenarios],scenarios.map(item=>({...item,openAiCode:''})),scenarios.map(item=>({...item,id:''})),scenarios.map(item=>({...item,description:' '}))]){
   pendingScenarios.push(invalid);const beforeLoads=loads;await panel.getByRole('button',{name:'载入协议与桩行为'}).click();
   assert.ok(loads>beforeLoads,'no scenario request was issued for the invalid catalog');
   // Wait until the load leaves the in-progress state, then require the refusal message.
   const settled=await waitForStatus(text=>!text.includes('正在载入'),'invalid catalog #'+invalid.length+' settled');
   assert.equal(settled,FAIL,'invalid catalog #'+invalid.length+' must be refused');
   assert.equal(await panel.getByLabel('桩行为').count(),0);
  }
  await panel.getByRole('button',{name:'载入协议与桩行为'}).click();
  await waitForStatus(text=>text.includes('已载入 2 个协议与 3 个桩行为'),'catalog reload');
 }
 await panel.getByRole('button',{name:'发起本机回环往返'}).click();
 if(live){
  await waitForStatus(text=>text.includes('本机回环往返完成：HTTP 200'),'parsed');
  // Live sweep: every non-slow behaviour must reproduce its advertised code over a real socket.
  const catalog=await (await fetch(base+'/api/v1/ai-loopback-stub-scenarios',{headers:{Origin:base}})).json();
  assert.ok(Array.isArray(catalog.data)&&catalog.data.length>=7,'scenario catalog missing');
  for(const scenario of catalog.data.filter(item=>item.id!=='slow')){
   const response=await fetch(base+'/api/v1/ai-loopback-exchange',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({protocol:'OpenAiCompatible',model:'demo-model',system:'演示系统提示：仅用于适配验证',user:'演示用户文本：仅用于适配验证',maxTokens:64,temperature:0.2,stubBehaviour:scenario.id})});
   const body=await response.json();const data=body.data;
   assert.equal(data.loopbackOnly,true,scenario.id);assert.equal(data.credentialRead,false,scenario.id);
   assert.equal(data.productionTransportImplemented,false,scenario.id);assert.equal(data.syntheticStubOnly,true,scenario.id);
   if(scenario.id==='valid'){
    assert.equal(response.status,200,scenario.id);assert.equal(data.status,'parsed',scenario.id);assert.ok(data.text.includes('[合成桩响应]'),scenario.id);
   }else{
    assert.equal(response.status,502,scenario.id);assert.equal(data.code,scenario.openAiCode,scenario.id);assert.equal(data.text,null,scenario.id);
   }
  }
 }
 else{
  await waitForStatus(text=>text.includes('本机回环往返完成：HTTP 200'),'parsed');assert.equal(runs,1);
  const facts=await panel.locator('.domain-facts').innerText();
  assert.ok(facts.includes('[合成桩响应]'),facts);
  assert.ok(facts.includes('输入 12 · 输出 32 · 合计 44'),facts);
  assert.ok(facts.includes('仅回环：是 · 读取凭据：否 · 生产传输：未实现 · 仅合成桩：是'),facts);
  assert.ok(facts.includes('本次实际发送（合成，无凭据）')&&facts.includes('"model":"demo-model"'),facts);
  assert.ok(!/authorization|Bearer |sk-/i.test(facts),facts);
  exchange=rejected('endpoint_not_loopback');
  await panel.getByRole('button',{name:'发起本机回环往返'}).click();await waitForStatus(text=>text.includes('被拒绝/解析失败（端点不是本机回环）'),'rejected/endpoint');
  exchange={...rejected('unsupported_protocol'),status:'refused'};await panel.getByRole('button',{name:'发起本机回环往返'}).click();await waitForStatus(text=>text.includes('已拒绝（未连接）（协议不在保留范围）'),'refused');
  exchange=rejected('response_too_large');await panel.getByRole('button',{name:'发起本机回环往返'}).click();await waitForStatus(text=>text.includes('响应超过256KiB'),'oversized');
  exchange={...rejected('loopback_timeout'),status:'timeout'};await panel.getByRole('button',{name:'发起本机回环往返'}).click();await waitForStatus(text=>text.includes('超时（超过5秒未响应）'),'timeout');
  exchange={...rejected('loopback_unreachable'),status:'unreachable'};await panel.getByRole('button',{name:'发起本机回环往返'}).click();await waitForStatus(text=>text.includes('不可达（本机端口不可达）'),'unreachable');
  for(const [caseIndex,invalid] of [
   {...parsed(),loopbackOnly:false},
   {...parsed(),credentialRead:true},
   {...parsed(),productionTransportImplemented:true},
   {...parsed(),syntheticStubOnly:false},
   {...parsed(),notes:' '},
   {...parsed(),text:'没有合成标记的回答'},
   {...parsed(),usage:{inputTokens:12,outputTokens:32,totalTokens:99}},
   {...parsed(),stopReason:null},
   {...parsed(),status:'rejected',code:'endpoint_not_loopback'},
   {...rejected('some_unknown_code')},
   {...rejected('http_status_not_ok'),text:'不该有文本'},
   {...parsed(),httpStatus:600},
   {...parsed(),responseBytes:999999},
   {...parsed(),elapsedMilliseconds:-1},
   {...parsed(),status:'mystery'},
   {...parsed(),sentRequestJson:JSON.stringify({model:'demo-model',api_key:'abcdefghijklmnop'})},
   {...parsed(),sentRequestJson:'Authorization: Bearer abcdefghijklmnop'},
   {...parsed(),sentRequestJson:'[1,2,3]'},
   {...parsed(),sentRequestJson:'not json'},
   {...parsed(),sentRequestJson:123},
  ].entries()){
   exchange=invalid;await panel.getByRole('button',{name:'发起本机回环往返'}).click();
   await waitForStatus(text=>text===FAIL,'invalid case '+caseIndex).catch(()=>{throw new Error('invalid case '+caseIndex+' was accepted')});
   assert.equal(await panel.locator('.domain-facts').count(),0);
  }
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/ai-loopback-exchange',hold);
  await panel.getByRole('button',{name:'发起本机回环往返'}).click();await waitForStatus(text=>text.includes('正在本机回环往返'),'running');
  await panel.getByRole('button',{name:'取消回环往返等待'}).click();await waitForStatus(text=>text.includes('等待已取消或超时'),'cancelled');
  release();await page.unroute('**/api/v1/ai-loopback-exchange',hold);
  exchange=parsed();await panel.getByRole('button',{name:'发起本机回环往返'}).click();await waitForStatus(text=>text.includes('本机回环往返完成'),'parsed again');
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'loopback panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS AI loopback round-trip ${live?'actual local HTTP':'injected'}: synthetic stub, flags, invalid shapes and cancel.`);
}finally{await browser.close();}
