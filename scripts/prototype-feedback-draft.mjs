import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const KEY_ID='11111111-1111-1111-1111-111111111111';
try{
 const page=await browser.newPage();let posts=0,keys=[],mode='fail';
 const body=draft=>({category:draft.category,message:draft.message,page:draft.page,createdAt:'2026-01-01T00:00:00Z',id:KEY_ID,isDemo:true,isPersistent:false});
 await page.route('**/api/v1/feedback',route=>{posts++;const draft=route.request().postDataJSON();assert.ok(typeof draft.idempotencyKey==='string'&&draft.idempotencyKey.length>0,'missing idempotency key');keys.push(draft.idempotencyKey);
  if(mode==='fail')return route.fulfill({status:400,contentType:'application/problem+json',body:JSON.stringify({isDemo:true,code:'validation_failed'})});
  return route.fulfill({status:mode==='replay'?200:201,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:body(draft)})});});
 await page.goto('http://127.0.0.1:5173/integration');
 const form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交后端演示反馈 · POST /api/v1/feedback'})});
 const confirmation=form.getByRole('checkbox'),submit=form.getByRole('button',{name:'提交演示反馈到后端',exact:true});
 // A rejected attempt keeps the draft and its key, so an explicit retry replays instead of creating a second record.
 await confirmation.check();await submit.click();await form.getByText(/HTTP 400/).waitFor();assert.equal(posts,1);assert.equal(keys.length,1);assert.ok(await submit.isEnabled());assert.equal(await page.getByRole('complementary',{name:'反馈内存回执'}).count(),0);
 mode='replay';await submit.click();await form.getByText('服务器已存在该草稿的记录，本次未重复创建；下方回执为原记录。',{exact:true}).waitFor();assert.equal(posts,2);assert.equal(keys[1],keys[0]);
 const receipt=page.getByRole('complementary',{name:'反馈内存回执'});await receipt.waitFor();assert.equal(await receipt.locator('code').textContent(),KEY_ID);assert.equal(await receipt.locator('time').getAttribute('datetime'),'2026-01-01T00:00:00Z');
 assert.ok(await submit.isDisabled());await confirmation.uncheck();await confirmation.check();assert.ok(await submit.isDisabled());
 await page.setViewportSize({width:390,height:844});assert.ok(await receipt.evaluate(element=>element.scrollWidth<=element.clientWidth));await page.setViewportSize({width:1280,height:720});
 const saved=JSON.parse(await form.locator('pre').textContent());await page.route('**/api/v1/feedback/*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(saved)}));await receipt.getByRole('button',{name:'核对内存记录'}).click();await receipt.getByText(/核对一致/).waitFor();assert.equal(posts,2);
 let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};await page.route('**/api/v1/feedback/*',hold);
 await receipt.getByRole('button',{name:'核对内存记录',exact:true}).click();await receipt.getByText('正在核对内存记录…',{exact:true}).waitFor();assert.equal(await receipt.getByText(/核对一致/).count(),0);await receipt.getByRole('button',{name:'取消核对等待'}).click();await receipt.getByText(/核对等待已取消或超时/).waitFor();assert.ok(await receipt.getByRole('button',{name:'核对内存记录',exact:true}).isEnabled());release();await page.unroute('**/api/v1/feedback/*',hold);await receipt.getByRole('button',{name:'核对内存记录',exact:true}).click();await receipt.getByText(/核对一致/).waitFor();assert.equal(posts,2);
 await page.route('**/api/v1/feedback/*',route=>route.fulfill({status:404,body:'SYNTHETIC_PRIVATE_DIAGNOSTIC'}));await receipt.getByRole('button',{name:'核对内存记录'}).click();await receipt.getByText(/未找到内存记录/).waitFor();assert.ok(!(await page.content()).includes('SYNTHETIC_PRIVATE_DIAGNOSTIC'));assert.equal(posts,2);
 await page.route('**/api/v1/feedback/*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:{id:'wrong'}})}));await receipt.getByRole('button',{name:'核对内存记录'}).click();await receipt.getByText(/核对失败或响应不符/).waitFor();assert.equal(posts,2);
 await form.evaluate(element=>element.requestSubmit());assert.equal(posts,2);
 await form.getByRole('textbox').fill('新的虚构评审草稿');assert.ok(!(await confirmation.isChecked()));assert.ok(await submit.isDisabled());assert.equal(await form.getByText(/契约通过（仅 Demo）/).count(),0);assert.equal(posts,2);
 assert.equal(await receipt.count(),0);assert.equal(await form.getByText('服务器已存在该草稿的记录，本次未重复创建；下方回执为原记录。',{exact:true}).count(),0);
 await confirmation.check();await form.getByRole('combobox').selectOption('bug');assert.ok(!(await confirmation.isChecked()));assert.ok(await submit.isDisabled());assert.equal(posts,2);
 // An edited draft is a new intent: it must not reuse the replayed key.
 mode='created';await confirmation.check();await submit.click();await form.getByText('服务器新建了该反馈记录。',{exact:true}).waitFor();assert.equal(posts,3);assert.notEqual(keys[2],keys[0]);
 // Editing again clears the success lock so the receipt-contract rejections below can be submitted.
 await form.getByRole('textbox').fill('验证回执字段校验');
 for(const invalid of [{message:'wrong synthetic receipt'},{id:'not-a-guid'},{createdAt:'not-a-date'},{category:'unknown'},{message:''}]){
  await page.route('**/api/v1/feedback',route=>route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:{category:'bug',message:'验证回执字段校验',page:'/integration',createdAt:'2026-01-01T00:00:00Z',id:KEY_ID,isDemo:true,isPersistent:false,...invalid}})}));
  await confirmation.check();await submit.click();await form.getByText('feedback 提交结果不符合内存演示契约。',{exact:true}).waitFor();assert.equal(await form.getByText(/契约通过（仅 Demo）/).count(),0);assert.equal(await form.locator('pre').count(),0);
 }
 console.log('PASS feedback draft edits clear old result and require renewed confirmation without automatic submission.');
}finally{await browser.close();}
