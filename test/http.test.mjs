import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base='http://127.0.0.1:43829';
test('local HTTP boundary and private state',{timeout:20000},async()=>{
  const data=await mkdtemp(join(tmpdir(),'pulso-test-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PULSO_PORT:'43829',PULSO_DATA_DIR:data,PULSO_NO_DEFAULT_ACCOUNT:'1'},windowsHide:true,stdio:'ignore'});
  try{
    for(let i=0;i<60;i++){try{const r=await fetch(base+'/health');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.equal((await fetch(base+'/api/state')).status,401);
    const index=await fetch(base);assert.equal(index.status,200);assert.match(await index.text(),/type="module"/);const cookie=index.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie,Origin:'https://example.com'}})).status,403);
    const info=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.deepEqual(info.accounts,[]);assert.ok(info.csrf);
    assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
    const result=await fetch(base+'/api/settings',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Pulso-Csrf':info.csrf},body:JSON.stringify({nativeNotifications:false})});assert.equal(result.status,200);
    const after=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(after.settings.nativeNotifications,false);
    const js=await(await fetch(base+'/app.js')).text();assert.ok(!/access_token|refresh_token/.test(js));
    await fetch(base+'/api/shutdown',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Pulso-Csrf':info.csrf},body:'{}'});
    await new Promise(r=>child.once('exit',r));
  }finally{child.kill();await rm(data,{recursive:true,force:true});}
});
test('renaming validates input and persists for an isolated account',{timeout:20000},async()=>{
  const data=await mkdtemp(join(tmpdir(),'pulso-rename-'));
  await writeFile(join(data,'state.json'),JSON.stringify({initialized:true,accounts:[{id:'test-account',label:'Antes',source:'isolated',status:'pending',buckets:[],failures:0}],events:[],settings:{nativeNotifications:false,autoStart:false}}));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PULSO_PORT:'43829',PULSO_DATA_DIR:data,PULSO_CODEX_JS:join(data,'missing.js')},windowsHide:true,stdio:'ignore'});
  try{
    for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const page=await fetch(base);const cookie=page.headers.get('set-cookie').split(';')[0];
    const state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();
    const post=(body,csrf=state.csrf)=>fetch(base+'/api/rename',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Pulso-Csrf':csrf},body:JSON.stringify(body)});
    assert.equal((await post({id:'test-account',label:'   '})).status,400);
    assert.equal((await post({id:'missing',label:'Nome'})).status,404);
    assert.equal((await post({id:'test-account',label:'Nome'},'bad')).status,403);
    assert.equal((await post({id:'test-account',label:' Novo nome '})).status,200);
    assert.equal(JSON.parse(await readFile(join(data,'state.json'),'utf8')).accounts[0].label,'Novo nome');
    const subscription=(body)=>fetch(base+'/api/subscription',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Pulso-Csrf':state.csrf},body:JSON.stringify(body)});
    assert.equal((await subscription({id:'test-account',date:'2026-02-31',kind:'period_end'})).status,400);
    assert.equal((await subscription({id:'missing',date:'2026-12-01',kind:'renewal'})).status,404);
    assert.equal((await subscription({id:'test-account',date:'2026-12-01',kind:'period_end'})).status,200);
    const saved=JSON.parse(await readFile(join(data,'state.json'),'utf8')).accounts[0].subscription;
    assert.equal(saved.date,'2026-12-01');assert.equal(saved.source,'manual');assert.equal(saved.kind,'period_end');
    const visible=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(visible.accounts[0].subscription.date,'2026-12-01');
    assert.equal((await subscription({id:'test-account',date:null})).status,200);
    assert.equal(JSON.parse(await readFile(join(data,'state.json'),'utf8')).accounts[0].subscription,null);
    await fetch(base+'/api/shutdown',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Pulso-Csrf':state.csrf},body:'{}'});
    await new Promise(r=>child.once('exit',r));
  }finally{child.kill();await rm(data,{recursive:true,force:true});}
});
