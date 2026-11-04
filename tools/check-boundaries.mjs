import { readdir, readFile } from 'node:fs/promises';
async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'target', 'generated'].includes(e.name)) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) files.push(...await walk(p)); else files.push(p);
  }
  return files;
}
for (const directory of ['packages/plugin-sdk', 'packages/desktop-ui']) for (const file of await walk(directory)) {
  if (!/\.[jt]sx?$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  if (/from\s+['"](?:@tauri-apps|.*plugins\/|.*apps\/)|__TAURI_INTERNALS__/.test(source)) throw new Error(`Forbidden host/game dependency: ${file}`);
}
for (const directory of ['crates/play-core', 'crates/play-contracts']) {
  const manifest = await readFile(`${directory}/Cargo.toml`, 'utf8');
  if (/tauri|play-runtime|likeboom-private/.test(manifest)) throw new Error(`Forbidden crate dependency: ${directory}`);
}
console.log('Public package dependency boundaries OK');
