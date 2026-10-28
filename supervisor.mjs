import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,open,unlink,writeFile} from 'node:fs/promises';
const root=dirname(fileURLToPath(import.meta.url));
const dir=process.env.PULSO_DATA_DIR||join(process.env.LOCALAPPDATA||join(root,'local-data'),'PulsoCotas');
await mkdir(dir,{recursive:true});
const url=`http://127.0.0.1:${process.env.PULSO_PORT||43821}`;
const healthy=async()=>{try{const r=await fetch(url+'/health',{signal:AbortSignal.timeout(4000)});const data=await r.json();return data.ok&&data.app==='pulso';}catch{return false;}};
const show=()=>{if(!process.argv.includes('--background'))spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).unref();};
if(await healthy()){show();process.exit(0);}
const lock=join(dir,'supervisor.lock');
let fd;try{fd=await open(lock,'wx');}catch(e){if(e.code!=='EEXIST')throw e;const {readFile}=await import('node:fs/promises');let alive=false;try{const pid=Number(await readFile(lock,'utf8'));process.kill(pid,0);alive=true;}catch{}if(alive){show();process.exit(0);}await unlink(lock).catch(()=>{});fd=await open(lock,'wx');}
await fd.writeFile(String(process.pid));await fd.close();
await unlink(join(dir,'stopped')).catch(()=>{});
let child=null,ending=false,opened=false,failures=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function cleanup(){ending=true;child?.kill();await unlink(lock).catch(()=>{});}
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>{void cleanup().finally(()=>process.exit(0));});
try{while(!ending){
  const {existsSync}=await import('node:fs');if(existsSync(join(dir,'stopped')))break;
  child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:process.env,windowsHide:true,stdio:'ignore'});
  let exited=false;child.on('exit',()=>{exited=true});child.on('error',()=>{exited=true});
  let unhealthy=0;
  while(!exited&&!ending){await wait(10000);if(await healthy()){unhealthy=0;failures=0;if(!opened){opened=true;show();}}else if(++unhealthy>=3){child.kill();break;}}
  if(!ending){failures++;await wait(Math.min(60000,failures*5000));}
}}finally{await cleanup();}
