import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
const ctx=vm.createContext({});
function load(a,b){const start=src.indexOf(a);assert.ok(start>=0);vm.runInContext(src.slice(start,src.indexOf(b,start)),ctx);}
load('  function obligationsForAction(', '  function workflowDependencyIssue(');
load('  function assertMaterialReady(', '  function recordMaterialOutput(');
load('  function listTurnPaperRefs(', '  var init_turnPaperScope');
load('  function getTurnPaperScopeFromRequest(', '  var init_requestTurnPaperScope');
load('  function dedupePaperContexts(', '  function readTextFile2(');
const items=new Map([1,2].map(id=>[id,{id,libraryID:1,key:'KEY'+id}]));
const request={libraryID:1,classifiedIntent:{paperTargetIntent:'active',semantic:{reading:{coverage:'exhaustive'}}},turnPaperScope:{papers:[{paper:{itemId:1,libraryID:1,contextItemId:101},roles:['active']},{paper:{itemId:2,libraryID:1,contextItemId:102},roles:['selected']}]}};
const gateway={getItem:id=>items.get(id),listPaperContexts:r=>r.turnPaperScope.papers.map(e=>e.paper)};
const output={id:'paper_analysis_answer',afterActions:[0],sourceActionIndexes:[0],requiredEvidence:'body'};
request.actionContract={id:'contract',obligations:[{id:'read',sourceActionIndex:0,operation:'read_full'}]};
request.actionProgress={contractId:'contract',obligations:[{obligationId:'read',status:'fulfilled'}]};
request.documentReadObservations=[{issuer:'zotero_host',libraryID:1,itemKey:'KEY1',capabilities:['body']}];
// The actual old gate rejects an otherwise completed read with a captured active paper.
const old=fs.readFileSync(new URL('./fixtures/original-llmforzotero.js',import.meta.url),'utf8');
const start=old.indexOf('  function assertMaterialReady(');assert.ok(start>=0);
vm.runInContext(old.slice(start,old.indexOf('  function recordMaterialOutput(',start)).replace('function assertMaterialReady(','function oldAssertMaterialReady('),ctx);
assert.throws(()=>ctx.oldAssertMaterialReady(request,output,gateway),/frozen paper sources.*unresolved/);
assert.doesNotThrow(()=>ctx.assertMaterialReady(request,output,gateway));
// Reuse the full reader's captured scope and require actual host body evidence.
request.documentReadObservations[0].itemKey='KEY2';
assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/Read the requested source/);
request.documentReadObservations[0].itemKey='KEY1';
request.documentReadObservations[0].capabilities=['metadata'];
assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/Read the requested source/);
request.documentReadObservations[0].capabilities=['body'];
request.actionProgress.obligations[0].status='pending';
assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/prerequisite/);
request.actionProgress.obligations[0].status='fulfilled';
items.get(1).deleted=true;
assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/unavailable/);
items.get(1).deleted=false;
for(const target of ['added','all_visible']){
 request.classifiedIntent.paperTargetIntent=target;
 assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/Read the requested source/);
 request.documentReadObservations.push({issuer:'zotero_host',libraryID:1,itemKey:'KEY2',capabilities:['body']});
 assert.doesNotThrow(()=>ctx.assertMaterialReady(request,output,gateway));
 request.documentReadObservations.pop();
}
request.classifiedIntent.paperTargetIntent='active';
request.actionContract.obligations[0].targetSelectors=[{kind:'item_id',value:2}];
assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/Read the requested source/);
delete request.actionContract.obligations[0].targetSelectors;
// Mutation boundaries must never fall back to active paper scope.
request.actionContract.obligations[0].operation='move_to_collection';
assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/frozen paper sources.*unresolved/);
request.actionContract.obligations[0].targetBoundary={frozenTargetIds:[2]};
assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/Read the requested source/);
request.actionContract.obligations[0]={id:'read',sourceActionIndex:0,operation:'read_full'};
request.turnPaperScope.papers=[];
assert.throws(()=>ctx.assertMaterialReady(request,output,gateway),/unresolved/);
console.log('PASS: real old gate reproduces failure; fixed gate uses actual full-reader resolver. Active/added/all/explicit scopes; missing/wrong body evidence, prerequisites, deleted/unresolved sources; mutation boundaries stay strict. Zotero records simulated.');
