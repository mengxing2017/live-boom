import { createContext, useContext, useRef, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '@liveboom/plugin-sdk/ui';
const ConfirmContext = createContext<(message: string) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const pending = useRef<((value: boolean) => void) | null>(null);
  const finish = (value: boolean) => { pending.current?.(value); pending.current = null; setMessage(''); };
  useEffect(() => () => { pending.current?.(false); }, []);
  return <ConfirmContext.Provider value={text => { if (pending.current) return Promise.resolve(false); setMessage(text); return new Promise(resolve => { pending.current = resolve; }); }}>{children}<Modal open={Boolean(message)} title="确认操作" onClose={() => finish(false)}><p className="confirmation-message">{message}</p><div className="lb-dialog-actions"><button autoFocus onClick={() => finish(false)}>取消</button><button onClick={() => finish(true)}>确认执行</button></div></Modal></ConfirmContext.Provider>;
}
