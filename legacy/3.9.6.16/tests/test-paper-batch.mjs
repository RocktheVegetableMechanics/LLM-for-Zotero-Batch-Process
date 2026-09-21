import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
const start=src.indexOf('  function createRetryablePersistence('),end=src.indexOf('  // src/modules/contextPanel/setupHandlers/controllers/sendFlowController.ts',start);
const batchCode=src.slice(start,end);
const tick=()=>new Promise(r=>setImmediate(r));
const ctx=vm.createContext({});vm.runInContext(batchCode,ctx);
const jobs=[1,2,3].map(id=>({id,state:'queued'}));let release;const hold=new Promise(r=>release=r);const seen=[];
const q=ctx.createSequentialPaperBatch(jobs,async j=>{seen.push(j.id);if(j.id===1)await hold;if(j.id===2)throw new Error('failure');return {status:'completed'};});
const running=q.run();await tick();q.pause();release();await running;assert.deepEqual(seen,[1]);assert.equal(jobs[1].state,'queued');await q.run();assert.deepEqual(seen,[1,2,3]);assert.equal(jobs[1].state,'failed');assert.equal(jobs[2].state,'completed');assert.equal(q.paused,false);
const rejected=[1,2,3].map(id=>({id,state:'queued'}));
await ctx.createSequentialPaperBatch(rejected,async j=>({status:j.id===1?'blocked':j.id===2?'cancelled':'completed',detail:j.id===1?'Document not finalized':''})).run();
assert.deepEqual(rejected.map(j=>j.state),['blocked','cancelled','completed']);
assert.equal(rejected[0].detail,'Document not finalized');
const pending=[1,2].map(id=>({id,state:'queued'}));let stopRelease;const stopHold=new Promise(r=>stopRelease=r);const stopped=ctx.createSequentialPaperBatch(pending,async()=>{await stopHold;return {status:'cancelled'};});const stopRun=stopped.run();stopped.stop();stopRelease();await stopRun;assert.equal(pending[1].state,'cancelled');await stopped.run();assert.equal(pending[1].state,'cancelled');

// Execute the actual batch dialog and worker adapter with a small DOM/runtime harness.
class El {constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.events={};this.value='';this.isConnected=true;}append(...els){this.children.push(...els);}replaceChildren(...els){this.children=els;}addEventListener(n,f){this.events[n]=f;}remove(){this.isConnected=false;}scrollIntoView(){} setAttribute(){} }
const doc={createElementNS:(_,tag)=>new El(tag),documentElement:new El('root')};
const papers=[1,2,3,4].map(id=>({id,libraryID:1,isRegularItem:()=>true,getField:()=>`Paper ${id}`}));
const attachments=papers.map(p=>({id:100+p.id,parentID:p.id}));
const items=new Map([...papers,...attachments].map(p=>[p.id,p]));let selected=[papers[0],papers[1],papers[0]],key=200,releaseFirst;const firstHold=new Promise(r=>releaseFirst=r);const calls=[];
let custom=[{id:'summary',label:'My_Summary_Prompt',prompt:'Summarize the full paper.'}], overrides={},labels={},deleted=[],order=[];
const observers=new Map();let observerId=0;
const prefs={registerObserver:(key,callback)=>{observers.set(++observerId,{key,callback});return observerId;},unregisterObserver:id=>observers.delete(id)};
const refresh=async()=>{for(const observer of observers.values())observer.callback();await tick();};
// Deliberately omit structuredClone: the add-on script sandbox does not supply DOM globals.
const windowListeners = new Map();
doc.defaultView={MutationObserver:class {observe(){} disconnect(){}},
 addEventListener(name,fn){if(!windowListeners.has(name))windowListeners.set(name,new Set());windowListeners.get(name).add(fn);},
 removeEventListener(name,fn){windowListeners.get(name)?.delete(fn);}};
let runtimeModel='gpt-5.6-luna',runtimeEffort='max';
const remembered=new Map();let omitSavedAnswer=false;
const runtime=vm.createContext({
 IOUtils:{exists:async()=>false,makeDirectory:async()=>{},writeUTF8:async()=>{}},
 getCodexRuntimeModelPref:()=>runtimeModel,getCodexReasoningModePref:()=>runtimeEffort,
 setCodexRuntimeModelPref:m=>runtimeModel=m,setCodexReasoningModePref:e=>runtimeEffort=e,
 getConfiguredCodexAppServerBinaryPath:()=>'',
 loadCodexAppServerModelCatalog:async()=>({models:[{model:'gpt-5.6-luna',displayName:'Luna',supportedReasoningEfforts:['low','max']},{model:'gpt-5.6-sol',displayName:'Sol',supportedReasoningEfforts:['low','high']}]}),
 CODEX_APP_SERVER_GROUP_ID:'codex_app_server',CODEX_APP_SERVER_PROVIDER_LABEL:'Codex',DEFAULT_TEMPERATURE:1,CODEX_REASONING_OPTIONS:['low','max'],
 touchCodexConversationTitle:async()=>{},setLastUsedCodexPaperConversationKey:(l,p,k)=>remembered.set(p,k),activeCodexPaperConversationByPaper:new Map(),buildCodexPaperStateKey:(l,p)=>`${l}:${p}`,
 PERSISTED_HISTORY_LIMIT:100,loadStoredConversationByKey:async key=>{const call=calls.find(c=>c.item.id===key);return call?[{role:'user',text:call.question},...omitSavedAnswer?[]:[{role:'assistant',text:'Stored answer'}]]:[]},
 Zotero:{Profile:{dir:"test-profile"},Prefs:prefs,getMainWindow:()=>({document:doc}),getActiveZoteroPane:()=>({getSelectedItems:()=>selected}),Items:{get:id=>items.get(id)}},
 config:{prefsPrefix:'test'},MAX_EDITABLE_SHORTCUTS:20,migrateShortcutDefaultsIfNeeded:()=>{},getShortcutOverrides:()=>overrides,getShortcutLabelOverrides:()=>labels,getDeletedShortcutIds:()=>deleted,getShortcutOrder:()=>order,
 normalizeShortcutOrderForVisibleIds:(saved,ids)=>[...saved.filter(id=>ids.includes(id)),...ids.filter(id=>!saved.includes(id))],
 loadShortcutText:async file=>fs.readFileSync(new URL('../src/extension/content/shortcuts/'+file,import.meta.url),'utf8'),
 getCustomShortcuts:()=>custom,resolveConversationBaseItem:p=>p,
 createCodexPaperConversation:async(libraryID,paperID)=>({conversationKey:++key}),
 createCodexPaperPortalItem:(paper,conversationKey)=>({id:conversationKey,paperID:paper.id}),ensureConversationLoaded:async()=>{},getConversationKey:item=>item.id,
 bindStandalonePanelHost:()=>{},clearPanelHostBinding:()=>{},getAbortController2:()=>null,
 resolvePaperContextRefFromItem:paper=>({itemId:paper.id,contextItemId:paper.id+100}),
 sendQuestion:async opts=>{calls.push(opts);if(calls.length===1)await firstHold;return {status:'completed'};}
});
for(const [a,b] of [['  function formatCodexReasoningLabel(', '  var init_catalogSelection'],['  function formatCodexAppServerReasoningLabel(', '  var DEFAULT_MODEL_LIST_LIMIT'],['  function buildCodexAppServerReasoningConfig(', '  var init_reasoning']]) {
 const start=src.indexOf(a);assert.ok(start>=0,a);vm.runInContext(src.slice(start,src.indexOf(b,start)),runtime);
}
vm.runInContext(batchCode,runtime);
const builtinStart=src.indexOf('      BUILTIN_SHORTCUT_FILES = [');
vm.runInContext('var '+src.slice(builtinStart,src.indexOf('];',builtinStart)+2).trim(),runtime);
const loaderStart=src.indexOf('  async function loadConfiguredShortcutChoices(');
vm.runInContext(src.slice(loaderStart,src.indexOf('  async function renderShortcuts(',loaderStart)),runtime);
const profile={authMode:'codex_app_server',model:'gpt-5.6-luna',reasoning:{level:'max'}};
runtime.openSequentialPaperBatch(profile);
await tick();
const panel=doc.documentElement.children[0];const button=text=>panel.children.find(e=>e.tag==='button'&&e.textContent===text);
const presets=panel.children.find(e=>e.tag==='select'),prompt=panel.children.find(e=>e.tag==='textarea');
assert.deepEqual(presets.children.slice(1,6).map(e=>e.textContent),['Summarize','Key Points','Methodology','Limitations','Diagram']);
assert.equal(observers.size,5);
custom.push({id:'new',label:'New Prompt',prompt:'New body'});await refresh();
assert.ok(presets.children.some(e=>e.value==='new'),'new chat shortcut automatically appears');
presets.value='summarize';presets.events.change();
assert.ok(prompt.value.length>20,'actual built-in prompt loaded');
overrides.summarize='Edited summary';labels.summarize='Renamed summary';order=['new','summarize'];await refresh();
assert.equal(prompt.value,'Edited summary');assert.equal(presets.children[1].value,'new');
prompt.value='My draft';overrides.summarize='Another update';await refresh();assert.equal(prompt.value,'My draft','manual draft preserved');
deleted=['summarize'];await refresh();assert.equal(presets.value,'');assert.equal(prompt.value,'My draft');
presets.value='summary';presets.events.change();
assert.equal(panel.children.find(e=>e.tag==='textarea').value,'Summarize the full paper.');
button('开始 / 继续').events.click();await tick();assert.equal(calls.length,1);
custom[0].prompt='Changed after submission';await refresh();assert.equal(prompt.value,'Summarize the full paper.','submitted prompt preserved');
selected=[];profile.model='changed-after-submit';releaseFirst();await tick();await tick();
assert.equal(calls.length,2);assert.equal(calls[0].item.paperID,1);assert.equal(calls[1].item.paperID,2);
assert.equal(calls[0].contextSource.contextItem.parentID,1);assert.equal(calls[1].contextSource.contextItem.parentID,2);
assert.equal(calls[1].question,'Summarize the full paper.');assert.equal(calls[1].model,'gpt-5.6-luna');assert.equal(calls[1].reasoning.effort,'max');
assert.equal(remembered.get(1),calls[0].item.id);assert.equal(remembered.get(2),calls[1].item.id);
assert.notEqual(calls[0].item.id,calls[1].item.id);
assert.equal(panel.children.find(e=>e.tag==='ol').children.length,2,'selection deduplicated');
assert.ok(panel.children.find(e=>e.tag==='ol').children.every(e=>e.children[0].textContent.startsWith('完成')));
button('收起').events.click();
assert.equal(panel.children.find(e=>e.tag==='textarea').style.display,'none','inline display cannot override collapsed state');
runtime.openSequentialPaperBatch(profile,papers[2]);
assert.equal(panel.children.find(e=>e.tag==='ol').hidden,false,'repeated entry expands queue');
assert.equal(panel.children.find(e=>e.tag==='textarea').style.display,'block');
assert.equal(panel.children.find(e=>e.tag==='ol').children.length,3,'new paper appended');
runtime.openSequentialPaperBatch(profile,papers[2]);
assert.equal(panel.children.find(e=>e.tag==='ol').children.length,3,'repeated entry deduplicated');
panel.children.find(e=>e.tag==='ol').children[2].children[1].events.click();
assert.equal(panel.children.find(e=>e.tag==='ol').children.length,2,'queued item removed');
selected=[papers[2]];button('添加文库选中项').events.click();
button('开始 / 继续').events.click();await tick();await tick();
assert.equal(calls.length,3,'completed batch can accept more work');assert.equal(calls[2].model,'gpt-5.6-luna','later addition keeps confirmed model');
const dropZone=panel.children.find(e=>e.tag==='div'&&e.textContent?.startsWith('把 Zotero'));
dropZone.events.drop({preventDefault(){},stopPropagation(){},dataTransfer:{getData:()=> '4,4,garbage'}});
assert.equal(panel.children.find(e=>e.tag==='ol').children.length,4,'valid dropped papers appended once');
const settings=panel.children.find(e=>e.tag==='div'&&e.children.some(c=>c.tag==='select'));
const [modelSelect,reasoningSelect]=settings.children.filter(e=>e.tag==='select');
modelSelect.value='gpt-5.6-sol';modelSelect.events.change();
assert.equal(runtimeModel,'gpt-5.6-sol');assert.equal(reasoningSelect.value,'auto','unsupported Max reconciled for Sol');
reasoningSelect.value='high';reasoningSelect.events.change();assert.equal(runtimeEffort,'high');
omitSavedAnswer=true;await button('开始 / 继续').events.click();
assert.equal(calls[3].model,'gpt-5.6-sol');assert.equal(calls[3].reasoning.effort,'high');
assert.ok(panel.children.find(e=>e.tag==='ol').children[3].children[0].textContent.startsWith('失败'),'missing stored answer must not be marked completed');
let row=panel.children.find(e=>e.tag==='ol').children[3];row.children.find(e=>e.textContent==='重新排队').events.click();
assert.ok(row.children.some(e=>e.textContent==='打开论文会话'),'failed attempt remains accessible');
omitSavedAnswer=false;reasoningSelect.value='auto';reasoningSelect.events.change();
await button('开始 / 继续').events.click();assert.equal(calls[4].reasoning,undefined);assert.equal(calls[4].reasoningMode,'auto');
assert.ok(panel.children.find(e=>e.tag==='ol').children[3].children[0].textContent.startsWith('完成'));
const liveJobs=[{id:1,state:'queued'}],liveSeen=[];let liveRelease;const liveHold=new Promise(r=>liveRelease=r);
const liveQueue=ctx.createSequentialPaperBatch(liveJobs,async j=>{liveSeen.push(j.id);if(j.id===1)await liveHold;return {status:'completed'};});
const liveRun=liveQueue.run();liveJobs.push({id:2,state:'queued'});liveRelease();await liveRun;
assert.deepEqual(liveSeen,[1,2],'running queue consumes later additions in order');
await button('关闭').events.click();assert.equal(observers.size,0,'observers released on close');
// Stop has a real effect even before the first Start; requeue permits explicit restart.
runtime.openSequentialPaperBatch(profile,papers[0]);await tick();
const next=doc.documentElement.children.at(-1),nextButton=text=>next.children.find(e=>e.tag==='button'&&e.textContent===text);
nextButton('停止当前及后续').events.click();assert.ok(next.children.find(e=>e.tag==='ol').children[0].children[0].textContent.startsWith('已停止'));
next.children.find(e=>e.tag==='ol').children[0].children.find(e=>e.textContent==='重新排队').events.click();
await nextButton('开始 / 继续').events.click();assert.ok(next.children.find(e=>e.tag==='ol').children[0].children[0].textContent.startsWith('完成'));
await nextButton('关闭').events.click();
// Exercise the dialog's real Stop handler while sendQuestion is still pending.
selected=[papers[0],papers[1]];let abortCalls=0,releaseActive;
runtime.sendQuestion=async opts=>{calls.push(opts);return await new Promise(resolve=>releaseActive=resolve);};
runtime.getAbortController2=()=>({abort(){abortCalls++;releaseActive({status:'cancelled',detail:'explicit stop'});}});
runtime.openSequentialPaperBatch(profile);await tick();
const active=doc.documentElement.children.at(-1),activeButton=text=>active.children.find(e=>e.tag==='button'&&e.textContent===text);
assert.equal(activeButton('新建队列').disabled,true,'pending tasks cannot be discarded by starting a new queue');
const activeRun=activeButton('开始 / 继续').events.click();await tick();
const beforeDoubleClick=calls.length;await activeButton('开始 / 继续').events.click();assert.equal(calls.length,beforeDoubleClick,'double start does not duplicate a running request');
activeButton('停止当前及后续').events.click();await activeRun;
assert.equal(abortCalls,1,'Stop calls the active conversation abort controller');
assert.ok(active.children.find(e=>e.tag==='ol').children.every(e=>e.children[0].textContent.startsWith('已停止')));
activeButton('新建队列').events.click();
assert.equal(active.children.find(e=>e.tag==='ol').children.length,0);
assert.equal(active.children.find(e=>e.tag==='textarea').disabled,false,'new batch can choose a new prompt');
await activeButton('关闭').events.click();
// Closing the main host must abort an active request as well as remove observers.
runtime.openSequentialPaperBatch(profile,papers[0]);await tick();
const unloading=doc.documentElement.children.at(-1);
const unloadRun=unloading.children.find(e=>e.textContent==='开始 / 继续').events.click();await tick();
const abortsBeforeUnload=abortCalls;
for(const fn of [...windowListeners.get('unload')]) {
 if(windowListeners.get('unload').has(fn))fn();
}
await unloadRun;
assert.equal(abortCalls,abortsBeforeUnload+1,'main host unload does not remove its abort listener before dispatch');
assert.equal(observers.size,0,'unload releases shortcut observers');
assert.equal(windowListeners.get('unload').size,0,'unload releases window listeners');
console.log('PASS: whole-job FIFO, pause/resume, failure isolation, stop pending; dialog preset expansion, selected-paper snapshot/deduplication, independent conversations, per-paper attachments, frozen prompt/model/reasoning. Zotero/model and DOM are simulated.');

