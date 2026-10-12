// Department case-record template and validator.
// The template is never pre-filled with a result: every row starts as 未执行, and a "通过"/"失败" row
// must carry an evidence reference. Automation can fill 执行者=自动 rows, but 部门 rows stay for humans.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {navRoutes} from '../src/frontend/src/nav.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Same source of truth as the built app: the injected build id, else the current commit.
function currentBuildId(){
 const injected=(process.env.PROTOTYPE_BUILD_ID||'').trim();
 if(injected)return injected;
 try{return execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()||'<构建标识>'}catch{return '<构建标识>'}
}
const records=path.join(root,'artifacts','prototype');
const templatePath=path.join(records,'case-records-template.csv');
const columns=['route','caseId','buildId','executor','mode','startedAt','expected','actual','result','evidence','feedbackId','retestVersion'];
const results=['未执行','通过','失败','阻塞','不适用'];
// '未指定' keeps an unexecuted row from claiming who ran it; it must be replaced once a result is recorded.
const executors=['未指定','自动','开发','部门'];
const modes=['模拟','本机Demo','真实只读'];

function quote(value){const text=String(value??'');return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text}
function toCsv(rows){return `${[columns.join(','),...rows.map(row=>columns.map(column=>quote(row[column])).join(','))].join('\n')}\n`}
// Quote-aware parser: embedded commas, quotes and newlines must survive a round trip.
export function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 const source=text.replace(/^\uFEFF/,'');
 for(let index=0;index<source.length;index++){
  const character=source[index];
  if(quoted){
   if(character==='"'){if(source[index+1]==='"'){field+='"';index++}else quoted=false}
   else field+=character;
   continue;
  }
  if(character==='"'){if(field.length)throw new Error('引号只能出现在字段开头');quoted=true;continue}
  if(character===','){row.push(field);field='';continue}
  if(character==='\n'){row.push(field);rows.push(row);row=[];field='';continue}
  if(character==='\r')continue;
  field+=character;
 }
 if(quoted)throw new Error('存在未闭合的引号');
 if(field.length||row.length){row.push(field);rows.push(row)}
 return rows.filter(line=>line.some(cell=>cell.trim().length>0));
}
export function validateRecords(text,{knownCases,knownRoutes,buildId}){
 const errors=[];
 let rows;
 try{rows=parseCsv(text)}catch(error){return {errors:[`CSV 解析失败：${error.message}`],total:0,counted:{}}}
 if(rows.length<1)return {errors:['文件为空'],total:0,counted:{}};
 const header=rows[0].map(cell=>cell.trim());
 for(const column of columns)if(!header.includes(column))errors.push(`缺少必需列：${column}`);
 if(errors.length)return {errors,total:0,counted:{}};
 const index=Object.fromEntries(header.map((column,position)=>[column,position]));
 const seen=new Set(),counted={};
 for(const [offset,line] of rows.slice(1).entries()){
  const number=offset+2;
  const value=column=>line[index[column]]??'';
  const caseId=value('caseId').trim(),route=value('route').trim(),result=value('result').trim(),executor=value('executor').trim(),mode=value('mode').trim();
  if(!knownRoutes.includes(route))errors.push(`第${number}行：未知路由 ${route||'(空)'}`);
  if(!knownCases.includes(caseId))errors.push(`第${number}行：未在验收清单中定义的用例 ${caseId||'(空)'}`);
  if(!results.includes(result))errors.push(`第${number}行：结果只能是 ${results.join('/')}`);
  if(!executors.includes(executor))errors.push(`第${number}行：执行者只能是 ${executors.join('/')}`);
  if(!modes.includes(mode))errors.push(`第${number}行：模式只能是 ${modes.join('/')}`);
  if(!value('buildId').trim())errors.push(`第${number}行：必须记录构建标识`);
  else if(buildId&&value('buildId').trim()!==buildId)errors.push(`第${number}行：构建标识与当前构建不一致（${value('buildId').trim()} ≠ ${buildId}）`);
  if(result==='通过'||result==='失败'){if(!value('evidence').trim())errors.push(`第${number}行：结果为“${result}”时必须填写证据引用`)}
  if(result==='不适用'){if(!value('expected').trim()&&!value('actual').trim())errors.push(`第${number}行：不适用必须写明范围依据（预期或实际列）`)}
  if(result!=='未执行'&&!value('startedAt').trim())errors.push(`第${number}行：已执行的行必须填写执行时间`);
  if(executor==='部门'&&result==='通过'&&!value('feedbackId').trim())errors.push(`第${number}行：部门判定通过必须有关联反馈编号`);
  if(result!=='未执行'&&executor==='未指定')errors.push(`第${number}行：已执行的行必须填写执行者`);
  const key=`${route}|${caseId}`;
  if(seen.has(key))errors.push(`第${number}行：重复的 ${key}`);
  seen.add(key);
  counted[result]=(counted[result]??0)+1;
 }
 // A file that silently marks everything as 未执行 is valid; automation must not invent 通过 rows.
 return {errors,total:rows.length-1,counted};
}
function templateRows(buildId){
 const rows=[];
 const summaryPath=path.join(records,'scope-summary.json');
 if(!existsSync(summaryPath))throw new Error('缺少 artifacts/prototype/scope-summary.json；请先运行 scripts/prototype-scope-map.mjs');
 const summary=JSON.parse(readFileSync(summaryPath,'utf8'));
 for(const row of summary.rows)
  for(const caseId of row.cases)
   rows.push({route:row.route,caseId,buildId,executor:'未指定',mode:'模拟',startedAt:'',expected:'',actual:'',result:'未执行',evidence:'',feedbackId:'',retestVersion:''});
 assert.ok(rows.length>0,'模板必须至少包含一条记录');
 return rows;
}
function selfTest(){
 const knownCases=['UI-01','UI-02'],knownRoutes=['/','/assets'],buildId='demo-build';
 const base={route:'/',caseId:'UI-01',buildId,executor:'未指定',mode:'模拟',startedAt:'',expected:'',actual:'',result:'未执行',evidence:'',feedbackId:'',retestVersion:''};
 assert.deepEqual(validateRecords(toCsv([base]),{knownCases,knownRoutes,buildId}).errors,[]);
 const failing=[
  [{...base,result:'通过'},'必须填写证据引用'],
  [{...base,result:'通过',executor:'开发',evidence:'截图1',startedAt:'2026-10-10 09:00'},null],
  [{...base,result:'阻塞'},'已执行的行必须填写执行者'],
  [{...base,result:'通过',evidence:'截图1'},'必须填写执行时间'],
  [{...base,result:'通过',executor:'部门',evidence:'截图1',startedAt:'2026-10-10 09:00'},'必须有关联反馈编号'],
  [{...base,result:'通过',executor:'部门',evidence:'截图1',startedAt:'2026-10-10 09:00',feedbackId:'FB-1'},null],
  [{...base,result:'部门已确认'},'结果只能是'],
  [{...base,executor:'客户'},'执行者只能是'],
  [{...base,mode:'生产'},'模式只能是'],
  [{...base,buildId:'other'},'构建标识与当前构建不一致'],
  [{...base,caseId:'UI-99'},'未在验收清单中定义'],
  [{...base,route:'/nope'},'未知路由'],
  [{...base,result:'不适用'},'必须写明范围依据'],
  [{...base,result:'阻塞',executor:'开发',startedAt:'2026-10-10 09:00'},null],
  [{...base,result:'阻塞'},'必须填写执行时间'],
  [{...base,executor:'部门',result:'通过',evidence:'录像',feedbackId:'FB-1',startedAt:'2026-10-10 09:00'},null],
  [{...base,executor:'部门',result:'通过',evidence:'录像',startedAt:'2026-10-10 09:00'},'必须有关联反馈编号'],
 ];
 for(const [row,expected] of failing){
  const errors=validateRecords(toCsv([row]),{knownCases,knownRoutes,buildId}).errors;
  if(expected===null)assert.deepEqual(errors,[],`应通过：${JSON.stringify(row)}`);
  else assert.ok(errors.some(error=>error.includes(expected)),`应报“${expected}”：${errors.join('；')}`);
 }
 assert.ok(validateRecords(toCsv([base,{...base}]),{knownCases,knownRoutes,buildId}).errors.some(error=>error.includes('重复')));
 // Quoting round trip: commas, quotes and newlines inside free text must not corrupt the columns.
 const quoted={...base,expected:'a,b',actual:'引号"内"容',evidence:'多行\n证据'};
 const parsed=parseCsv(toCsv([quoted]));
 assert.equal(parsed.length,2);assert.equal(parsed[1][columns.indexOf('expected')],'a,b');assert.equal(parsed[1][columns.indexOf('actual')],'引号"内"容');assert.equal(parsed[1][columns.indexOf('evidence')],'多行\n证据');
 assert.deepEqual(validateRecords(toCsv([quoted]),{knownCases,knownRoutes,buildId}).errors,[]);
 assert.ok(validateRecords('route,caseId\n/,UI-01\n',{knownCases,knownRoutes,buildId}).errors.some(error=>error.includes('缺少必需列')));
 console.log('PASS case-record validator self-test: required columns, constrained values, evidence rules and CSV quoting.');
}
// Only act as a CLI when executed directly; importing this module must not run the commands.
const isEntryPoint=process.argv[1]!==undefined&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
const args=isEntryPoint?process.argv.slice(2):[];
if(args.includes('--self-test'))selfTest();
else if(args.includes('--template')){
 const buildId=currentBuildId();
 mkdirSync(records,{recursive:true});
 writeFileSync(templatePath,toCsv(templateRows(buildId)),'utf8');
 console.log(`PASS case-record template written: ${templatePath} (${readFileSync(templatePath,'utf8').trim().split('\n').length-1} rows, all 未执行)`);
}else if(args.includes('--check')){
 const target=args[args.indexOf('--check')+1];
 if(!target||!existsSync(target))throw new Error('用法：node scripts/prototype-case-records.mjs --check <csv路径>');
 const checklist=readFileSync(path.join(root,'docs','部门原型验收清单.md'),'utf8');
 const knownCases=[...new Set([...checklist.matchAll(/UI-\d{2}/g)].map(match=>match[0]))].sort();
 const check=validateRecords(readFileSync(target,'utf8'),{knownCases,knownRoutes:navRoutes.map(item=>item.to),buildId:currentBuildId()});
 if(check.errors.length){console.error(`发现 ${check.errors.length} 个问题：`);for(const error of check.errors.slice(0,20))console.error(`- ${error}`);process.exit(1)}
 console.log(`PASS case records: ${check.total} 行通过校验（${Object.entries(check.counted).map(([key,value])=>`${key} ${value}`).join('、')}）；未判定部门通过。`);
}else if(isEntryPoint)console.log('用法：--template | --check <csv> | --self-test');
