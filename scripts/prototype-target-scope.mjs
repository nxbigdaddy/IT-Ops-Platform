import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const PASS='清单通过：6/6 个目标均为文档保留地址或合成主机名；未解析DNS、未连接。';
const FAIL='目标清单校验失败或响应不符；不显示诊断正文，不回退本地判断。';
const data=(accepted,errors)=>({configurationValid:errors.length===0,errors,accepted,connectionAttempted:false,executionAllowed:false,syntheticOnly:true,notes:'窗口参数只做区间与关系校验；不代表已排期、已限速或已接入。'});
let body=null,posts=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/connector-target-scope'))posts++;});
 else await page.route('**/api/v1/connector-target-scope',route=>{posts++;const posted=route.request().postDataJSON();const hosts=posted.hosts??[];assert.equal(posted.intervalSeconds,300);assert.equal(posted.concurrency,2);assert.equal(posted.timeoutSeconds,30);const payload=body??data(hosts.length,[]);return route.fulfill({status:payload.configurationValid?200:400,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:payload})})});
 await page.goto(base+'/connectors');
 const panel=page.getByRole('region',{name:'采集目标清单校验'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(posts,0);
 assert.ok((await panel.getByLabel('合成目标清单').inputValue()).includes('app-01.invalid'));
 await panel.getByRole('button',{name:'校验目标清单'}).click();await panel.getByText(PASS,{exact:true}).waitFor();assert.equal(posts,1);
 assert.equal(await panel.getByText('所有 6 个目标均通过规则，采集窗口参数也在允许区间内；仍未连接任何目标。',{exact:true}).count(),1);
 if(!live){
  await panel.getByLabel('合成目标清单').fill('app-01.invalid\nreal-host.internal\napp-01.invalid\n192.0.2.10');
  body=data(2,[{index:1,field:'host',code:'not_documentation_target'},{index:2,field:'host',code:'duplicate'}]);
  await panel.getByRole('button',{name:'校验目标清单'}).click();await panel.getByText('清单未通过：2/4 个可用，2 处问题。未连接任何目标。',{exact:true}).waitFor();
  const table=panel.getByLabel('目标清单问题');assert.equal(await table.locator('tbody tr').count(),2);
  assert.ok((await table.innerText()).includes('仅允许文档保留地址'),await table.innerText());assert.ok((await table.innerText()).includes('重复项'));
  assert.ok((await table.innerText()).includes('real-host.internal'),'the rejected line must be shown for correction');
  for(const bad of [{...data(6,[]),notes:' '},{...data(6,[]),accepted:1,errors:[{index:0,field:'intervalSeconds',code:'not_a_code'}]},
   {...data(6,[]),syntheticOnly:false},{...data(6,[]),connectionAttempted:true},{...data(6,[]),executionAllowed:true},
   {...data(6,[]),accepted:2},{...data(6,[]),accepted:7},{...data(3,[{index:9,field:'host',code:'duplicate'}])},
   {...data(3,[{index:0,field:'other',code:'duplicate'}])},{...data(3,[{index:0,field:'host',code:'unknown_code'}])},
   {...data(3,[{index:0,field:'host',code:'duplicate'}]),configurationValid:true},
   {...data(3,[{index:0,field:'host',code:'duplicate'}]),errors:'none'},
  ]){
   body=bad;await panel.getByRole('button',{name:'校验目标清单'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  }
  body=null;await panel.getByLabel('合成目标清单').fill('app-01.invalid');
  await panel.getByRole('button',{name:'校验目标清单'}).click();await panel.getByText('清单通过：1/1 个目标均为文档保留地址或合成主机名；未解析DNS、未连接。',{exact:true}).waitFor();
  await panel.getByLabel('合成目标清单').fill(Array.from({length:51},(_,index)=>`host-${index}.invalid`).join('\n'));
  assert.ok(await panel.getByRole('button',{name:'校验目标清单'}).isDisabled());
  await panel.getByRole('button',{name:'填入示例清单'}).click();assert.ok(await panel.getByRole('button',{name:'校验目标清单'}).isEnabled());
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/connector-target-scope',hold);
  await panel.getByRole('button',{name:'校验目标清单'}).click();await panel.getByText('正在校验目标清单…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消目标校验等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/connector-target-scope',hold);
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'target scope panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS connector target scope ${live?'actual local HTTP':'injected'}: documentation-only policy, per-line issues, bounds and cancel.`);
}finally{await browser.close();}
