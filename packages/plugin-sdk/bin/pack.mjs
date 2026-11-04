#!/usr/bin/env node
import { readFile, readdir, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function pack(directory, output, keyPath) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const files = {};
  const safe = name => typeof name === 'string' && /^[A-Za-z0-9._/-]+$/.test(name) && !name.split('/').some(p => !p || p === '.' || p === '..');
  const localRead = async name => {
    if (!safe(name)) throw new Error('Unsafe package path');
    let current = root;
    for (const part of name.split('/')) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not allowed'); }
    return readFile(current);
  };
  const add = (name, data) => { if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe package path'); files[name] = Buffer.from(data).toString('base64'); };
  add('manifest.json', JSON.stringify(manifest));
  for (const name of [manifest.inputSchema, manifest.configSchema, manifest.planSchema, manifest.presentationSchema, manifest.examples].filter(Boolean)) add(name, await localRead(name));
  // Default self-contained builder; a plugin may instead supply a prebuilt, offline HTML document.
  let html;
  try { html = (await localRead(manifest.entry)).toString('utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const sdk = (await readFile(new URL('../src/client.js', import.meta.url), 'utf8')).replace('export function connectPlugin', 'function connectPlugin');
    const code = await readFile(join(root, 'src/index.js'), 'utf8');
    if (/<\/script/i.test(code)) throw new Error('Use an external bundler for embedded closing script tags');
    html = `<html lang="zh-CN"><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui,sans-serif;background:#10182d;color:white}main{height:100%;display:grid;place-content:center;text-align:center}h1{font-size:clamp(32px,7vw,90px);overflow-wrap:anywhere}p{color:#acbbdf}</style><main id="stage"></main><script>${sdk}\nconst LikeBoom=Object.freeze({connect:connectPlugin});\n${code}</script></html>`;
  }
  add(manifest.entry, html);
  if (manifest.controlEntry) add(manifest.controlEntry, await localRead(manifest.controlEntry));
  async function assets(dir) {
    let entries;try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const item of entries) {
      const path = join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error('Symlinks are not allowed');
      if (item.isDirectory()) await assets(path); else if (item.isFile()) { if (/\.(map|pem|key)$/i.test(item.name)) throw new Error('Source maps and signing keys must not be bundled'); add(relative(root, path).replaceAll('\\', '/'), await readFile(path)); }
    }
  }
  await assets(join(root, 'assets'));
  try { add('THIRD_PARTY_NOTICES', await readFile(join(root, 'THIRD_PARTY_NOTICES'))); } catch (e) { if (e.code !== 'ENOENT') throw e; add('THIRD_PARTY_NOTICES', 'No bundled third-party runtime code besides LikeBoom Plugin SDK.'); }
  add('LICENSE-LikeBoom-SDK', await readFile(new URL('../LICENSE', import.meta.url)));
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  // Rust BTreeMap and JS bytewise ASCII ordering must agree for signatures.
  const integrity = Object.fromEntries(Object.keys(sorted).sort().map(path => [path, hash(Buffer.from(sorted[path], 'base64'))]));
  let signature = null;
  if (keyPath) {
    const key = createPrivateKey(await readFile(keyPath));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Signing key must be Ed25519');
    signature = { publisher: manifest.publisher, value: sign(null, Buffer.from(JSON.stringify(integrity)), key).toString('base64') };
    const der = createPublicKey(key).export({ format: 'der', type: 'spki' });
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(`${output}.publisher.json`, JSON.stringify({ publisher: manifest.publisher, publicKey: der.subarray(-32).toString('base64') }, null, 2));
  }
  const bytes = Buffer.from(JSON.stringify({ format: 'likeboom.plugin.v1', files: sorted, integrity, signature }));
  await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, bytes);
  return { path: output, digest: hash(bytes) };
}
export async function main() {
  const directory = process.argv[2]; if (!directory) throw new Error('Usage: likeboom-plugin <plugin-directory> [output.lbplug] [ed25519-private.pem]');
  const out = process.argv[3] ?? join(directory, 'dist/plugin.lbplug');
  console.log(await pack(directory, out, process.argv[4]));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
