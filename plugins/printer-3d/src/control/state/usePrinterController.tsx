import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { connectControl } from '@liveboom/plugin-sdk/control';
import type { ControlState, ControlTask } from '@liveboom/plugin-sdk/control';
import { PRESENTATION } from '../../settings.js';
import { eventName, sourceName, Avatar } from '../panels/controls';
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
export function usePrinterController() {
    const [layoutReset, setLayoutReset] = useState(0), [ruleKey, setRuleKey] = useState('manual'), [showLog, setShowLog] = useState(false);
    const layoutStore = useMemo(() => ({ load: () => bridge.current?.request('layout.load') ?? Promise.resolve(null), save: (layout: Record<string, number>) => bridge.current?.request('layout.save', {layout}) ?? Promise.resolve(null) }), []);
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
            if (data.type === 'layout.reset') setLayoutReset(n => n + 1);
            else if (data.type === 'state')
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
        return () => { client.dispose(); bridge.current = null; image.current='';pendingImage.current=''; };
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
        return null;
    const current = state.current, queueUnits = state.queue.reduce((n, t) => n + t.work_units - t.completed_units, 0), done = [...state.history, ...state.queue].reduce((n, t) => n + t.completed_units, 0) + (current?.completed_units ?? 0);
    const rules = config.rules, appliedRules=(state.config as Config).rules, activeRule = appliedRules[event];
    const dirty = JSON.stringify(config) !== configKey;
    const units = (t: ControlTask) => Array.isArray(t.plan?.units) ? t.plan.units as {
        score: number;
        size: string;
    }[] : [];
    const row = (task: ControlTask, history = false) => <li key={`${task.id}/${task.epoch}`} className="task-row"><Avatar name={task.input.nickname} src={mediaImages[String(task.input.media??'')]}/><div className="task-copy"><strong>{String(task.input.nickname ?? '访客')}</strong><small>{sourceName(task.source)} · {eventName(task.input.event)} · {task.completed_units}/{task.work_units} 份{task.priority ? ' · 优先' : ''}</small>{history && <small>{task.created_at ? new Date(task.created_at).toLocaleTimeString() : '旧版时间未记录'} · {({ completed: '已完成', failed: '失败', interrupted: '中断', cancelled: '已取消', running: '制作中', queued: '等待中' })[task.status]}{units(task).slice(0, task.completed_units).map((u, i) => <span key={i}> · {u.size === 'large' ? '大' : '小'}图 {u.score}分</span>)}</small>}</div>{history ? ['failed', 'interrupted'].includes(task.status) && <button onClick={() => void run(() => command('retry', { id: task.id }), '已按冻结计划重试')}>重试</button> : <button className="quiet danger" aria-label={`移除${String(task.input.nickname)}`} onClick={() => void run(() => command('cancel', { id: task.id }))}>移除</button>}</li>;
    return {current,state,config,preview,previewLoaded,drag,run,command,previewControl,nickname,setNickname,content,setContent,event,setEvent,quantity,setQuantity,priority,setPriority,media,mediaImages,busy,activeRule,submit,presentation,updatePresentation,metrics,setMetrics,camera,viewName,setViewName,views,loadViews,voices,setVoices,request,dirty,rules,setConfig,ruleKey,setRuleKey,exportReady,setExportReady,people,setMedia,importFiles,interval,setIntervalValue,log,filter,setFilter,mediaFiles,setMediaFiles,license,setLicense,appliedRules,scenario,row,done,queueUnits,layoutReset,layoutStore,showLog,setShowLog,feedback,input};
}
export type PrinterController = NonNullable<ReturnType<typeof usePrinterController>>;
