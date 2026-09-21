import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const s=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
const context=vm.createContext({isCodexAppServerConversationRequest:()=>true,getCodexRuntimeModelPref:()=> 'global-model',getCodexReasoningModePref:()=> 'max'});
for (const [start,end] of [['  function buildCodexReasoningConfig(', '  var init_catalogSelection'],['  function buildCodexAppServerReasoningConfig(', '  var init_reasoning'],['  function resolveEffectiveRequestConfig(', '\n  function ']]) {
 const a=s.indexOf(start);const b=s.indexOf(end,a+start.length);vm.runInContext(s.slice(a,b),context);
}
const auto=context.resolveEffectiveRequestConfig({authMode:'codex_app_server',model:'gpt-5.6-sol',reasoningMode:'auto'});
assert.equal(auto.model,'gpt-5.6-sol');assert.equal(auto.reasoning,undefined,'batch Auto must not inherit global Max');
const high=context.resolveEffectiveRequestConfig({authMode:'codex_app_server',model:'gpt-5.6-sol',reasoningMode:'high'});
assert.equal(high.reasoning.effort,'high');assert.equal(high.authMode,'codex_app_server');assert.equal(high.providerProtocol,'codex_responses');
const ordinary=context.resolveEffectiveRequestConfig({authMode:'codex_app_server',model:'gpt-5.6-luna'});assert.equal(ordinary.reasoning.effort,'max','ordinary chat still follows its existing preference');
console.log('PASS: actual effective request config preserves selected batch model and explicit Auto/High; ordinary chat defaults unchanged.');
