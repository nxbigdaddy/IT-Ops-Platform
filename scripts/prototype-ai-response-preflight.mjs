import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const notes='仅用服务端合成响应验证离线解析契约；无网络传输、无凭据、无真实模型调用。';
const accepted=(id,protocol,label)=>({id,protocol,label,description:`${label}说明`,accepted:true,code:'accepted',outputPreview:'合成响应：仅用于本地契约验证。',inputTokens:12,outputTokens:8,liveCallPerformed:false,transportImplemented:false,productionEnabled:false,notes});
const rejected=(id,protocol,label,code)=>({id,protocol,label,description:`${label}说明`,accepted:false,code,outputPreview:null,inputTokens:0,outputTokens:0,liveCallPerformed:false,transportImplemented:false,productionEnabled:false,notes});
const body=[
 accepted('openai-valid','OpenAiCompatible','OpenAI 兼容：合法合成响应'),
 rejected('openai-object-mismatch','OpenAiCompatible','object 字段不符','unsupported_object'),
 rejected('openai-role-mismatch','OpenAiCompatible','消息角色不符','unsupported_role'),
 rejected('openai-usage-inconsistent','OpenAiCompatible','用量不自洽','inconsistent_usage'),
 rejected('openai-stop-unsupported','OpenAiCompatible','结束原因不支持','unsupported_stop_reason'),
 rejected('openai-empty-output','OpenAiCompatible','输出为空','invalid_output_length'),
 rejected('openai-tool-call','OpenAiCompatible','包含工具调用字段','tools_not_supported'),
 rejected('openai-provider-error','OpenAiCompatible','提供方错误对象','provider_error_not_supported'),
 rejected('openai-duplicate-property','OpenAiCompatible','重复属性名','duplicate_property'),
 rejected('openai-invalid-json','OpenAiCompatible','非法 JSON','invalid_json'),
 accepted('anthropic-valid','Anthropic','Anthropic：合法合成响应'),
 rejected('anthropic-type-mismatch','Anthropic','type 字段不符','unsupported_type'),
 rejected('anthropic-stop-unsupported','Anthropic','结束原因不支持','unsupported_stop_reason'),
 rejected('anthropic-empty-output','Anthropic','输出为空','invalid_output_length'),
 rejected('anthropic-provider-error','Anthropic','提供方错误对象','provider_error_not_supported'),
];
const LOAD_PREFIX='已载入 15 个响应契约场景：接受 2、拒绝 13；';
const FAIL='响应契约场景载入失败或响应不符；不显示诊断正文，不回退为本地结论。';
let list=body,gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/api/v1/ai-response-scenarios'))gets++;});
 else await page.route('**/api/v1/ai-response-scenarios',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:list})})});
 await page.goto(base+'/ai');
 const panel=page.getByRole('region',{name:'AI响应契约预检'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 assert.ok(await panel.getByText(/不.*发起网络请求、不读取凭据、不调用模型/).count()>=1);
 await panel.getByRole('button',{name:'载入响应契约场景'}).click();
 if(live){await panel.getByLabel('响应契约场景清单').waitFor();assert.ok(await panel.getByText(/已载入 \d+ 个响应契约场景/).count()>=1);}
 else{
  await panel.getByText(new RegExp(LOAD_PREFIX)).waitFor();assert.equal(gets,1);
  const table=panel.getByLabel('响应契约场景清单');assert.equal(await table.locator('tbody tr').count(),15);
  assert.ok((await table.innerText()).includes('tools_not_supported'));
  assert.equal(await table.getByText('接受',{exact:true}).count(),2);
  assert.equal(await table.getByText('拒绝',{exact:true}).count(),13);
  await panel.getByLabel('合成响应场景').selectOption('openai-tool-call');
  assert.ok((await panel.innerText()).includes('解析被拒（tools_not_supported）'));
  assert.ok((await panel.innerText()).includes('网络请求：否'));
  await panel.getByLabel('合成响应场景').selectOption('openai-valid');
  assert.ok((await panel.innerText()).includes('解析成功，输出预览'));
  for(const bad of [
   body.map(item=>item.id==='openai-valid'?{...item,liveCallPerformed:true}:item),
   body.map(item=>item.id==='openai-valid'?{...item,transportImplemented:true}:item),
   body.map(item=>item.id==='openai-valid'?{...item,productionEnabled:true}:item),
   body.map(item=>item.id==='openai-valid'?{...item,outputPreview:''}:item),
   body.map(item=>item.id==='openai-tool-call'?{...item,code:'accepted'}:item),
   body.map(item=>item.id==='openai-tool-call'?{...item,outputPreview:'泄漏'}:item),
   body.map(item=>item.id==='openai-tool-call'?{...item,inputTokens:3}:item),
   body.map(item=>item.id==='openai-valid'?{...item,protocol:'OtherVendor'}:item),
   body.map(item=>item.id==='openai-valid'?{...item,notes:' '}:item),
   [body[0],{...body[1],id:'openai-valid'}],
   [],
  ]){
   list=bad;await panel.getByRole('button',{name:'载入响应契约场景'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();
   await page.waitForFunction(()=>!document.querySelector('[aria-label="响应契约场景清单"]'));
  }
  list=body;await panel.getByRole('button',{name:'载入响应契约场景'}).click();await panel.getByText(new RegExp(LOAD_PREFIX)).waitFor();
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/ai-response-scenarios',hold);
  await panel.getByRole('button',{name:'载入响应契约场景'}).click();await panel.getByText('正在载入响应契约场景…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消响应契约等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/ai-response-scenarios',hold);
  await panel.getByRole('button',{name:'载入响应契约场景'}).click();await panel.getByText(new RegExp(LOAD_PREFIX)).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'AI response panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS AI response contract ${live?'actual local HTTP':'injected'}: server-evaluated fixtures, rejection codes, no live-call claim and cancel.`);
}finally{await browser.close();}
