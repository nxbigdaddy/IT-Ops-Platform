import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {navRoutes} from '../src/frontend/src/nav.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checklist=readFileSync(path.join(root,'docs','部门原型验收清单.md'),'utf8');
const mapping=readFileSync(path.join(root,'docs','原型范围与case映射.md'),'utf8');
const caseIds=new Set([...checklist.matchAll(/UI-\d{2}/g)].map(match=>match[0]));
assert.ok(caseIds.size>=30,`checklist case ids look wrong: ${caseIds.size}`);
const rows=[...mapping.matchAll(/^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|/gm)].map(match=>({
  route:match[1].trim(),page:match[2].trim(),cases:[...match[3].matchAll(/UI-\d{2}/g)].map(item=>item[0]),raw:match[3].trim(),
}));
assert.ok(rows.length>0,'no scope rows parsed; keep the table format `| \`/route\` | page | cases |`');
const routes=navRoutes.map(item=>item.to);
assert.equal(new Set(routes).size,routes.length,'duplicate route in nav.ts');
for(const route of routes)assert.ok(rows.some(row=>row.route===route),`route ${route} missing from 原型范围与case映射.md`);
for(const row of rows)
{
  assert.ok(routes.includes(row.route),`scope table lists unknown route ${row.route}`);
  assert.ok(row.page.length>0,`route ${row.route} has no page label`);
  assert.ok(row.raw.length>0,`route ${row.route} has no case column`);
  for(const id of row.cases)assert.ok(caseIds.has(id),`route ${row.route} references unknown case ${id}`);
}
// The checklist must state exactly which routes this batch delivers, so reviewers do not hunt for target
// pages that were excluded. The list is compared with nav.ts as a set, and the stated count must match.
const deliveredBlock=checklist.split('<!-- delivered-routes -->')[1];
assert.ok(deliveredBlock,'checklist must keep the <!-- delivered-routes --> anchor');
const deliveredLine=deliveredBlock.split('\n').find(line=>line.includes('/'))??'';
const delivered=[...deliveredLine.matchAll(/`(\/[A-Za-z0-9_:\/-]*)`/g)].map(match=>match[1]);
assert.equal(new Set(delivered).size,delivered.length,'duplicate route in the delivered-routes line');
assert.deepEqual([...delivered].sort(),[...routes].sort(),'the delivered-routes line must match nav.ts exactly');
// The count is stated on the heading line just above the anchor.
const headingLine=checklist.split('<!-- delivered-routes -->')[0].split('\n').filter(line=>line.trim().length>0).pop()??'';
const statedCount=/共\s*(\d+)\s*条/.exec(headingLine);
assert.ok(statedCount,`the delivered-routes line must state the count, for example 共 ${routes.length} 条`);
assert.equal(Number(statedCount[1]),routes.length,'the stated route count must match nav.ts');
// The checklist points reviewers at scripts and test suites; every named artifact must exist, otherwise the
// coverage table claims evidence that is gone.
const namedScripts=new Set([...checklist.matchAll(/`([a-z0-9-]+\.mjs)`/g)].map(match=>match[1]));
assert.ok(namedScripts.size>=20,`the checklist should name the check scripts: ${namedScripts.size}`);
// A referenced name may also be a packaged material (serve-demo.mjs), which is generated into the zip.
const packageSpec=JSON.parse(readFileSync(path.join(root,'scripts','review-package.json'),'utf8').replace(/^\uFEFF/,''));
const packageMaterials=new Set(packageSpec.required??[]);
for(const script of namedScripts)
  assert.ok(existsSync(path.join(root,'scripts',script))||packageMaterials.has(script),`checklist references missing script ${script}`);
const namedSuites=new Set([...checklist.matchAll(/([A-Za-z][A-Za-z0-9]*(?:Tests|Test))(?=[`/、\s|])/g)].map(match=>match[1]));
assert.ok(namedSuites.size>=10,`the checklist should name the test suites: ${namedSuites.size}`);
const testDir=path.join(root,'tests','backend','OpsPlatform.Api.Tests');
for(const suite of namedSuites){
  const fileName=`${suite}.cs`;
  assert.ok(existsSync(path.join(testDir,fileName)),`checklist references missing test suite ${suite}`);
  assert.ok(readFileSync(path.join(testDir,fileName),'utf8').includes(`class ${suite}`),`${fileName} does not declare class ${suite}`);
}
// The suggested review path on the dashboard must not link to a route that does not exist.
const {reviewPath}=await import('../src/frontend/src/review-path.ts');
assert.ok(reviewPath.length>=5,`review path looks empty: ${reviewPath.length}`);
for(const step of reviewPath){
  assert.ok(routes.includes(step.to),`review path step ${step.label} links to unknown route ${step.to}`);
  assert.ok(step.hint.length>0,`review path step ${step.label} has no hint`);
}
assert.equal(new Set(reviewPath.map(step=>step.label)).size,reviewPath.length,'duplicate review path label');
const covered=new Set(rows.flatMap(row=>row.cases));for(const id of covered)assert.ok(caseIds.has(id));
const excluded=[...caseIds].filter(id=>!covered.has(id)).sort();
assert.ok(excluded.length>0,'a scope table that covers every target case would be misleading without those routes');
// The packaged manifest embeds this summary, so the artifact is refreshed on every verification run.
const summarized=rows.map(row=>({route:row.route,page:row.page,cases:row.cases}));
const outDir=path.join(root,'artifacts','prototype');mkdirSync(outDir,{recursive:true});
writeFileSync(path.join(outDir,'scope-summary.json'),`${JSON.stringify({generatedAt:new Date().toISOString(),pages:routes.length,casesReferenced:covered.size,casesTotal:caseIds.size,excluded,rows:summarized},null,2)}\n`,'utf8');
console.log(`PASS prototype scope map: ${routes.length} routes mapped, ${covered.size}/${caseIds.size} target cases referenced, ${excluded.length} explicitly excluded.`);
