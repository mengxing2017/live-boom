import type { PrinterController } from '../state/usePrinterController';
import { Panel } from './controls';
export function QueuePanel({ controller }: { controller: PrinterController }) {
  const { current, state, run, command, row, done, queueUnits } = controller;
  return <div className="queue-pane"><div className="queue-summary">已交付 {done} 份 · 待办 {queueUnits} 份</div><Panel title="打印队列" tag="QUEUE" action={<span className="count-badge">{state.queue.length}</span>}><div className="current-task">{current ? <><strong>当前：{String(current.input.nickname)}</strong><small>{current.completed_units}/{current.work_units} 份</small></> : '当前待命'}</div><ul className="task-list">{state.queue.map(t => row(t))}</ul>{!state.queue.length && <p className="empty">队列空空的，等待作品加入。</p>}<button className="quiet danger" disabled={!state.queue.length} onClick={() => void run(() => command('clear_pending'))}>清空等待队列</button></Panel></div>;
}
