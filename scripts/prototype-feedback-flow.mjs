import{createRequire}from'node:module';import{existsSync}from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const require=createRequire(path.join(root,'src/frontend/package.json'));const{chromium}=require('playwright-core');
const executablePath=process.env.BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);const browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage();const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const row={id:'FB-import-demo',department:'IT 部门',module:'提示词治理',text:'导入回归模拟反馈',priority:'一般',state:'待评审',createdAt:'2026-10-10T01:00:00.000Z'};
const upload=async rows=>{await page.getByRole('button',{name:'导入 JSON',exact:true}).click();await page.getByLabel('选择反馈 JSON 文件',{exact:true}).setInputFiles({name:'mock.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,mode:'mock',exportedAt:new Date().toISOString(),feedback:rows}))});};
try{
 await page.goto(base+'/feedback');await upload([row]);await page.getByRole('button',{name:'确认合并',exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.getByText(row.text,{exact:true}).count(),0);
 await upload([row]);await page.getByRole('button',{name:'确认合并',exact:true}).click();assert.equal(await page.getByText(row.text,{exact:true}).count(),1);
 await upload([{...row,state:'已验收'}]);assert.ok(await page.getByRole('button',{name:'确认合并',exact:true}).isDisabled());await page.getByRole('button',{name:'取消',exact:true}).click();
 await upload([{...row,id:'FB-bad-demo',unexpected:'field'}]);assert.ok(await page.getByRole('button',{name:'确认合并',exact:true}).isDisabled());assert.ok((await page.locator('dialog').innerText()).includes('导入已拒绝'));await page.keyboard.press('Escape');
 await page.reload();assert.equal(await page.getByText(row.text,{exact:true}).count(),1);const summaryBefore=await page.getByRole('region',{name:'反馈评审概览',exact:true}).innerText();await page.getByLabel('反馈关键词搜索',{exact:true}).fill('不存在的关键词');assert.equal(await page.getByRole('region',{name:'反馈评审概览',exact:true}).innerText(),summaryBefore);assert.equal(await page.getByText(row.text,{exact:true}).count(),0);
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON',exact:true}).click();const download=await downloadEvent;
 assert.equal(download.suggestedFilename(),'ops-demo-feedback.json');const stream=await download.createReadStream();assert.ok(stream);const chunks=[];for await(const chunk of stream)chunks.push(chunk);
 const exported=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.equal(exported.schemaVersion,1);assert.equal(exported.mode,'mock');assert.ok(exported.feedback.some(item=>item.id===row.id&&item.text===row.text&&item.state==='待评审'));
 await page.getByRole('button',{name:'清空反馈筛选',exact:true}).click();assert.equal(await page.getByText(row.text,{exact:true}).count(),1);
 await page.getByLabel('反馈部门筛选',{exact:true}).selectOption('财务部门');assert.equal(await page.getByText(row.text,{exact:true}).count(),0);
 await page.getByLabel('反馈部门筛选',{exact:true}).selectOption('IT 部门');await page.getByLabel('反馈关键词搜索',{exact:true}).fill('提示词治理');assert.equal(await page.getByText(row.text,{exact:true}).count(),1);
 await page.getByLabel('反馈优先级筛选',{exact:true}).selectOption('阻塞验收');assert.equal(await page.getByText(row.text,{exact:true}).count(),0);
 await page.getByLabel('反馈优先级筛选',{exact:true}).selectOption('一般');assert.equal(await page.getByText(row.text,{exact:true}).count(),1);
 await page.getByRole('button',{name:'清空反馈筛选',exact:true}).click();assert.equal(await page.getByLabel('反馈优先级筛选',{exact:true}).inputValue(),'全部优先级');
 console.log('PASS feedback import/reload, filters, summary stability and full JSON export while no rows match');
}finally{await browser.close();}
