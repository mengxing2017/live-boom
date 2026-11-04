import { createRoot } from 'react-dom/client';
import { DesktopApp } from '@likeboom/desktop-ui';
import type { DesktopTransport, Snapshot, Task, PluginInfo } from '@likeboom/plugin-sdk';
import '@likeboom/desktop-ui/styles';
const documentURL = new URLSearchParams(location.search).get('document')!;
const plugin = { digest: 'test', manifest: { id: 'private.probe', name: 'Probe', version: '1.0.0', sdkApi: '1', hostVersion: '>=0.2.0 <0.3.0', entry: 'web/index.html', configSchema: 'schemas/config.json', inputSchema: 'schemas/input.json', stateSchemaVersion: 1, permissions: ['task.current.read','task.result.report'], publisher:'test' }, input_schema: {}, config_schema:{} } as PluginInfo;
let snapshot: Snapshot = { version:1, session_id:'browser', paused:false, display_ready:false, active:plugin, config:{duration:2}, current:null, queue:[], history:[] };
const listeners = new Set<(s:Snapshot)=>void>();
const emit = () => { snapshot = {...snapshot, version:snapshot.version+1}; for(const f of listeners) f(snapshot); };
const testState = { prepared: null as unknown, results: [] as string[], pause(value:boolean){ snapshot={...snapshot,paused:value};emit();}, snapshot:()=>snapshot };
Object.assign(window,{ __test:testState, __TAURI_INTERNALS__:{secret:'host-only'} });
const transport: DesktopTransport = {
 snapshot:async()=>snapshot, subscribe:async f=>{listeners.add(f);return()=>listeners.delete(f);}, plugins:async()=>[plugin], document:async()=>documentURL,
 command:async(name,args)=>{if(name==='register_display'){ const task:Task={id:'task1',plugin,input:{nickname:'访客'},config:{duration:2},epoch:'epoch1',instance:String(args?.instance),status:'running',prepared:false};snapshot={...snapshot,display_ready:true,current:task};emit(); }return null;},
 prepare:async(_,input)=>{testState.prepared=input;snapshot={...snapshot,current:{...snapshot.current!,input,prepared:true}};emit();},
 result:async request=>{testState.results.push(request.status);snapshot={...snapshot,current:null};emit();},
 service:async()=>null,
};
createRoot(document.getElementById('root')!).render(<DesktopApp transport={transport} role="display"/>);
