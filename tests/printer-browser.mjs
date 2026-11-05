// Real Chromium test with CDP; no application code depends on this test harness.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const delay = ms=>new Promise(r=>setTimeout(r,ms));
const bin=process.env.CHROMIUM_BIN ?? process.argv[2];
if(!bin) throw new Error('Set CHROMIUM_BIN to a Chromium executable');
const bundle=JSON.parse(await readFile('plugins/printer-3d/dist/plugin.lbplug','utf8'));
const manifest=JSON.parse(Buffer.from(bundle.files['manifest.json'],'base64'));
const html=Buffer.from(bundle.files[manifest.entry],'base64');
const controlHtml=Buffer.from(bundle.files[manifest.controlEntry],'base64');
const registryBundle=JSON.parse(await readFile('plugins/registry/dist/plugin.lbplug'));
const registryHtml=Buffer.from(registryBundle.files['web/index.html'],'base64');
const registryControl=Buffer.from(registryBundle.files['web/control.html'],'base64');
let networkHits=0;
const server=createServer((req,res)=>{
 if(!['/plugin','/control','/evil-control','/registry','/registry-control'].includes(req.url)){networkHits++;res.end('blocked');return;}
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'");
 res.setHeader('Content-Type','text/html');if(req.url==='/evil-control'){res.end(`<script>addEventListener('message',e=>{if(e.source!==parent||!e.ports[0])return;const p=e.ports[0],nonce=e.data.nonce;p.onmessage=({data})=>{if(data.type==='response')document.body.dataset.result=data.error||'UNEXPECTED_SUCCESS'};p.start();p.postMessage({api:'1',nonce,type:'request',id:'forbidden',method:'command',params:{name:'install',args:{path:'/tmp/untrusted.lbplug'}}});});</script>`);return;}res.end(req.url==='/registry'?registryHtml:req.url==='/registry-control'?registryControl:req.url==='/control'?controlHtml:html);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const vitePort=reserve.address().port;await new Promise(r=>reserve.close(r));const base=`http://127.0.0.1:${vitePort}`;
const vite=spawn(process.execPath,['apps/desktop/node_modules/vite/bin/vite.js','apps/desktop','--host','127.0.0.1','--port',String(vitePort)],{stdio:['ignore','pipe','pipe']});
let viteLog='';vite.stdout.on('data',b=>viteLog+=b);vite.stderr.on('data',b=>viteLog+=b);
const profile=await mkdtemp(join(tmpdir(),'liveboom-chrome-'));
let chrome,ws;
try {
 for(let n=0;;n++){try{if((await fetch(base)).ok)break;}catch{}if(n>100)throw new Error(viteLog);await delay(100);}
 chrome=spawn(bin,['--headless','--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--window-size=960,540','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(new Error(log)),45000);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});chrome.on('exit',()=>{clearTimeout(timeout);reject(new Error(log));});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let seq=0;const pending=new Map(),browserErrors=[];
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')browserErrors.push(m.params.exceptionDetails);if(m.method==='Log.entryAdded')browserErrors.push(m.params.entry);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}};
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
 await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
 const url=`${base}/tests/printer.html?document=${encodeURIComponent(`http://127.0.0.1:${port}/plugin`)}`;
 await call('Page.navigate',{url},sessionId);
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 if(!process.env.LIVEBOOM_CONTROL_ONLY){
 let prepared;
 for(let n=0;n<300;n++){prepared=await evaluate('window.__test?.prepared');if(prepared)break;const error=await evaluate("document.querySelector('.display-error')?.textContent");if(error)throw new Error(error);await delay(100);}
 assert.ok(prepared,'3D plugin never prepared: '+JSON.stringify(browserErrors)+' '+await evaluate('document.body.innerText'));assert.equal(prepared.units.length,2);assert.ok(prepared.units.every(u=>u.score>=60&&u.score<=95));
 await evaluate('window.__test.pause(true)');await delay(1500);assert.deepEqual(await evaluate('window.__test.units'),[],'Pause did not freeze production');
 await evaluate('window.__test.pause(false)');
 for(let n=0;n<200;n++){if(await evaluate('window.__test.units.length===1'))break;await delay(100);}
 assert.deepEqual(await evaluate('window.__test.units'),[0]);await evaluate('window.__test.pause(true)');await delay(4000);
 assert.deepEqual(await evaluate('window.__test.units'),[0],'A new unit escaped the paused session while its predecessor acknowledgement was pending');assert.deepEqual(await evaluate('window.__test.results'),[]);
 await evaluate('window.__test.pause(false)');
 for(let n=0;n<600;n++){if((await evaluate('window.__test.results.length'))>0)break;await delay(100);}
 assert.deepEqual(await evaluate('window.__test.results'),['completed']);
 assert.deepEqual(await evaluate('window.__test.units'),[0,1]);assert.ok(await evaluate('window.__test.frames>0'),'No actual WebGL preview frames');
 await evaluate('window.__test.stale()');await delay(300);assert.deepEqual(await evaluate('window.__test.results'),['completed'],'A delayed previous-session snapshot replayed a completed task');
 assert.equal(networkHits,0,'Plugin attempted network access');
 await evaluate("window.__test.control({op:'rules'})");for(let n=0;n<50;n++){if(await evaluate('window.__test.exports.length>0'))break;await delay(100);}
 assert.ok(await evaluate('window.__test.exports.length>8'),'Rules PNG was not generated');
 await evaluate("window.__test.control({op:'saveCamera',name:'验收镜头'})");
 for(let n=0;n<50;n++){if(await evaluate('window.__test.views().length===1'))break;await delay(100);}assert.equal(await evaluate('window.__test.views().length'),1);
 for(const theme of ['study','night','workshop','garden','home']){await evaluate(`window.__test.present({theme:${JSON.stringify(theme)}})`);await delay(250);}
 for(const aa of ['msaa2','msaa4','msaa8','ssaa15','ssaa2','off']){await evaluate(`window.__test.present({aa:${JSON.stringify(aa)}})`);await delay(250);}
 const shot=await call('Page.captureScreenshot',{format:'png'},sessionId);await writeFile('/tmp/liveboom-printer-3d.png',Buffer.from(shot.data,'base64'));

 }
 // The real React control document and renderer share only host-mediated snapshots/frames.
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false},sessionId);
 const controlUrl=`${base}/tests/printer.html?document=${encodeURIComponent(`http://127.0.0.1:${port}/plugin`)}&control=${encodeURIComponent(`http://127.0.0.1:${port}/control`)}`;
 await call('Page.navigate',{url:controlUrl},sessionId);
 const attachFrame=async suffix=>{
  for(let n=0;n<100;n++){
   const {frameTree}=await call('Page.getFrameTree',{},sessionId);const child=frameTree.childFrames?.find(f=>f.frame.url.endsWith(suffix));if(child)return {id:child.frame.id,session:sessionId};
   const {targetInfos}=await call('Target.getTargets');const remote=targetInfos.find(t=>t.type==='iframe'&&t.url.endsWith(suffix));if(remote){const {sessionId:remoteSession}=await call('Target.attachToTarget',{targetId:remote.targetId,flatten:true});await call('Page.enable',{},remoteSession);const {frameTree:tree}=await call('Page.getFrameTree',{},remoteSession);return {id:tree.frame.id,session:remoteSession};}
   await delay(100);
  }
  throw new Error('Control frame missing: '+JSON.stringify(await call('Target.getTargets'))+' '+JSON.stringify(browserErrors)+' '+await evaluate('document.body.innerText'));
 };
 let controlFrame=await attachFrame('/control');
 await call('Runtime.enable',{},controlFrame.session);await call('Log.enable',{},controlFrame.session);
 let {executionContextId}=await call('Page.createIsolatedWorld',{frameId:controlFrame.id,worldName:'control-test'},controlFrame.session);
 const ui=async expression=>{const r=await call('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true,awaitPromise:true},controlFrame.session);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const click=async text=>{for(let n=0;n<100;n++){if(await ui(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)})`))break;await delay(100);}return ui(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button not found: '+${JSON.stringify(text)}+' '+document.body.innerText);const disabled=b.disabled,valid=b.form?.checkValidity();b.click();return {disabled,valid,invalid:Array.from(b.form?.querySelectorAll(':invalid')??[]).map(e=>({label:e.getAttribute('aria-label'),value:e.value}))};})()`)};
 const field=async(label,value)=>{await ui(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');if(!el)throw Error('Missing '+${JSON.stringify(label)});el.focus();})()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,commands:['selectAll']},controlFrame.session);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2},controlFrame.session);await call('Input.insertText',{text:String(value)},controlFrame.session);const actual=await ui(`document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]').value`);assert.equal(actual,String(value),'Failed to fill '+label);};
 async function registryCheck(){
 // The second example uses the same public shell/opaque bridge and its actual registry renderer.
 await call('Page.navigate',{url:`${base}/tests/printer.html?kind=registry&document=${encodeURIComponent(`http://127.0.0.1:${port}/registry`)}&control=${encodeURIComponent(`http://127.0.0.1:${port}/registry-control`)}`},sessionId);
 controlFrame=await attachFrame('/registry-control');({executionContextId}=await call('Page.createIsolatedWorld',{frameId:controlFrame.id,worldName:'control-test'},controlFrame.session));
 for(let n=0;n<100;n++){if(await ui("!!document.querySelector('[aria-label=登记昵称]')"))break;await delay(100);}
 for(let n=0;n<100;n++){if(await evaluate('window.__test.snapshot().display_ready'))break;await delay(100);}
 assert.equal(await evaluate('window.__test.snapshot().display_ready'),true,'Registry display did not register: '+await evaluate('document.body.innerText'));
 await field('登记昵称','桌面登记验证');await field('登记留言','React 登记工作区');await delay(50);await click('加入登记队列');
 for(let n=0;n<200;n++){if(await evaluate('window.__test.results.length>0'))break;await delay(100);}
 assert.deepEqual(await evaluate('window.__test.results'),['completed'],'Registry did not complete: '+JSON.stringify(await evaluate('window.__test.snapshot()'))+' '+await ui('document.body.innerText')+' '+JSON.stringify(browserErrors));
 for(const [width,height] of [[720,560],[1920,1080]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);await delay(250);assert.ok(await ui('document.documentElement.scrollHeight<=innerHeight+1'));}
 console.log('Desktop workbench: real React registry submission/completion passed');
 }
 if(!process.env.LIVEBOOM_REGISTRY_ONLY){
 for(let n=0;n<100;n++){if(await ui("document.body.textContent.includes('打印现场')"))break;await delay(100);}
 assert.equal(await ui("document.body.textContent.includes('规则演示台')"),true);
 for(let n=0;n<300;n++){if(await evaluate('window.__test.snapshot().display_ready&&window.__test.frames>0'))break;await delay(100);}assert.equal(await evaluate('window.__test.frames>0'),true,'Display did not produce a first frame');console.log('React control: initialized with live preview');
 for(let n=0;n<100;n++){if(await ui("document.querySelector('.stage-preview>img')?.naturalWidth>0"))break;await delay(100);}
 assert.equal(await ui("document.querySelector('.stage-preview>img')?.naturalWidth>0"),true,'First preview failed: '+JSON.stringify(browserErrors)+' '+JSON.stringify(await call('Runtime.evaluate',{expression:"(()=>{const i=document.querySelector('.stage-preview>img');return {src:i?.src,width:i?.naturalWidth,complete:i?.complete}})()",returnByValue:true},controlFrame.session)));
 await evaluate('window.scrollTo(0,0)');await ui('window.scrollTo(0,0)');await delay(1000);
 const initialShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sessionId);await writeFile('/tmp/liveboom-printer-control.png',Buffer.from(initialShot.data,'base64'));
 // Resize the actual host and its opaque plugin frame; the same control instance and draft survive.
 const dimensions=[];
 for(const [width,height,scale] of [[720,560,1],[960,640,1],[1280,800,1],[1920,1080,1],[2560,1440,1],[1280,800,1.25],[1280,800,1.5],[1280,800,2]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false},sessionId);await delay(250);
  for(let n=0;n<80;n++){if(await ui(`innerHeight===${height-68}&&innerWidth===${width-56}`))break;await delay(50);}
  const host=await evaluate("(()=>{const f=document.querySelector('.plugin-control-frame'),r=f.getBoundingClientRect();return {width:r.width,height:r.height,scroll:document.documentElement.scrollHeight,viewport:innerHeight}})()");
  const inner=await ui("(()=>{const r=document.querySelector('.studio').getBoundingClientRect(),b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='加入手动队列').getBoundingClientRect();return {width:r.width,height:r.height,scroll:document.documentElement.scrollHeight,viewport:innerHeight,submit:{top:b.top,bottom:b.bottom,right:b.right},compact:document.querySelector('.lb-workbench').classList.contains('is-compact')}})()");
  assert.ok(Math.abs(host.height-(height-68))<=2,'Host did not fill remaining window: '+JSON.stringify({width,height,host}));
  assert.ok(Math.abs(inner.height-host.height)<=2,'Plugin did not follow host: '+JSON.stringify(inner));
  assert.ok(inner.scroll<=inner.viewport+1,'Plugin became a long page: '+JSON.stringify(inner));
  if(inner.submit.bottom>inner.viewport){const shot=await call('Page.captureScreenshot',{format:'png'},sessionId);await writeFile('/tmp/layout-failure.png',Buffer.from(shot.data,'base64'));console.log(await ui("Array.from(document.querySelectorAll('.lb-workbench,.lb-workbench-group,[data-panel],.lb-stage,.production-center,.stage-panel')).map(e=>({tag:e.tagName,id:e.id,class:e.className,display:getComputedStyle(e).display,height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top}))"));}
  assert.ok(inner.submit.top>=0&&inner.submit.bottom<=inner.viewport&&inner.submit.right<=inner.width,'Submit escaped viewport: '+JSON.stringify(inner));
  dimensions.push({width,height,scale,host,inner});
  if(scale===1&&[720,1280,1920].includes(width)){const shot=await call('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`/tmp/liveboom-workbench-${width}.png`,Buffer.from(shot.data,'base64'));}
 }
 await writeFile('/tmp/liveboom-layout-matrix.json',JSON.stringify(dimensions,null,2));
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false},sessionId);await delay(250);
 // The parent navigation hides the iframe without replacing it or its draft.
 const frameIdentity=await evaluate("document.querySelector('.plugin-control-frame').src");
 for(const title of ['历史','设置','玩法','帮助','工作台']){await evaluate(`Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.endsWith(${JSON.stringify(title)})).click()`);await delay(50);}
 assert.equal(await evaluate("document.querySelector('.plugin-control-frame').src"),frameIdentity);
 console.log('Desktop workbench: eight viewport/DPI cases, bounded iframe and visible submit controls passed');
 await field('昵称 / 要展示的文字','窗口切换草稿');
 await ui("dispatchEvent(new KeyboardEvent('keydown',{key:',',ctrlKey:true,bubbles:true}))");
 for(let n=0;n<50;n++){if(await evaluate("document.querySelector('nav [aria-current=page]')?.textContent.endsWith('设置')"))break;await delay(50);}
 assert.equal(await evaluate("document.querySelector('nav [aria-current=page]').textContent.endsWith('设置')"),true,'Iframe shortcut was not forwarded');
 await evaluate("Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.endsWith('工作台')).click()");await delay(100);
 assert.equal(await ui(`document.querySelector('[aria-label="昵称 / 要展示的文字"]').value`),'窗口切换草稿');
 const beforeSeparator=await ui("Number(document.querySelector('[role=separator]').getAttribute('aria-valuenow'))");
 await ui("document.querySelector('[role=separator]').focus()");
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'},controlFrame.session);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'},controlFrame.session);await delay(200);
 assert.notEqual(await ui("Number(document.querySelector('[role=separator]').getAttribute('aria-valuenow'))"),beforeSeparator,'Keyboard splitter did not resize');
 assert.ok(await evaluate("Object.keys(localStorage).some(k=>k.startsWith('liveboom:layout:1:'))"),'Layout was not persisted in trusted host');
 await evaluate("Array.from(document.querySelectorAll('.app-toolbar button')).find(b=>b.textContent==='恢复默认布局').click()");await delay(150);

 assert.deepEqual(await ui("(()=>{let blocked=false;try{parent.document.body.textContent}catch{blocked=true}return {blocked,tauri:typeof window.__TAURI_INTERNALS__}})()"),{blocked:true,tauri:'undefined'});
 await field('昵称 / 要展示的文字','React 迁移验证');await field('事件数量','2');
 const submitted=await click('加入手动队列');assert.equal(submitted.disabled,false);assert.equal(submitted.valid,true,JSON.stringify(submitted));
 for(let n=0;n<100;n++){if(await evaluate("window.__test.snapshot().current?.input.nickname==='React 迁移验证'"))break;await delay(100);}
 assert.equal(await evaluate('window.__test.snapshot().current?.source'),'manual',JSON.stringify(await evaluate('window.__test.commands'))+' '+await ui("document.querySelector('footer').textContent"));assert.equal(await evaluate('window.__test.snapshot().current?.input.quantity'),2);
 await click('暂停制作');await delay(500);assert.equal(await evaluate('window.__test.snapshot().paused'),true);
 const frozenBeforeResize=await evaluate('({id:window.__test.snapshot().current.id,config:window.__test.snapshot().current.config,plan:window.__test.snapshot().current.plan,completed:window.__test.snapshot().current.completed_units})');
 for(const [width,height] of [[960,640],[1920,1080],[1440,1100]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);await delay(100);}
 assert.deepEqual(await evaluate('({id:window.__test.snapshot().current.id,config:window.__test.snapshot().current.config,plan:window.__test.snapshot().current.plan,completed:window.__test.snapshot().current.completed_units})'),frozenBeforeResize,'Resizing changed the paused production session');

 const pausedPreview=await ui("document.querySelector('.stage-preview>img')?.src");await click('继续制作');for(let n=0;n<100;n++){if(await ui(`document.querySelector('.stage-preview>img')?.src!==${JSON.stringify(pausedPreview)}`))break;await delay(100);}assert.notEqual(await ui("document.querySelector('.stage-preview>img')?.src"),pausedPreview,'Preview remained frozen after resume');
 // Scene and rule edits are made through React controls, not fixture APIs.
 await ui("(()=>{const select=Array.from(document.querySelectorAll('label')).find(l=>l.querySelector('span')?.textContent==='场景').querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'study');select.dispatchEvent(new Event('change',{bubbles:true}));})()");
 for(let n=0;n<50;n++){if(await evaluate("window.__test.snapshot().presentation.theme==='study'"))break;await delay(100);}assert.equal(await evaluate('window.__test.snapshot().presentation.theme'),'study');
 await field('单份打印秒数','3');await click('保存并应用到新任务 · 未保存');
 for(let n=0;n<50;n++){if(await evaluate('window.__test.snapshot().config.duration===3'))break;await delay(100);}assert.equal(await evaluate('window.__test.snapshot().config.duration'),3);
 assert.equal(await evaluate('window.__test.snapshot().current.config.duration'),2,'A rule edit changed an accepted task');console.log('React control: submit, pause, scene and frozen-rule editing passed');
 await ui("(()=>{const f=document.querySelector('input[type=file]');const dt=new DataTransfer();dt.items.add(new File([new Uint8Array([137,80,78,71])],'自有头像.png',{type:'image/png'}));f.files=dt.files;f.dispatchEvent(new Event('change',{bubbles:true}));})()");
 for(let n=0;n<50;n++){if(await evaluate('window.__test.imports===1'))break;await delay(100);}assert.equal(await evaluate('window.__test.imports'),1);
 for(let n=0;n<600;n++){if(await evaluate('window.__test.results.length>0'))break;await delay(100);}
 assert.deepEqual(await evaluate('window.__test.results'),['completed']);
 for(let n=0;n<100;n++){if(await ui("document.querySelector('.history-list').textContent.includes('React 迁移验证')"))break;await delay(100);}
 assert.equal(await ui("document.querySelector('.history-list').textContent.includes('React 迁移验证')"),true);
 await evaluate("window.__test.control({op:'preview',enabled:false})");
 // A final in-flight frame can replace src while decode() is pending.
 // Wait for the visible image's load state rather than decoding a superseded frame.
 for(let n=0;n<100;n++){if(await ui("(()=>{const i=document.querySelector('.stage-preview>img');return !!i?.complete&&i.naturalWidth>0;})()"))break;await delay(100);}
 assert.equal(await ui("document.querySelector('.stage-preview>img')?.naturalWidth>0"),true,'Preview image was blocked or missing: '+await ui("document.querySelector('.stage-preview').innerHTML"));
 await click('生成规则图');for(let n=0;n<50;n++){if(await ui("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='预览并保存 PNG').disabled"))break;await delay(100);}
 await click('预览并保存 PNG');for(let n=0;n<50;n++){if(await evaluate("!!document.querySelector('[role=dialog]')"))break;await delay(100);}assert.equal(await evaluate("!!document.querySelector('[role=dialog]')"),true);assert.equal(await evaluate('window.__test.saves'),0,'Plugin saved a PNG without trusted-host review');
 await evaluate("document.querySelector('[aria-label=关闭对话框]').click()");
 await evaluate("document.querySelector('.browser-output').style.visibility='hidden';window.scrollTo(0,0)");await delay(200);

 await registryCheck();
 // A hostile control document still cannot install/activate plugins or reach arbitrary native commands.
 await call('Page.navigate',{url:controlUrl.replace(encodeURIComponent(`http://127.0.0.1:${port}/control`),encodeURIComponent(`http://127.0.0.1:${port}/evil-control`))},sessionId);
 controlFrame=await attachFrame('/evil-control');({executionContextId}=await call('Page.createIsolatedWorld',{frameId:controlFrame.id,worldName:'control-test'},controlFrame.session));
 let rejection='';for(let n=0;n<50;n++){rejection=await ui('document.body.dataset.result');if(rejection)break;await delay(100);}assert.match(rejection,/无此权限/);assert.equal(await evaluate("window.__test.commands.some(c=>c.name==='install')"),false);
 assert.equal(networkHits,0);
 console.log('React control: real controls submit/pause/resume, frozen rule edits, scene changes, media import, completed history, actual preview, trusted PNG review and forbidden-command isolation passed');
 if(!process.env.LIVEBOOM_CONTROL_ONLY)console.log('Chromium WebGL: 3D scene, frozen two-unit plan, pause/resume, ordered unit acknowledgements, single completion, bounded preview rule PNG, five themes, six AA modes, camera persistence passed');

 } else { await registryCheck(); }

} finally {ws?.close();chrome?.kill();vite.kill('SIGTERM');await new Promise(r=>server.close(r));await delay(300);await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150}).catch(error=>console.error('Temporary Chromium profile cleanup:',error.message));}
