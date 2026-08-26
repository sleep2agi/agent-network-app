import { beginForward, confirmForward, createForwardPersistence, drainForwardWrites, findForward, initForwardController, markForwardAmbiguous, mayProjectForward, resetForwardWithoutResend } from './forward-controller';
const ck=(n:string,v:boolean)=>{if(!v)throw new Error(`FAIL: ${n}`)}; let ids=0;
let disk:any[]=[]; initForwardController([], async all => { disk=structuredClone(all); });
const ack=beginForward('A','T','ack',()=>`id_${++ids}`); let uiWrites=0;
confirmForward(ack.operation.key);
if (mayProjectForward('A','B',true)) uiWrites++;
if (mayProjectForward('A','A',false)) uiWrites++;
await drainForwardWrites();
ck('late ACK clears store without writing B/unmount UI',findForward('A','T','ack')===null&&disk.length===0&&uiWrites===0);

let release!:()=>void; const held=new Promise<void>(r=>{release=r}); let calls=0; disk=[];
initForwardController([], async all => { calls++; if(calls===1) await held; disk=structuredClone(all); });
const ordered=beginForward('A','T','ordered',()=>`id_${++ids}`); confirmForward(ordered.operation.key);
await Promise.resolve(); ck('confirm state completes while pending save delayed',findForward('A','T','ordered')===null&&calls===1);
release(); await drainForwardWrites(); initForwardController(disk,async()=>{});
ck('remount cannot resurrect pending after confirm',findForward('A','T','ordered')===null);

let release2!:()=>void; const held2=new Promise<void>(r=>{release2=r}); calls=0; disk=[];
initForwardController([], async all => { calls++; if(calls===1) await held2; disk=structuredClone(all); });
const amb=beginForward('A','T','amb',()=>`id_${++ids}`); markForwardAmbiguous(amb.operation.key); release2(); await drainForwardWrites();
initForwardController(disk,async()=>{}); ck('remount restores ambiguous not stale pending',findForward('A','T','amb')?.state==='ambiguous');
const twice=beginForward('A','T','amb',()=>`id_${++ids}`); ck('doubletap/reopen reuses request',!twice.started&&twice.operation.requestId===amb.operation.requestId);
resetForwardWithoutResend(amb.operation.key); ck('safe reset clears without resending',findForward('A','T','amb')===null);
let attempts=0; let retryResolved!:()=>void; const retryObserved=new Promise<void>(r=>{retryResolved=r}); disk=[]; initForwardController([],async all=>{attempts++;if(attempts===1)throw new Error('disk');disk=structuredClone(all);retryResolved()});
beginForward('A','T','retry-save',()=>`id_${++ids}`); await retryObserved;
ck('rejected save stays dirty and retries without unhandled rejection',attempts===2&&disk.length===1);

// Exercise the exact production adapter used by App.tsx. A storage rejection
// must reach the controller; a delayed pending save must finish before confirm.
let productionCalls=0; let release3!:()=>void; const held3=new Promise<void>(r=>{release3=r}); let autoRetried!:()=>void; const autoRetryDone=new Promise<void>(r=>{autoRetried=r}); disk=[];
const productionSave=async(all:any[],profileId?:string)=>{productionCalls++;if(profileId!=='profile-x')throw new Error('scope');if(productionCalls===1)await held3;if(productionCalls===2)throw new Error('disk reject');disk=structuredClone(all);if(productionCalls===3)autoRetried()};
initForwardController([],createForwardPersistence(productionSave,'profile-x'));
const wired=beginForward('A','T','wired',()=>`id_${++ids}`); confirmForward(wired.operation.key); release3(); await autoRetryDone;
ck('production chain auto-retries latest empty snapshot without test drain',productionCalls===3&&disk.length===0);
initForwardController(disk,async()=>{}); ck('production storage remount cannot resurrect confirmed pending',findForward('A','T','wired')===null);
console.log('forward controller async sequences: 9/9 checks passed');
