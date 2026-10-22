import {spawn} from 'node:child_process';
const api=spawn(process.execPath,['server/index.js'],{stdio:'inherit'});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--configLoader','runner'],{stdio:'inherit'});
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;api.kill();vite.kill();process.exitCode=code;}
for(const child of [api,vite]){child.on('error',()=>stop(1));child.on('exit',code=>stop(code||0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
