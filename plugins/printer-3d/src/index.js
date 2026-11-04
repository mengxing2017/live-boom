import {connectPlugin} from '@likeboom/plugin-sdk/client';
import {createRendererSession} from './scene/session.js';
import {preparePlan} from './rules/plan.js';
export function startDisplay(view) {
let world,sessionServices;
return connectPlugin(services=>{
 let disposed=false;
 return {
  prepare(input,config){return preparePlan(input,config);},
  async play(input,config,state){
   const plan=state.plan;if(!plan)throw new Error('Frozen plan required');
   let media='';if(plan.media&&plan.content==='portrait')media=String(await sessionServices.request('media.resolve',{reference:plan.media}));
   if(disposed)return;
   for(let index=state.completedUnits;index<plan.units.length;index++){
    if(disposed)return;const completed=await world.start(plan,index,config,services,state.source,media);if(!completed||disposed)return;
    await world.speakDone(services,plan,index,config);if(disposed)return;
    await services.request('units.complete',{index});
   }
   if(!disposed)services.result('completed');
  },
  pause(){world?.pause();},resume(){world?.resume();},dispose(){disposed=true;world?.cancel();}
 };
},{session:async (services,config)=>{sessionServices=services;world=await createRendererSession(services,view);world.setConfig(config);return world;}});

}
