import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
function fn(name,next){const a=src.indexOf('  function '+name+'(');assert.ok(a>=0);return src.slice(a,src.indexOf('  function '+next+'(',a));}
let selected='A';
const bindings=new Map(), owners=new Map(), controllers=new Map();
const ctx=vm.createContext({hostBindings:bindings,getSelectedTabID:()=>selected,
 buildHostIdentity:b=>`${b.tabID}:${b.paper}`,isRequestOwner:(k,id)=>owners.get(k)===id,
 getCancelledRequestId:()=>0,getAbortController2:k=>controllers.get(k),
 requireCurrentPanelOwnership:(body,item)=>bindings.get(body)?.paper===item.id,
 isPanelWebChatMode:()=>false});
vm.runInContext(fn('capturePanelOperationLease','isPanelOperationLeaseCurrent')+fn('isPanelOperationLeaseCurrent','logOwnershipVerdict')+fn('notifyProviderDispatch','createOwnershipFencedProviderDispatch'),ctx);
const jobs=['A','B','C'].map((id,i)=>{const body={querySelector:()=>({dataset:{handlersInitialized:true}})};bindings.set(body,{generation:1,tabID:id,paper:i+1});owners.set(i+1,i+10);controllers.set(i+1,new AbortController());return {id,body,item:{id:i+1},key:i+1,requestId:i+10};});
for(const job of jobs){selected=job.id;job.lease=ctx.capturePanelOperationLease(job.body,{allowBackground:true});}
selected='elsewhere';
// Evaluate the production send continuation predicate, including cancellation and scope checks.
const predicate=src.match(/const requestIsActive = \(conversationKey2\) => ([^;]+);/)[1];
function active(job){Object.assign(ctx,{thisRequestId:job.requestId,ownershipLease:job.lease,body:job.body,item:job.item});return vm.runInContext(`(conversationKey2 => ${predicate})(${job.key})`,ctx);}
for(const job of jobs){assert.equal(active(job),true);assert.equal(ctx.notifyProviderDispatch(job.body,{},job.item,job.lease),true);}
selected='A';const foregroundLease=ctx.capturePanelOperationLease(jobs[0].body);selected='B';
assert.equal(ctx.isPanelOperationLeaseCurrent(foregroundLease),false,'navigation-sensitive operations retain focus fence');
bindings.get(jobs[2].body).generation++;
assert.equal(active(jobs[2]),false,'rebound panel cannot continue');bindings.get(jobs[2].body).generation--;
bindings.get(jobs[2].body).paper=999;
assert.equal(active(jobs[2]),false,'paper identity mismatch cannot continue');bindings.get(jobs[2].body).paper=3;
controllers.get(2).abort();assert.equal(active(jobs[1]),false,'explicit cancellation still works');
const start=src.indexOf('        async runTurnExclusive(callback) {');
const method=src.slice(start,src.indexOf('        onNotification(',start));
const queue=vm.runInNewContext(`new (class {turnQueue=Promise.resolve(); ${method}})()`);
let releaseA;const holdA=new Promise(r=>releaseA=r);const sequence=[],results=new Map();
const pending=jobs.map(job=>queue.runTurnExclusive(async()=>{
  if(!active(job))return;
  sequence.push('start:'+job.id);
  if(job.id==='A')await holdA;
  results.set(job.key,'Summary for '+job.id);
  sequence.push('end:'+job.id);
}));
await new Promise(r=>setImmediate(r));assert.deepEqual(sequence,['start:A']);
releaseA();await Promise.all(pending);
assert.deepEqual(sequence,['start:A','end:A','start:C','end:C']);
assert.equal(results.get(1),'Summary for A');assert.equal(results.get(3),'Summary for C');assert.equal(results.has(2),false);
await assert.rejects(queue.runTurnExclusive(async()=>{throw new Error('one turn failed');}));
assert.equal(await queue.runTurnExclusive(async()=> 'next still runs'),'next still runs');
assert.equal((src.match(/capturePanelOperationLease\([^\n]+allowBackground: true/g)||[]).length,4);
console.log('PASS: background A/B/C dispatch; explicit B cancel; per-paper results; FIFO execution; failed job releases queue; host identity/generation fences; other operations still require selected tab. UI and model are simulated; production lease, send predicate, dispatch and queue code executed.');
