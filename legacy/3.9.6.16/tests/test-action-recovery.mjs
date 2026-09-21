import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
const modules=['agent/contracts/operationCatalog','agent/contracts/workflowDependencies','agent/services/libraryMutation/canonicalJson','agent/model/actionIntent','agent/model/semanticDecisions','agent/model/semanticIntentSchema','agent/model/semanticWorkflowReuse','agent/skills/routingTypes','agent/model/semanticSkillRouting','agent/model/semanticIntentService'];
const ctx=vm.createContext({
  resolveSkillRequestContext:r=>({availableContexts:r.contexts||['single-paper']}),
  sha256Text:async s=>createHash('sha256').update(s).digest('hex'),
  extractJsonObject3:JSON.parse,
  getNotesDirectoryConfig:()=>({}), semanticInputDigest:async()=> 'test',
  buildSemanticPrompt:()=> 'ORIGINAL CURRENT REQUEST',
  getOriginalAgentPermissionMode:()=> 'default', isSkillContextEligible:()=>true,
  getInterpretedTurnPapers:()=>[{}], validatedWorkflowReuse:()=>{},
  SEMANTIC_COMPLETION_TIMEOUT_MS:20000,
});
vm.runInContext('var __esm=o=>{let done=false;return()=>{if(!done){done=true;Object.values(o)[0]();}};};',ctx);
for(const name of modules){
  const marker='  // src/'+name+'.ts', start=source.indexOf(marker);
  assert.ok(start>=0,name);
  const code=source.slice(start,source.indexOf('\n  // ',start+marker.length));
  for(const [,dep] of code.matchAll(/\b(init_\w+)\(\);/g)) if(!(dep in ctx)) ctx[dep]=()=>{};
  vm.runInContext(code,ctx);
}
vm.runInContext('init_semanticIntentService();',ctx);
const skill={id:'review',contexts:['single-paper'],instruction:'Review',version:1};
const request={userText:'请审阅这篇论文，再审阅方法。',turnPaperScope:{papers:[],collections:[]},model:'test'};
const selection={skillId:'review',requestedScope:'single-paper',evidenceText:'审阅'};
async function validate(sel,scopes=['single-paper'],req=request,skills=[skill]){
  const rejections=[];
  const valid=await ctx.validateSkillRouterSelections({response:{selections:[sel],requestedScopes:scopes},request:req,skills,rejections});
  return {valid,rejections};
}
assert.equal((await validate(selection)).valid[0].evidence.start,1);
assert.equal((await validate({...selection,occurrence:1})).valid[0].evidence.start,9);
for(const [sel,scopes,req,reason] of [
  [{...selection,skillId:'invented'},['single-paper'],request,'unknown_or_ineligible_skill_id'],
  [selection,[],request,'scope_not_in_requestedScopes'],
  [{...selection,requestedScope:'note'},['note'],request,'scope_incompatible_with_skill'],
  [selection,['single-paper'],{...request,contexts:['note']},'scope_unavailable_in_current_context'],
  [{...selection,evidenceText:'review paper'},['single-paper'],request,'evidenceText_or_occurrence_not_in_current_user_message'],
  [{...selection,occurrence:2},['single-paper'],request,'evidenceText_or_occurrence_not_in_current_user_message'],
]){
  const result=await validate(sel,scopes,req);
  assert.equal(result.valid.length,0);assert.equal(result.rejections[0].reason,reason);
}
assert.equal((await validate(selection,['single-paper'],{...request,contexts:[]},[{...skill,contexts:['any']}])).valid.length,1);
const fixture={"responses":[{"value":{"schemaVersion":1,"taskKind":"write","queryLanguage":"zh","requestedScopes":["single-paper"],"selections":[],"retrievalIntent":"none","deliverableIntent":"document","documentKind":"report","paperTargetIntent":"active","externalSearchIntent":"none","wantedSections":[],"writeDisposition":"required","actionIntents":[{"operation":"file_write","coverage":"one","targetKind":"items","scopeRole":"destination","reviewPreference":"default","parameters":{"filePath":"C:\\Diagnostic\\notes.md"},"contentFrom":"analysis-report"}],"decisions":{"constraints":[],"noteDestination":"file","conversationOnly":false,"responseIntent":"receipt","generationMode":"reason","reading":{"source":"provided_context","coverage":"overview"},"literature":"none","bulk":false,"continuation":"revise","questions":[],"assumptions":["Save the prior answer as a local file."],"materialOutputs":[{"id":"analysis-report","description":"Format the prior answer with a supplied introductory sentence.","afterActions":[],"sourceActionIndexes":[],"requiredEvidence":"body"}]}}}]};
const good=structuredClone(fixture.responses[0].value);
delete good.decisions.workflowReuse;
good.selections=[selection];good.requestedScopes=['single-paper'];

ctx.logUtilityLLMFailure=()=>{};
async function interpret(responses,signal){
 const calls=[];
 ctx.callSemanticCompletion=async(_,p)=>{calls.push(p);const r=responses[Math.min(calls.length-1,responses.length-1)];return r.ok===false?r:{ok:true,text:JSON.stringify(r)};};
 const result=await vm.runInContext('new SemanticIntentService()',ctx).interpret(request,[skill],{signal});
 return {result,calls};
}
const cases=[
 ['coverage',v=>v.actionIntents[0].coverage='exhaustive'],
 ['operation',v=>v.actionIntents[0].operation='paper_read'],
 ['wantedSections',v=>v.wantedSections=['figures']],
 ['parameters',v=>v.actionIntents[0].parameters.figureLabels=['1']],
 ['scope',v=>v.actionIntents[0].scope={kind:'paper'}],
 ['targetKind',v=>v.actionIntents[0].targetKind='paper'],
 ['writeDisposition',v=>v.writeDisposition='none'],
 ['documentKind',v=>v.documentKind='analysis'],
 ['retrievalIntent',v=>v.retrievalIntent='analyze'],
 ['dependsOn',v=>v.actionIntents[0].dependsOn=[-1]],
 ['constraints',v=>v.actionIntents[0].constraints={includeFigures:true}],
 ['targetSelectors',v=>v.actionIntents[0].targetSelectors=[]],
];
for(const [field,mutate] of cases){
 const bad=structuredClone(good);mutate(bad);const issues=[];
 assert.equal(ctx.parseClassifiedTurnIntent(JSON.stringify(bad),issues),null);
 assert.ok(issues.some(x=>x.includes(field)),field+': '+issues.join(';'));
 const recovered=await interpret([bad,good]);
 assert.equal(recovered.result.degraded,false,field);
 assert.equal(recovered.calls.length,2);
 assert.ok(recovered.calls[1].prompt.includes(field));
 assert.equal(recovered.result.classifiedIntent.actionIntents[0].parameters.filePath,good.actionIntents[0].parameters.filePath);
 assert.equal(recovered.result.classifiedIntent.writeDisposition,'required');
}
const invalid=structuredClone(good);invalid.actionIntents[0].coverage='exhaustive';
const twice=await interpret([invalid,invalid,good]);assert.equal(twice.calls.length,3);assert.equal(twice.result.degraded,false);
const late=await interpret([{ok:false,reason:'empty'},invalid,good]);assert.equal(late.calls.length,3);assert.equal(late.result.degraded,false);
const permanent=await interpret([invalid]);assert.equal(permanent.calls.length,3);assert.equal(permanent.result.classifiedIntent,null);assert.match(permanent.result.failureDetail,/actionIntents\[0\].*coverage/);
const aborted=await interpret([good],{aborted:true});assert.equal(aborted.calls.length,0);assert.equal(aborted.result.classifiedIntent,null);
assert.ok(ctx.parseClassifiedTurnIntent(JSON.stringify(good)),'legacy callers do not require diagnostics');
console.log('PASS: 12 action/envelope rejection cases, field-specific recovery, unchanged save target/authority, late action failure recovery, three-call cap, persistent rejection and cancellation. Synthetic model responses; actual production parsers and interpreter.');
