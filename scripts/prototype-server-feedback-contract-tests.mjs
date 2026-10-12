import assert from 'node:assert/strict';
import {validServerFeedback as valid,validServerFeedbackList as list} from '../src/frontend/src/server-feedback-contract.ts';
const item={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',category:'bug',message:'synthetic',page:null,createdAt:'2026-01-01T00:00:00Z',isDemo:true,isPersistent:false};
assert.equal(valid({...item,internalDiagnostic:'synthetic'}),false);assert.equal(valid(Object.create(item)),false);
assert.ok(valid(item));assert.ok(list([]));assert.ok(list([item]));
for(const key of Object.keys(item)){const copy={...item};delete copy[key];assert.equal(valid(copy),false,key);}
for(const value of [null,[],{},true,'text'])assert.equal(valid(value),false);
for(const change of [{message:''},{message:' '},{message:'x'.repeat(2001)},{page:'//foreign'},{page:'x'},{category:'unknown'},{isDemo:false},{isPersistent:true},{createdAt:'invalid'},{id:'bad'}])assert.equal(valid({...item,...change}),false);
assert.ok(valid({...item,message:'x'.repeat(2000)}));assert.equal(list([item,{...item,id:item.id.toUpperCase()}]),false);
const rows=Array.from({length:200},(_,i)=>({...item,id:i.toString(16).padStart(8,'0')+'-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}));assert.ok(list(rows));assert.equal(list([...rows,{...item}]),false);
assert.equal(item.message,'synthetic');console.log('PASS feedback pure contract: missing fields, invalid types, bounds, capacity and case-insensitive duplicate IDs.');
