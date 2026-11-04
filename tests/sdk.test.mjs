import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('old plugin callbacks retain the old task context and dispose never reports a result', async () => {
  const source = (await readFile('packages/plugin-sdk/src/client.js', 'utf8')).replace('export function connectPlugin', 'function connectPlugin');
  let listener; const parent = {}; const messages = [], services = [], disposed = [];
  const port = { postMessage: m => messages.push(m), start() {}, onmessage: null };
  const sandbox = { parent, setTimeout, clearTimeout, addEventListener: (name, f) => { if(name==='message')listener = f; }, removeEventListener() {}, services, disposed };
  runInNewContext(source + '\nconnectPlugin(s => { services.push(s); const index=services.length; return { prepare:v=>v, play(){}, dispose(){disposed.push(index);} }; });', sandbox);
  await listener({ source: parent, data: { type: 'likeboom.connect', api: '1', nonce: 'test' }, ports: [port] });
  const context = epoch => ({ task_id: 'same-task', epoch, instance: 'display' });
  const receive = (type, epoch) => port.onmessage({ data: { api: '1', nonce: 'test', type, context: context(epoch), input: { nickname: '访客' }, config: {} } });
  await receive('prepare', 'one'); await receive('play', 'one');
  await receive('prepare', 'two'); await receive('play', 'two');
  services[0].result('completed'); services[1].result('failed');
  const results = messages.filter(m => m.type === 'result');
  assert.equal(results[0].context.epoch, 'one'); assert.equal(results[1].context.epoch, 'two');
  await assert.rejects(services[0].request('storage.get', { key: 'x' }), /Stale task/);
  await receive('dispose', 'two');
  assert.deepEqual(disposed, [1, 2]);
  assert.equal(messages.filter(m => m.type === 'result').length, 2);
});

test('renderer session survives task disposal and is destroyed only with the plugin document', async()=>{
 const source=(await readFile('packages/plugin-sdk/src/client.js','utf8')).replace('export function connectPlugin','function connectPlugin');let listener;const parent={};const port={postMessage(){},start(){},onmessage:null};const events=[];
 runInNewContext(source+`\nconnectPlugin(s=>({prepare:v=>v,play(){},dispose(){events.push('task-dispose')}}),{session:()=>{events.push('session-create');return {presentation(){events.push('presentation')},dispose(){events.push('session-dispose')}}}});`,{parent,setTimeout,clearTimeout,addEventListener:(name,f)=>{if(name==='message')listener=f;},removeEventListener(){},events});
 await listener({source:parent,data:{type:'likeboom.connect',api:'1',nonce:'n'},ports:[port]});
 const receive=(type,epoch)=>port.onmessage({data:{api:'1',nonce:'n',type,context:{task_id:'task',epoch,instance:'display'},input:{},config:{}}});
 await receive('session');await receive('presentation');await receive('prepare','one');await receive('play','one');await receive('cancel','one');await receive('prepare','two');await receive('dispose','two');
 assert.deepEqual(events,['session-create','presentation','task-dispose','task-dispose','session-dispose']);
});
