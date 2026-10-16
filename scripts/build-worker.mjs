import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.webp':'image/webp'};
const assets={};
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else assets['/'+p.slice(4)]={type:types[extname(p)]??'application/octet-stream',data:(await readFile(p)).toString('base64')};}}
await walk('out');
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
// Bundle server modules with the compiler already supplied by Next.js. Runtime
// secrets come from env; no private environment file is read or embedded here.
const require=createRequire(import.meta.url);
const webpack=require('next/dist/compiled/webpack/webpack').webpack;
await new Promise((resolveBuild,rejectBuild)=>{
 webpack({mode:'production',target:'webworker',entry:resolve('worker/index.mjs'),
  output:{path:resolve('dist/server'),filename:'index.js',module:true,library:{type:'module'}},
  experiments:{outputModule:true},optimization:{minimize:false},devtool:false,
  plugins:[new webpack.BannerPlugin({banner:`const ASSETS=${JSON.stringify(assets)};`,raw:true})],
 },(error,stats)=>{
  if(error)rejectBuild(new Error('Worker packaging failed.'));
  else if(stats.hasErrors())rejectBuild(new Error(stats.toString({all:false,errors:true})));
  else resolveBuild();
 });
});
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
console.log(`Packaged ${Object.keys(assets).length} Next.js assets, finder access, and the waitlist/email Worker.`);
