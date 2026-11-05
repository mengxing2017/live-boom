// Each playback gets services bound to its immutable context. Late timers cannot complete a new task.
export function connectPlugin(factory, options = {}) {
  let connected = false;
  const init = async (event) => {
    if (connected || event.source !== parent || event.data?.type !== 'liveboom.connect' || event.data?.api !== '1' || typeof event.data?.nonce !== 'string' || !event.ports[0]) return;
    connected = true; removeEventListener('message', init);
    const port = event.ports[0], nonce = event.data.nonce;
    let sequence = 0, generation = 0, plugin = null, contextKey = '', activeContext = undefined, session = null, sessionReady = Promise.resolve();
    const pending = new Map();
    const keyOf = c => `${c?.task_id}/${c?.epoch}/${c?.instance}`;
    const send = (type, data = {}) => port.postMessage({ api: '1', nonce, type, ...data });
    const dispose = () => {
      generation++; contextKey = ''; activeContext=undefined; plugin?.dispose?.(); plugin = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Plugin disposed')); } pending.clear();
    };
    const request = (type, context, method, params = {}) => new Promise((resolve, reject) => {
      if (context && contextKey !== keyOf(context)) return reject(new Error('Stale task'));
      const id = String(++sequence);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host request timeout')); }, 5000);
      pending.set(id, { resolve, reject, timer }); send(type, { id, method, params, ...(context ? {context} : {}) });
    });
    const sessionServices = Object.freeze({
      metrics: value => send('session.metrics', {value}),
      request: (method, params) => request('session.service', null, method, params),
      frame: async blob => { if (!(blob instanceof Blob) || blob.size > 262144 || blob.type !== 'image/jpeg') return; const bytes = await blob.arrayBuffer(); port.postMessage({api:'1',nonce,type:'preview.frame',bytes}, [bytes]); },
      exportPng: bytes => { if (bytes instanceof ArrayBuffer && bytes.byteLength <= 2097152) port.postMessage({api:'1',nonce,type:'export.png',bytes}, [bytes]); },
    });
    const servicesFor = context => Object.freeze({
      result: status => send('result', { context, status }),
      progress: value => send('progress', { context, value }),
      request: (method, params = {}) => request('service', context, method, params),
    });
    const unhandled=event=>send('error',{context:activeContext,message:String(event.message??event.reason??'Plugin error').slice(0,200)});
    addEventListener('error',unhandled);addEventListener('unhandledrejection',unhandled);
    port.onmessage = async ({ data }) => {
      if (data?.api !== '1' || data.nonce !== nonce) return;
      if (data.type === 'service.result') {
        const request = pending.get(data.id);
        if (request) { clearTimeout(request.timer); pending.delete(data.id); data.error ? request.reject(new Error(data.error)) : request.resolve(data.value); } return;
      }
      try {
        if (data.type === 'session') {
          if (!session && options.session) { sessionReady = Promise.resolve(options.session(sessionServices,data.config)).then(s => {session=s;}); await sessionReady; }
        } else if (data.type === 'configure') { await sessionReady; session?.configure?.(data.config); } else if (data.type === 'presentation') { await sessionReady; await session?.presentation?.(data.value); }
        else if (data.type === 'preview.control') { await sessionReady; session?.control?.(data.value); }
        else if (data.type === 'prepare') {
          await sessionReady;
          dispose(); const revision = generation; const context = data.context; contextKey = keyOf(context); activeContext=context;
          const instance = await factory(servicesFor(context));
          if (generation !== revision) { instance.dispose?.(); return; }
          plugin = instance;
          const input = await (plugin.prepare?.(data.input, data.config) ?? data.input);
          if (generation === revision) send('prepared', { context, input });
        } else if (data.type === 'play') {
          await sessionReady;
          if (!plugin || contextKey !== keyOf(data.context)) {
            dispose(); const revision = generation; contextKey = keyOf(data.context); activeContext=data.context;
            const instance = await factory(servicesFor(data.context));
            if (revision !== generation) { instance.dispose?.(); return; }
            plugin = instance;
          }
          await plugin.play(data.input, data.config, {plan:data.plan, completedUnits:data.completedUnits ?? 0, source:data.source});
        } else if (data.type === 'pause') { plugin?.pause?.(); }
        else if (data.type === 'resume') { plugin?.resume?.(); }
        else if (data.type === 'cancel') { dispose(); }
        else if (data.type === 'dispose') { removeEventListener('error',unhandled);removeEventListener('unhandledrejection',unhandled);dispose(); await sessionReady; session?.dispose?.(); session=null; }
        else if (data.type === 'restore') { plugin?.restore?.(data.snapshot); }
      } catch (error) { send('error', { context: data.context, message: String(error).slice(0, 200) }); }
    };
    port.start(); send('ready');
  };
  addEventListener('message', init);
  return () => removeEventListener('message', init);
}
