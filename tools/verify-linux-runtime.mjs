// Use the ELF's actual interpreter; the host distro's ldd can select a different libc.
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
if (process.platform !== 'linux') {
  console.log('Linux ELF runtime check skipped on this platform.');
} else {
  const binary = resolve(process.argv[2] ?? 'target/debug/liveboom');
  if (!existsSync(binary)) throw new Error(`请先构建桌面程序：${binary}`);
  const environment = { ...process.env, LC_ALL: 'C' };
  const program = execFileSync('readelf', ['-l', binary], { env: environment, encoding: 'utf8' });
  const interpreter = program.match(/Requesting program interpreter:\s*([^\]]+)\]/)?.[1];
  if (!interpreter) throw new Error('找不到 ELF 动态加载器');
  const result = spawnSync(interpreter, ['--list', binary], { env: environment, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 || /not found/.test(result.stdout + result.stderr)) {
    console.error(result.stdout + result.stderr);
    console.error('Linux 动态加载失败。请更新 Devbox 环境并重新链接程序；不要混用不同 nixpkgs 的原生库。');
    process.exitCode = 1;
  } else {
    console.log(`Linux 动态加载通过：${interpreter}`);
    const libc = result.stdout.split('\n').filter(line => /lib(c|m|mvec)\.so/.test(line));
    for (const line of libc) console.log(line.trim());
  }
}
