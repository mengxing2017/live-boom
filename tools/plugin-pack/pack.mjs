import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../packages/plugin-sdk/bin/pack.mjs';
export { pack } from '../../packages/plugin-sdk/bin/pack.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
