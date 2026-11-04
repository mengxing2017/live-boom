import type { PluginInfo, Snapshot, Task } from './protocol';
export type ControlTask = Pick<Task, 'id' | 'epoch' | 'input' | 'plan' | 'work_units' | 'completed_units' | 'source' | 'priority' | 'status' | 'created_at' | 'finished_at'>;
export type ControlState = Omit<Snapshot, 'current' | 'queue' | 'history' | 'active'> & {
    active: PluginInfo;
    current: ControlTask | null;
    queue: ControlTask[];
    history: ControlTask[];
};
export type ControlEvent = {
    type: 'state';
    value: ControlState;
} | {
    type: 'preview';
    bytes: ArrayBuffer;
} | {
    type: 'metrics';
    value: Record<string, unknown>;
} | {
    type: 'export.ready';
};
/** A control document has no native bridge. Requests cross a host-checked MessagePort. */
export function connectControl(onEvent: (event: ControlEvent) => void) {
    let port: MessagePort | undefined, nonce = '', sequence = 0;
    const pending = new Map<string, {
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    const request = (method: string, params: Record<string, unknown> = {}, bytes?: ArrayBuffer): Promise<unknown> => new Promise((resolve, reject) => {
        if (!port) {
            reject(new Error('操作台尚未连接'));
            return;
        }
        const id = String(++sequence);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('操作超时')); }, 15000);
        pending.set(id, { resolve, reject, timer });
        port.postMessage({ api: '1', nonce, type: 'request', id, method, params, ...(bytes ? { bytes } : {}) }, bytes ? [bytes] : []);
    });
    const init = (event: MessageEvent) => {
        if (port || event.source !== parent || event.data?.type !== 'likeboom.control.connect' || event.data.api !== '1' || typeof event.data.nonce !== 'string' || !event.ports[0])
            return;
        port = event.ports[0];
        nonce = event.data.nonce;
        removeEventListener('message', init);
        port.onmessage = ({ data }) => {
            if (data?.api !== '1' || data.nonce !== nonce)
                return;
            if (data.type === 'response') {
                const p = pending.get(data.id);
                if (p) {
                    clearTimeout(p.timer);
                    pending.delete(data.id);
                    data.error ? p.reject(new Error(data.error)) : p.resolve(data.value);
                }
                return;
            }
            onEvent(data as ControlEvent);
        };
        port.start();
        port.postMessage({ api: '1', nonce, type: 'ready' });
    };
    addEventListener('message', init);
    return { request, resize(height: number) { port?.postMessage({ api: '1', nonce, type: 'resize', height }); }, dispose() { removeEventListener('message', init); port?.close(); for (const p of pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error('操作台已关闭'));
        } pending.clear(); } };
}
