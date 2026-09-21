import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const s=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
function extract(a,b){const i=s.indexOf(a);assert.ok(i>=0);return s.slice(i,s.indexOf(b,i+a.length));}
const c=vm.createContext({__esm:()=>()=>{}});
vm.runInContext(extract('  // src/agent/contracts/actionEvaluation.ts','  // src/'),c);
const receipt={operation:'zotero_script_execute',executionAuthority:'external_runtime',status:'observed',verification:'execution_only',proofDomain:'execution',requestedTargets:[],appliedTargets:[],alreadySatisfiedTargets:[]};
for(const n of [9,12]) {
 const outcome=c.evaluatePreparedActionContract({},Array.from({length:n},()=>({...receipt})));
 assert.equal(outcome.state,'unverified');assert.match(outcome.correction,/Do not repeat scripts/);
 assert.match(outcome.failure,new RegExp(n+' calls'));
}
const verified={...receipt,verification:'verified'};
const contract={version:4,intent:{semantic:{materialOutputs:[{id:'answer'}]}},obligations:[]};
const pending=c.evaluatePreparedActionContract({actionContract:contract},[verified]);
assert.equal(pending.state,'pending');assert.match(pending.correction,/submit_document/);
assert.equal(c.evaluatePreparedActionContract({actionContract:{...contract,intent:{semantic:{}}}},[verified]).state,'satisfied');
// Reconciliation must require the same obligation AND concrete target coverage.
const old={...receipt,obligationId:'one',requestedTargets:['item:1']};
const proof={...verified,executionAuthority:'host',obligationId:'one',appliedTargets:['item:1']};
const req={actionContract:{...contract,intent:{semantic:{}}}};
assert.equal(c.evaluatePreparedActionContract(req,[old,proof]).state,'satisfied');
assert.equal(c.evaluatePreparedActionContract(req,[old,{...proof,obligationId:'two'}]).state,'unverified');
assert.equal(c.evaluatePreparedActionContract(req,[old,{...proof,appliedTargets:['item:2']}]).state,'unverified');
// Exercise the actual card, including pending -> delivered and disposal.
class Element {
 constructor(){this.dataset={};this.isConnected=true;this.children=[];this.listeners={};}
 append(...x){this.children.push(...x);} replaceChildren(){this.children=[];this.textContent='';}
 addEventListener(k,f){this.listeners[k]=f;}
}
let status='pending',timers=[],rendered=0,ready=0;
const document={documentId:'d',visibleMarkdown:'the complete answer',title:'Test',validation:{integrityValidated:true}};
const ui=vm.createContext({cardDisposers:new Map(),loadPlanDocument:async()=>document,loadPlanDocumentOutbox:async()=>({status}),setTimeout:f=>(timers.push(f),f),clearTimeout:f=>{timers=timers.filter(x=>x!==f);},createDocumentCardLayout:()=>({header:new Element(),actions:new Element(),content:new Element()}),createDocumentActionButton:()=>new Element(),renderPlanDocumentContent:()=>rendered++,renderCoverageInspector:()=>null,renderPlanDocumentFigures:()=>null});
vm.runInContext(extract('  function renderPlanDocumentCard(', '  function disposeAgentTrace('),ui);
const root=ui.renderPlanDocumentCard({doc:{createElement:()=>new Element()},documentId:'d',onReady:()=>ready++});
const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
assert.equal(rendered,0);assert.equal(timers.length,1);
status='delivered';await timers.shift()();assert.equal(rendered,1);assert.equal(ready,1);
status='pending';const other=ui.renderPlanDocumentCard({doc:{createElement:()=>new Element()},documentId:'d'});await settle();
ui.cardDisposers.get(other)();assert.equal(timers.length,0);
status='pending';ui.renderPlanDocumentCard({doc:{createElement:()=>new Element()},documentId:'d'});await settle();
for(let i=1;i<30;i++)await timers.shift()();
assert.equal(timers.length,0,'polling is bounded');
assert.equal(root.children.length>0,true);
console.log('PASS: 9/12 script recovery, independently verified target coverage, material obligations, pending-to-delivered document rendering, disposal and bounded polling.');
let delivered=0;
const outbox={documentId:'d',visibleMarkdown:document.visibleMarkdown,status:'pending',messageTimestamp:1};
const publication=vm.createContext({listPlanDocumentOutboxForConversation:async()=>[outbox],loadPlanDocument:async()=>document,getPlannedDocumentOrigin:()=>null,Zotero:{DB:{executeTransaction:async f=>f()}},markPlanDocumentDelivered:async()=>{outbox.status='delivered';delivered++;}});
vm.runInContext(extract('  async function deliverPendingPlanDocumentMessage(', '  var init_publication'),publication);
const params={conversationKey:'test',documentId:'d',visibleMarkdown:document.visibleMarkdown,messageTimestamp:1};
assert.equal(await publication.deliverPendingPlanDocumentMessage({...params,visibleMarkdown:document.visibleMarkdown+'\nverification warning'}),null);
assert.equal((await publication.deliverPendingPlanDocumentMessage(params)).documentId,'d');
await publication.deliverPendingPlanDocumentMessage(params);assert.equal(delivered,1);
console.log('PASS: exact persisted document delivery; altered content cannot mark delivery; repeated publication is idempotent.');

