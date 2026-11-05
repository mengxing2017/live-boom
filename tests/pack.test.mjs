import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { pack } from '../tools/plugin-pack/pack.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
test('independent private plugin uses the same SDK and does not modify the public host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liveboom-private-play-'));
  try {
    const initialFiles = await (await import('node:fs/promises')).readdir('apps/desktop/dist/assets');
    const before = hash(await readFile('apps/desktop/dist/assets/' + initialFiles.find(n=>n.endsWith('.js'))));
    const manifest = JSON.parse(await readFile('plugins/registry/manifest.json', 'utf8'));
    delete manifest.controlEntry; manifest.capabilities = [];
    manifest.id = 'private.customer'; manifest.publisher = 'private-publisher'; manifest.name = 'Private custom scene';
    await mkdir(join(root, 'schemas')); await mkdir(join(root, 'src'));
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    for (const name of ['input', 'config']) await writeFile(join(root, `schemas/${name}.json`), await readFile(`plugins/registry/schemas/${name}.json`));
    await writeFile(join(root, 'src/index.js'), 'liveboom.connect(s => ({play(input) { document.getElementById("stage").textContent = input.nickname; s.result("completed"); }, dispose() {}}));');
    const key = generateKeyPairSync('ed25519');
    await writeFile(join(root, 'signing.pem'), key.privateKey.export({format:'pem',type:'pkcs8'}));
    const out = join(root, 'custom.lbplug');
    await pack(root, out, join(root, 'signing.pem'));
    const bundle = JSON.parse(await readFile(out));
    assert.equal(verify(null, Buffer.from(JSON.stringify(bundle.integrity)), key.publicKey, Buffer.from(bundle.signature.value, 'base64')), true);
    assert.equal(bundle.signature.publisher, 'private-publisher');
    for (const [path, bytes] of Object.entries(bundle.files)) assert.equal(hash(Buffer.from(bytes,'base64')), bundle.integrity[path]);
    assert.ok(!Object.keys(bundle.files).some(p=>p.includes('signing') || p.endsWith('.map') || p.includes('src/')));
    const files = await (await import('node:fs/promises')).readdir('apps/desktop/dist/assets');
    assert.equal(before, hash(await readFile('apps/desktop/dist/assets/' + files.find(n=>n.endsWith('.js')))));
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('sample packages contain self-contained documents and no host imports', async () => {
  for (const scene of ['registry','printer-3d']) {
    const bundle=JSON.parse(await readFile(`plugins/${scene}/dist/plugin.lbplug`));
    const manifest=JSON.parse(Buffer.from(bundle.files['manifest.json'],'base64'));
    const html=Buffer.from(bundle.files[manifest.entry],'base64').toString();
    assert.ok(html.includes('connectPlugin') || html.includes('WebGLRenderer'));
    assert.ok(!html.includes('@tauri-apps') && !html.includes('__TAURI_INTERNALS__'));
  }
});
