import { useEffect, useRef, useState } from 'react';
import { OutputAudio } from './OutputAudio';
import { sameContext } from '@likeboom/plugin-sdk';
import type { DesktopTransport, PlaybackContext, ResultRequest, Snapshot, Task } from '@likeboom/plugin-sdk';

const contextOf = (t: Task): PlaybackContext => ({ task_id: t.id, epoch: t.epoch, instance: t.instance });
export function PluginHost({ transport, snapshot }: { transport: DesktopTransport; snapshot: Snapshot }) {
  const assetCache=useRef(new Map<string,string>());
  const audio = useRef(new OutputAudio());
  const [unlocked, setUnlocked] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const latest = useRef(snapshot); latest.current = snapshot;
  const port = useRef<MessagePort | null>(null);
  const nonce = useRef('');
  const instance = useRef(crypto.randomUUID()); const registered = useRef('');
  const prepared = useRef(''); const played = useRef(''); const reported = useRef('');
  const elapsed = useRef(0); const lastTick = useRef(performance.now());
  const [started,setStarted] = useState(false);
  const [url, setUrl] = useState(''); const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [error, setError] = useState('');
  const pauseSent=useRef<boolean|undefined>(undefined);
  const presentationKey=JSON.stringify(snapshot.presentation),configKey=JSON.stringify(snapshot.config);
  const digest = snapshot.active?.digest ?? '';
  const send = (type: string, data: Record<string, unknown> = {}) => port.current?.postMessage({ api: '1', nonce: nonce.current, type, ...data });
  const fail = (message: string, expected?: PlaybackContext) => {
    if (expected && (!latest.current.current || !sameContext(expected, contextOf(latest.current.current)))) return;
    setError(message);
    const task = latest.current.current;
    if (task && reported.current !== task.epoch) {
      reported.current = task.epoch;
      void transport.result({ ...contextOf(task), status: 'failed' }).catch(e => { if (latest.current.current && sameContext(contextOf(task), contextOf(latest.current.current))) { reported.current = ''; setError(String(e)); } });
    }
  };
  useEffect(() => {
    let active = true;
    readyRef.current = false; setReady(false); setError(''); setUrl('');assetCache.current.clear();
    void transport.document(digest).then(value => { if (active) setUrl(value); }).catch(e => { if (active) setError(String(e)); });
    const timeout = setTimeout(() => { if (active && !readyRef.current) setError('插件加载超时，请停用或重新打开展示窗'); }, 10000);
    return () => { active = false; clearTimeout(timeout); send('dispose'); audio.current.stop(); port.current?.close(); port.current = null; };
  }, [digest, transport]);

  const connect = () => {
    readyRef.current = false; setReady(false); setStarted(false); instance.current = crypto.randomUUID();
    registered.current = ''; prepared.current = ''; played.current = ''; reported.current = '';
    port.current?.close();
    const channel = new MessageChannel(); port.current = channel.port1; nonce.current = crypto.randomUUID();
    let count = 0, bucket = performance.now(), outstanding = 0, lastFrame = 0, lastExport = 0;
    channel.port1.onmessage = async ({ data }) => {
      if (!data || data.api !== '1' || data.nonce !== nonce.current) return;
      if (performance.now() - bucket >= 1000) { bucket = performance.now(); count = 0; }
      if (data.type === 'preview.frame') {
        if (!latest.current.active?.manifest.capabilities.includes('preview.frames.v1') || !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength > 262144 || performance.now()-lastFrame < 200) return;
        lastFrame=performance.now(); void transport.preview?.(instance.current,Array.from(new Uint8Array(data.bytes))).catch(() => {}); return;
      }
      if (data.type === 'export.png') {
        if (!latest.current.active?.manifest.capabilities.includes('export.png.v1') || !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength > 2097152 || performance.now()-lastExport < 1000) return;
        lastExport=performance.now(); void transport.exportPng?.(instance.current,Array.from(new Uint8Array(data.bytes))).catch(e => setError(String(e))); return;
      }
      let size: number; try { size = JSON.stringify(data).length; } catch { fail('插件消息无法序列化'); return; }
      if (++count > 100 || size > 65536) { fail('插件消息超过限制'); return; }
      if (data.type === 'ready') { readyRef.current = true; setReady(true); return; }
      if(data.type==='session.metrics'){if(size<=4096)void transport.sessionService?.(instance.current,'diagnostics.report',{metrics:data.value}).catch(()=>{});return;}
      if(data.type==='error'&&!data.context){audio.current.stop();setReady(false);setError('场景初始化失败：'+String(data.message));void transport.command('interrupt_display').catch(()=>{});return;}
      if (data.type === 'session.service') {
        if (++outstanding > 16) { outstanding--; return; }
        if(data.method==='session.interrupt'){audio.current.stop();setReady(false);setError('3D 渲染中断，请关闭并重新打开展示窗');}
        const expectedInstance=instance.current;
        try { const value=await transport.sessionService?.(expectedInstance,data.method,data.params ?? {}); if(expectedInstance===instance.current) send('service.result',{id:data.id,value}); }
        catch(e) { if(expectedInstance===instance.current) send('service.result',{id:data.id,error:String(e)}); }
        finally {outstanding--; } return;
      }
      const task = latest.current.current;
      if (!task || !sameContext(data.context, contextOf(task))) return;
      const request: ResultRequest = { ...contextOf(task), status: 'completed' };
      try {
        if (data.type === 'prepared' && prepared.current === task.epoch && !task.prepared) {
          await transport.prepare(request, data.input);
        } else if (data.type === 'result' && reported.current !== task.epoch) {
          if (!['completed', 'failed'].includes(data.status)) throw new Error('无效的插件结果');
          reported.current = task.epoch;
          await transport.result({ ...request, status: data.status });
        } else if (data.type === 'error') { fail('玩法执行失败'); }
        else if (data.type === 'service') {
          if (++outstanding > 16) { outstanding--; throw new Error('服务并发超过限制'); }
          try {
            let value: unknown;
            if (['audio.play','audio.stop','speech.say'].includes(data.method)) {
              if (!latest.current.active?.manifest.capabilities.includes('audio.own.v1')) throw new Error('无音频权限');
              const p=data.params ?? {};
              if (data.method==='audio.stop') audio.current.stop();
              else if (data.method==='audio.play') {
                let uri=assetCache.current.get(String(p.path));if(!uri){uri=String(await transport.sessionService?.(instance.current,'assets.resolve',{path:p.path}));if(assetCache.current.size>=4)assetCache.current.clear();assetCache.current.set(String(p.path),uri);}
                if(latest.current.current && sameContext(request,contextOf(latest.current.current)) && !latest.current.paused) await audio.current.play(String(uri), Number(p.volume ?? .4), p.loop === true);
              } else if (!latest.current.paused) await audio.current.say(String(p.text ?? ''),String(p.lang ?? 'zh-CN'),`${task.epoch}/${p.id}`,Number(p.rate ?? 1), Number(p.volume ?? .6),typeof p.voice==='string'?p.voice:undefined);
            } else value = await transport.service(request, data.method, data.params ?? {});
            if (sameContext(data.context, latest.current.current ? contextOf(latest.current.current) : { task_id: '', epoch: '', instance: '' })) send('service.result', { id: data.id, value });
          } catch (e) { if (latest.current.current && sameContext(request, contextOf(latest.current.current))) send('service.result', { id: data.id, error: String(e) }); }
          finally { outstanding--; }
        }
      } catch (e) { if (latest.current.current && sameContext(request, contextOf(latest.current.current))) { reported.current = ''; fail(String(e), request); } }
    };
    channel.port1.start();
    // Opaque sandbox origins cannot be named as targetOrigin. Transfer once to this exact frame.
    iframe.current?.contentWindow?.postMessage({ type: 'likeboom.connect', api: '1', nonce: nonce.current }, '*', [channel.port2]);
  };

  useEffect(() => {
    if (ready && (registered.current !== instance.current || !snapshot.display_ready)) {
      registered.current = instance.current;
      void transport.command('register_display', { instance: instance.current }).then(() => { send('session',{config:latest.current.config}); send('presentation', {value:latest.current.presentation}); setStarted(true); }).catch(e => { registered.current = ''; setError(String(e)); });
    }
  }, [ready, snapshot.display_ready, transport]);
  useEffect(() => {
    if (!ready || !started) return;
    const task = snapshot.current;
    if (!task) { if(prepared.current||played.current){audio.current.stop();send('cancel');} prepared.current = ''; played.current = ''; elapsed.current = 0; pauseSent.current=undefined;return; }
    if (task.instance !== instance.current) return;
    if (!task.prepared && prepared.current !== task.epoch) {
      audio.current.stop();pauseSent.current=undefined;
      prepared.current = task.epoch; reported.current = ''; elapsed.current = 0; lastTick.current = performance.now();
      send('prepare', { context: contextOf(task), input: task.input, config: task.config });
    } else if (task.prepared && played.current !== task.epoch) {
      audio.current.stop();pauseSent.current=undefined;
      played.current = task.epoch; elapsed.current = 0; lastTick.current = performance.now();
      send('play', { context: contextOf(task), input: task.input, config: task.config, plan:task.plan, completedUnits:task.completed_units, source:task.source });
    }
    if(pauseSent.current!==snapshot.paused){pauseSent.current=snapshot.paused;if(snapshot.paused)audio.current.stop();send(snapshot.paused?'pause':'resume');}
  }, [snapshot.current, snapshot.paused, ready, started]);
  useEffect(() => { if (started) send('configure',{config:snapshot.config}); },[configKey,started]);
  useEffect(() => { if (ready) send('presentation',{value:snapshot.presentation}); },[presentationKey,ready]);
  useEffect(() => {
    let active=true; let unlisten: (()=>void) | undefined;
    void transport.subscribeControl?.(value=>{
      if(value.op==='speechTest'&&latest.current.active?.manifest.capabilities.includes('audio.own.v1')) { const p=latest.current.presentation;void audio.current.say(String(value.text??'声音试听 / Audio test'),String(p.language??'zh-CN'),'audition',Number(p.rate??1),Number(p.volume??.4),String(p.voice??'')); }
      else if(value.op==='audioTest'&&latest.current.active?.manifest.capabilities.includes('audio.own.v1')) { void transport.sessionService?.(instance.current,'assets.resolve',{path:value.path}).then(uri=>audio.current.play(String(uri),.4,false)).catch(e=>setError(String(e))); }
      else send('preview.control',{value});
    }).then(fn=>{if(active)unlisten=fn;else fn();});
    return ()=>{active=false;unlisten?.();};
  },[transport]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = performance.now(); const delta = now - lastTick.current; lastTick.current = now;
      const s = latest.current; const task = s.current;
      if (!task || s.paused || task.instance !== instance.current || reported.current === task.epoch) return;
      elapsed.current += delta;
      if (delta > 15000) { audio.current.stop();setReady(false);setError('系统休眠或展示中断，请关闭并重新打开展示窗');void transport.command('interrupt_display').catch(e=>setError(String(e)));return; }
      if (elapsed.current > (task.prepared ? Math.max(120000,task.work_units * 45000) : 10000)) fail('插件执行超时');
    }, 1000);
    return () => clearInterval(timer);
  }, [transport]);
  return <>{!unlocked && snapshot.active?.manifest.capabilities.includes('audio.own.v1') && <button className="audio-unlock" onClick={() => { void audio.current.unlock().then(()=>setUnlocked(true)).catch(e=>setError(String(e))); }}>点击启用本窗口声音 / Enable audio</button>}<iframe ref={iframe} title={snapshot.active?.manifest.name ?? '玩法'} sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'" src={url || undefined} onLoad={url ? connect : undefined} />{error && <p className="display-error">{error}</p>}<span className="source-label">本地互动 · {snapshot.current?.source === 'demo' ? '离线演示 / DEMO' : snapshot.current ? '手动输入' : '未接入平台'}</span></>;
}
