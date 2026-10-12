import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'src/frontend/package.json'));
const {chromium}=require('playwright-core');
const executablePath=process.env.BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const base=process.env.PROTOTYPE_URL || 'http://127.0.0.1:5173';
const findings=[];
try{
 await page.goto(base,{waitUntil:'networkidle'});
 const routes=await page.locator('nav a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
 for(const route of routes){
  await page.goto(base+route,{waitUntil:'networkidle'});
  const issues=await page.evaluate(()=>{
   const visible=el=>el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0;
   const result=[];
   for(const el of document.querySelectorAll('button,input,textarea,select')){
    if(!visible(el))continue;
    const name=el.getAttribute('aria-label') || el.getAttribute('title') || el.labels?.[0]?.textContent || el.textContent;
    if(!name?.trim())result.push({type:'missing-accessible-name',tag:el.tagName});
   }
   if(document.querySelectorAll('main').length!==1)result.push({type:'main-landmark-count'});
   return result;
  });
  if(issues.length)findings.push({route,issues});
 }
 const out=path.join(root,'artifacts/prototype');mkdirSync(out,{recursive:true});
 writeFileSync(path.join(out,'basic-a11y-results.json'),JSON.stringify({passed:findings.length===0,pages:routes.length,findings,scope:'Basic DOM labels and landmark check only; not WCAG certification'},null,2));
 console.log(JSON.stringify({pages:routes.length,findings},null,2));
 if(findings.length)process.exitCode=1;
}finally{await browser.close();}
