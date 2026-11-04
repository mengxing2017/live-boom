export function audioStrategy(services, presentation, config, plan, epochKey) {
 const current=()=>typeof presentation==='function'?presentation():presentation;
 const send=(method,params)=>services.request(method,params).catch(()=>{});
 return {
  phase(phase){const presentation=current();if(!presentation.mute)return send('audio.play',{path:`assets/audio/${phase==='printing'?'printing-writing':'robot-arm'}.wav`,volume:presentation.volume,loop:phase==='printing'});},
  say(text,id){const presentation=current();if(config.speech&&!presentation.mute)return send('speech.say',{text,lang:presentation.language,id:epochKey+'/'+id,voice:presentation.voice,rate:presentation.rate,volume:presentation.volume});},
  stop(){send('audio.stop',{});}
 };
}
