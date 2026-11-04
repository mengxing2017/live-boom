import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {preparePlan,ruleText} from '../plugins/printer-3d/src/rules/plan.js';
const schema=JSON.parse(await readFile('plugins/printer-3d/schemas/config.json'));
const defaults=s=>'default' in s?s.default:s.type==='object'?Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,defaults(v)])):null;
test('offline mappings freeze every promised unit and disabled rules/capacity fail',()=>{
 const config=defaults(schema);const input={nickname:'昵称',content:'text',media:'',event:'beer',quantity:2};let rolls=0;
 const plan=preparePlan(input,config,()=>{rolls++;return .999999;});assert.equal(rolls,4);assert.equal(plan.units.length,4);assert.ok(plan.units.every(u=>u.score===95&&u.size==='large'));
 config.rules.beer.units=3;assert.equal(plan.units.length,4,'later config changed a frozen plan');assert.equal(preparePlan(input,config,()=>0).units[0].score,60);
 assert.throws(()=>preparePlan({...input,quantity:100},config),/capacity/);config.rules.beer.enabled=false;assert.throws(()=>preparePlan(input,config),/disabled/);assert.ok(ruleText(config).includes('未接入平台'));
});
test('3D package retains original and Three.js notices, all extension schemas and self-contained code',async()=>{
 const bundle=JSON.parse(await readFile('plugins/printer-3d/dist/plugin.lbplug'));const bytes=name=>Buffer.from(bundle.files[name],'base64');const manifest=JSON.parse(bytes('manifest.json'));
 for(const path of [manifest.planSchema,manifest.presentationSchema])assert.ok(bundle.files[path]);
 assert.ok(manifest.capabilities.includes('control.v1'));
 const control=bytes(manifest.controlEntry).toString().replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
 assert.ok(control.includes('规则演示台')&&control.includes('打印记录'));
 assert.ok(!/<script[^>]+src=|<link[^>]+href=/.test(control),'Control document must bundle React and CSS offline');
 for(const name of ['react','react-dom'])assert.ok(bytes('THIRD_PARTY_NOTICES').toString().includes(await readFile(`plugins/printer-3d/node_modules/${name}/LICENSE`,'utf8')));
 const upstream=await readFile('third_party/3d-printer-live/LICENSE','utf8');assert.ok(bytes('THIRD_PARTY_NOTICES').toString().includes(upstream));assert.ok(bytes('THIRD_PARTY_NOTICES').toString().includes('2010-2024 three.js authors'));
 assert.equal(createHash('sha256').update(upstream).digest('hex'),'36974e3ecde59805b4f4840dcf2342f6ca2a29eea38e501cd2e1bf201888027d');
 const html=bytes(manifest.entry).toString();assert.ok(html.includes('WebGLRenderer'));assert.ok(!/douyin-bridge|__start-bridge|\/__scene-events|9223|wx-copy/.test(html));
 assert.ok(!Object.keys(bundle.files).some(path=>/avatar-atlas|original-icons|\.map$/.test(path)));
});
