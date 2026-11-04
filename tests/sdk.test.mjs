import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('old plugin callbacks retain the old task context and dispose never reports a result', async () => {
  const source = (await readFile('packages/plugin-sdk/src/client.js', 'utf8')).replace('export function connectPlugin', 'function connectPlugin');
  let listener; const parent = {}; const messages = [], services = [], disposed = [];
  const port = { postMessage: m => messages.push(m), start() {}, onmessage: null };
  const sandbox = { parent, setTimeout, clearTimeout, addEventListener: (_, f) => { listener = f; }, removeEventListener() {}, services, disposed };
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
