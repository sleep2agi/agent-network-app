import { manageSecrets, parseSecretSnapshot } from './scoped-secrets';
const scope={networkId:'net-fixture',daemonId:'daemon-fixture',nodeId:'node-fixture'};
const snapshot={network_id:scope.networkId,daemon_node_id:scope.daemonId,node_id:scope.nodeId,revision:1,activation:'next_start',keys:[{key:'TEST_VENDOR_KEY',source:'node'}]};
let count=0;function check(name:string,pass:boolean){if(!pass)throw Error(name);count++;}
const id='dsk_11111111-1111-4111-8111-111111111111';
const requests:any[]=[];
const result=await manageSecrets(scope,async(args,_signal,containsKey)=>{
  requests.push({args,containsKey});return args.action==='read'?{ok:true,request_id:id,daemon_node_id:scope.daemonId,node_id:scope.nodeId,status:'succeeded',snapshot}:{ok:true,request_id:id,status:'pending'};
},new AbortController().signal,{action:'put',key:'TEST_VENDOR_KEY',value:'TEST-ONLY-fixture',revision:0},{pollMs:0});
check('saved requires scoped Daemon receipt',result.kind==='ready');
check('only explicit write sends a key, never polling',requests.length===2&&requests[0].containsKey&&requests[0].args.value==='TEST-ONLY-fixture'&&!requests[1].containsKey&&!Object.hasOwn(requests[1].args,'value'));
check('no value in result',!JSON.stringify(result).includes('TEST-ONLY-fixture'));
check('wrong node rejected',parseSecretSnapshot({...snapshot,node_id:'other'},scope)===null);
check('value-bearing receipt rejected',parseSecretSnapshot({...snapshot,value:'bad'},scope)===null);
const old=await manageSecrets(scope,async()=>({ok:false,error:'scoped_secrets_upgrade_required'}),new AbortController().signal);
check('old software is not simulated success',old.kind==='unsupported');
const denied=await manageSecrets(scope,async()=>({ok:false,error:'secret_admin_required'}),new AbortController().signal);
check('member denied visibly',denied.kind==='forbidden');
const pending=await manageSecrets(scope,async(args)=>args.action==='read'?{ok:true,request_id:id,daemon_node_id:scope.daemonId,node_id:scope.nodeId,status:'pending'}:{ok:true,request_id:id,status:'pending'},new AbortController().signal,undefined,{timeoutMs:15,pollMs:2});
check('bounded pending is unconfirmed, not endless loading',pending.kind==='unconfirmed');
console.log(`scoped secrets: ${count}/${count} checks passed`);
