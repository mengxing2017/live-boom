import { useEffect, useRef, useState } from 'react';
import { sameContext } from '@likeboom/plugin-sdk';
import type { DesktopTransport, PlaybackContext, ResultRequest, Snapshot, Task } from '@likeboom/plugin-sdk';

const contextOf = (t: Task): PlaybackContext => ({ task_id: t.id, epoch: t.epoch, instance: t.instance });
export function PluginHost({ transport, snapshot }: { transport: DesktopTransport; snapshot: Snapshot }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const latest = useRef(snapshot); latest.current = snapshot;
  const port = useRef<MessagePort | null>(null);
  const nonce = useRef('');
  const instance = useRef(crypto.randomUUID()); const registered = useRef('');
  const prepared = useRef(''); const played = useRef(''); const reported = useRef('');
  const elapsed = useRef(0); const lastTick = useRef(performance.now());
  const [url, setUrl] = useState(''); const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [error, setError] = useState('');
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
    readyRef.current = false; setReady(false); setError(''); setUrl('');
    void transport.document(digest).then(value => { if (active) setUrl(value); }).catch(e => { if (active) setError(String(e)); });
    const timeout = setTimeout(() => { if (active && !readyRef.current) setError('插件加载超时，请停用或重新打开展示窗'); }, 10000);
    return () => { active = false; clearTimeout(timeout); send('dispose'); port.current?.close(); port.current = null; };
  }, [digest, transport]);

  const connect = () => {
    readyRef.current = false; setReady(false); instance.current = crypto.randomUUID();
    registered.current = ''; prepared.current = ''; played.current = ''; reported.current = '';
    port.current?.close();
    const channel = new MessageChannel(); port.current = channel.port1; nonce.current = crypto.randomUUID();
    let count = 0, bucket = performance.now(), outstanding = 0;
    channel.port1.onmessage = async ({ data }) => {
      if (!data || data.api !== '1' || data.nonce !== nonce.current) return;
      if (performance.now() - bucket >= 1000) { bucket = performance.now(); count = 0; }
      let size: number; try { size = JSON.stringify(data).length; } catch { fail('插件消息无法序列化'); return; }
      if (++count > 100 || size > 65536) { fail('插件消息超过限制'); return; }
      if (data.type === 'ready') { readyRef.current = true; setReady(true); return; }
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
            const value = await transport.service(request, data.method, data.params ?? {});
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
      void transport.command('register_display', { instance: instance.current }).catch(e => { registered.current = ''; setError(String(e)); });
    }
  }, [ready, snapshot.display_ready, transport]);
  useEffect(() => {
    if (!ready) return;
    const task = snapshot.current;
    if (!task) { send('cancel'); prepared.current = ''; played.current = ''; elapsed.current = 0; return; }
    if (task.instance !== instance.current) return;
    if (!task.prepared && prepared.current !== task.epoch) {
      prepared.current = task.epoch; reported.current = ''; elapsed.current = 0; lastTick.current = performance.now();
      send('prepare', { context: contextOf(task), input: task.input, config: task.config });
    } else if (task.prepared && played.current !== task.epoch) {
      played.current = task.epoch; elapsed.current = 0; lastTick.current = performance.now();
      send('play', { context: contextOf(task), input: task.input, config: task.config });
    }
    send(snapshot.paused ? 'pause' : 'resume');
  }, [snapshot.current, snapshot.paused, ready]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = performance.now(); const delta = now - lastTick.current; lastTick.current = now;
      const s = latest.current; const task = s.current;
      if (!task || s.paused || task.instance !== instance.current || reported.current === task.epoch) return;
      elapsed.current += delta;
      if (delta > 15000) { fail('系统休眠或展示长时间中断，请重试任务'); return; }
      if (elapsed.current > (task.prepared ? 120000 : 10000)) fail('插件执行超时');
    }, 1000);
    return () => clearInterval(timer);
  }, [transport]);
  return <><iframe ref={iframe} title={snapshot.active?.manifest.name ?? '玩法'} sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'" src={url || undefined} onLoad={url ? connect : undefined} />{error && <p className="display-error">{error}</p>}<span className="source-label">本地互动 · 手动输入</span></>;
}
