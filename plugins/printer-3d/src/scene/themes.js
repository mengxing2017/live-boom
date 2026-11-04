import * as THREE from '../../vendor/three.module.js';
// Original procedural scenery replaces screenshot-derived and uncleared image assets.
export function createThemes(scene, machine, key, fill) {
 const groups={};
 const cube=(g,w,h,d,x,y,z,color)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.8}));m.position.set(x,y,z);g.add(m);return m;};
 for(const id of ['home','study','night','workshop','garden']){const g=new THREE.Group();scene.add(g);groups[id]=g;
  if(id==='study'){for(let row=0;row<4;row++){cube(g,3,.12,1,8,1+row*1.4,-4.9,'#b99a76');for(let i=0;i<7;i++)cube(g,.25,.75+(i%3)*.12,.6,7.1+i*.3,1.5+row*1.4,-4.8,['#91a4a0','#d8b686','#825a54'][i%3]);}}
  if(id==='night'){const light=new THREE.PointLight('#ffb36b',10,12);light.position.set(5,3,0);g.add(light);for(let i=0;i<22;i++)cube(g,.04,.5,.02,-8+(i*13%17),3+i%5,-5.7,'#7f9aa9');}
  if(id==='workshop'){cube(g,3.5,2.4,.15,7,4.9,-4.8,'#a87e54');for(let i=0;i<8;i++){cube(g,.08,.7,.08,5.5+i*.4,4.8,-4.6,'#adb7bb');cube(g,.15,.3,.15,5.5+i*.4,4.4,-4.6,'#527a71');}}
  if(id==='garden'){for(let i=0;i<7;i++){const x=i<4?8:-7,z=(i%4)*1.4-4;cube(g,.6,.6,.6,x,.1,z,'#af785c');for(let k=0;k<5;k++){const leaf=new THREE.Mesh(new THREE.SphereGeometry(.4,12,8),new THREE.MeshStandardMaterial({color:'#729477'}));leaf.scale.set(.6,1.8,.4);leaf.position.set(x+Math.sin(k)*.3,.9+k*.22,z+Math.cos(k)*.2);g.add(leaf);}}}
 }
 const colors={home:['#d8c8b3','#d8cbb8',2.6],study:['#e1ddd1','#e2ded2',3.1],night:['#343e50','#555d6b',.65],workshop:['#b1a08c','#b6a28a',2],garden:['#ccd6bf','#c7d2ba',2.8]};
 return id=>{const c=colors[id]??colors.home;for(const [k,g]of Object.entries(groups))g.visible=k===id;scene.background.set(c[0]);machine.wall.material.color.set(c[1]);key.intensity=c[2];fill.intensity=id==='night'?.25:.8;};
}
