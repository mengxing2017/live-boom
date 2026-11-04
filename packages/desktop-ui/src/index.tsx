import { useEffect, useState } from 'react';
import type { DesktopTransport, PluginInfo, Snapshot } from '@likeboom/plugin-sdk';
import { PluginHost } from './PluginHost';
export type { DesktopTransport } from '@likeboom/plugin-sdk';

function describe(e: unknown): string { return typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e); }
function useSnapshot(transport: DesktopTransport) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    let active = true, version = -1, session = ''; let dispose: (() => void) | undefined;
    const apply = (s: Snapshot) => { if (active && (session !== s.session_id || s.version > version)) { session = s.session_id; version = s.version; setSnapshot(s); setError(''); } };
    const refresh = () => transport.snapshot().then(apply).catch(e => { if (active) setError(describe(e)); });
    void transport.subscribe(apply).then(unlisten => { if (!active) { unlisten(); return; } dispose = unlisten; void refresh(); }).catch(e => { if (active) setError(describe(e)); });
    // Snapshots are authoritative; this also recovers lost notifications without replaying tasks.
    const timer = setInterval(() => { void refresh(); }, 1000);
    return () => { active = false; clearInterval(timer); dispose?.(); };
  }, [transport]);
  return { snapshot, error };
}
type Fields = Record<string, unknown>;
function defaults(schema: Fields): Fields {
  const result: Fields = {};
  for (const [key, property] of Object.entries((schema.properties ?? {}) as Fields)) { const p = property as Fields; if ('default' in p) result[key] = p.default; else if (Array.isArray(p.enum) && p.enum.length) result[key] = p.enum[0]; else if (p.type === 'object') result[key] = defaults(p); else if (p.type === 'boolean') result[key] = false; }
  return result;
}
function SchemaFields({ schema, value, onChange }: { schema: Fields; value: Fields; onChange: (v: Fields) => void }) {
  const required = (schema.required ?? []) as string[];
  return <>{Object.entries((schema.properties ?? {}) as Fields).map(([name, raw]) => {
    const field = raw as Fields; const type = String(field.type); const options = field.enum as unknown[] | undefined;
    const change = (v: unknown) => onChange({ ...value, [name]: v });
    return <label key={name}>{String(field.title ?? name)}{required.includes(name) ? ' *' : ''}
      {type === 'object' ? <SchemaFields schema={field} value={(value[name] ?? {}) as Fields} onChange={change} /> : options ? <select value={JSON.stringify(value[name] ?? options[0])} onChange={e => change(JSON.parse(e.target.value))}>{options.map(v => <option key={JSON.stringify(v)} value={JSON.stringify(v)}>{String(v)}</option>)}</select> : type === 'boolean' ? <input type="checkbox" checked={Boolean(value[name])} onChange={e => change(e.target.checked)} /> : <input required={required.includes(name)} type={['integer', 'number'].includes(type) ? 'number' : 'text'} min={field.minimum as number | undefined} max={field.maximum as number | undefined} step={type === 'integer' ? 1 : 'any'} value={String(value[name] ?? '')} onChange={e => change(['integer', 'number'].includes(type) ? Number(e.target.value) : e.target.value)} />}
    </label>;
  })}</>;
}
export function DesktopApp({ transport, role }: { transport: DesktopTransport; role: 'control' | 'display' }) {
  const { snapshot, error } = useSnapshot(transport);
  if (role === 'display') return <main className="display-root">{snapshot?.active ? <PluginHost key={snapshot.active.digest} snapshot={snapshot} transport={transport} /> : <p>请在控制台启用玩法</p>}{error && <p className="display-error">{error}</p>}</main>;
  return <Control transport={transport} snapshot={snapshot} connectionError={error} />;
}
function Control({ transport, snapshot, connectionError }: { transport: DesktopTransport; snapshot: Snapshot | null; connectionError: string }) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]); const [selected, setSelected] = useState('');
  const [sourceDigest, setSourceDigest] = useState('');
  const [config, setConfig] = useState<Fields>({}); const [input, setInput] = useState<Fields>({});
  const [feedback, setFeedback] = useState(''); const [busy, setBusy] = useState(false);
  const [path, setPath] = useState(''); const [publisher, setPublisher] = useState(''); const [key, setKey] = useState('');
  const refresh = () => transport.plugins().then(setPlugins);
  useEffect(() => { void refresh().catch(e => setFeedback(describe(e))); }, [transport]);
  useEffect(() => { setInput(snapshot?.active ? defaults(snapshot.active.input_schema) : {}); }, [snapshot?.active?.digest]);
  const choice = plugins.find(p => p.digest === selected);
  const act = async (name: string, args: Fields = {}) => {
    setFeedback('');
    try { const result = await transport.command(name, args); setFeedback(name === 'trust_publisher' ? `已信任发布者：${JSON.stringify(result)}` : '操作成功'); await refresh(); }
    catch (e) { setFeedback(describe(e)); }
  };
  const submit = async () => {
    setBusy(true);
    try { await transport.command('submit', { command_id: crypto.randomUUID(), input }); setInput(snapshot?.active ? defaults(snapshot.active.input_schema) : {}); setFeedback('已加入队列'); }
    catch (e) { setFeedback(describe(e)); } finally { setBusy(false); }
  };
  return <main className="control-page"><h1>LikeBoom 公共玩法宿主</h1><p>本地互动 · 无需平台账号</p>
    <section><h2>玩法插件</h2><select aria-label="选择插件版本" value={selected} onChange={e => { setSelected(e.target.value); const p = plugins.find(p => p.digest === e.target.value); setConfig(p ? defaults(p.config_schema) : {}); }}><option value="">选择已安装插件</option>{plugins.map(p => <option key={p.digest} value={p.digest}>{p.manifest.name} · {p.manifest.version} · {p.digest.slice(0, 8)}</option>)}</select>
    {choice && <><SchemaFields schema={choice.config_schema} value={config} onChange={setConfig} /><button onClick={() => void act('activate', { digest: choice.digest, config })}>启用 / 应用配置</button><button onClick={() => { if (confirm('卸载该版本？被任务引用的版本会拒绝卸载。')) void act('uninstall', { digest: choice.digest }); }}>卸载版本</button><details><summary>复制兼容版本的状态</summary><select aria-label="选择状态来源版本" value={sourceDigest} onChange={e => setSourceDigest(e.target.value)}><option value="">选择来源版本</option>{plugins.filter(p => p.manifest.id === choice.manifest.id && p.digest !== choice.digest && p.manifest.stateSchemaVersion === choice.manifest.stateSchemaVersion).map(p => <option key={p.digest} value={p.digest}>{p.manifest.version}</option>)}</select><button disabled={!sourceDigest} onClick={() => { if (confirm('将来源状态复制到所选版本？需无待执行任务，目标状态必须为空，来源会保留。')) void act('copy_state', { sourceDigest, targetDigest: choice.digest }); }}>复制到所选版本</button></details></>}
    <p>当前：{snapshot?.active?.manifest.name ?? '未启用'} · {snapshot?.display_ready ? '展示已就绪' : '等待展示'}</p><button onClick={() => void act('open_display')}>打开展示窗</button><button onClick={() => void act('disable')}>停用玩法</button></section>
    {snapshot?.active && <form className="control-form" onSubmit={e => { e.preventDefault(); void submit(); }}><SchemaFields schema={snapshot.active.input_schema} value={input} onChange={setInput} /><button disabled={busy}>{busy ? '提交中' : '加入队列'}</button></form>}
    <p role="status">{feedback || connectionError}</p>
    <section><h2>公共运行控制</h2><button onClick={() => void act(snapshot?.paused ? 'resume' : 'pause')}>{snapshot?.paused ? '继续' : '暂停'}</button><button onClick={() => void act('clear_pending')}>清空待执行</button>
    {snapshot?.current && <p>播放中：{snapshot.current.id.slice(0, 8)} <button onClick={() => void act('cancel', { id: snapshot.current?.id })}>取消当前</button></p>}
    <ul>{snapshot?.queue.map(task => <li key={task.id}>{JSON.stringify(task.input)} <button onClick={() => void act('cancel', { id: task.id })}>删除</button></li>)}</ul></section>
    <section><h2>本地记录</h2><button onClick={() => { if (confirm('清空记录及命令回执，开始新场？')) void act('clear_history'); }}>清空历史 / 新场</button><ul>{snapshot?.history.slice(-20).reverse().map(task => <li key={`${task.id}-${task.epoch}`}>{task.status} · {JSON.stringify(task.input)} {['failed', 'interrupted'].includes(task.status) && <button onClick={() => void act('retry', { id: task.id })}>明确重试</button>}</li>)}</ul></section>
    <details><summary>插件诊断</summary><button onClick={() => { void transport.command('diagnostics').then(messages => setFeedback(Array.isArray(messages) && messages.length ? messages.join('；') : '已安装插件校验正常')).catch(e => setFeedback(describe(e))); }}>检查安装包</button></details>
    <details><summary>离线导入插件</summary><label>本机 .lbplug 路径<input value={path} onChange={e => setPath(e.target.value)} /></label><button onClick={() => { if (confirm('导入该插件包？仅安装，随后需手动启用。')) void act('install', { path }); }}>校验并导入</button><p>导入前应核对发布者、公钥指纹和所需权限。正式模式拒绝未签名插件。</p></details>
    <details><summary>信任插件发布者</summary><label>发布者 ID<input value={publisher} onChange={e => setPublisher(e.target.value)} /></label><label>Ed25519 公钥（base64）<input value={key} onChange={e => setKey(e.target.value)} /></label><button onClick={() => { void (async () => { try { const bytes = Uint8Array.from(atob(key), c => c.charCodeAt(0)); if (bytes.length !== 32) throw new Error('公钥必须是 32 字节 Ed25519 公钥'); const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); const fingerprint = Array.from(digest, x => x.toString(16).padStart(2, '0')).join(''); if (confirm(`发布者：${publisher}\nSHA-256：${fingerprint}\n确认已通过独立渠道核实？`)) await act('trust_publisher', { publisher, publicKey: key }); } catch (e) { setFeedback(describe(e)); } })(); }}>保存信任</button></details>
  </main>;
}
