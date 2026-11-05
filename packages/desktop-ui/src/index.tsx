import { UI_NOTICES } from './ui-notices';
import { PluginsView } from './views/PluginsView';
import { useSnapshot, describe } from './state/useSnapshot';
import { defaults, SchemaFields } from './components/SchemaFields';
import type { Fields } from './components/SchemaFields';
import { AppShell } from './shell/AppShell';
import type { View } from './shell/AppShell';
import { ConfirmProvider, useConfirm } from './components/ConfirmProvider';
import '@liveboom/plugin-sdk/ui/styles';
import { useEffect, useState } from 'react';
import type { DesktopTransport, PluginInfo, Snapshot } from '@liveboom/plugin-sdk';
import { PresentationControl } from './PresentationControl';
import { PluginHost } from './PluginHost';
import { PluginControlHost } from './PluginControlHost';
export type { DesktopTransport } from '@liveboom/plugin-sdk';

/** Standalone renderer surface, also used by protocol integration fixtures. */
export function GameplaySurface({transport}: {transport:DesktopTransport}) {
  const {snapshot,error} = useSnapshot(transport);
  return <main className="display-root">{snapshot?.active && <PluginHost key={snapshot.active.digest} snapshot={snapshot} transport={transport}/>} {error&&<p className="display-error">{error}</p>}</main>;
}
export function DesktopApp({transport}: {transport:DesktopTransport}) {
  const {snapshot,error} = useSnapshot(transport);
  return <ConfirmProvider><Control transport={transport} snapshot={snapshot} connectionError={error}/></ConfirmProvider>;
}
function Control({ transport, snapshot, connectionError }: { transport: DesktopTransport; snapshot: Snapshot | null; connectionError: string }) {
  const ask = useConfirm();
  const [comfortable, setComfortable] = useState(() => { try { return localStorage.getItem('liveboom:comfortable') === 'true'; } catch { return false; } });
  useEffect(() => { document.documentElement.dataset.density = comfortable ? 'comfortable' : 'compact'; try { localStorage.setItem('liveboom:comfortable', String(comfortable)); } catch { /* Optional preference. */ } dispatchEvent(new Event('liveboom:appearance')); }, [comfortable]);
  const [view, setView] = useState<View>('workspace'), [layoutReset, setLayoutReset] = useState(0);
  useEffect(() => { const keydown = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); setView('settings'); } }; addEventListener('keydown', keydown); const command = () => setView('settings'); addEventListener('liveboom:settings', command); return () => { removeEventListener('keydown', keydown); removeEventListener('liveboom:settings', command); }; }, []);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [input, setInput] = useState<Fields>({});
  const [mediaFiles,setMediaFiles]=useState<[string,number][]>([]);
  const [license,setLicense]=useState('');const [mediaTarget,setMediaTarget]=useState('');const [sourceFilter,setSourceFilter]=useState('all');
  const [priority,setPriority]=useState(false); const [demoInterval,setDemoInterval]=useState(30);
  const [feedback, setFeedback] = useState(''); const [busy, setBusy] = useState(false);
  const refresh = () => transport.plugins().then(setPlugins);
  useEffect(() => { void refresh().catch(e => setFeedback(describe(e))); }, [transport]);
  useEffect(() => { setInput(snapshot?.active ? defaults(snapshot.active.input_schema) : {}); }, [snapshot?.active?.digest]);
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
  return <AppShell view={view} onView={setView} name={snapshot?.active?.manifest.name ?? '选择玩法'} ready={Boolean(snapshot?.display_ready)} paused={Boolean(snapshot?.paused)} queued={snapshot?.queue.length ?? 0} message={feedback || connectionError} onReset={() => { setLayoutReset(n => n + 1); setView('workspace'); }}>
    <PluginsView visible={view === 'plugins'} plugins={plugins} snapshot={snapshot} act={act} onError={setFeedback}/>
    <div className="workspace-view" hidden={view !== 'workspace'}>
    {!snapshot?.active && <div className="empty-workspace"><h1>开始本地互动</h1><p>选择已安装玩法，或导入新的玩法包。</p><button className="primary" onClick={async () => setView('plugins')}>选择玩法</button></div>}
    {custom && snapshot && <PluginControlHost key={snapshot.active!.digest} snapshot={snapshot} transport={transport} visible={view === 'workspace'} resetKey={layoutReset}/>}
    {!custom && snapshot?.active && <div className="generic-workspace-shell"><div className="generic-render display-root"><PluginHost key={snapshot.active.digest} snapshot={snapshot} transport={transport} visible={view==='workspace'}/></div><div className="generic-workspace">

    {snapshot?.active && <form className="control-form" onSubmit={e => { e.preventDefault(); void submit(); }}>{snapshot.active.examples?.length>0&&<label>本地示例模板<select defaultValue="" onChange={e=>{const example=snapshot.active?.examples[Number(e.target.value)];if(example)setInput(example.input);}}><option value="">选择示例（不会自动提交）</option>{snapshot.active.examples.map((example,i)=><option key={i} value={i}>{example.name}</option>)}</select></label>}<SchemaFields schema={snapshot.active.input_schema} value={input} onChange={setInput} /><label><input type="checkbox" checked={priority} onChange={e=>setPriority(e.target.checked)}/>优先排队（不打断当前）</label><button disabled={busy}>{busy ? '提交中' : '手动加入队列'}</button><button type="button" disabled={busy} onClick={async ()=>void submit(true)}>作为离线模拟事件提交</button>
    {snapshot.active.manifest.capabilities.includes('media.own.v1')&&<label><select aria-label="图像引用目标字段" value={mediaTarget} onChange={e=>setMediaTarget(e.target.value)}><option value="">选择引用目标字段（可稍后粘贴）</option>{Object.entries((snapshot.active.input_schema.properties??{}) as Fields).filter(([,p])=>(p as Fields).type==='string').map(([k,p])=><option key={k} value={k}>{String((p as Fields).title??k)}</option>)}</select>导入自有图像（PNG/JPEG，最大 8 MiB）<input type="file" accept="image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>8*1024*1024){setFeedback('图片最大 8 MiB');return;}void file.arrayBuffer().then(bytes=>transport.importMedia?.(Array.from(new Uint8Array(bytes)))).then(reference=>{if(reference){if(mediaTarget)setInput(v=>({...v,[mediaTarget]:reference}));setFeedback('已安全导入：'+reference);}}).catch(e=>setFeedback(describe(e)));}}/></label>}
    <label>空闲演示间隔<select value={demoInterval} onChange={e=>setDemoInterval(Number(e.target.value))}>{[15,30,60,120].map(n=><option key={n} value={n}>{n} 秒</option>)}</select></label><button type="button" onClick={async ()=>void act('demo_policy',{enabled:!snapshot.demo_enabled,interval:demoInterval,input})}>{snapshot.demo_enabled?'停止空闲演示':'显式开启空闲演示'}</button><button type="button" onClick={async ()=>{if(await ask('清除本场模拟任务与模拟记录，保留手动任务？'))void act('reset_demo');}}>重置演示</button><p>仅在空闲时发送当前表单内容，持续标记演示；重启后默认关闭。无平台连接。</p></form>}
    {snapshot?.active?.presentation_schema && <PresentationControl key={snapshot.active.digest} transport={transport} snapshot={snapshot} defaults={defaults} renderFields={(schema,value,onChange)=><SchemaFields schema={schema} value={value} onChange={onChange}/>}/>}
    {snapshot?.active?.manifest.capabilities.includes('media.own.v1')&&<details><summary>管理自有图像</summary><button onClick={async ()=>{void transport.command('media_list').then(v=>setMediaFiles(v as [string,number][])).catch(e=>setFeedback(describe(e)));}}>列出当前插件图片</button><p>最多 200 张、合计 200 MiB。历史或状态引用的图片无法删除。</p>{mediaFiles.map(([reference,size])=><p key={reference}><code>{reference}</code> · {Math.ceil(size/1024)} KiB <button onClick={async ()=>{if(await ask('删除此图像？'))void act('delete_media',{reference});}}>删除未引用图片</button></p>)}</details>}
    <p role="status">{feedback || connectionError}</p>
    <section><h2>公共运行控制</h2><p>等待事件：{snapshot?.queue.length??0} · 待制作份数：{[...(snapshot?.queue??[]),...(snapshot?.current?[snapshot.current]:[])].reduce((n,t)=>n+t.work_units-t.completed_units,0)} · 平台状态：未接入</p><button onClick={async () => void act(snapshot?.paused ? 'resume' : 'pause')}>{snapshot?.paused ? '继续' : '暂停'}</button><button onClick={async () => void act('clear_pending')}>清空待执行</button>
    {snapshot?.current && <p>播放中：{snapshot.current.id.slice(0, 8)} <button onClick={async () => void act('cancel', { id: snapshot.current?.id })}>取消当前</button><button onClick={async ()=>{if(await ask('暂停当前未完成份，先运行等待任务？已完成份不会重做。'))void act('preempt');}}>受控让位</button></p>}
    <ul>{snapshot?.queue.map(task => <li key={task.id}>{JSON.stringify(task.input)} <button onClick={async () => void act('cancel', { id: task.id })}>删除</button></li>)}</ul></section>
    </div></div>}
    </div>
    <div className="view-scroll history-view" hidden={view !== 'history'}>
    <section><h2>本地记录</h2><label>来源筛选<select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}><option value="all">全部本地</option><option value="manual">手动</option><option value="demo">离线演示</option></select></label><button onClick={async () => { if (await ask('清空记录及命令回执，开始新场？')) void act('clear_history'); }}>清空历史 / 新场</button><ul>{snapshot?.history.filter(t=>sourceFilter==='all'||t.source===sourceFilter).slice(-20).reverse().map(task => <li key={`${task.id}-${task.epoch}`}>{task.source==='demo'?'演示':'手动'} · {task.status} · {task.completed_units}/{task.work_units} · {new Date(task.created_at).toLocaleString()} · {task.plugin.manifest.name} · {Object.values(task.input).filter(value => typeof value === 'string').slice(0,2).join(' · ')} <details><summary>任务详情</summary><pre>{JSON.stringify({input:task.input,plan:task.plan},null,2)}</pre></details> {['failed', 'interrupted'].includes(task.status) && <button onClick={async () => void act('retry', { id: task.id })}>明确重试</button>}</li>)}</ul></section>
    </div>
    <div className="view-scroll settings-view" hidden={view !== 'settings'}><h1>应用设置</h1><label><input type="checkbox" checked={comfortable} onChange={e => setComfortable(e.target.checked)}/>舒适字号</label><p>界面布局随窗口自动调整。玩法画面随工作台可用空间自动调整。</p>
    <details><summary>运行环境</summary><button onClick={() => {void transport.command('runtime_info').then(v=>setFeedback(JSON.stringify(v))).catch(e=>setFeedback(describe(e)));}}>查看运行环境</button><button onClick={async () => {if(await ask('重启当前应用？在制任务会记录中断，需明确重试。'))void act('restart');}}>重启应用</button></details>
    <details><summary>插件诊断</summary><button onClick={async () => { void transport.command('diagnostics').then(messages => setFeedback(Array.isArray(messages) && messages.length ? messages.join('；') : '已安装插件校验正常')).catch(e => setFeedback(describe(e))); }}>检查安装包</button></details>
    </div>

    <div className="view-scroll settings-view" hidden={view !== 'about'}><details open><summary>帮助与关于 / About</summary><button onClick={() => setLicense(UI_NOTICES)}>查看客户端界面依赖许可</button><p>启用玩法后，画面直接显示在工作台内，可手动提交或显式演示。OBS / 直播伴侣可采集当前客户端窗口。该软件不包含真实直播事件接入或支付功能。</p><p>3D 模型、机械臂与渲染算法改编自 3d-printer-live。原作者：志哥AI，Copyright (c) 2026，MIT。Three.js revision 170，MIT。完整许可随插件 THIRD_PARTY_NOTICES 分发，并保存在 third_party/3d-printer-live/LICENSE。</p><button onClick={async ()=>{void transport.command('licenses').then(text=>setLicense(String(text))).catch(e=>setFeedback(describe(e)));}}>查看当前插件完整第三方许可</button>{license&&<pre className="license-text">{license}</pre>}</details>
    </div>
  </AppShell>;
}
