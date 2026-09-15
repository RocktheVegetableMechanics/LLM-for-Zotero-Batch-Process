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
const bad=structuredClone(good);bad.selections[0].evidenceText='historical paraphrase';
async function run(responses){
  const prompts=[];
  ctx.callSemanticCompletion=async(_,p)=>{prompts.push(p.prompt);return {ok:true,text:JSON.stringify(responses[prompts.length-1])};};
  const result=await vm.runInContext('new SemanticIntentService()',ctx).interpret(request,[skill]);
  return {result,prompts};
}
const recovered=await run([bad,good]);
assert.equal(recovered.result.degraded,false);
assert.equal(recovered.prompts.length,2);
assert.match(recovered.prompts[1],/Skill binding correction/);
assert.match(recovered.prompts[1],/evidenceText_or_occurrence_not_in_current_user_message/);
assert.equal(recovered.result.classifiedIntent.writeDisposition,'required');
assert.equal(recovered.result.classifiedIntent.actionIntents[0].operation,good.actionIntents[0].operation);
const failed=await run([bad,bad]);
assert.equal(failed.result.classifiedIntent,null);
assert.equal(failed.result.failureStage,'skill_binding');
assert.equal(failed.result.rejectedResponses.length,2);
assert.equal(failed.prompts.length,2);
assert.match(failed.result.failureDetail,/evidenceText_or_occurrence/);
const withoutSkill=structuredClone(good);withoutSkill.selections=[];
assert.equal((await run([bad,withoutSkill])).result.classifiedIntent.writeDisposition,'required');
assert.equal((await run([good])).prompts.length,1);
console.log('PASS: binding rejection cases; exact Chinese evidence and occurrences; any-context compatibility; corrected retry preserves write action; repeated failure stays unauthorized; optional skill omission preserves work. Model responses and external runtime dependencies are mocked.');
request.contexts=['note'];
const unavailable=await run([good,good]);
assert.equal(unavailable.result.degraded,false);
assert.equal(unavailable.result.skillIds.length,0);
assert.equal(unavailable.result.classifiedIntent.writeDisposition,'required');
assert.equal(unavailable.result.classifiedIntent.actionIntents[0].operation,'file_write');
request.contexts=['single-paper'];
const budgets=[];
ctx.logUtilityLLMFailure=()=>{};
ctx.callSemanticCompletion=async(_,p)=>{
 budgets.push(p.jsonBudget);
 return budgets.length===1?{ok:false,reason:'empty'}:{ok:true,text:JSON.stringify(good)};
};
const emptyRecovered=await vm.runInContext('new SemanticIntentService()',ctx).interpret(request,[skill]);
assert.equal(emptyRecovered.degraded,false);assert.deepEqual(budgets,[5000,10000]);
console.log('PASS: unavailable optional skill is never activated; valid actions preserved after correction; empty final JSON retries with expanded budget.');
