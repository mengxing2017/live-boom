import {useEffect,useRef,useState} from 'react';
import type {DesktopTransport,Snapshot} from '@liveboom/plugin-sdk';
type Fields=Record<string,unknown>;
export function PresentationControl({transport,snapshot,renderFields,defaults}:{transport:DesktopTransport;snapshot:Snapshot;renderFields:(schema:Fields,value:Fields,onChange:(v:Fields)=>void)=>React.ReactNode;defaults:(s:Fields)=>Fields}){
 const [metrics,setMetrics]=useState<Fields>({});
 useEffect(()=>{let active=true,off:(()=>void)|undefined;void transport.subscribeMetrics?.(value=>{if(active)setMetrics(value);}).then(fn=>{if(active)off=fn;else fn();});return()=>{active=false;off?.();};},[transport]);
 const schema=snapshot.active?.presentation_schema;
 const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
 const [value,setValue]=useState<Fields>({});const [error,setError]=useState('');const [preview,setPreview]=useState('');const [exported,setExported]=useState<number[]|null>(null);const [viewName,setViewName]=useState('');const [views,setViews]=useState<{name:string}[]>([]);
 const [exportUrl,setExportUrl]=useState('');
 useEffect(()=>{if(!exported)return;const url=URL.createObjectURL(new Blob([Uint8Array.from(exported)],{type:'image/png'}));setExportUrl(url);return()=>URL.revokeObjectURL(url);},[exported]);
 const imageUrl=useRef('');const dragging=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{setValue(schema?{...defaults(schema),...snapshot.presentation}:{});},[snapshot.active?.digest]);
 useEffect(()=>{let active=true,off:(()=>void)|undefined;void transport.subscribePreview?.(bytes=>{if(!active)return;const url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:'image/jpeg'}));if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current=url;setPreview(url);}).then(fn=>{if(active)off=fn;else fn();});return()=>{active=false;off?.();if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);};},[transport]);
 useEffect(()=>{let active=true,off:(()=>void)|undefined;void transport.subscribeExport?.(bytes=>{if(active)setExported(bytes);}).then(fn=>{if(active)off=fn;else fn();});return()=>{active=false;off?.();};},[transport]);
 useEffect(()=>{if(!('speechSynthesis' in window))return;const update=()=>setVoices(speechSynthesis.getVoices().filter(v=>v.localService));update();speechSynthesis.addEventListener('voiceschanged',update);return()=>speechSynthesis.removeEventListener('voiceschanged',update);},[]);
 const command=async(name:string,args:Fields={})=>{try{await transport.command(name,args);setError('');}catch(e){setError(String(e));}};
 const control=async(args:Fields)=>{await command('preview_control',args);};
 const loadViews=()=>{void transport.command('read_preferences',{key:'views'}).then(value=>setViews(Array.isArray(value)?value:[])).catch(e=>setError(String(e)));};
 useEffect(()=>{loadViews();},[snapshot.active?.digest]);
 if(!schema)return null;
 return <section><h2>画面与输出</h2>{Object.keys(metrics).length>0&&<p>实测渲染：{JSON.stringify(metrics)}</p>}{renderFields(schema,value,setValue)}<button onClick={()=>void command('presentation',value)}>即时应用显示设置</button><p>显示设置立即生效；玩法规则仅影响新提交任务。</p>
 <label>输出尺寸<select defaultValue="1280,720" onChange={e=>{const [width,height]=e.target.value.split(',').map(Number);void command('resize_display',{width,height});}}>{['1280,720','1920,1080','720,1280','1080,1920'].map(v=><option key={v} value={v}>{v.replace(',',' × ')}</option>)}</select></label>
 <label>本地语音<select value={String(value.voice??'')} onChange={e=>setValue(v=>({...v,voice:e.target.value}))}><option value="">按语言自动选择</option>{voices.map(v=><option key={v.voiceURI} value={v.name}>{v.name} · {v.lang}</option>)}</select></label><button onClick={()=>void control({op:'speechTest',text:'声音试听。Audio test.'})}>试听本地语音</button>
 <p>声音需在展示窗口点击启用。仅使用本地语音；没有本地语音时保留文字。</p>
 {preview&&<img className="output-preview" src={preview} alt="展示窗预览，拖动调整镜头" onPointerDown={e=>{dragging.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{const p=dragging.current;dragging.current=null;if(p)void control({op:'orbit',dx:(e.clientX-p.x)/300,dy:(e.clientY-p.y)/300});}} />}
 <button onClick={()=>void control({op:'zoom',factor:.9})}>放大</button><button onClick={()=>void control({op:'zoom',factor:1.1})}>缩小</button><button onClick={()=>void control({op:'resetCamera'})}>初始镜头</button>
 <label>镜头名称<input maxLength={32} value={viewName} onChange={e=>setViewName(e.target.value)}/></label><button disabled={views.length>=10} onClick={()=>{void control({op:'saveCamera',name:viewName||`镜头 ${views.length+1}`}).then(()=>{setTimeout(loadViews,300);});}}>保存镜头（最多 10 个）</button><button onClick={loadViews}>刷新镜头</button>
 <ul>{views.map((v,i)=><li key={i}>{v.name}<button onClick={()=>void control({op:'loadCamera',index:i})}>切换</button><button onClick={()=>{void control({op:'deleteCamera',index:i}).then(()=>setTimeout(loadViews,300));}}>删除</button></li>)}</ul>
 <button onClick={()=>void control({op:'rules'})}>生成规则 PNG</button>{exported&&exportUrl&&<img className="output-preview" alt="待保存规则图" src={exportUrl}/>} {exported&&<button onClick={()=>{void transport.savePng?.(exported).then(()=>{setExported(null);}).catch(e=>setError(String(e)));}}>选择位置保存规则图</button>}
 <button onClick={()=>void control({op:'clearScenery'})}>清理空闲画面成品</button><p role="status">{error}</p></section>;
}
