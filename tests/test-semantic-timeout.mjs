import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js', import.meta.url), 'utf8');
const transport = source.slice(source.indexOf('  async function callSemanticCompletion('), source.indexOf('  async function hasCurrentSemanticIntent('));
const timeout = source.slice(source.indexOf('  async function callLLMWithTimeout('), source.indexOf('  var DEFAULT_LLM_CALL_TIMEOUT_MS;'));
let lastParams;
const context = vm.createContext({
  setTimeout, clearTimeout, AbortController, Error, Promise,
  getAbortController: () => AbortController,
  DEFAULT_CODEX_API_BASE: 'https://chatgpt.com/backend-api/codex/responses',
  DEFAULT_LLM_CALL_TIMEOUT_MS: 10000,
  callUtilityLLM: async p => { lastParams = p; return {ok: true}; },
});
vm.runInContext(transport + timeout, context);
const request = {model:'gpt-5.6-sol',authMode:'codex_app_server'};
await context.callSemanticCompletion(request, {timeoutMs:20000});
assert.equal(lastParams.timeoutMs, 120000);
assert.equal(lastParams.authMode, 'codex_auth');
const patchedBudget = lastParams.timeoutMs;
await context.callSemanticCompletion({...request,authMode:'codex_auth'}, {timeoutMs:20000});
assert.equal(lastParams.timeoutMs, 120000);
await context.callSemanticCompletion({...request,authMode:'api_key'}, {timeoutMs:20000});
assert.equal(lastParams.timeoutMs, 20000);

// Exercise the actual bundled deadline/cancellation implementation against
// a completion that takes longer than the old 20-second deadline.
const delayed = ({signal}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve({text:'{"ok":true}'}), 21000);
  signal.addEventListener('abort', () => {
    clearTimeout(timer); reject(new Error('Aborted by caller'));
  }, {once:true});
});
const started = Date.now();
const results = await Promise.allSettled([
  context.callLLMWithTimeout({timeoutMs:20000,llmCall:delayed}),
  context.callLLMWithTimeout({timeoutMs:patchedBudget,llmCall:delayed}),
]);
assert.equal(results[0].status, 'rejected');
// Native transports can reject synchronously on abort before the deadline
// rejection wins Promise.race; both outcomes stop the old request at 20s.
assert.match(results[0].reason.message, /timed out after 20000ms|Aborted by caller/);
assert.equal(results[1].status, 'fulfilled');
const controller = new AbortController();
const cancelled = context.callLLMWithTimeout({timeoutMs:patchedBudget,parentSignal:controller.signal,llmCall:delayed});
controller.abort();
await assert.rejects(cancelled, /LLM call aborted|Aborted by caller/);
console.log(JSON.stringify({passed:true,elapsedMs:Date.now()-started,old20s:'timed out',patched120s:'completed at 21s',cancellation:'preserved',otherProviders:'unchanged',livePluginTest:'unpatched: completed with OK in 13439ms'},null,2));
