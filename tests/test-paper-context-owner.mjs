import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
const paper={id:1,isAttachment:()=>false,getField:()=> 'Paper A'},own={id:101,parentID:1},other={id:102,parentID:2};let active=other;
const ctx=vm.createContext({resolveActiveNoteSession:()=>null,isGlobalPortalItem:()=>false,resolveDisplayConversationKind:()=> 'paper',getSelectedSupportedAttachmentFromLibraryPane:()=>null,resolveContextAttachmentSupport:()=>false,getActiveContextAttachmentFromTabs:()=>active,resolveConversationBaseItem:p=>p,getContextItemLabel:p=>String(p.id),getFirstPdfChildAttachment:()=>own,getBestSupportedContextAttachment:async()=>own,sanitizeText2:s=>s});
for(const name of ['resolveContextSourceItemBase','resolveContextSourceItemAsyncBase']){
 const prefix=name.includes('Async')?'  async function ':'  function ';const start=src.indexOf(prefix+name+'(');let end=src.indexOf('\n  function ',start+prefix.length);const asyncEnd=src.indexOf('\n  async function ',start+prefix.length);if(asyncEnd>=0&&asyncEnd<end)end=asyncEnd;vm.runInContext(src.slice(start,end),ctx);
 active=other;assert.equal((await ctx[name](paper)).contextItem.id,101,'unrelated active tab must not leak');
 active=own;assert.equal((await ctx[name](paper)).contextItem.id,101,'own active attachment retained');
}
console.log('PASS: synchronous and asynchronous context resolution reject another paper’s active PDF.');
