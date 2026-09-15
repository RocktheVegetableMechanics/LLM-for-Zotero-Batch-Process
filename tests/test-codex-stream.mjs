import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const patched=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
const original=fs.readFileSync(new URL('./fixtures/original-llmforzotero.js',import.meta.url),'utf8');
function section(src,name){const a=src.indexOf('  // src/'+name+'.ts');assert.ok(a>=0);return src.slice(a,src.indexOf('\n  // ',a+10));}
function load(src){
  const blocks=['agent/model/responsesShared','agent/model/codexResponses','agent/model/completion'].map(n=>section(src,n)).join('\n');
  let nextBody, wire=[];
  const ctx=vm.createContext({TextDecoder,Error,
    resolveRequestAuthState:async()=>({}),
    assertCodexDirectModelAvailable:()=>{},
    sanitizeCodexDirectReasoningConfig:(_m,r)=>r,
    CODEX_DIRECT_RESPONSES_URL:'https://chatgpt.com/backend-api/codex/responses',
    postWithReasoningFallback:async p=>{wire.push(p.buildPayload());return {body:nextBody};},
    buildReasoningPayload:()=>({extra:{},omitTemperature:true}),
    buildPromptCachePayloadHints:()=>({}),
    buildResponsesFunctionTools:t=>t,
    normalizeProviderCompletion:(_r,o)=>({status:o?.responseStatus==='incomplete'?'incomplete':'complete'}),
    stringifyUnknown:v=>typeof v==='string'?v:'',
    groupToolContinuationMessages:messages=>({toolMessages:messages.filter(m=>m.role==='tool'),followupUserMessages:messages.filter(m=>m.role==='user')}),
  });
  for(const name of new Set(blocks.match(/\binit_\w+(?=\()/g)))ctx[name]=()=>{};
  const argsStart=src.indexOf('  function parseToolCallArguments(');
  vm.runInContext(src.slice(argsStart,src.indexOf('  function createFallbackToolCallId(',argsStart)),ctx);
  vm.runInContext('var __esm=o=>{let done=false;return()=>{if(!done){done=true;Object.values(o)[0]();}};};'+blocks+'\ninit_codexResponses();',ctx);
  return {ctx,setBody:b=>{nextBody=b;},wire};
}
const enc=new TextEncoder();
function stream(events,error){let index=0,released=false;return {getReader(){return {async read(){if(index<events.length)return {done:false,value:enc.encode('data: '+JSON.stringify(events[index++])+'\n\n')};if(error)throw error;return {done:true};},releaseLock(){released=true;}};},get released(){return released;}};}
const delta={type:'response.output_text.delta',delta:'partial answer'};
const partialCall={type:'response.output_item.added',item:{type:'function_call',id:'fc1',call_id:'call1',name:'file_write',arguments:'{"path":'}};
const params={request:{authMode:'codex_auth',model:'gpt-5.6-sol'},messages:[{role:'user',content:'Explain the already read paper.'}],tools:[]};
const old=load(original);old.setBody(stream([delta],new Error('Error in input stream')));
await assert.rejects(new old.ctx.CodexResponsesAgentAdapter().runStep(params),/Error in input stream/);
const fixed=load(patched),adapter=new fixed.ctx.CodexResponsesAgentAdapter();
const broken=stream([delta,partialCall],new Error('Error in input stream'));fixed.setBody(broken);
let seen='';const result=await adapter.runStep({...params,onTextDelta:t=>{seen+=t;}});
assert.equal(seen,'partial answer');assert.equal(result.kind,'incomplete');assert.equal(result.reason,'stream_interrupted');
assert.equal(result.calls,undefined);assert.equal(result.assistantMessage.content,'');assert.ok(broken.released);
assert.ok(!adapter.conversationItems.some(i=>i.type==='function_call'));
assert.equal(adapter.conversationItems[0].content,params.messages[0].content);

// The next step consumes the existing recovery instruction and prior input,
// while no partial tool arguments enter the retry request.
fixed.setBody(stream([{type:'response.output_text.delta',delta:'Complete recovered answer.'}]));
const resumed=await adapter.runStep({...params,continuationMessages:[{role:'user',content:result.recoveryInstruction}]});
assert.equal(resumed.kind,'final');assert.equal(resumed.text,'Complete recovered answer.');
assert.ok(!JSON.stringify(fixed.wire.at(-1)).includes('"fc1"'));
assert.ok(fixed.wire.at(-1).input.some(i=>i.content===result.recoveryInstruction));

for(const [error,signal] of [[new Error('Error in input stream'),{aborted:true}],[new Error('Unexpected transport failure'),undefined],[Object.assign(new Error('Cancelled'),{name:'AbortError'}),undefined]]){
  fixed.setBody(stream([],error));
  await assert.rejects(new fixed.ctx.CodexResponsesAgentAdapter().runStep({...params,signal}),e=>e===error);
}
fixed.setBody(stream([{type:'response.output_item.done',item:{type:'function_call',id:'done1',call_id:'call2',name:'paper_read',arguments:'{"mode":"overview"}'}}]));
const tool=await new fixed.ctx.CodexResponsesAgentAdapter().runStep(params);
assert.equal(tool.kind,'tool_calls');assert.equal(tool.calls.length,1);
console.log(JSON.stringify({passed:true,original:'reader error aborts run',patched:'recoverable incomplete step',retry:'complete answer',partialToolCalls:'discarded',completedToolCall:'preserved',cancellationAndUnknownErrors:'propagated',liveNetworkRecoveryTest:false},null,2));
