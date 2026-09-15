import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../src/extension/content/scripts/llmforzotero.js',import.meta.url),'utf8');
const original=fs.readFileSync(new URL('./fixtures/original-llmforzotero.js',import.meta.url),'utf8');
function fn(s,name,next){return s.slice(s.indexOf('  function '+name+'('),s.indexOf('  function '+next+'('));}
function load(s){
  const c=vm.createContext({getOrCreateZoteroMcpBearerToken:()=> 'test-only',normalizeText15:v=>v,getZoteroMcpAllowedToolNames:()=>['paper_read','library_read'],getZoteroMcpDirectPdfToolNames:()=>['paper_read'],getZoteroMcpServerUrl:()=> 'http://127.0.0.1:23119/diagnostic',CODEX_MCP_EFFECT_APPROVAL_MODE:'writes',getZoteroMcpToolApprovalOverrides:n=>Object.fromEntries(n.map(k=>[k,{approval_mode:'writes'}])),ZOTERO_MCP_AUTH_HEADER:'Authorization',ZOTERO_MCP_SCOPE_HEADER:'X-Scope',getZoteroMcpServerName:p=>'llm_for_zotero_'+p,getConfigHeaders:c=>c.http_headers});
  vm.runInContext(fn(s,'buildZoteroMcpConfigValue','normalizePositiveInt13')+fn(s,'buildCodexZoteroMcpThreadConfig','buildClaudeZoteroMcpServerConfig')+fn(s,'hashString','buildCodexZoteroMcpPreflightCacheKey'),c);
  return c;
}
const before=load(original),after=load(src);
for(const options of [{},{rawPdfMode:true},{enabled:false},{required:true,scopeToken:'scope-test'}]){
  const a=JSON.parse(JSON.stringify(before.buildZoteroMcpConfigValue(options)));
  const b=JSON.parse(JSON.stringify(after.buildZoteroMcpConfigValue(options)));
  assert.equal(b.tool_timeout_sec,1800);delete b.tool_timeout_sec;
  assert.deepEqual(a,b,'permissions, headers, tools, and scope unchanged');
}
const config=after.buildCodexZoteroMcpThreadConfig({profileSignature:'profile_c6ada7a7',scopeToken:'scope-test'});
assert.equal(config.config.mcp_servers[config.serverName].tool_timeout_sec,1800);
const server=config.config.mcp_servers[config.serverName];
assert.notEqual(JSON.stringify(after.buildPreflightConfigSignature(server)),JSON.stringify(after.buildPreflightConfigSignature({...server,tool_timeout_sec:300})));
// Recorded wall-clock intervals, not synthetic claims of a live 30-minute run.
const failedMs=1789375024576-1789374724572;
const measuredFullReadMs=1789375038032-1789374644391;
assert.ok(failedMs>=300000&&failedMs<301000);
assert.ok(measuredFullReadMs>300000&&measuredFullReadMs<server.tool_timeout_sec*1000);
console.log(JSON.stringify({passed:true,failedCallSeconds:failedMs/1000,measuredOtherFullReadSeconds:measuredFullReadMs/1000,generatedScopedTimeoutSeconds:1800,otherConfig:'unchanged',preflightCache:'timeout included',livePatchedFullRead:false},null,2));
