import { useEffect, useState } from 'react';
import type { DesktopTransport, PluginInfo, Snapshot } from '@likeboom/plugin-sdk';
import { PresentationControl } from './PresentationControl';
import { PluginHost } from './PluginHost';
import { PluginControlHost } from './PluginControlHost';
export type { DesktopTransport } from '@likeboom/plugin-sdk';

function describe(e: unknown): string { return typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e); }
function useSnapshot(transport: DesktopTransport) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    let active = true, version = -1, session = ''; let dispose: (() => void) | undefined;
    const apply = (s: Snapshot) => { if (active && s.version > version) { session = s.session_id; version = s.version; setSnapshot(s); setError(''); } };
    const refresh = () => (version>=0&&transport.changes?transport.changes(version,session):transport.snapshot()).then(s=>{if(s)apply(s);}).catch(e => { if (active) setError(describe(e)); });
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
  for (const [key, property] of Object.entries((schema.properties ?? {}) as Fields)) { const p = property as Fields; if ('default' in p) result[key] = p.default; else if (Array.isArray(p.enum) && p.enum.length) result[key] = p.enum[0]; else if (p.type === 'object') result[key] = defaults(p); else if (p.type === 'boolean') result[key] = false; else if (p.type === 'array') result[key] = []; }
  return result;
}
function SchemaFields({ schema, value, onChange }: { schema: Fields; value: Fields; onChange: (v: Fields) => void }) {
  const required = (schema.required ?? []) as string[];
  return <>{Object.entries((schema.properties ?? {}) as Fields).map(([name, raw]) => {
    const field = raw as Fields; const type = String(field.type); const options = field.enum as unknown[] | undefined;
    const change = (v: unknown) => onChange({ ...value, [name]: v });
    if(type==='object')return <fieldset key={name}><legend>{String(field.title??name)}</legend><SchemaFields schema={field} value={(value[name]??{}) as Fields} onChange={change}/></fieldset>;
    return <label key={name}>{String(field.title ?? name)}{required.includes(name) ? ' *' : ''}
      {type === 'array' ? <textarea aria-label={String(field.title ?? name)} value={JSON.stringify(value[name] ?? [])} onChange={e=>{try{const a=JSON.parse(e.target.value);if(Array.isArray(a)&&a.length<=Number(field.maxItems))change(a);}catch{/* keep last valid value */}}} /> : options ? <select value={JSON.stringify(value[name] ?? options[0])} onChange={e => change(JSON.parse(e.target.value))}>{options.map(v => <option key={JSON.stringify(v)} value={JSON.stringify(v)}>{String(v)}</option>)}</select> : type === 'boolean' ? <input type="checkbox" checked={Boolean(value[name])} onChange={e => change(e.target.checked)} /> : <input required={required.includes(name)} type={['integer', 'number'].includes(type) ? 'number' : 'text'} min={field.minimum as number | undefined} max={field.maximum as number | undefined} step={type === 'integer' ? 1 : 'any'} value={String(value[name] ?? '')} onChange={e => change(['integer', 'number'].includes(type) ? Number(e.target.value) : e.target.value)} />}
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
  const [migration,setMigration]=useState('{"mapping":{},"defaults":{}}');
  const [mediaFiles,setMediaFiles]=useState<[string,number][]>([]);
  const [license,setLicense]=useState('');const [mediaTarget,setMediaTarget]=useState('');const [sourceFilter,setSourceFilter]=useState('all');
  const [priority,setPriority]=useState(false); const [demoInterval,setDemoInterval]=useState(30);
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
  const submit = async (demo=false) => {
    setBusy(true);
    try { await transport.command(demo?'submit_demo':'submit', { command_id: crypto.randomUUID(), input, priority:priority?1:0 }); setInput(snapshot?.active ? defaults(snapshot.active.input_schema) : {}); setFeedback('已加入队列'); }
    catch (e) { setFeedback(describe(e)); } finally { setBusy(false); }
  };
  const custom = Boolean(snapshot?.active?.manifest.controlEntry);
  const controlUpgrade = !custom && snapshot?.active && plugins.find(p=>p.manifest.id===snapshot.active!.manifest.id&&p.manifest.controlEntry);
  return <main className={custom?'control-page control-page-custom':'control-page'}><h1>LikeBoom 公共玩法宿主</h1><p>本地互动 · 无需平台账号</p>
    {controlUpgrade&&<p role="status">当前版本使用通用表单。<button onClick={()=>{setSelected(controlUpgrade.digest);setConfig({...defaults(controlUpgrade.config_schema),...snapshot!.config});}}>选择带专属操作台的 {controlUpgrade.manifest.version} 版</button>选择后点击“启用玩法”；在制和等待任务需先处理。</p>}
    <details className="host-management" open={!custom}><summary>公共宿主管理 · 选择、启用与维护插件</summary><h2>玩法插件</h2><select aria-label="选择插件版本" value={selected} onChange={e => { setSelected(e.target.value); const p = plugins.find(p => p.digest === e.target.value); setConfig(p ? defaults(p.config_schema) : {}); }}><option value="">选择已安装插件</option>{plugins.map(p => <option key={p.digest} value={p.digest}>{p.manifest.name} · {p.manifest.version} · {p.digest.slice(0, 8)}</option>)}</select>
    {choice && <><SchemaFields schema={choice.config_schema} value={config} onChange={setConfig} /><button onClick={() => void act('activate', { digest: choice.digest, config })}>启用玩法</button>{snapshot?.active?.digest===choice.digest&&<button onClick={()=>void act('configure',config)}>应用到新任务规则</button>}<button onClick={() => { if (confirm('卸载该版本？被任务引用的版本会拒绝卸载。')) void act('uninstall', { digest: choice.digest }); }}>卸载版本</button><details><summary>复制兼容版本的状态</summary><select aria-label="选择状态来源版本" value={sourceDigest} onChange={e => setSourceDigest(e.target.value)}><option value="">选择来源版本</option>{plugins.filter(p => p.manifest.id === choice.manifest.id && p.digest !== choice.digest && p.manifest.stateSchemaVersion === choice.manifest.stateSchemaVersion).map(p => <option key={p.digest} value={p.digest}>{p.manifest.version}</option>)}</select><button disabled={!sourceDigest} onClick={() => { if (confirm('将来源状态复制到所选版本？需无待执行任务，目标状态必须为空，来源会保留。')) void act('copy_state', { sourceDigest, targetDigest: choice.digest }); }}>复制到所选版本</button></details><details><summary>跨 schema 数据迁移</summary><p>由插件作者提供键映射和默认值；目标必须为空，来源保留用于回退。映射不会执行代码。</p><select value={sourceDigest} onChange={e=>setSourceDigest(e.target.value)}><option value="">选择不同 schema 的来源</option>{plugins.filter(p=>p.manifest.id===choice.manifest.id&&p.manifest.publisher===choice.manifest.publisher&&p.manifest.stateSchemaVersion!==choice.manifest.stateSchemaVersion).map(p=><option key={p.digest} value={p.digest}>{p.manifest.version} · schema {p.manifest.stateSchemaVersion}</option>)}</select><textarea aria-label="迁移键映射 JSON" value={migration} onChange={e=>setMigration(e.target.value)}/><button disabled={!sourceDigest} onClick={()=>{try{const spec=JSON.parse(migration);if(confirm('按当前映射写入目标版本？目标插件负责解释新状态，原状态将保留。'))void act('migrate_state',{sourceDigest,targetDigest:choice.digest,mapping:spec.mapping,defaults:spec.defaults});}catch(e){setFeedback(describe(e));}}}>检查并迁移到所选版本</button></details></>}
    <p>当前：{snapshot?.active?.manifest.name ?? '未启用'} · {snapshot?.display_ready ? '展示已就绪' : '等待展示'}</p><button onClick={() => void act('open_display')}>打开展示窗</button><button onClick={() => void act('disable')}>停用玩法</button></details>
    {custom && snapshot && <PluginControlHost key={snapshot.active!.digest} snapshot={snapshot} transport={transport}/>}
    {!custom && <>
    {snapshot?.active && <form className="control-form" onSubmit={e => { e.preventDefault(); void submit(); }}>{snapshot.active.examples?.length>0&&<label>本地示例模板<select defaultValue="" onChange={e=>{const example=snapshot.active?.examples[Number(e.target.value)];if(example)setInput(example.input);}}><option value="">选择示例（不会自动提交）</option>{snapshot.active.examples.map((example,i)=><option key={i} value={i}>{example.name}</option>)}</select></label>}<SchemaFields schema={snapshot.active.input_schema} value={input} onChange={setInput} /><label><input type="checkbox" checked={priority} onChange={e=>setPriority(e.target.checked)}/>优先排队（不打断当前）</label><button disabled={busy}>{busy ? '提交中' : '手动加入队列'}</button><button type="button" disabled={busy} onClick={()=>void submit(true)}>作为离线模拟事件提交</button>
    {snapshot.active.manifest.capabilities.includes('media.own.v1')&&<label><select aria-label="图像引用目标字段" value={mediaTarget} onChange={e=>setMediaTarget(e.target.value)}><option value="">选择引用目标字段（可稍后粘贴）</option>{Object.entries((snapshot.active.input_schema.properties??{}) as Fields).filter(([,p])=>(p as Fields).type==='string').map(([k,p])=><option key={k} value={k}>{String((p as Fields).title??k)}</option>)}</select>导入自有图像（PNG/JPEG，最大 8 MiB）<input type="file" accept="image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>8*1024*1024){setFeedback('图片最大 8 MiB');return;}void file.arrayBuffer().then(bytes=>transport.importMedia?.(Array.from(new Uint8Array(bytes)))).then(reference=>{if(reference){if(mediaTarget)setInput(v=>({...v,[mediaTarget]:reference}));setFeedback('已安全导入：'+reference);}}).catch(e=>setFeedback(describe(e)));}}/></label>}
    <label>空闲演示间隔<select value={demoInterval} onChange={e=>setDemoInterval(Number(e.target.value))}>{[15,30,60,120].map(n=><option key={n} value={n}>{n} 秒</option>)}</select></label><button type="button" onClick={()=>void act('demo_policy',{enabled:!snapshot.demo_enabled,interval:demoInterval,input})}>{snapshot.demo_enabled?'停止空闲演示':'显式开启空闲演示'}</button><button type="button" onClick={()=>{if(confirm('清除本场模拟任务与模拟记录，保留手动任务？'))void act('reset_demo');}}>重置演示</button><p>仅在空闲时发送当前表单内容，持续标记演示；重启后默认关闭。无平台连接。</p></form>}
    {snapshot?.active?.presentation_schema && <PresentationControl key={snapshot.active.digest} transport={transport} snapshot={snapshot} defaults={defaults} renderFields={(schema,value,onChange)=><SchemaFields schema={schema} value={value} onChange={onChange}/>}/>}
    {snapshot?.active?.manifest.capabilities.includes('media.own.v1')&&<details><summary>管理自有图像</summary><button onClick={()=>{void transport.command('media_list').then(v=>setMediaFiles(v as [string,number][])).catch(e=>setFeedback(describe(e)));}}>列出当前插件图片</button><p>最多 200 张、合计 200 MiB。历史或状态引用的图片无法删除。</p>{mediaFiles.map(([reference,size])=><p key={reference}><code>{reference}</code> · {Math.ceil(size/1024)} KiB <button onClick={()=>{if(confirm('删除此图像？'))void act('delete_media',{reference});}}>删除未引用图片</button></p>)}</details>}
    <p role="status">{feedback || connectionError}</p>
    <section><h2>公共运行控制</h2><p>等待事件：{snapshot?.queue.length??0} · 待制作份数：{[...(snapshot?.queue??[]),...(snapshot?.current?[snapshot.current]:[])].reduce((n,t)=>n+t.work_units-t.completed_units,0)} · 平台状态：未接入</p><button onClick={() => void act(snapshot?.paused ? 'resume' : 'pause')}>{snapshot?.paused ? '继续' : '暂停'}</button><button onClick={() => void act('clear_pending')}>清空待执行</button>
    {snapshot?.current && <p>播放中：{snapshot.current.id.slice(0, 8)} <button onClick={() => void act('cancel', { id: snapshot.current?.id })}>取消当前</button><button onClick={()=>{if(confirm('暂停当前未完成份，先运行等待任务？已完成份不会重做。'))void act('preempt');}}>受控让位</button></p>}
    <ul>{snapshot?.queue.map(task => <li key={task.id}>{JSON.stringify(task.input)} <button onClick={() => void act('cancel', { id: task.id })}>删除</button></li>)}</ul></section>
    <section><h2>本地记录</h2><label>来源筛选<select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}><option value="all">全部本地</option><option value="manual">手动</option><option value="demo">离线演示</option></select></label><button onClick={() => { if (confirm('清空记录及命令回执，开始新场？')) void act('clear_history'); }}>清空历史 / 新场</button><ul>{snapshot?.history.filter(t=>sourceFilter==='all'||t.source===sourceFilter).slice(-20).reverse().map(task => <li key={`${task.id}-${task.epoch}`}>{task.source==='demo'?'演示':task.source==='manual'?'手动':'旧版本地'} · {task.status} · {task.completed_units}/{task.work_units} · {task.created_at?new Date(task.created_at).toLocaleString():'旧版时间未记录'} · {JSON.stringify(task.plan??task.input)} {['failed', 'interrupted'].includes(task.status) && <button onClick={() => void act('retry', { id: task.id })}>明确重试</button>}</li>)}</ul></section>
    </>}
    {custom && (feedback||connectionError) && <p role="status">{feedback||connectionError}</p>}
    <details><summary>宿主与采集兼容</summary><button onClick={()=>{void transport.command('runtime_info').then(v=>setFeedback(JSON.stringify(v))).catch(e=>setFeedback(describe(e)));}}>查看运行环境</button><button onClick={()=>void act('capture_mode',{enabled:true})}>Windows 采集兼容：软件渲染</button><button onClick={()=>void act('capture_mode',{enabled:false})}>恢复硬件渲染</button><button onClick={()=>{if(confirm('重启当前应用？在制任务会记录中断，需明确重试。'))void act('restart');}}>重启应用</button><p>兼容选项在下次创建展示窗时生效，可重启应用应用设置；软件渲染可能降低帧率，需在目标采集工具实测。</p></details>
    <details><summary>插件诊断</summary><button onClick={() => { void transport.command('diagnostics').then(messages => setFeedback(Array.isArray(messages) && messages.length ? messages.join('；') : '已安装插件校验正常')).catch(e => setFeedback(describe(e))); }}>检查安装包</button></details>
    <details><summary>离线导入插件</summary><label>本机 .lbplug 路径<input value={path} onChange={e => setPath(e.target.value)} /></label><button onClick={() => { if (confirm('导入该插件包？仅安装，随后需手动启用。')) void act('install', { path }); }}>校验并导入</button><p>导入前应核对发布者、公钥指纹和所需权限。正式模式拒绝未签名插件。</p></details>
    <details><summary>信任插件发布者</summary><label>发布者 ID<input value={publisher} onChange={e => setPublisher(e.target.value)} /></label><label>Ed25519 公钥（base64）<input value={key} onChange={e => setKey(e.target.value)} /></label><button onClick={() => { void (async () => { try { const bytes = Uint8Array.from(atob(key), c => c.charCodeAt(0)); if (bytes.length !== 32) throw new Error('公钥必须是 32 字节 Ed25519 公钥'); const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); const fingerprint = Array.from(digest, x => x.toString(16).padStart(2, '0')).join(''); if (confirm(`发布者：${publisher}\nSHA-256：${fingerprint}\n确认已通过独立渠道核实？`)) await act('trust_publisher', { publisher, publicKey: key }); } catch (e) { setFeedback(describe(e)); } })(); }}>保存信任</button></details>
    <details><summary>帮助与关于 / About</summary><p>先启用玩法、打开展示窗，再手动提交或显式演示。OBS / 直播伴侣请选择 LikeBoom 展示窗进行窗口采集。该软件不包含真实直播事件接入或支付功能。</p><p>3D 模型、机械臂与渲染算法改编自 3d-printer-live。原作者：志哥AI，Copyright (c) 2026，MIT。Three.js revision 170，MIT。完整许可随插件 THIRD_PARTY_NOTICES 分发，并保存在 third_party/3d-printer-live/LICENSE。</p><button onClick={()=>{void transport.command('licenses').then(text=>setLicense(String(text))).catch(e=>setFeedback(describe(e)));}}>查看当前插件完整第三方许可</button>{license&&<pre className="license-text">{license}</pre>}</details>
  </main>;
}
