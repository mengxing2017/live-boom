import type { PrinterController } from '../state/usePrinterController';
import { Panel } from './controls';
export function HistoryPanel({ controller }: { controller: PrinterController }) {
  const { state, run, command, filter, setFilter, row } = controller;
  return <Panel title="打印记录" tag="PRINT LOG" action={<select aria-label="记录来源" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部本地</option><option value="manual">手动</option><option value="demo">离线模拟</option></select>}><ul className="task-list history-list">{state.history.filter(t => filter === 'all' || t.source === filter).slice().reverse().map(t => row(t, true))}</ul>{!state.history.length && <p className="empty">还没有制作记录，等第一份作品完成。</p>}<button className="quiet danger" onClick={() => void run(() => command('clear_history'))}>清空记录 / 开始新场</button></Panel>;
}
