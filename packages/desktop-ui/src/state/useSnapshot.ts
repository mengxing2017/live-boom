import { useEffect, useState } from 'react';
import type { DesktopTransport, Snapshot } from '@liveboom/plugin-sdk';
export function describe(e: unknown): string { return typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e); }
export function useSnapshot(transport: DesktopTransport) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    let active = true, version = -1, session = ''; let dispose: (() => void) | undefined;
    const apply = (s: Snapshot) => { if (active && s.version > version) { session = s.session_id; version = s.version; setSnapshot(s); setError(''); } };
    const refresh = () => (version>=0&&transport.changes?transport.changes(version,session):transport.snapshot()).then(s=>{if(s)apply(s);}).catch(e => { if (active) setError(describe(e)); });
    void transport.subscribe(apply).then(unlisten => { if (!active) { unlisten(); return; } dispose = unlisten; void refresh(); }).catch(e => { if (active) setError(describe(e)); });
    // Snapshots are authoritative; this also recovers lost notifications without replaying tasks.
    const timer = setInterval(() => { void refresh(); }, 1000);
    return () => { active = false; clearInterval(timer); dispose?.(); };
  }, [transport]);
  return { snapshot, error };
}
