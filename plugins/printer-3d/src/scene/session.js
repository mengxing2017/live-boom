// Transfer kinematics and studio lighting adapted from 3d-printer-live.
// Copyright (c) 2026 志哥AI. MIT; see THIRD_PARTY_NOTICES.
import * as THREE from '../../vendor/three.module.js';
import {OrbitControls} from '../../vendor/OrbitControls.js';
import {createMachine} from '../machine/model.js';
import {SceneOutput} from '../render/scene-output.js';
import {nextRenderScale} from '../render/render-budget.js';
import {createThemes} from './themes.js';
import {DEFAULT_CAMERA,validCamera,normalizeViews} from './cameras.js';
import {messages} from '../i18n/index.js';
import {ruleText} from '../rules/plan.js';
import {audioStrategy} from '../audio/strategy.js';

import {PRESENTATION} from '../settings.js';
export {PRESENTATION} from '../settings.js';
const QUALITY={lite:{scale:1,shadow:0,reflection:false},balanced:{scale:1,shadow:1024,reflection:true},high:{scale:1.25,shadow:2048,reflection:true},ultra:{scale:1.5,shadow:2048,reflection:true},max:{scale:2,shadow:4096,reflection:true}};
const ease=u=>{u=THREE.MathUtils.clamp(u,0,1);return u*u*(3-2*u);};
export function initials(name) {
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d');
 let hash=0;for(const ch of name)hash=(hash*31+ch.codePointAt(0))>>>0;
 c.fillStyle=`hsl(${hash%360} 45% 62%)`;c.fillRect(0,0,256,256);c.fillStyle='#fff8';c.beginPath();c.arc(220,30,90,0,Math.PI*2);c.fill();
 c.fillStyle='#243747';c.font='bold 100px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(Array.from(name).slice(0,2).join(''),128,135,230);return canvas.toDataURL('image/png');
}
export async function createRendererSession(services, view) {
 const stage=view.stage; let captionText='';
 const showCaption=()=>view.overlay(captionText,presentation.overlay);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#d8c8b3');
 const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});renderer.localClippingEnabled=true;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 stage.append(renderer.domElement);const output=new SceneOutput(renderer);
 const camera=new THREE.PerspectiveCamera(36,1,.1,500),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI/2-.05;controls.minDistance=3;controls.maxDistance=180;
 const applyCamera=v=>{if(validCamera(v)){camera.position.fromArray(v.p);controls.target.fromArray(v.t);controls.update();}};applyCamera(DEFAULT_CAMERA);
 scene.add(new THREE.HemisphereLight(0xffe9cf,0x4b4040,.85));const key=new THREE.DirectionalLight(0xffe9d0,2.6);key.position.set(-5,11,7);key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-10,right:15,top:10,bottom:-10});key.shadow.bias=-.00008;scene.add(key);const fill=new THREE.DirectionalLight(0xd9e6ff,.8);fill.position.set(6,4,2);scene.add(fill);
 const machine=createMachine(scene,renderer,initials),setTheme=createThemes(scene,machine,key,fill);
 const studio=new THREE.Scene();studio.background=new THREE.Color('#45413b');
 const softbox=(w,h,x,y,z,power)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(power,power*.97,power*.92),side:THREE.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,2,0);studio.add(m);};
 softbox(6,8,-6,6,4,5);softbox(3,7,6,4,1,3);softbox(7,3,0,9,-3,4);
 const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(studio,.06,.1,50);scene.environment=environment.texture;scene.environmentIntensity=.65;pmrem.dispose();studio.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
 let presentation={...PRESENTATION},views=[],active=null,products=[],disposed=false,paused=false,shown=true,frame=0,last=performance.now(),nextAt=0,renderCount=0,statAt=last,measured=0,scaleLimit=2,beltOffset=0,lastConfig=null;
 const prefs=await services.request('preferences.get',{key:'views'}).catch(()=>null);views=normalizeViews(prefs);
 const savedCamera=await services.request('preferences.get',{key:'camera'}).catch(()=>null);applyCamera(savedCamera);
 const savedPresentation=await services.request('preferences.get',{key:'presentation'}).catch(()=>null);
 const language=()=>messages[presentation.language]??messages['zh-CN'];
 const cameraValue=()=>({p:camera.position.toArray(),t:controls.target.toArray()});
 const saveCamera=()=>{void services.request('preferences.set',{key:'camera',value:cameraValue()}).catch(()=>{});};controls.addEventListener('end',saveCamera);
 const sayCaption=text=>{if(text!==captionText){captionText=text;showCaption();}};
 function resize(){const ratio=Math.min(devicePixelRatio||1,3),w=Math.max(1,Math.round(stage.clientWidth*ratio)),h=Math.max(1,Math.round(stage.clientHeight*ratio));camera.aspect=w/h;camera.updateProjectionMatrix();output.configure(w,h,QUALITY[presentation.quality].scale,presentation.aa,scaleLimit);}
 function updatePresentation(value,persist=true){
  // Host validates a complete schema; startup preferences are still validated defensively here.
  const next={...PRESENTATION,...value};if(!QUALITY[next.quality]||!messages[next.language])return;
  presentation=next;scaleLimit=2;setTheme(next.theme);const q=QUALITY[next.quality];
  key.castShadow=next.shadows&&q.shadow>0;if(q.shadow&&key.shadow.mapSize.x!==q.shadow){key.shadow.mapSize.set(q.shadow,q.shadow);key.shadow.map?.dispose();key.shadow.map=null;}
  machine.setQuality(q.reflection&&next.reflections);renderer.shadowMap.enabled=next.shadows;
  const refl=next.quality==='max'?1536:next.quality==='ultra'?1024:512;machine.bedReflection.getRenderTarget().setSize(refl,refl);machine.deskReflection.getRenderTarget().setSize(refl,refl);
  showCaption();resize();if(active){active.audio.stop();if(!paused)active.audio.phase(active.phase==='printing'?'printing':'transfer');}
  if(persist)void services.request('preferences.set',{key:'presentation',value:next}).catch(()=>{});
 }
 updatePresentation(savedPresentation??PRESENTATION,false);
 const lost=event=>{event.preventDefault();cancel();void services.request('session.interrupt',{}).catch(()=>{});};renderer.domElement.addEventListener('webglcontextlost',lost);
 const observer=new ResizeObserver(resize);observer.observe(stage);resize();
 function removeProduct(p){const i=products.indexOf(p);if(i>=0)products.splice(i,1);machine.disposeProduct(p);}
 function cancel(){if(!active)return;active.audio.stop();removeProduct(active.product);const done=active.resolve;active=null;machine.solveArm(machine.restGrip,.22);done(false);}
 function setPhase(value){if(!active||active.phase===value)return;active.phase=value;active.audio.stop();if(!paused&&value!=='score')active.audio.phase(value);}
 function transfer(t){
  const a=active,p=a.product,st=a.transfer;let target,opening=.24;
  if(t<1.2)target=st.start.clone().lerp(st.pick,ease(t/1.2));else if(t<1.65){target=st.pick.clone();opening=THREE.MathUtils.lerp(.24,.12*p.factor,ease((t-1.2)/.45));}
  else if(t<2.35){target=st.pick.clone();target.y+=ease((t-1.65)/.7)*.7;opening=.12*p.factor;}
  else if(t<3.75){target=st.pick.clone().lerp(st.place,ease((t-2.35)/1.4));target.y+=.7;opening=.12*p.factor;}
  else if(t<4.45){target=st.place.clone();target.y+=(1-ease((t-3.75)/.7))*.7;opening=.12*p.factor;}
  else if(t<4.9){target=st.place.clone();opening=THREE.MathUtils.lerp(.12*p.factor,.24,ease((t-4.45)/.45));}
  else target=st.place.clone().lerp(machine.restGrip,ease((t-4.9)/1.1));
  if(t>=1.65&&!st.attached){machine.solveArm(st.pick,.12*p.factor);machine.gripAnchor.attach(p.g);st.attached=true;}machine.solveArm(target,opening);
  if(t>=4.45&&!st.released){scene.attach(p.g);p.g.rotation.set(0,0,0);p.g.position.set(.25,.57*(1-p.factor)-.105,3.2);st.released=true;products.push(p);}
 }
 function tick(now){
  if(disposed)return;frame=shown?requestAnimationFrame(tick):setTimeout(()=>tick(performance.now()),1000/30);if(now+.5<nextAt)return;nextAt=Math.max(nextAt+1000/presentation.fps,now);
  const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
  if(!paused){
   beltOffset+=dt*.21;machine.beltTexture.offset.x-=dt*.21/16.3;machine.rollers.forEach(r=>r.rotation.z-=dt*.21/.18);machine.beltLines.forEach((b,i)=>b.position.x=-4.3+(i*16.3/84+beltOffset)%16.3);
   for(const p of [...products]){if(active?.product!==p||active.transfer?.released)p.g.position.x+=dt*.21;if(p.g.position.x>12)removeProduct(p);}
   while(products.length>12){const old=products.find(p=>p!==active?.product);if(!old)break;removeProduct(old);}
   if(active){const a=active,p=a.product;a.elapsed+=dt*a.config.speed;
    const printing=a.config.duration;
    if(a.elapsed<printing){const f=a.elapsed/printing,y=.58+f*1.85,layer=Math.floor(f*72),position=(f*72-layer)*4;
     const half=y<1.18?.78:Math.sqrt(Math.max(.001,.69*.69-(y-1.7)*(y-1.7)));const corners=[[-half,.35],[half,.35],[half,-.3],[-half,-.3],[-half,.35]],i=Math.floor(position),u=position-i;
     p.plane.constant=p.g.position.y+y*p.factor;machine.gantry.position.y=p.g.position.y+y*p.factor+.715;machine.head.position.x=.25+THREE.MathUtils.lerp(corners[i][0],corners[i+1][0],u)*p.factor;machine.head.position.z=-.05+THREE.MathUtils.lerp(corners[i][1],corners[i+1][1],u)*p.factor-.04;machine.fan.rotation.z+=dt*35;
     p.filament.geometry.setDrawRange(0,Math.floor(f*p.filament.geometry.attributes.position.count/2)*2);
     sayCaption(`${a.source==='demo'?language().demo:language().manual} · ${a.plan.nickname}\n${language().printing} ${Math.floor(f*100)}% · ${a.index+1}/${a.plan.units.length}`);
    }else if(a.elapsed<printing+1.2){setPhase('score');p.plane.constant=20;p.glint.visible=presentation.effects;p.glint.material.uniforms.sweep.value=-1.4+(a.elapsed-printing)/1.2*2.8;p.glint.material.uniforms.strength.value=Math.sin((a.elapsed-printing)/1.2*Math.PI);sayCaption(`${a.plan.nickname} · ${a.plan.scored?language().score+' '+a.unit.score:language().done}`);}
    else {setPhase('transfer');p.glint.visible=false;
     if(!a.transfer){const pick=new THREE.Vector3(.25,p.g.position.y+2.3*p.factor,-.05-.13*p.factor);a.transfer={pick,place:pick.clone().add(new THREE.Vector3(0,-.105,3.25)),start:machine.gripAnchor.getWorldPosition(new THREE.Vector3())};}
     const t=a.elapsed-printing-1.2;transfer(t);sayCaption(`${a.plan.nickname} · ${language().transfer} · ${a.index+1}/${a.plan.units.length}`);
     if(t>=6){a.audio.stop();active=null;machine.solveArm(machine.restGrip,.22);a.resolve(true);}
    }
   }else sayCaption(language().idle);
  }
  machine.updateHoses();controls.update();if(shown){output.render(scene,camera);renderCount++;}
  if(shown&&now-statAt>=2000){measured=renderCount*1000/(now-statAt);services.metrics({fps:Math.round(measured*10)/10,output:[renderer.domElement.width,renderer.domElement.height],internal:[output.target.width,output.target.height],samples:output.samples,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures});renderCount=0;statAt=now;if(presentation.smooth){const next=nextRenderScale(scaleLimit,measured,presentation.fps);if(next!==scaleLimit){scaleLimit=next;resize();}}}
 }
 frame=requestAnimationFrame(tick);
 return {
  visibility(value){if(disposed||shown===value)return;if(shown)cancelAnimationFrame(frame);else clearTimeout(frame);shown=value;last=performance.now();statAt=last;renderCount=0;frame=shown?requestAnimationFrame(tick):setTimeout(()=>tick(performance.now()),1000/30);},
  presentation(value){if(Object.keys(value??{}).length)updatePresentation(value);},
  async control(value){
   if(!value||typeof value.op!=='string')return;
   if(value.op==='resetCamera'){applyCamera(DEFAULT_CAMERA);saveCamera();}
   if(value.op==='orbit'&&Number.isFinite(value.dx)&&Number.isFinite(value.dy)){const offset=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(offset);s.theta+=THREE.MathUtils.clamp(value.dx,-1,1);s.phi=THREE.MathUtils.clamp(s.phi+value.dy,.1,Math.PI/2-.05);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();saveCamera();}
   if(value.op==='zoom'&&Number.isFinite(value.factor)){camera.position.sub(controls.target).multiplyScalar(THREE.MathUtils.clamp(value.factor,.8,1.2)).add(controls.target);controls.update();saveCamera();}
   if(value.op==='saveCamera'&&views.length<10){views.push({...cameraValue(),name:String(value.name??`Camera ${views.length+1}`).slice(0,32)});await services.request('preferences.set',{key:'views',value:views});}
   if(value.op==='loadCamera'&&Number.isInteger(value.index)){applyCamera(views[value.index]);saveCamera();}
   if(value.op==='deleteCamera'&&Number.isInteger(value.index)&&value.index>=0&&value.index<views.length){views.splice(value.index,1);await services.request('preferences.set',{key:'views',value:views});}
   if(value.op==='rules'&&lastConfig){const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=760;const c=canvas.getContext('2d');c.fillStyle='#f2ece1';c.fillRect(0,0,1000,760);c.fillStyle='#1c3541';c.font='bold 36px sans-serif';c.fillText('liveboom · 3D',40,60);c.font='25px sans-serif';ruleText(lastConfig,presentation.language).split('\n').forEach((line,i)=>c.fillText(line,40,120+i*45,920));canvas.toBlob(async blob=>{if(blob)services.exportPng(await blob.arrayBuffer());},'image/png');}
   if(value.op==='clearScenery'&&!active){for(const p of [...products])removeProduct(p);}
  },
  configure(config){lastConfig=config;},
  setConfig(config){lastConfig=config;},
  async start(plan,index,config,taskServices,source,media){
   if(disposed||active)throw new Error('Renderer is busy');
   const unit=plan.units[index],p=machine.createProduct({name:plan.nickname,avatar:media||initials(plan.nickname),score:unit.score,scored:plan.scored,language:presentation.language});
   p.factor=unit.size==='small'?.72:1;p.g.scale.setScalar(p.factor);p.g.position.y=.57*(1-p.factor);
   const points=[];for(let layer=0;layer<72;layer++){const y=.58+(layer+1)/72*1.85,h=y<1.18?.78:Math.sqrt(Math.max(.001,.69*.69-(y-1.7)**2));for(const [x1,z1,x2,z2]of [[-h,.35,h,.35],[h,.35,h,-.3],[h,-.3,-h,-.3],[-h,-.3,-h,.35]])points.push(x1,y,z1,x2,y,z2);}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setDrawRange(0,0);p.filament=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#d2c5a7',transparent:true,opacity:.5}));p.g.add(p.filament);
   const audio=audioStrategy(taskServices,()=>presentation,config,plan,index);audio.say(`${plan.nickname} ${language().printing}`,'start');audio.phase('printing');
   return new Promise(resolve=>{active={product:p,plan,unit,index,config,resolve,audio,phase:'printing',elapsed:0,source,transfer:null};});
  },
  speakDone(taskServices,plan,index,config){return audioStrategy(taskServices,()=>presentation,config,plan,index).say(`${plan.nickname} ${language().done}`,'done-'+index);},
  pause(){paused=true;active?.audio.stop();},resume(){paused=false;last=performance.now();if(active)active.audio.phase(active.phase==='printing'?'printing':'transfer');},cancel,
  dispose(){disposed=true;cancel();if(shown)cancelAnimationFrame(frame);else clearTimeout(frame);observer.disconnect();controls.removeEventListener('end',saveCamera);controls.dispose();for(const p of [...products])removeProduct(p);
   const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();environment.dispose();machine.dispose();output.dispose();renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
  },
  diagnostics(){return {products:products.length,active:!!active,fps:measured,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,output:[renderer.domElement.width,renderer.domElement.height],internal:[output.target.width,output.target.height],samples:output.samples};}
 };
}
