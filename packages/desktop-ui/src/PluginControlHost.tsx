import { Modal } from '@liveboom/plugin-sdk/ui';
import { useConfirm } from './components/ConfirmProvider';
import { useEffect, useRef, useState } from 'react';
import type { DesktopTransport, Snapshot, Task } from '@liveboom/plugin-sdk';
import type { ControlState, ControlTask } from '@liveboom/plugin-sdk/control';
const taskView = (t: Task): ControlTask => ({ id: t.id, epoch: t.epoch, input: t.input, plan: t.plan, work_units: t.work_units, completed_units: t.completed_units, source: t.source, priority: t.priority, status: t.status, created_at: t.created_at, finished_at: t.finished_at });
function project(s: Snapshot): ControlState {
    const own = (t: Task) => t.plugin.digest === s.active?.digest;
    return { ...s, active: s.active!, current: s.current && own(s.current) ? taskView(s.current) : null, queue: s.queue.filter(own).map(taskView), history: s.history.filter(own).slice(-100).map(taskView) };
}
const commands = new Set(['submit', 'submit_demo', 'configure', 'presentation', 'open_display', 'pause', 'resume', 'cancel', 'retry', 'clear_pending', 'clear_history', 'preempt', 'reset_demo', 'demo_policy', 'resize_display', 'preview_control', 'read_preferences', 'media_list', 'delete_media', 'media_resolve', 'licenses']);
const destructive = new Set(['clear_pending', 'clear_history', 'preempt', 'reset_demo', 'delete_media']);
export function PluginControlHost({ transport, snapshot, visible = true, resetKey = 0 }: {
    transport: DesktopTransport;
    snapshot: Snapshot;
    visible?: boolean;
    resetKey?: number;
}) {
    const ask = useConfirm();
    const visibility = useRef(visible); visibility.current = visible;
    const viewportRevision = useRef(0);
    const frame = useRef<HTMLIFrameElement>(null), channel = useRef<MessagePort | null>(null), latest = useRef(snapshot);
    latest.current = snapshot;
    const [url, setUrl] = useState(''), [error, setError] = useState(''), [review, setReview] = useState<number[]|null>(null), [exportUrl, setExportUrl] = useState('');
    const exported = useRef<number[] | null>(null), nonce = useRef('');
    const digest = snapshot.active!.digest;
    const send = (type: string, body: Record<string, unknown> = {}, transfer: Transferable[] = []) => channel.current?.postMessage({ api: '1', nonce: nonce.current, type, ...body }, transfer);
    useEffect(() => { let active = true; void transport.document(digest, 'control').then(value => { if (active)
        setUrl(value); }).catch(e => { if (active)
        setError(String(e)); }); return () => { active = false; channel.current?.close(); channel.current = null; }; }, [transport, digest]);
    const sendViewport = () => { const el = frame.current; if (el) send('viewport', { value: { width: el.clientWidth, height: el.clientHeight, dpr: devicePixelRatio, visible: visibility.current, density: document.documentElement.dataset.density === 'comfortable' ? 'comfortable' : 'compact', mode: el.clientWidth < 1180 ? 'compact' : 'normal', revision: ++viewportRevision.current } }); };
    useEffect(() => { let raf = 0; const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sendViewport); }; const observer = new ResizeObserver(update); if (frame.current) observer.observe(frame.current); addEventListener('resize', update); addEventListener('liveboom:appearance', update); update(); return () => { observer.disconnect(); removeEventListener('resize', update); removeEventListener('liveboom:appearance', update); cancelAnimationFrame(raf); }; }, [digest]);
    useEffect(() => { sendViewport(); }, [visible]);
    useEffect(() => { if (resetKey) send('layout.reset'); }, [resetKey]);
    useEffect(() => { send('state', { value: project(snapshot) }); }, [snapshot]);
    useEffect(() => {
        let active = true;
        const disposers: (() => void)[] = [];
        const keep = (promise: Promise<() => void> | undefined) => { void promise?.then(fn => { if (active)
            disposers.push(fn);
        else
            fn(); }); };
        keep(transport.subscribePreview?.(bytes => { if (!active || !visibility.current || bytes.length > 262144)
            return; const buffer = Uint8Array.from(bytes).buffer; send('preview', { bytes: buffer }, [buffer]); }));
        keep(transport.subscribeMetrics?.(value => send('metrics', { value })));
        keep(transport.subscribeExport?.(bytes => { if (bytes.length <= 2097152) {
            exported.current = bytes;
            send('export.ready');
        } }));
        return () => { active = false; disposers.forEach(fn => fn()); };
    }, [transport, digest]);
    useEffect(() => { if (!review)
        return; const value = URL.createObjectURL(new Blob([Uint8Array.from(review)], { type: 'image/png' })); setExportUrl(value); return () => URL.revokeObjectURL(value); }, [review]);
    const connect = () => {
        channel.current?.close();
        const c = new MessageChannel();
        channel.current = c.port1;
        nonce.current = crypto.randomUUID();
        let count = 0, clock = performance.now(), outstanding = 0;
        const port = c.port1;
        const token = nonce.current;
        const reply = (id: string, value?: unknown, error?: string) => { if (channel.current === port)
            port.postMessage({ api: '1', nonce: token, type: 'response', id, value, error }); };
        port.onmessage = async ({ data }) => {
            if (data?.api !== '1' || data.nonce !== token || latest.current.active?.digest !== digest)
                return;
            if (performance.now() - clock > 1000) {
                clock = performance.now();
                count = 0;
            }
            if (++count > 40)
                return;
            if (data.type === 'ready') {
                send('state', { value: project(latest.current) });
                sendViewport();
                return;
            }
            if (data.type !== 'request' || typeof data.id !== 'string' || data.id.length > 32)
                return;
            if (++outstanding > 8) {
                outstanding--;
                reply(data.id, undefined, '操作过于频繁');
                return;
            }
            try {
                const caps = latest.current.active.manifest.capabilities;
                const params = data.params ?? {};
                if (JSON.stringify(params).length > 65536)
                    throw new Error('请求过大');
                let value: unknown;
                if (data.method === 'app.settings') {
                    dispatchEvent(new Event('liveboom:settings'));
                }
                else if (data.method === 'layout.load' || data.method === 'layout.save') {
                    const plugin = latest.current.active.manifest;
                    const key = `liveboom:layout:1:${plugin.publisher}:${plugin.id}`;
                    if (data.method === 'layout.load') {
                        try { value = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { value = null; }
                    } else {
                        const layout = params.layout;
                        if (!layout || typeof layout !== 'object' || Object.keys(layout).sort().join(',') !== 'inspector,stage,tasks' || !Object.values(layout).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 5 && v <= 90) || Math.abs(Object.values(layout).reduce<number>((n,v) => n + Number(v), 0) - 100) > 1) throw new Error('无效布局');
                        try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* Layout persistence is optional on restricted profiles. */ }
                    }
                }
                else if (data.method === 'media.import') {
                    if (!caps.includes('media.own.v1') || !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength > 8388608)
                        throw new Error('无效图像请求');
                    value = await transport.importMedia?.(Array.from(new Uint8Array(data.bytes)),digest);
                }
                else if (data.method === 'voices') {
                    value = 'speechSynthesis' in window ? speechSynthesis.getVoices().filter(v => v.localService).map(v => ({ name: v.name, lang: v.lang })) : [];
                }
                else if (data.method === 'export.review') {
                    if (!caps.includes('export.png.v1') || !exported.current)
                        throw new Error('请先生成规则图片');
                    setReview([...exported.current]);
                }
                else if (data.method === 'command') {
                    const { name, args = {} } = params;
                    if (!commands.has(name))
                        throw new Error('操作台无此权限');
                    if (name.startsWith('media_') || name === 'delete_media') {
                        if (!caps.includes('media.own.v1'))
                            throw new Error('无媒体权限');
                    }
                    if (name === 'presentation' && !caps.includes('presentation.v1'))
                        throw new Error('无画面权限');
                    if (['cancel', 'retry'].includes(name) && ![latest.current.current, ...latest.current.queue, ...latest.current.history].some(t => t !== null && t.id === args.id && t.plugin.digest === digest))
                        throw new Error('任务不属于当前玩法');
                    if (destructive.has(name) && !await ask('确认执行此操作？\n' + ({ clear_pending: '清空等待队列', clear_history: '清空本场记录并开始新场', preempt: '当前未完成份重新排队', reset_demo: '清除模拟任务与记录，保留手动数据', delete_media: '删除未引用的自有图像' } as Record<string, string>)[name]))
                        throw new Error('已取消');
                    value = await transport.command(name, {...args,__controlDigest:digest});
                }
                else
                    throw new Error('未知操作台请求');
                reply(data.id, value);
            }
            catch (e) {
                reply(data.id, undefined, String(e));
            }
            finally {
                outstanding--;
            }
        };
        port.start();
        frame.current?.contentWindow?.postMessage({ type: 'liveboom.control.connect', api: '1', nonce: token }, '*', [c.port2]);
    };
    return <div className="plugin-control-shell"><div className="plugin-frame-viewport"><iframe ref={frame} className="plugin-control-frame" title={`${snapshot.active!.manifest.name}操作台`} sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'" src={url || undefined} onLoad={url ? connect : undefined}/></div>{error && <p role="alert">{error}</p>}<Modal open={Boolean(review)} title="宿主确认保存规则图片" onClose={() => setReview(null)}><img src={exportUrl} alt="待保存的规则图片"/><button onClick={() => { if (review)
        void transport.savePng?.(review).then(() => setReview(null)).catch(e => setError(String(e))); }}>选择位置并保存 PNG</button></Modal></div>;
}
