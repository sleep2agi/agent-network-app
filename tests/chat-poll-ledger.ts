// Isolated transport ledger. Virtual clock, no production requests, no 304s.
// Synthetic task body sizes match the two supplied observations (decimal KB).
import assert from 'node:assert/strict';
import { createChatRounds } from '../src/chat-poll-round';
const hub = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
  const u = new URL(req.url), n = Number(u.searchParams.get('limit'));
  const bytes = u.pathname === '/api/tasks' ? (n === 30 ? 114000 : 691000) : u.pathname === '/api/messages' ? 19000 : 1000;
  return new Response('x'.repeat(bytes));
} });
try {
 for(const window of [30,200,0]) for(const after of [false,true]) {
  let now=0, requests=0, bytes=0;
  const rounds=createChatRounds(()=>now);
  const get=async(path:string)=>{const response=await fetch(`${hub.url.origin}${path}`);bytes+=(await response.arrayBuffer()).byteLength;requests++;};
  const round=async(n:number)=>{await Promise.all([get(`/api/tasks?to_name=A&limit=${n}`).then(()=>get(`/api/tasks?from_name=A&limit=${n}`)),get('/api/messages?limit=50')]);};
  for(now=5000;now<=60000;now+=5000){
    if(window) await (after?rounds.tick(window,round):round(window));
    if(now%30000===0 && (window || !after)) await Promise.all([get('/api/status?light=1'),get('/api/status?alias=A')]);
  }
  assert.equal(requests, window?40:after?0:4);
  console.log({window,after,requests,bytes});
 }
} finally {hub.stop(true);}
