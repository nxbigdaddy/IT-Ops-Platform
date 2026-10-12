import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const notes='按关键字与函数名单筛查，且不做语法解析；通过只表示未命中已知写入特征，不能证明语句无副作用。';
const ok=(kind,length)=>({configurationValid:true,errors:[],statementKind:kind,length,executionAttempted:false,connectionAttempted:false,readOnlyOnly:true,notes});
const bad=(code,kind='select',length=12)=>({configurationValid:false,errors:[{field:'statement',code}],statementKind:kind,length,executionAttempted:false,connectionAttempted:false,readOnlyOnly:true,notes});
const FAIL='监控查询预检失败或响应不符；不显示诊断正文，不回退为本地判断。';
let body=ok('select',42),posts=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/monitored-query-preflight'))posts++;});
 else await page.route('**/api/v1/monitored-query-preflight',route=>{posts++;const posted=route.request().postDataJSON();assert.equal(typeof posted.statement,'string');const payload=body;return route.fulfill({status:payload.configurationValid?200:400,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:payload})})});
 await page.goto(base+'/database');
 const panel=page.getByRole('region',{name:'监控查询白名单预检'});await panel.waitFor();
 assert.equal(await panel.locator('.panel-note').count(),0);assert.equal(posts,0);
 assert.ok(await panel.getByText(/不做语法解析/).count()>=1);
 await panel.getByRole('button',{name:'检查查询规则'}).click();
 if(live){await panel.getByText(/查询规则通过|查询被拒绝/).waitFor();}
 else{
  await panel.getByText(/查询规则通过：识别为 SELECT/).waitFor();assert.equal(posts,1);
  assert.ok((await panel.innerText()).includes('执行：否 · 连接：否'));
  body=bad('multiple_statements');await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText(/查询被拒绝：不允许多条语句/).waitFor();
  body=bad('write_keyword_into');await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText(/命中写入关键字：INTO/).waitFor();
  body=bad('write_function_pg_terminate_backend');await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText(/命中已知写入函数：pg_terminate_backend/).waitFor();
  body=bad('not_read_only','unsupported');await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText(/仅允许 SELECT \/ SHOW \/ WITH…SELECT/).waitFor();
  body=bad('comments_not_allowed');await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText(/不允许注释/).waitFor();
  for(const invalid of [
   {...ok('select',10),executionAttempted:true},
   {...ok('select',10),connectionAttempted:true},
   {...ok('select',10),readOnlyOnly:false},
   {...ok('select',10),notes:' '},
   {...ok('select',10),statementKind:'other'},
   {...ok('select',9999)},
   {...ok('select',10),configurationValid:false},
   {...bad('multiple_statements'),configurationValid:true},
   {...bad('multiple_statements'),errors:[{field:'other',code:'x'}]},
   {...bad('multiple_statements'),errors:[{field:'statement',code:''}]},
  ]){
   body=invalid;await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();
   assert.equal(await panel.locator('.panel-note').count(),0);
  }
  body=ok('show',11);await panel.getByRole('button',{name:'填入允许示例'}).click();await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText(/识别为 SHOW/).waitFor();
  await panel.getByRole('button',{name:'填入应拒绝示例'}).click();assert.ok((await panel.getByLabel('计划只读语句').inputValue()).includes('into'));
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/monitored-query-preflight',hold);
  await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText('正在检查查询规则…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消查询预检等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/monitored-query-preflight',hold);
  body=ok('select',10);await panel.getByRole('button',{name:'检查查询规则'}).click();await panel.getByText(/查询规则通过/).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'monitored query panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS monitored query allowlist ${live?'actual local HTTP':'injected'}: classification, write screening, invalid shapes and cancel.`);
}finally{await browser.close();}
