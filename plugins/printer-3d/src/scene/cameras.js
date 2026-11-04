const finiteVector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=200);
export const DEFAULT_CAMERA={p:[6.8,9.6,24.5],t:[3.6,2.3,1.3]};
export function validCamera(v){return v&&finiteVector(v.p)&&finiteVector(v.t)&&Math.hypot(...v.p.map((n,i)=>n-v.t[i]))>=3;}
export function normalizeViews(value){return Array.isArray(value)?value.filter(v=>validCamera(v)&&typeof v.name==='string'&&v.name.length<=32).slice(0,10):[];}
