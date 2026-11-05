import {readFile,writeFile,access} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
/** Include the actual bundled packages' license texts, not an assumed top-level license. */
export async function writeControlNotices(root, inputs) {
  const licenses=new Map();
  for(const input of Object.keys(inputs)){
    if(!input.includes('node_modules/'))continue;
    let directory=dirname(resolve(input));
    while(directory!==dirname(directory)){
      try {
        const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
        if(!pkg.name){directory=dirname(directory);continue;}
        if(licenses.has(`${pkg.name}@${pkg.version}`))break;
        const name=await (async()=>{for(const candidate of ['LICENSE','LICENSE.md','LICENSE-MIT','LICENSE.txt','license','license.md']){try{await access(join(directory,candidate));return candidate;}catch{}}})();
        if(!name && pkg.name==='react-remove-scroll-bar'){licenses.set(`${pkg.name}@${pkg.version}`,await readFile(new URL('../../third_party/react-remove-scroll-bar/LICENSE',import.meta.url),'utf8'));break;}
        if(!name)throw new Error(`Missing license for bundled package ${pkg.name}`);
        licenses.set(`${pkg.name}@${pkg.version}`,await readFile(join(directory,name),'utf8'));break;
      } catch(error) { if(error.code!=='ENOENT')throw error; directory=dirname(directory); }
    }
  }
  const path=new URL('THIRD_PARTY_NOTICES',root);
  let base='';try{base=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  base=base.split('\n--- Bundled control UI dependencies (generated) ---')[0];
  await writeFile(path,base+'\n--- Bundled control UI dependencies (generated) ---\n\n'+[...licenses].sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>`${name}\n\n${text.replaceAll("\r\n", "\n")}`).join('\n\n'));
}
