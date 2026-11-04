// Each playback gets services bound to its immutable context. Late timers cannot complete a new task.
export function connectPlugin(factory) {
  let connected = false;
  const init = async (event) => {
    if (connected || event.source !== parent || event.data?.type !== 'likeboom.connect' || event.data?.api !== '1' || typeof event.data?.nonce !== 'string' || !event.ports[0]) return;
    connected = true; removeEventListener('message', init);
    const port = event.ports[0], nonce = event.data.nonce;
    let sequence = 0, generation = 0, plugin = null, contextKey = '';
    const pending = new Map();
    const keyOf = c => `${c?.task_id}/${c?.epoch}/${c?.instance}`;
    const send = (type, data = {}) => port.postMessage({ api: '1', nonce, type, ...data });
    const dispose = () => {
      generation++; contextKey = ''; plugin?.dispose?.(); plugin = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Plugin disposed')); } pending.clear();
    };
    const servicesFor = context => Object.freeze({
      result: status => send('result', { context, status }),
      progress: value => send('progress', { context, value }),
      request: (method, params = {}) => new Promise((resolve, reject) => {
        if (contextKey !== keyOf(context)) return reject(new Error('Stale task'));
        const id = String(++sequence);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host request timeout')); }, 5000);
        pending.set(id, { resolve, reject, timer }); send('service', { id, method, params, context });
      }),
    });
    port.onmessage = async ({ data }) => {
      if (data?.api !== '1' || data.nonce !== nonce) return;
      if (data.type === 'service.result') {
        const request = pending.get(data.id);
        if (request) { clearTimeout(request.timer); pending.delete(data.id); data.error ? request.reject(new Error(data.error)) : request.resolve(data.value); } return;
      }
      try {
        if (data.type === 'prepare') {
          dispose(); const revision = generation; const context = data.context; contextKey = keyOf(context);
          const instance = await factory(servicesFor(context));
          if (generation !== revision) { instance.dispose?.(); return; }
          plugin = instance;
          const input = await (plugin.prepare?.(data.input, data.config) ?? data.input);
          if (generation === revision) send('prepared', { context, input });
        } else if (data.type === 'play') {
          if (!plugin || contextKey !== keyOf(data.context)) {
            dispose(); const revision = generation; contextKey = keyOf(data.context);
            const instance = await factory(servicesFor(data.context));
            if (revision !== generation) { instance.dispose?.(); return; }
            plugin = instance;
          }
          await plugin.play(data.input, data.config);
        } else if (data.type === 'pause') { plugin?.pause?.(); }
        else if (data.type === 'resume') { plugin?.resume?.(); }
        else if (data.type === 'cancel' || data.type === 'dispose') { dispose(); }
        else if (data.type === 'restore') { plugin?.restore?.(data.snapshot); }
      } catch (error) { send('error', { context: data.context, message: String(error).slice(0, 200) }); }
    };
    port.start(); send('ready');
  };
  addEventListener('message', init);
  return () => removeEventListener('message', init);
}
