import {createRoot} from 'react-dom/client';
import {DesktopApp,GameplaySurface} from '@liveboom/desktop-ui';
import type {DesktopTransport,Snapshot,Task,PluginInfo} from '@liveboom/plugin-sdk';
import '@liveboom/desktop-ui/styles';
import currentManifest from '../../../plugins/printer-3d/manifest.json';
import inputSchema from '../../../plugins/printer-3d/schemas/input.json';
import configSchema from '../../../plugins/printer-3d/schemas/config.json';
import presentationSchema from '../../../plugins/printer-3d/schemas/presentation.json';
import examples from '../../../plugins/printer-3d/schemas/examples.json';
import registryManifest from '../../../plugins/registry/manifest.json';
import registryInput from '../../../plugins/registry/schemas/input.json';
import registryConfig from '../../../plugins/registry/schemas/config.json';
const registry = new URLSearchParams(location.search).get('kind') === 'registry';
const manifest = registry ? registryManifest : currentManifest;
const controlURL=new URLSearchParams(location.search).get('control');
let displayInstance='';
const previews=new Set<(bytes:number[])=>void>(),exports=new Set<(bytes:number[])=>void>(),metricsListeners=new Set<(v:Record<string,unknown>)=>void>();
const documentURL=new URLSearchParams(location.search).get('document')!;
const plugin={digest:'test',manifest,examples,input_schema:registry?registryInput:inputSchema,config_schema:registry?registryConfig:configSchema,plan_schema:{},presentation_schema:presentationSchema} as PluginInfo;
const config={duration:2,speed:4,score:true,speech:false,rules:Object.fromEntries(['manual','comment','like','follow','join','heart','beer','lollipop','other'].map(event=>[event,{enabled:true,units:1,size:'small'}]))};
let snapshot:Snapshot={version:1,session_id:'browser3d',paused:false,display_ready:false,demo_enabled:false,demo_interval:30,presentation:{theme:'home',quality:'lite',aa:'off',fps:30,smooth:true,overlay:true,shadows:false,reflections:false,effects:true,language:'zh-CN',volume:0,mute:true,voice:'',rate:1},active:plugin,config,current:null,queue:[],history:[]};
const listeners=new Set<(s:Snapshot)=>void>(),prefs=new Map();
const emit=()=>{snapshot={...snapshot,version:snapshot.version+1};for(const f of listeners)f(snapshot);};
const testState={commands:[] as {name:string,args:unknown}[],imports:0,saves:0,previous:null as Task|null,stale(){if(!this.previous)return;for(const f of listeners)f({...snapshot,version:snapshot.version-1,session_id:'stale-session',current:this.previous});},prepared:null as unknown,results:[] as string[],units:[] as number[],frames:0,metrics:{} as Record<string,unknown>,views:()=>prefs.get('views')??[],present(value:Record<string,unknown>){snapshot={...snapshot,presentation:{...snapshot.presentation,...value}};emit();},exports:[] as number[],pause(value:boolean){snapshot={...snapshot,paused:value};emit();},snapshot:()=>snapshot,controls:new Set<(v:Record<string,unknown>)=>void>(),control(value:Record<string,unknown>){for(const f of this.controls)f(value);}};
Object.assign(window,{__test:testState,__TAURI_INTERNALS__:{secret:'host-only'}});
const transport:DesktopTransport={
 snapshot:async()=>snapshot,subscribe:async f=>{listeners.add(f);return()=>listeners.delete(f);},plugins:async()=>[plugin],document:async(_,surface)=>surface==='control'?controlURL!:documentURL,
 importMedia:async bytes=>{testState.imports++;if(bytes.length>8388608)throw new Error('too large');return 'media:'+'a'.repeat(64);},
 savePng:async()=>{testState.saves++;},
 subscribePreview:async f=>{previews.add(f);return()=>previews.delete(f);},
 subscribeExport:async f=>{exports.add(f);return()=>exports.delete(f);},
 subscribeMetrics:async f=>{metricsListeners.add(f);return()=>metricsListeners.delete(f);},
 command:async(name,args={})=>{
  testState.commands.push({name,args:{...args}});delete args.__controlDigest;
  if(name==='register_display'){displayInstance=String(args.instance);snapshot={...snapshot,display_ready:true};if(!controlURL){const task:Task={id:'printer1',plugin,input:{nickname:'迁移验证',content:'text',media:'',event:'manual',quantity:2},config,epoch:'epoch1',instance:displayInstance,status:'running',prepared:false,plan:null,work_units:2,completed_units:0,source:'demo',priority:0,created_at:Date.now(),finished_at:null,unit_completed_at:[]};snapshot={...snapshot,current:task};}emit();}
  else if(name==='submit'||name==='submit_demo'){const input=args.input as Record<string,unknown>;const c=snapshot.config as typeof config;const count=registry ? 1 : Number(input.quantity)*c.rules[String(input.event)].units;const task:Task={id:crypto.randomUUID(),epoch:crypto.randomUUID(),plugin,input,config:c,instance:displayInstance,status:'running',prepared:false,plan:null,work_units:count,completed_units:0,source:name==='submit_demo'?'demo':'manual',priority:Number(args.priority),created_at:Date.now(),finished_at:null,unit_completed_at:[]};snapshot=snapshot.current?{...snapshot,queue:[...snapshot.queue,task]}:{...snapshot,current:task};emit();}
  else if(name==='configure'){snapshot={...snapshot,config:args};emit();}
  else if(name==='presentation'){snapshot={...snapshot,presentation:args};emit();}
  else if(name==='pause'||name==='resume'){testState.pause(name==='pause');}
  else if(name==='preview_control'){testState.control(args);}
  else if(name==='read_preferences')return prefs.get(args.key)??null;
  else if(name==='demo_policy'){snapshot={...snapshot,demo_enabled:Boolean(args.enabled),demo_interval:Number(args.interval)};emit();}
  else if(name==='clear_pending'){snapshot={...snapshot,queue:[]};emit();}
  else if(name==='cancel'){snapshot={...snapshot,current:null};emit();}
  else if(name==='licenses')return 'MIT License · Copyright (c) 2026 志哥AI';
  return null;
 },
 prepare:async(_,plan)=>{testState.prepared=plan;snapshot={...snapshot,current:{...snapshot.current!,plan,prepared:true}};emit();},
 result:async request=>{testState.previous=snapshot.current;testState.results.push(request.status);snapshot={...snapshot,history:[...snapshot.history,{...snapshot.current!,status:request.status}],current:snapshot.queue[0]??null,queue:snapshot.queue.slice(1)};emit();},
 service:async(request,method,params)=>{if(request.epoch!==snapshot.current?.epoch)throw new Error('Stale task');if(method==='units.complete'){testState.units.push(Number(params.index));snapshot={...snapshot,current:{...snapshot.current!,completed_units:Number(params.index)+1}};emit();if(params.index===0)await new Promise(resolve=>setTimeout(resolve,1000));}return null;},
 sessionService:async(_,method,params)=>{if(method==='diagnostics.report'){testState.metrics=params.metrics as Record<string,unknown>;for(const f of metricsListeners)f(testState.metrics);return null;}if(method==='preferences.set'){prefs.set(params.key,params.value);return null;}if(method==='preferences.get')return prefs.get(params.key)??null;throw new Error('Unsupported session service');},
 preview:async(_,bytes)=>{if(bytes.length>262144||bytes[0]!==255)throw new Error('Invalid preview');testState.frames++;for(const f of previews)f(bytes);},
 exportPng:async(_,bytes)=>{testState.exports=bytes;for(const f of exports)f(bytes);},
 subscribeControl:async f=>{testState.controls.add(f);return()=>testState.controls.delete(f);},
};
createRoot(document.getElementById('root')!).render(controlURL?<DesktopApp transport={transport}/>:<GameplaySurface transport={transport}/>);
