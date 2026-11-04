// Real Chromium test with CDP; no application code depends on this test harness.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const delay = ms=>new Promise(r=>setTimeout(r,ms));
const bin=process.env.CHROMIUM_BIN ?? process.argv[2];
if(!bin) throw new Error('Set CHROMIUM_BIN to a Chromium executable');
const sdk=(await readFile('packages/plugin-sdk/src/client.js','utf8')).replace('export function connectPlugin','function connectPlugin');
let networkHits=0;
const server=createServer((req,res)=>{
 if(req.url!='/plugin'){networkHits++;res.end('network');return;}
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'");
 res.setHeader('Content-Type','text/html');
 res.end(`<main id="stage"></main><script>${sdk}\nconnectPlugin(s=>{let timer,remaining=2000,start;function resume(){if(timer)return;start=performance.now();timer=setTimeout(()=>{timer=undefined;s.result('completed')},remaining);}return {async prepare(input){let blocked=false;try{parent.document.body.innerHTML}catch{blocked=true}let networkBlocked=false;try{await fetch('/forbidden')}catch{networkBlocked=true}return {...input,message:JSON.stringify({blocked,networkBlocked,tauri:typeof window.__TAURI_INTERNALS__})}},play(input){document.getElementById('stage').textContent=input.nickname;resume()},pause(){clearTimeout(timer);timer=undefined;remaining=Math.max(1,remaining-(performance.now()-start))},resume,dispose(){clearTimeout(timer)}}})</script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const vitePort=reserve.address().port;await new Promise(r=>reserve.close(r));const base=`http://127.0.0.1:${vitePort}`;
const vite=spawn(process.execPath,['apps/desktop/node_modules/vite/bin/vite.js','apps/desktop','--host','127.0.0.1','--port',String(vitePort)],{stdio:['ignore','pipe','pipe']});
let viteLog='';vite.stdout.on('data',b=>viteLog+=b);vite.stderr.on('data',b=>viteLog+=b);
const profile=await mkdtemp(join(tmpdir(),'likeboom-chrome-'));
let chrome,ws;
try {
 for(let n=0;;n++){try{if((await fetch(base)).ok)break;}catch{}if(n>100)throw new Error(viteLog);await delay(100);}
 chrome=spawn(bin,['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(new Error(log)),15000);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});chrome.on('exit',()=>{clearTimeout(timeout);reject(new Error(log));});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let seq=0;const pending=new Map();
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}};
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
 await call('Page.enable',{},sessionId);
 const url=`${base}/tests/browser.html?document=${encodeURIComponent(`http://127.0.0.1:${port}/plugin`)}`;
 await call('Page.navigate',{url},sessionId);
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 let prepared;
 for(let n=0;n<100;n++){prepared=await evaluate('window.__test?.prepared');if(prepared)break;await delay(100);}
 assert.ok(prepared,'plugin never prepared');
 const probe=JSON.parse(prepared.message);assert.deepEqual(probe,{blocked:true,networkBlocked:true,tauri:'undefined'});
 assert.equal(networkHits,0,'CSP allowed network access');
 await evaluate('window.__test.pause(true)');await delay(2300);assert.deepEqual(await evaluate('window.__test.results'),[],'pause did not freeze task');
 await evaluate('window.__test.pause(false)');
 for(let n=0;n<50;n++){if((await evaluate('window.__test.results.length'))>0)break;await delay(100);}
 assert.deepEqual(await evaluate('window.__test.results'),['completed']);
 console.log('Chromium: opaque iframe, host DOM/API isolation, CSP network denial, Plugin RPC, pause/resume and single completion passed');
} finally {ws?.close();chrome?.kill();vite.kill('SIGTERM');await new Promise(r=>server.close(r));await delay(300);await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150}).catch(error=>console.error('Temporary Chromium profile cleanup:',error.message));}
