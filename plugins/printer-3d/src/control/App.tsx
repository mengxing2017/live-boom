// UI layout and interaction adapted from 3d-printer-live, Copyright (c) 2026 志哥AI, MIT.
// React state and all host interactions are rewritten for LikeBoom's plugin boundary.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { connectControl } from '@likeboom/plugin-sdk/control';
import type { ControlState, ControlTask } from '@likeboom/plugin-sdk/control';
import './studio.css';
import { PRESENTATION } from '../settings.js';
type Fields = Record<string, unknown>;
type Rule = {
    enabled: boolean;
    units: number;
    size: string;
};
type Config = {
    duration: number;
    speed: number;
    score: boolean;
    speech: boolean;
    rules: Record<string, Rule>;
};
const events = [['manual', '手动制作', '✎'], ['comment', '评论 666', '✉'], ['like', '点赞', '＋'], ['follow', '关注', '☆'], ['join', '进入', '↳'], ['heart', '爱心', '♡'], ['beer', '啤酒', '♧'], ['lollipop', '棒棒糖', '◎'], ['other', '其他', '◇']];
const eventName = (value: unknown) => events.find(([key]) => key === value)?.[1] ?? String(value ?? '手动');
const sourceName = (s: string) => s === 'demo' ? '离线模拟' : s === 'manual' ? '手动' : '旧版本地';
function Panel({ title, tag, children, action }: {
    title: string;
    tag: string;
    children: ReactNode;
    action?: ReactNode;
}) { return <section className="panel"><header className="panel-heading"><h2>{title}<small>{tag}</small></h2>{action}</header><div className="panel-body">{children}</div></section>; }
function Avatar({ name, src }: {
    name: unknown; src?: string;
}) { const text = String(name ?? '访客'); let h = 0; for (const c of text)
    h = (h * 31 + c.codePointAt(0)!) % 360; return <span className="avatar" style={{ background: `hsl(${h} 36% 38%)` }}>{src?<img src={src} alt={text}/>:Array.from(text).slice(0, 2).join('')}</span>; }
function Toggle({ label, checked, onChange }: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) { return <label className="toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></label>; }
function Choice({ label, value, options, onChange }: {
    label: string;
    value: unknown;
    options: (string | number | [
        string | number,
        string
    ])[];
    onChange: (v: string) => void;
}) { return <label className="field"><span>{label}</span><select value={String(value ?? '')} onChange={e => onChange(e.target.value)}>{options.map(option => { const [v, text] = Array.isArray(option) ? option : [option, String(option)]; return <option key={v} value={v}>{text}</option>; })}</select></label>; }
function App() {
    const [mediaImages,setMediaImages]=useState<Record<string,string>>({});
    const [state, setState] = useState<ControlState | null>(null), [preview, setPreview] = useState(''), [metrics, setMetrics] = useState<Fields>({}), [exportReady, setExportReady] = useState(false);
    const bridge = useRef<ReturnType<typeof connectControl> | null>(null), image = useRef(''), pendingImage=useRef(''), drag = useRef<{
        x: number;
        y: number;
    } | null>(null);
    const [config, setConfig] = useState<Config | null>(null), [presentation, setPresentation] = useState<Fields>({}), presentationRef = useRef<Fields>({});
    const [nickname, setNickname] = useState('橘子汽水'), [content, setContent] = useState('portrait'), [media, setMedia] = useState(''), [quantity, setQuantity] = useState(1), [event, setEvent] = useState('manual'), [priority, setPriority] = useState(false);
    const [feedback, setFeedback] = useState(''), [busy, setBusy] = useState(false), [log, setLog] = useState<string[]>([]), [interval, setIntervalValue] = useState(30), [filter, setFilter] = useState('all');
    const [views, setViews] = useState<{
        name: string;
    }[]>([]), [viewName, setViewName] = useState(''), [voices, setVoices] = useState<{
        name: string;
        lang: string;
    }[]>([]), [license, setLicense] = useState('');
    const [mediaFiles, setMediaFiles] = useState<[
        string,
        number
    ][]>([]), [people, setPeople] = useState<{
        name: string;
        reference: string;
    }[]>([]);
    useLayoutEffect(() => {
        const client = connectControl(data => {
            if (data.type === 'state')
                setState(s => !s || data.value.version > s.version ? data.value : s);
            else if (data.type === 'metrics')
                setMetrics(data.value);
            else if (data.type === 'export.ready')
                setExportReady(true);
            else if (data.type === 'preview') {
                // One undecoded frame at a time: never revoke the image React is about to commit.
                if(pendingImage.current)return;
                const bytes=new Uint8Array(data.bytes);let binary='';
                for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
                const url='data:image/jpeg;base64,'+btoa(binary);
                if(url===image.current)return; // A paused scene may send identical frames; no load event would follow.
                pendingImage.current=url;
                setPreview(url);
            }
        });
        bridge.current = client;
        const observer = new ResizeObserver(() => client.resize(document.body.getBoundingClientRect().height + 8));
        observer.observe(document.body);
        return () => { observer.disconnect(); client.dispose(); bridge.current = null; image.current='';pendingImage.current=''; };
    }, []);
    const configKey = JSON.stringify(state?.config), presentationKey = JSON.stringify(state?.presentation);
    useEffect(() => { if (state)
        setConfig(state.config as Config); }, [configKey]);
    useEffect(() => { if (state) {
        const value = { ...PRESENTATION, ...state.presentation };
        setPresentation(value);
        presentationRef.current = value;
    } }, [presentationKey]);
    const previewLoaded=(url:string,ok:boolean)=>{if(url!==pendingImage.current)return;if(ok)image.current=url;else setPreview(image.current);pendingImage.current='';};
    const request = (method: string, params: Fields = {}, bytes?: ArrayBuffer) => bridge.current?.request(method, params, bytes) ?? Promise.reject(new Error('尚未连接'));
    const command = (name: string, args: Fields = {}) => request('command', { name, args });
    const record = (text: string) => { setFeedback(text); setLog(lines => [`${new Date().toLocaleTimeString()} · ${text}`, ...lines].slice(0, 20)); };
    const run = async (action: () => Promise<unknown>, success = '操作成功') => { setBusy(true); try {
        await action();
        record(success);
    }
    catch (e) {
        record(String(e));
    }
    finally {
        setBusy(false);
    } };
    const previewControl = (args: Fields) => command('preview_control', args);
    const input = (kind = event) => ({ nickname, content, media, event: kind, quantity });
    const submit = (demo: boolean, kind = event) => run(() => command(demo ? 'submit_demo' : 'submit', { command_id: crypto.randomUUID(), input: input(kind), priority: priority ? 1 : 0 }), `${nickname} · ${eventName(kind)} · 已加入${demo ? '模拟' : '手动'}队列`);
    const updatePresentation = (patch: Fields) => { const next = { ...presentationRef.current, ...patch }; presentationRef.current = next; setPresentation(next); void run(() => command('presentation', next), '画面设置已更新'); };
    const loadViews = async () => { const value = await command('read_preferences', { key: 'views' }); setViews(Array.isArray(value) ? value : []); };
    const camera = async (args: Fields) => { await previewControl(args); if (['saveCamera', 'deleteCamera'].includes(String(args.op))) {
        await new Promise(r => setTimeout(r, 350));
        await loadViews();
    } };
    const importFiles = (files: FileList | null) => { if (!files)
        return; void run(async () => { const imported: {
        name: string;
        reference: string;
    }[] = []; for (const file of Array.from(files).slice(0, 20)) {
        if (file.size > 8388608 || !['image/png', 'image/jpeg'].includes(file.type))
            throw new Error('仅支持 8 MiB 以内的 PNG/JPEG');
        const reference = String(await request('media.import', {}, await file.arrayBuffer()));
        imported.push({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 32) || '访客', reference });
    } setPeople(old => [...imported, ...old].slice(0, 200)); if (imported[0]) {
        setMedia(imported[0].reference);
        setNickname(imported[0].name);
    } }, '自有图像已导入，可选择后制作'); };
    const mediaKey=JSON.stringify(Array.from(new Set([media,...(state?.current?[String(state.current.input.media??'')]:[]),...(state?.queue??[]).map(t=>String(t.input.media??'')),...(state?.history??[]).slice(-20).map(t=>String(t.input.media??''))])).filter(v=>v.startsWith('media:')).slice(0,20));
    useEffect(()=>{let active=true;void (async()=>{for(const reference of JSON.parse(mediaKey) as string[]){if(mediaImages[reference])continue;try{const url=await command('media_resolve',{reference});if(active&&typeof url==='string'&&url.startsWith('data:image/png;base64,'))setMediaImages(v=>({...v,[reference]:url}));}catch{/* Historical missing media keeps the initials fallback. */}}})();return()=>{active=false;};},[mediaKey]);
    const scenario=()=>run(async()=>{for(const [i,kind] of ['comment','heart','beer','lollipop'].entries()){if(!(state?.config as Config).rules[kind]?.enabled)continue;const person=people[i]??{name:String(state?.active.examples[i]?.input.nickname??nickname),reference:''};await command('submit_demo',{command_id:crypto.randomUUID(),input:{nickname:person.name,content,media:person.reference,event:kind,quantity:1},priority:kind==='comment'?0:1});record(`${person.name} · ${eventName(kind)} · 模拟事件已提交`);}},'规则演示已提交；若遇容量限制，已接受的事件保留');
    if (!state || !config)
        return <div className="connecting" role="status">正在连接 3D 制作台…</div>;
    const current = state.current, queueUnits = state.queue.reduce((n, t) => n + t.work_units - t.completed_units, 0), done = [...state.history, ...state.queue].reduce((n, t) => n + t.completed_units, 0) + (current?.completed_units ?? 0);
    const rules = config.rules, appliedRules=(state.config as Config).rules, activeRule = appliedRules[event];
    const dirty = JSON.stringify(config) !== configKey;
    const units = (t: ControlTask) => Array.isArray(t.plan?.units) ? t.plan.units as {
        score: number;
        size: string;
    }[] : [];
    const row = (task: ControlTask, history = false) => <li key={`${task.id}/${task.epoch}`} className="task-row"><Avatar name={task.input.nickname} src={mediaImages[String(task.input.media??'')]}/><div className="task-copy"><strong>{String(task.input.nickname ?? '访客')}</strong><small>{sourceName(task.source)} · {eventName(task.input.event)} · {task.completed_units}/{task.work_units} 份{task.priority ? ' · 优先' : ''}</small>{history && <small>{task.created_at ? new Date(task.created_at).toLocaleTimeString() : '旧版时间未记录'} · {({ completed: '已完成', failed: '失败', interrupted: '中断', cancelled: '已取消', running: '制作中', queued: '等待中' })[task.status]}{units(task).slice(0, task.completed_units).map((u, i) => <span key={i}> · {u.size === 'large' ? '大' : '小'}图 {u.score}分</span>)}</small>}</div>{history ? ['failed', 'interrupted'].includes(task.status) && <button onClick={() => void run(() => command('retry', { id: task.id }), '已按冻结计划重试')}>重试</button> : <button className="quiet danger" aria-label={`移除${String(task.input.nickname)}`} onClick={() => void run(() => command('cancel', { id: task.id }))}>移除</button>}</li>;
    return <div className="studio">
  <header className="studio-header"><div className="brand"><span className="brand-icon">▧</span><div><b>3D 制作台</b><small>PRINT STUDIO · LIKEBOOM</small></div></div><div className="connection"><i />{state.display_ready ? '展示已就绪' : '展示未打开'}<span>独立娱乐 · 未接入平台</span></div><button className="primary" onClick={() => void run(() => command('open_display'), '展示窗口已打开')}>打开展示窗 ↗</button></header>
  <div className="page-title"><div><h1>把每一次互动，制作成作品。</h1><p>逐层制作 · 机械臂转运 · 成品展示</p></div><span className="mode-badge">● 本地互动</span></div>
  <div className="studio-grid"><div className="main-column">
   <section className="panel stage-panel"><header className="panel-heading"><h2>打印现场<small>LIVE PREVIEW</small></h2><span className="subtle">拖动预览调整机位 · 独立窗口高清输出</span></header>
    <div className="stage-preview">{preview ? <img src={preview} alt="3D 制作现场预览" onLoad={e=>previewLoaded(e.currentTarget.src,true)} onError={e=>previewLoaded(e.currentTarget.src,false)} draggable={false} onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => { const from = drag.current; drag.current = null; if (from)
        void run(() => previewControl({ op: 'orbit', dx: (e.clientX - from.x) / 300, dy: (e.clientY - from.y) / 300 }), '镜头已调整'); }}/> : <div className="preview-empty"><span>▧</span><h3>你的制作现场，即将开始</h3><p>打开独立展示窗，即可在这里查看实时画面</p><button onClick={() => void run(() => command('open_display'))}>打开展示窗</button></div>}
    <span className="preview-label">PRINTER 01 · {state.paused ? 'PAUSED' : current ? 'WORKING' : 'STANDBY'}</span><div className="current-card"><Avatar name={current?.input.nickname ?? '待命'} src={mediaImages[String(current?.input.media??'')]}/><div><strong>{String(current?.input.nickname ?? '等待下一位创作者')}</strong><small>{current ? `${sourceName(current.source)} · 已交付 ${current.completed_units}/${current.work_units} 份` : '手动加入作品，或选择右侧规则模拟'}</small></div>{current && <b>{current.completed_units}/{current.work_units}</b>}</div></div>
    <div className="stage-toolbar"><button className="primary" disabled={busy} onClick={() => void submit(true, 'manual')}>＋ 添加演示作品</button><button onClick={() => void run(() => command(state.paused ? 'resume' : 'pause'))}>{state.paused ? '继续制作' : '暂停制作'}</button><button disabled={!current} onClick={() => void run(() => command('cancel', { id: current?.id }), '已取消当前任务')}>跳过当前</button><button disabled={!current || !state.queue.length} onClick={() => void run(() => command('preempt'))}>受控让位</button><span>评分为 60–95 随机娱乐分数</span></div>
    <div className="sound-bar"><button aria-pressed={!Boolean(presentation.mute)} onClick={() => updatePresentation({ mute: !presentation.mute })}>{presentation.mute ? '打开声音' : '静音'}</button><label>音量<input aria-label="音量" type="range" min="0" max="1" step="0.05" value={Number(presentation.volume ?? .4)} onChange={e => updatePresentation({ volume: Number(e.target.value) })}/></label><button onClick={() => void run(() => previewControl({ op: 'audioTest', path: 'assets/audio/printing-writing.wav' }))}>测试打印音</button><span>首次使用须在展示窗点击“启用声音”</span></div>
   </section>
   <Panel title="手动制作" tag="CREATE"><form className="create-form" onSubmit={e=>e.preventDefault()} onKeyDown={e=>{if(e.key==='Enter'&&e.target instanceof HTMLInputElement){e.preventDefault();if(e.currentTarget.reportValidity()&&!busy&&activeRule?.enabled)void submit(false);}}}><label className="field"><span>昵称 / 要展示的文字</span><input aria-label="昵称 / 要展示的文字" maxLength={32} required value={nickname} onChange={e => setNickname(e.target.value)}/></label><Choice label="制作内容" value={content} options={[["portrait", "头像作品"], ["text", "昵称文字"]]} onChange={setContent}/><Choice label="事件规则" value={event} options={events.map(([v, label]) => [v, label])} onChange={setEvent}/><label className="field"><span>事件数量</span><input aria-label="事件数量" type="number" min={1} max={100} value={quantity} onChange={e => setQuantity(Number(e.target.value))}/></label><label className="toggle"><span>优先排队（不打断当前）</span><input type="checkbox" checked={priority} onChange={e => setPriority(e.target.checked)}/></label><div className="form-actions"><span>{activeRule?.enabled ? `本次 ${quantity * activeRule.units} 份 · ${activeRule.size === 'large' ? '大' : '小'}图` : '该规则已禁用'}{media ? ' · 已选择自有图像' : ' · 使用合成首字头像'}</span>{media&&<Avatar name={nickname} src={mediaImages[media]}/>}<button type="button" className="primary" disabled={busy || !activeRule?.enabled} onClick={e=>{if(e.currentTarget.form?.reportValidity())void submit(false);}}>加入手动队列</button></div></form></Panel>
   <Panel title="场景与画面" tag="SCENE"><div className="settings-grid"><Choice label="场景" value={presentation.theme} options={[["home", "温馨家庭"], ["study", "日光书房"], ["night", "雨夜工作角"], ["workshop", "复古手作室"], ["garden", "清新植物房"]]} onChange={theme => updatePresentation({ theme })}/><Choice label="画质" value={presentation.quality} options={[["lite", "轻量"], ["balanced", "均衡"], ["high", "高清"], ["ultra", "超清"], ["max", "极致"]]} onChange={quality => updatePresentation({ quality })}/><Choice label="抗锯齿" value={presentation.aa} options={[["off", "关闭"], ["msaa2", "MSAA 2×"], ["msaa4", "MSAA 4×"], ["msaa8", "MSAA 8×"], ["ssaa15", "SSAA 1.5×"], ["ssaa2", "SSAA 2×"]]} onChange={aa => updatePresentation({ aa })}/><Choice label="目标帧率" value={presentation.fps} options={[24, 30, 60, 90, 120]} onChange={fps => updatePresentation({ fps: Number(fps) })}/><Choice label="输出尺寸" value={String(metrics.size ?? '1280,720')} options={[["1280,720", "横屏 720p"], ["1920,1080", "横屏 1080p"], ["720,1280", "竖屏 720p"], ["1080,1920", "竖屏 1080p"]]} onChange={size => { setMetrics(v => ({ ...v, size })); const [width, height] = size.split(',').map(Number); void run(() => command('resize_display', { width, height })); }}/><Choice label="画面语言" value={presentation.language} options={[["zh-CN", "中文"], ["en", "English"]]} onChange={language => updatePresentation({ language })}/></div><div className="toggle-grid">{[['smooth', '流畅优先'], ['overlay', '状态牌'], ['shadows', '阴影'], ['reflections', '反射'], ['effects', '扫光']].map(([key, label]) => <Toggle key={key} label={label} checked={Boolean(presentation[key])} onChange={value => updatePresentation({ [key]: value })}/>)}</div><div className="camera-bar"><button onClick={() => void run(() => camera({ op: 'resetCamera' }))}>恢复初始视角</button><button onClick={() => void run(() => camera({ op: 'zoom', factor: .9 }))}>放大 ＋</button><button onClick={() => void run(() => camera({ op: 'zoom', factor: 1.1 }))}>缩小 −</button><input aria-label="镜头名称" placeholder="给当前镜头起个名字" maxLength={32} value={viewName} onChange={e => setViewName(e.target.value)}/><button disabled={!viewName || views.length >= 10} onClick={() => void run(() => camera({ op: 'saveCamera', name: viewName }), '镜头已保存')}>保存机位</button><button onClick={() => void run(loadViews)}>读取机位</button></div>{views.length > 0 && <div className="saved-views">{views.map((v, index) => <span key={index}><button onClick={() => void run(() => camera({ op: 'loadCamera', index }))}>{v.name}</button><button aria-label={`删除镜头${v.name}`} onClick={() => void run(() => camera({ op: 'deleteCamera', index }))}>×</button></span>)}</div>}<p className="note">实测 {String(metrics.fps ?? '--')} FPS · 渲染尺寸 {Array.isArray(metrics.internal) ? metrics.internal.join(' × ') : '--'} · 预览低帧传输，采集请选择独立展示窗。</p></Panel>
   <Panel title="声音与互动播报" tag="AUDIO"><Toggle label="本地语音与字幕" checked={config.speech} onChange={speech => setConfig({ ...config, speech })}/><div className="settings-grid"><Choice label="本地语音" value={presentation.voice} options={[["", "按语言自动选择"], ...voices.map(v => [v.name, `${v.name} · ${v.lang}`] as [
            string,
            string
        ])]} onChange={voice => updatePresentation({ voice })}/><label className="field"><span>语速 {String(presentation.rate ?? 1)}×</span><input aria-label="语速" type="range" min={.5} max={2} step={.05} value={Number(presentation.rate ?? 1)} onChange={e => updatePresentation({ rate: Number(e.target.value) })}/></label></div><div className="row"><button onClick={() => void run(async () => { const value = await request('voices'); setVoices(Array.isArray(value) ? value : []); })}>刷新本地语音</button><button onClick={() => void run(() => previewControl({ op: 'speechTest', text: '欢迎来到制作台，祝你今天有个好心情。' }))}>试听播报</button><button disabled={!dirty || busy} onClick={() => void run(() => command('configure', config), '新任务规则已保存')}>保存新任务设置</button></div><p className="note">只使用设备本地语音；未找到语音时显示字幕。播报开关随下方规则一并保存。</p></Panel>
   <Panel title="打印记录" tag="PRINT LOG" action={<select aria-label="记录来源" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部本地</option><option value="manual">手动</option><option value="demo">离线模拟</option></select>}><ul className="task-list history-list">{state.history.filter(t => filter === 'all' || t.source === filter).slice().reverse().map(t => row(t, true))}</ul>{!state.history.length && <p className="empty">还没有制作记录，等第一份作品完成。</p>}<button className="quiet danger" onClick={() => void run(() => command('clear_history'))}>清空记录 / 开始新场</button></Panel>
  </div><aside className="side-column">
   <Panel title="本场数据" tag="SESSION"><div className="stats"><div><small>已交付</small><b>{done}<em>份</em></b></div><div><small>等待制作</small><b>{queueUnits}<em>份</em></b></div><div><small>当前任务</small><b>{current ? 1 : 0}<em>项</em></b></div></div><p className="note">只统计本地任务；不代表平台点赞、评论或礼物数据。</p></Panel>
   <Panel title="规则演示台" tag="LOCAL DEMO"><Choice label="测试观众" value={nickname} options={Array.from(new Set([nickname, ...state.active.examples.map(x => String(x.input.nickname)), ...people.map(x => x.name)]))} onChange={name => { setNickname(name); setMedia(people.find(p => p.name === name)?.reference ?? ''); }}/><div className="rule-buttons">{['comment', 'heart', 'beer', 'lollipop'].map(kind => <button disabled={busy || !appliedRules[kind]?.enabled} key={kind} onClick={() => void submit(true, kind)}><b>{events.find(([k]) => k === kind)?.[2]}</b>{eventName(kind)}<small>{appliedRules[kind]?.units}份{appliedRules[kind]?.size === 'large' ? '大' : '小'}图</small></button>)}</div><div className="row"><button disabled={busy} onClick={()=>void scenario()}>运行规则演示</button></div><p className="note">全部为离线测试事件，优先任务仅优先排队；需打断时使用“受控让位”。</p><label className="upload">＋ 批量导入自有头像<input aria-label="批量导入自有头像" type="file" multiple accept="image/png,image/jpeg" onChange={e => importFiles(e.target.files)}/></label><p className="note">单次最多 20 张，PNG/JPEG ≤8 MiB；图片只保存在本机。</p>{people.length > 0 && <Choice label="已导入图像" value={media} options={[["", "使用合成首字头像"], ...people.map(p => [p.reference, p.name] as [
            string,
            string
        ])]} onChange={reference => { setMedia(reference); const person = people.find(p => p.reference === reference); if (person)
        setNickname(person.name); }}/>}<Choice label="空闲演示间隔" value={interval} options={[[15, '15 秒'], [30, '30 秒'], [60, '60 秒'], [120, '120 秒']]} onChange={value => setIntervalValue(Number(value))}/><div className="row"><button disabled={busy} onClick={() => void run(() => command('demo_policy', { enabled: !state.demo_enabled, interval, input: input() }))}>{state.demo_enabled ? '停止空闲演示' : '开启空闲演示'}</button><button className="quiet danger" onClick={() => void run(() => command('reset_demo'))}>重置演示</button></div><div className="demo-log" aria-label="本地操作日志">{log.map((line, i) => <div key={i}>{line}</div>)}</div></Panel>
   <Panel title="打印队列" tag="QUEUE" action={<span className="count-badge">{state.queue.length}</span>}><ul className="task-list">{state.queue.map(t => row(t))}</ul>{!state.queue.length && <p className="empty">队列空空的，等待作品加入。</p>}<button className="quiet danger" disabled={!state.queue.length} onClick={() => void run(() => command('clear_pending'))}>清空等待队列</button></Panel>
   <Panel title="打印规则" tag="RULES"><div className="settings-grid"><label className="field"><span>单份打印秒数</span><input aria-label="单份打印秒数" type="number" min={2} max={30} value={config.duration} onChange={e => setConfig({ ...config, duration: Number(e.target.value) })}/></label><Choice label="离线动画倍率" value={config.speed} options={[[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']]} onChange={speed => setConfig({ ...config, speed: Number(speed) })}/></div><Toggle label="娱乐随机评分" checked={config.score} onChange={score => setConfig({ ...config, score })}/><div className="rule-editor">{events.map(([key, label, icon]) => { const r = rules[key]; return <fieldset key={key}><legend>{icon} {label}</legend><Toggle label="启用" checked={r.enabled} onChange={enabled => setConfig({ ...config, rules: { ...rules, [key]: { ...r, enabled } } })}/><div className="rule-fields"><label>份数<input aria-label={`${label}份数`} type="number" min={1} max={10} value={r.units} onChange={e => setConfig({ ...config, rules: { ...rules, [key]: { ...r, units: Number(e.target.value) } } })}/></label><Choice label="尺寸" value={r.size} options={[["small", "小图"], ["large", "大图"]]} onChange={size => setConfig({ ...config, rules: { ...rules, [key]: { ...r, size } } })}/></div></fieldset>; })}</div><button className="primary full" disabled={!dirty || busy} onClick={() => void run(() => command('configure', config), '新任务规则已保存')}>保存并应用到新任务{dirty ? ' · 未保存' : ''}</button><p className="note">在制和已接受任务保持原规则、份数与分数；修改只影响新提交任务。</p><div className="row"><button onClick={() => { setExportReady(false); void run(() => previewControl({ op: 'rules' }), '已请求生成规则 PNG'); }}>生成规则图</button><button disabled={!exportReady} onClick={() => void run(() => request('export.review'))}>预览并保存 PNG</button></div></Panel>
   <Panel title="自有素材与帮助" tag="RESOURCES"><button onClick={() => void run(async () => { const files = await command('media_list'); setMediaFiles(files as [
        string,
        number
    ][]); })}>读取已保存的图片</button>{mediaFiles.map(([reference, size]) => <div className="media-row" key={reference}><button onClick={() => setMedia(reference)}>选择 {reference.slice(6, 14)} · {Math.ceil(size / 1024)} KiB</button><button aria-label={`删除图像${reference.slice(6, 14)}`} onClick={() => void run(() => command('delete_media', { reference }))}>删除</button></div>)}<p className="note">被任务、历史或偏好引用的图片不可删除。导入后可在当前页面选择制作，刷新后可读取已保存图片。</p><details><summary>使用与许可</summary><p>先打开展示窗，再提交手动作品或运行离线模拟。采集使用独立展示窗；控制台预览不播音、不驱动任务。</p><p>界面、模型与运动学改编自 3d-printer-live，Copyright (c) 2026 志哥AI，MIT。React、Three.js 与 LikeBoom SDK 的完整许可随包提供。</p><button onClick={() => void run(async () => setLicense(String(await command('licenses'))))}>查看完整第三方许可</button>{license && <pre>{license}</pre>}</details></Panel>
  </aside></div><footer><p role="status" aria-live="polite">{feedback || '制作台已就绪。所有提交与模拟均为本地娱乐内容。'}</p><span>LIKEBOOM · 独立娱乐 · 无平台连接 / 无支付</span></footer>
 </div>;
}
flushSync(() => createRoot(document.getElementById('root')!).render(<App />));
