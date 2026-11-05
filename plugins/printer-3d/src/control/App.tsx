// UI layout and interaction adapted from 3d-printer-live, Copyright (c) 2026 志哥AI, MIT.
// React state and all host interactions are rewritten for liveboom's plugin boundary.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Workbench, InspectorTabs } from '@liveboom/plugin-sdk/ui';
import '@liveboom/plugin-sdk/ui/styles';
import './studio.css';
import { usePrinterController } from './state/usePrinterController';
import { QueuePanel } from './panels/QueuePanel';
import { ProductionCenter } from './panels/ProductionCenter';
import { RulePanel } from './panels/RulePanel';
import { VisualPanel } from './panels/VisualPanel';
import { AudioPanel } from './panels/AudioPanel';
import { DemoPanel } from './panels/DemoPanel';
import { MediaPanel } from './panels/MediaPanel';
import { HistoryPanel } from './panels/HistoryPanel';
function App() {
  const c = usePrinterController();
  if (!c) return <div className="connecting" role="status">正在连接 3D 制作台…</div>;
  return <div className={`studio${c.showLog?' has-events':''}`}>
    <Workbench resetKey={c.layoutReset} store={c.layoutStore} tasks={<QueuePanel controller={c}/>} stage={<ProductionCenter controller={c}/>} inspector={<InspectorTabs items={[
      {id:'rules',label:'规则',content:<RulePanel controller={c}/>},
      {id:'visual',label:'画面',content:<VisualPanel controller={c}/>},
      {id:'audio',label:'声音',content:<AudioPanel controller={c}/>},
      {id:'demo',label:'演示',content:<DemoPanel controller={c}/>},
      {id:'media',label:'素材',content:<MediaPanel controller={c}/>},
      {id:'history',label:'记录',content:<HistoryPanel controller={c}/>},
    ]}/>}/>
    {c.showLog&&<div className="event-panel" aria-label="事件面板">{c.log.length?c.log.map((line,i)=><div key={i}>{line}</div>):'暂无操作记录'}</div>}
    <footer><p role="status" aria-live="polite">{c.feedback || '本地制作台已就绪'}</p><button aria-expanded={c.showLog} onClick={()=>c.setShowLog(v=>!v)}>事件 {c.log.length}</button><span>{String(c.metrics.fps??'--')} FPS · 实际画面</span></footer>
  </div>;
}
flushSync(() => createRoot(document.getElementById('root')!).render(<App/>));
