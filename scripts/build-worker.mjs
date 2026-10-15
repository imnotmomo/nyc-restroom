import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.webp':'image/webp'};
const assets={};
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else assets['/'+p.slice(4)]={type:types[extname(p)]??'application/octet-stream',data:(await readFile(p)).toString('base64')};}}
await walk('out');
const shared=await readFile('worker/waitlist.mjs','utf8');
const handler=(await readFile('worker/index.mjs','utf8')).replace("import { signupResponse, INSERT, values } from './waitlist.mjs';",'');
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js',`const ASSETS=${JSON.stringify(assets)};\n${shared}\n${handler}`);
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
console.log(`Packaged ${Object.keys(assets).length} Next.js assets and the waitlist Worker.`);
