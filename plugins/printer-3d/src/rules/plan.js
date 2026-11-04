// Adapted fixed offline mappings from 3d-printer-live (c) 2026 志哥AI, MIT.
// This module creates data only. The Rust coordinator is the sole queue owner.
export const EVENTS = ['manual','comment','like','follow','join','heart','beer','lollipop','other'];
export function preparePlan(input, config, random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) {
  const rule=config.rules?.[input.event];
  if (!rule?.enabled || !EVENTS.includes(input.event)) throw new Error('Rule disabled');
  const count=input.quantity*rule.units;
  if (!Number.isInteger(count) || count<1 || count>100) throw new Error('Work capacity exceeded');
  return {nickname:input.nickname,content:input.content,media:input.media,event:input.event,scored:config.score,
    units:Array.from({length:count},()=>({size:rule.size,score:60+Math.min(35,Math.max(0,Math.floor(random()*36)))}))};
}
export function ruleText(config,language='zh-CN') {
  return EVENTS.filter(k=>config.rules[k].enabled).map(k=>`${k}: ${config.rules[k].units} × ${config.rules[k].size}`).join('\n') + (language==='en'?'\nOFFLINE ENTERTAINMENT · no platform connected':'\n独立娱乐 · 未接入平台 · 模拟事件不代表真实送礼');
}
