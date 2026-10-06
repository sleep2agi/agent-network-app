import { adoptionSupported, isAdopted, adoptionOutcome, adoptionError } from './node-adoption';
import { adoptKnownNode, fetchNodeLifecycleRequest, runNodeLifecycleAction, type HubConfig, type HubNode } from './api';
import { readFileSync } from 'node:fs';
import { nodeIsDown } from './node-danger-actions';
import { setLanguagePreference } from './i18n';
let p=0,t=0; const ck=(name:string,ok:boolean)=>{t++;if(!ok)throw Error(name);p++;console.log(`PASS ${name}`);};
const node:HubNode={node_id:'fixture-node',alias:'fixture'};
ck('old Hub hidden',!adoptionSupported(node));
ck('partial response hidden',!adoptionSupported({...node,managed:'none'}));
ck('known manual supported',adoptionSupported({...node,managed:'none',adoption:null}));
ck('active authority adopted',isAdopted({...node,managed:'adopted',adoption:null}));
ck('pending not adopted',!isAdopted({...node,managed:'none',adoption:{request_id:'a',daemon_node_id:'d',status:'pending',error:null}}));
for(const kind of ['adopt','start','stop'] as const){
 ck(`${kind} pending not success`,adoptionOutcome(kind,'pending')==='pending');
 ck(`${kind} timeout failure`,adoptionOutcome(kind,'timeout')==='failed');
}
ck('noop stop not success',adoptionOutcome('stop','noop_not_my_child')==='failed');
ck('raw error not displayed',!adoptionError('bin: /private/fixture').includes('/private'));
const cfg:HubConfig={serverUrl:'https://fixture.invalid',token:'user-fixture',networkId:'net-fixture'};
const guarded=await runNodeLifecycleAction(cfg,'restart_node',{...node,managed:'adopted'});
ck('restart locally refused before network',!guarded.ok&&guarded.error==='adopted_restart_requires_daemon');
const source=readFileSync(new URL('./NodeDetailScreen.tsx',import.meta.url),'utf8').replace(/\r\n/g,'\n');
ck('detail isolates accounts and nodes',source.includes('key={JSON.stringify([cfg.serverUrl, cfg.token, cfg.networkId, node.node_id])}'));
ck('adopted skips legacy restart UI',source.includes('node && isAdopted(node) ? null : node ?'));
setLanguagePreference('zh');
ck('restart refusal readable',adoptionError('adopted_restart_requires_daemon')==='收编节点请先停止再启动。');
ck('legacy message maps restart refusal',source.includes("'adopted_restart_requires_daemon', 'lifecycle_identity_unavailable'" )&&source.includes('adoptionError(result.error)'));
ck('starting shares down state',nodeIsDown(true,'starting'));
const panel=readFileSync(new URL('./NodeAdoptionControls.tsx',import.meta.url),'utf8').replace(/\r\n/g,'\n');
ck('panel uses shared down definition',panel.includes('nodeIsDown(online, node.lifecycle_state)'));
ck('no adopted delete or silent unadopt',!panel.includes("'delete_node'")&&!panel.includes("'unadopt_node'"));
let restarts=0;
for(const row of [
  {...node,managed:'adopted'},
  {...node,managed:'none',adoption:{status:'active'}},
  null,
  node,
  {...node,managed:'created',adoption:null},
]) {
 globalThis.fetch=async(url:any)=>String(url).includes('/api/nodes')
  ? new Response(JSON.stringify({nodes:row?[row]:[]}))
  : (restarts++,new Response(JSON.stringify({result:{content:[{text:JSON.stringify({ok:true})}]}})));
 const before=restarts, result=await runNodeLifecycleAction(cfg,'restart_node',node);
 const expected=row!==null&&(row as any).managed!=='adopted'&&(row as any).adoption?.status!=='active';
 ck('id-only caller resolves authority '+String((row as any)?.managed),result.ok===expected&&restarts-before===(expected?1:0));
}
globalThis.fetch=async()=>{throw Error('offline');};
ck('id-only lookup failure blocks restart',!(await runNodeLifecycleAction(cfg,'restart_node',node)).ok);
let calls:any[]=[];
globalThis.fetch=async(url:any,init:any)=>{calls.push({url:String(url),init});return new Response(JSON.stringify({ok:true,request:{kind:'start',request_id:'r1',node_id:node.node_id,status:'timeout',error:null}}));};
ck('timeout preserved',(await fetchNodeLifecycleRequest(cfg,'start','r1'))?.status==='timeout');
ck('selector/network explicit',calls[0].url.includes('request_id=r1')&&calls[0].url.includes('network_id=net-fixture'));
ck('header auth only',calls[0].init.headers.Authorization==='Bearer user-fixture'&&!calls[0].url.includes(cfg.token));
globalThis.fetch=async()=>new Response('',{status:404});
ck('old request endpoint unavailable',await fetchNodeLifecycleRequest(cfg,'start','r1')===null);
globalThis.fetch=async(url:any,init:any)=>{calls.push({url:String(url),init});return new Response(JSON.stringify({result:{content:[{text:JSON.stringify({ok:true,request_id:'adopt1'})}]}}));};
ck('adopt accepted not completed',(await adoptKnownNode(cfg,node.node_id,'daemon-fixture','/fixture/node')).ok);
const args=JSON.parse(calls.at(-1).init.body).params;
ck('public adopt contract',args.name==='request_adopt_node'&&args.arguments.node_id===node.node_id&&args.arguments.workdir==='/fixture/node'&&args.arguments.network_id===cfg.networkId);
console.log(`${p}/${t}`);
