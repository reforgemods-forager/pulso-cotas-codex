import http from 'node:http';
import {readFile,writeFile,mkdir,rename,chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {CodexClient} from './lib/codex.mjs';
import {buckets,detectChanges} from './lib/limits.mjs';
import {subscriptionFromInput} from './lib/subscription.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const STATE=process.env.PULSO_DATA_DIR || join(process.env.LOCALAPPDATA || join(ROOT,'local-data'),'PulsoCotas');
const PORT=Number(process.env.PULSO_PORT||43821);
const ORIGIN=`http://127.0.0.1:${PORT}`;
await mkdir(STATE,{recursive:true});
const stateFile=join(STATE,'state.json');
let state={version:1,accounts:[],events:[],settings:{nativeNotifications:true,autoStart:false},lastPoll:0};
try{state={...state,...JSON.parse(await readFile(stateFile,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw new Error('Não foi possível ler o estado do Pulso. O arquivo foi preservado.');}
// Persist only account labels and quota snapshots. OAuth credentials stay in Codex's own store.
let saveQueue=Promise.resolve();
function save(){const snapshot=JSON.stringify(state,null,2);saveQueue=saveQueue.catch(()=>{}).then(async()=>{const temp=stateFile+'.tmp';await writeFile(temp,snapshot,{mode:0o600});await rename(temp,stateFile);});return saveQueue;}
const streams=new Set();const clients=new Map();const busy=new Set();
let activeLogin=null;let stopping=false;
const session=randomBytes(32).toString('hex');const csrf=randomBytes(32).toString('hex');
function safeEqual(a,b){return typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function emit(type,data={}){for(const res of streams)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);}
function client(a){if(!clients.has(a.id))clients.set(a.id,new CodexClient({home:a.source==='existing'?undefined:join(STATE,'profiles',a.id),onEvent:(method,params)=>{if(method==='account/login/completed')void finishLogin(a,params);}}));return clients.get(a.id);}
function notify(message){return new Promise(resolve=>{if(!state.settings.nativeNotifications||process.platform!=='win32')return resolve(false);const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(ROOT,'notify.ps1'),'-MessageBase64',Buffer.from(message,'utf8').toString('base64')],{windowsHide:true,stdio:'ignore'});let done=false;const finish=ok=>{if(!done){done=true;clearTimeout(timer);resolve(ok);}};const timer=setTimeout(()=>{p.kill();finish(false);},15000);p.on('error',()=>finish(false));p.on('exit',code=>finish(code===0));});}
function addEvent(event){state.events.unshift({id:randomUUID(),at:Math.floor(Date.now()/1000),...event});state.events=state.events.slice(0,300);}
function duration(min){if(min===10080)return 'semanal';if(min%1440===0)return `${min/1440} dia(s)`;if(min%60===0)return `${min/60} horas`;return `${min} minutos`;}
async function pollAccount(a,{force=false}={}){
  if(busy.has(a.id)||a.status==='connecting')return;
  if(!force&&a.nextCheckAt>Date.now())return;
  busy.add(a.id);a.lastAttempt=Date.now();
  try{
    const c=client(a);const r=await c.rpc('account/read',{refreshToken:false});
    if(r.account?.type!=='chatgpt'){const e=new Error('LOGIN_REQUIRED');e.kind='auth';throw e;}
    const result=await c.rpc('account/rateLimits/read');const next=buckets(result);
    if(!next.length)throw new Error('NO_QUOTA_DATA');
    const previous=a.buckets;const wasError=a.failures>0;
    a.email=r.account.email||null;a.plan=r.account.planType||null;a.buckets=next;
    a.lastSuccess=Date.now();a.status='ok';a.failures=0;a.problem=null;a.nextCheckAt=Date.now()+60000;
    const events=detectChanges(previous,next);
    for(const e of events)addEvent({...e,accountId:a.id,label:a.label});
    if(events.length){const text=events.map(e=>`${duration(e.durationMins)}: ${Math.round(e.to)}% disponível`).join('; ');const early=events.some(e=>e.kind==='early_reset');const full=events.some(e=>e.kind==='reset');const message=`${a.label} — ${early?'cota recuperada antes do previsto':full?'reset confirmado':'cota recuperada'}. ${text}.`;void notify(message);emit('notification',{title:'Cota recuperada',message});}
    if(wasError){addEvent({kind:'sync_restored',accountId:a.id,label:a.label});emit('restored',{accountId:a.id});}
  }catch(e){
    a.failures=(a.failures||0)+1;a.status=e.kind==='auth'?'auth_required':'retrying';
    a.problem=e.kind==='auth'?'A OpenAI precisa de um novo login. Reconecte esta conta.':'Não foi possível consultar agora. O Pulso tentará novamente.';
    const delays=[60000,120000,300000,900000];a.nextCheckAt=Date.now()+delays[Math.min(a.failures-1,3)];
    if(a.failures>=2)client(a).stop();
    if(a.failures===1&&(a.status==='auth_required')){addEvent({kind:'auth_required',accountId:a.id,label:a.label});void notify(`${a.label} precisa de um novo login. Abra o Pulso para reconectar.`);}
    if(a.failures===3&&a.status==='retrying'){addEvent({kind:'sync_problem',accountId:a.id,label:a.label});void notify(`${a.label} está sem sincronizar. Os dados antigos estão identificados no painel; novas tentativas continuam.`);}
  }finally{busy.delete(a.id);await save();emit('update');}
}
async function pollAll(force=false){for(const a of state.accounts){if(stopping)break;await pollAccount(a,{force});}state.lastPoll=Date.now();await save();}
async function finishLogin(a,params){
  if(!activeLogin||activeLogin.accountId!==a.id||activeLogin.loginId!==params?.loginId)return;
  activeLogin=null;
  if(params.success){a.status='pending';a.problem=null;await pollAccount(a,{force:true});}
  else{a.status='auth_required';a.problem='Login não concluído. Tente conectar novamente.';await save();emit('update');}
}
async function beginLogin(a){
  if(a.source==='existing')throw Object.assign(new Error('EXISTING'),{publicMessage:'Essa conta usa a conexão do Codex instalado. Faça login nele novamente; o Pulso não altera essa sessão.'});
  if(activeLogin)throw Object.assign(new Error('LOGIN_BUSY'),{publicMessage:'Conclua ou cancele o login que já está aberto.'});
  if(busy.has(a.id))throw Object.assign(new Error('POLL_BUSY'),{publicMessage:'Aguarde a consulta desta conta terminar e tente de novo.'});
  const profile=join(STATE,'profiles',a.id);await mkdir(profile,{recursive:true});
  a.status='connecting';activeLogin={accountId:a.id,started:Date.now(),loginId:null,url:null};
  let result;try{result=await client(a).rpc('account/login/start',{type:'chatgpt'});}catch(e){activeLogin=null;a.status='auth_required';throw e;}
  const url=new URL(result.authUrl);if(!['auth.openai.com','chatgpt.com'].includes(url.hostname)||url.protocol!=='https:')throw new Error('Unexpected login URL');
  a.status='connecting';a.problem=null;activeLogin={accountId:a.id,loginId:result.loginId,url:result.authUrl,started:Date.now()};await save();emit('update');return {authUrl:result.authUrl};
}
async function autoStart(enable){
  if(process.platform!=='win32')return;
  const startup=join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs/Startup/PulsoCotas.vbs');
  if(enable){const target=join(ROOT,'Iniciar.vbs').replaceAll('"','""');await writeFile(startup,`CreateObject("WScript.Shell").Run "wscript.exe ""${target}"" --background", 0, False\r\n`);}
  else{const {unlink}=await import('node:fs/promises');await unlink(startup).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  state.settings.autoStart=enable;await save();
}
function publicState(){return {accounts:state.accounts,events:state.events,settings:state.settings,now:Date.now(),lastPoll:state.lastPoll,activeLogin:activeLogin?{accountId:activeLogin.accountId,authUrl:activeLogin.url}:null,csrf};}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>8192)throw new Error('Too large');}return text?JSON.parse(text):{};}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(req.headers.host!==`127.0.0.1:${PORT}`){res.writeHead(403);return res.end('Host inválido');}
  if(req.headers.origin&&req.headers.origin!==ORIGIN){res.writeHead(403);return res.end('Origem inválida');}
  let pathname;try{pathname=new URL(req.url,ORIGIN).pathname;}catch{return json(res,400,{error:'Endereço inválido.'});}
  if(pathname==='/health')return json(res,200,{ok:true,app:'pulso',version:'1.0.0',uptime:Math.floor(process.uptime())});
  const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/translations.mjs':['translations.mjs','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
  if(assets[pathname]&&req.method==='GET'){
    if(pathname==='/')res.setHeader('Set-Cookie',`pulso=${session}; HttpOnly; SameSite=Strict; Path=/`);
    try{res.writeHead(200,{'Content-Type':assets[pathname][1],'Cache-Control':'no-store'});res.end(await readFile(join(ROOT,'public',assets[pathname][0])));}catch{res.end();}return;
  }
  const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pulso='))?.slice(6);
  if(!safeEqual(cookie,session))return json(res,401,{error:'Abra o painel novamente para renovar a conexão local.'});
  if(req.method==='GET'&&pathname==='/api/state')return json(res,200,publicState());
  if(req.method==='GET'&&pathname==='/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(': connected\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;
  }
  if(req.method!=='POST'||!safeEqual(req.headers['x-pulso-csrf'],csrf))return json(res,403,{error:'Pedido local não autorizado.'});
  try{
    const data=await body(req);
    if(pathname==='/api/refresh'){for(const a of state.accounts)if(a.lastAttempt&&Date.now()-a.lastAttempt<10000)return json(res,429,{error:'Aguarde alguns segundos antes de atualizar.'});void pollAll(true);return json(res,200,{ok:true});}
    if(pathname==='/api/accounts'){
      if(state.accounts.length>=12)return json(res,400,{error:'Limite de 12 contas neste painel.'});
      const label=String(data.label||'').trim().slice(0,60)||`Conta ${state.accounts.length+1}`;
      const a={id:randomUUID(),label,source:'isolated',status:'pending',buckets:[],lastSuccess:null,failures:0};state.accounts.push(a);await save();
      try{return json(res,200,{id:a.id,...await beginLogin(a)});}catch(e){a.status='auth_required';await save();throw e;}
    }
    if(pathname==='/api/subscription'){
      const a=state.accounts.find(x=>x.id===data.id);if(!a)return json(res,404,{error:'Conta não encontrada.'});
      let subscription;try{subscription=subscriptionFromInput(data);}catch{return json(res,400,{error:'Informe uma data válida e o tipo do período.'});}
      a.subscription=subscription;await save();emit('update');return json(res,200,{ok:true});
    }
    if(pathname==='/api/rename'){
      const a=state.accounts.find(x=>x.id===data.id);if(!a)return json(res,404,{error:'Conta não encontrada.'});
      if(typeof data.label!=='string'||!data.label.trim()||data.label.trim().length>60)return json(res,400,{error:'Digite um nome de 1 a 60 caracteres.'});
      a.label=data.label.trim();await save();emit('update');return json(res,200,{ok:true});
    }
    if(pathname==='/api/connect'){const a=state.accounts.find(x=>x.id===data.id);if(!a)return json(res,404,{error:'Conta não encontrada.'});return json(res,200,await beginLogin(a));}
    if(pathname==='/api/cancel-login'){
      if(activeLogin){const a=state.accounts.find(x=>x.id===activeLogin.accountId);await client(a).rpc('account/login/cancel',{loginId:activeLogin.loginId}).catch(()=>{});activeLogin=null;a.status='auth_required';await save();emit('update');}return json(res,200,{ok:true});
    }
    if(pathname==='/api/remove'){
      const a=state.accounts.find(x=>x.id===data.id);if(!a)return json(res,404,{error:'Conta não encontrada.'});
      if(busy.has(a.id)||activeLogin?.accountId===a.id)return json(res,409,{error:'Espere a consulta terminar ou cancele o login antes de remover.'});
      // Removing a borrowed account must never sign the user out of their desktop app.
      if(a.source==='isolated')await client(a).rpc('account/logout');
      clients.get(a.id)?.stop();clients.delete(a.id);state.accounts=state.accounts.filter(x=>x.id!==a.id);await save();emit('update');return json(res,200,{ok:true});
    }
    if(pathname==='/api/settings'){
      if(typeof data.autoStart==='boolean')await autoStart(data.autoStart);
      if(typeof data.nativeNotifications==='boolean')state.settings.nativeNotifications=data.nativeNotifications;
      await save();emit('update');return json(res,200,{ok:true});
    }
    if(pathname==='/api/test-notification'){const ok=await notify('Teste de notificação. O Pulso está pronto para avisar quando detectar recuperação de cota.');return json(res,200,{ok,message:ok?'Notificação enviada ao Windows. Confira se ela apareceu; o modo Não perturbe pode silenciá-la.':'O Windows não aceitou o envio. Ative as notificações e tente novamente.'});}
    if(pathname==='/api/shutdown'){await writeFile(join(STATE,'stopped'),'1');json(res,200,{ok:true});setTimeout(shutdown,100);return;}
    return json(res,404,{error:'Ação não encontrada.'});
  }catch(e){return json(res,400,{error:e.publicMessage||'Não foi possível concluir. Confira a conexão e tente novamente.'});}
});
async function shutdown(){if(stopping)return;stopping=true;clearInterval(tick);clearInterval(heartbeat);for(const c of clients.values())c.stop();for(const s of streams)s.end();await save();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
// A crash during sign-in must not leave an account stuck in "connecting".
for(const a of state.accounts){if(a.status==='connecting'){a.status='auth_required';a.problem='O login foi interrompido. Conecte novamente.';}a.nextCheckAt=0;}
let tick,heartbeat;
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,'127.0.0.1',resolve);});
console.log(`Pulso em ${ORIGIN}`);
// Accounts must be connected explicitly. Never borrow the desktop/CLI session.
if(!state.initialized){state.initialized=true;await save();}
void pollAll(true);
tick=setInterval(()=>{if(activeLogin&&Date.now()-activeLogin.started>10*60000){const a=state.accounts.find(x=>x.id===activeLogin.accountId);void client(a).rpc('account/login/cancel',{loginId:activeLogin.loginId}).catch(()=>{});activeLogin=null;a.status='auth_required';a.problem='O login expirou. Tente novamente.';void save();emit('update');}void pollAll();},15000);
heartbeat=setInterval(()=>{for(const res of streams)res.write(': heartbeat\n\n');},20000);
