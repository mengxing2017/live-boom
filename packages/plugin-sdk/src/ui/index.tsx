import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
export type LayoutStore = { load(): Promise<unknown>; save(value: Record<string, number>): Promise<unknown> };
const initial = { tasks: 21, stage: 52, inspector: 27 };
function validLayout(value: unknown): value is typeof initial {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Object.keys(initial).every(k => typeof v[k] === 'number' && Number.isFinite(v[k]) && Number(v[k]) >= 5 && Number(v[k]) <= 90) && Math.abs(Object.values(v).reduce<number>((n, x) => n + Number(x), 0) - 100) < 1;
}
/** Bounded desktop layout. Children stay mounted when a narrow window folds its side panes. */
export function Workbench({ tasks, stage, inspector, store, resetKey = 0 }: { tasks: ReactNode; stage: ReactNode; inspector: ReactNode; store?: LayoutStore; resetKey?: number }) {
  const root = useRef<HTMLDivElement>(null), group = useGroupRef(), previousFocus = useRef<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false), [drawer, setDrawer] = useState<'tasks' | 'inspector' | null>(null);
  const storeRef = useRef(store); storeRef.current = store;
  const loaded = useRef(false), reset = useRef(resetKey);
  useEffect(() => { const el = root.current!; const observer = new ResizeObserver(() => { if (el.clientWidth) setCompact(el.clientWidth < 1180); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { let active = true; void storeRef.current?.load().then(value => { if (active && validLayout(value)) group.current?.setLayout(value); }).catch(() => {}).finally(() => { loaded.current = true; }); if (!storeRef.current) loaded.current = true; return () => { active = false; }; }, []);
  useEffect(() => { if (reset.current === resetKey) return; reset.current = resetKey; group.current?.setLayout(initial); setDrawer(null); void storeRef.current?.save(initial).catch(() => {}); }, [resetKey]);
  useEffect(() => {
    if (!compact || !drawer) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const panel = root.current?.querySelector<HTMLElement>(`#${drawer}`);
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => { if (e.key !== 'Tab') return; const elements = focusable(), first = elements[0], last = elements.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } };
    addEventListener('keydown', trap);
    return () => { removeEventListener('keydown', trap); previousFocus.current?.focus(); };
  }, [compact, drawer]);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(null); }; addEventListener('keydown', escape); return () => removeEventListener('keydown', escape); }, []);
  return <div ref={root} className={`lb-workbench${compact ? ' is-compact' : ''}`} data-drawer={drawer ?? ''}>
    <div className="lb-pane-tools"><button aria-expanded={compact ? drawer === 'tasks' : true} onClick={() => setDrawer(drawer === 'tasks' ? null : 'tasks')}>任务队列</button><span>制作工作区</span><button aria-expanded={compact ? drawer === 'inspector' : true} onClick={() => setDrawer(drawer === 'inspector' ? null : 'inspector')}>属性与工具</button></div>
    {compact && drawer && <button className="lb-drawer-shade" aria-label="关闭侧面板" onClick={() => setDrawer(null)} />}
    <Group groupRef={group} className="lb-workbench-group" defaultLayout={initial} onLayoutChanged={value => { if (loaded.current && !compact) void storeRef.current?.save(value).catch(() => {}); }}>
      <Panel aria-label="任务队列" role={compact && drawer === 'tasks' ? 'dialog' : undefined} aria-modal={compact && drawer === 'tasks' ? true : undefined} id="tasks" className="lb-tasks" defaultSize="21%" minSize={compact ? 0 : '200px'} maxSize={compact ? '100%' : '360px'} groupResizeBehavior="preserve-pixel-size">{tasks}</Panel>
      <Separator className="lb-separator" aria-label="调整任务队列宽度" />
      <Panel id="stage" className="lb-stage" minSize={compact ? 0 : '360px'}>{stage}</Panel>
      <Separator className="lb-separator" aria-label="调整属性面板宽度" />
      <Panel aria-label="属性与工具" role={compact && drawer === 'inspector' ? 'dialog' : undefined} aria-modal={compact && drawer === 'inspector' ? true : undefined} id="inspector" className="lb-inspector" defaultSize="27%" minSize={compact ? 0 : '280px'} maxSize={compact ? '100%' : '440px'} groupResizeBehavior="preserve-pixel-size">{inspector}</Panel>
    </Group>
  </div>;
}
export function InspectorTabs({ items }: { items: { id: string; label: string; content: ReactNode }[] }) {
  return <Tabs.Root className="lb-tabs" defaultValue={items[0]?.id}><Tabs.List className="lb-tab-list" aria-label="属性与工具">{items.map(item => <Tabs.Trigger key={item.id} value={item.id}>{item.label}</Tabs.Trigger>)}</Tabs.List>{items.map(item => <Tabs.Content forceMount key={item.id} className="lb-tab-content" value={item.id}>{item.content}</Tabs.Content>)}</Tabs.Root>;
}
export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose(): void }) {
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal><Dialog.Overlay className="lb-dialog-overlay"/><Dialog.Content className="lb-dialog" aria-describedby={undefined}><Dialog.Title>{title}</Dialog.Title>{children}<Dialog.Close asChild><button className="lb-dialog-close" aria-label="关闭对话框">×</button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

/** Reserve a plugin-owned layout slot for a renderer owned by the trusted host. */
export function RenderSurface({request}: {request(method: string, params: Record<string, unknown>): Promise<unknown>}) {
  const element = useRef<HTMLDivElement>(null);
  const requestRef = useRef(request); requestRef.current = request;
  useEffect(() => {
    let last = '', pending = false, active = true;
    const update = () => {
      const el = element.current; if (!el || pending) return;
      const r = el.getBoundingClientRect();
      const clear = [[.5,.5],[0,0],[1,0],[0,1],[1,1]].every(([x,y]) => {const hit=document.elementFromPoint(r.x+2+x*Math.max(0,r.width-4),r.y+2+y*Math.max(0,r.height-4));return !!hit&&(hit===el||el.contains(hit));});
      const bounds = {x: r.x, y: r.y, width: r.width, height: r.height, visible: r.width > 0 && r.height > 0 && clear};
      const key = JSON.stringify(bounds); if (key === last) return;
      pending = true;
      void requestRef.current('surface.bounds', bounds).then(() => { if (active) last = key; }).catch(() => {}).finally(() => { pending = false; });
    };
    update(); const timer = setInterval(update, 100);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <div ref={element} className="lb-render-surface" aria-label="玩法画面占位区域" style={{width:'100%',height:'100%',minHeight:0,overflow:'hidden'}}/>;
}
