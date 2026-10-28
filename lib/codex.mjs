import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
export function codexCommand() {
  const candidates=[process.env.PULSO_CODEX_JS,process.env.APPDATA && join(process.env.APPDATA,'npm/node_modules/@openai/codex/bin/codex.js')].filter(Boolean);
  for (const file of candidates) if (existsSync(file)) return {command:process.execPath,args:[file]};
  return {command:'codex',args:[]};
}
export class CodexClient {
  constructor({home,onEvent=()=>{}}={}) {this.home=home;this.onEvent=onEvent;this.pending=new Map();this.seq=0;this.child=null;this.ready=null;}
  async start() {
    if(this.ready) return this.ready;
    this.ready=this.open().catch(e=>{this.ready=null;throw e});return this.ready;
  }
  async open() {
    const {command,args}=codexCommand();
    const env={...process.env};
    // Each added account gets its own state and Windows credential-store namespace.
    if(this.home){env.CODEX_HOME=this.home;for(const k of ['OPENAI_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_ACCESS_TOKEN'])delete env[k];}
    const cliArgs=[...args];
    if(this.home)cliArgs.push('-c','cli_auth_credentials_store="keyring"');
    cliArgs.push('app-server');
    const child=spawn(command,cliArgs,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
    child.stderr.on('data',()=>{}); // Never log authentication traffic or credentials.
    createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}if(m.id!=null&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);clearTimeout(p.timer);if(m.error){const e=new Error('CODEX_RPC_ERROR');e.kind=/401|unauth|refresh.token|sign.in|log.in|authentication|not authenticated/i.test(m.error.message||'')?'auth':'connection';p.reject(e);}else p.resolve(m.result);}else if(m.method)this.onEvent(m.method,m.params);});
    const closed=()=>{if(this.child!==child)return;this.child=null;this.ready=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('CODEX_CLOSED'));}this.pending.clear();};
    child.on('error',closed);child.on('exit',closed);
    await this.call('initialize',{clientInfo:{name:'pulso_cotas',title:'Pulso — Cotas do Codex',version:'1.0.0'}},20000);
    child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  }
  call(method,params={},timeout=25000) {
    return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CODEX_TIMEOUT'));},timeout);this.pending.set(id,{resolve,reject,timer});try{if(!this.child?.stdin.writable)throw new Error();this.child.stdin.write(JSON.stringify({id,method,params})+'\n');}catch{clearTimeout(timer);this.pending.delete(id);reject(new Error('CODEX_UNAVAILABLE'));}});
  }
  async rpc(method,params={}) {await this.start();return this.call(method,params);}
  stop(){const c=this.child;this.child=null;this.ready=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('CODEX_CLOSED'));}this.pending.clear();c?.kill();}
}
