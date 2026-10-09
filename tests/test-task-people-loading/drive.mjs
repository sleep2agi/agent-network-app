import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.OUT || '/output'; mkdirSync(out, { recursive: true });
let mode = 'hung', reads = 0, writes = 0;
const people = [{kind:'user',id:'u1',name:'Alice',networkId:'fixture-network'},{kind:'node',id:'n1',name:'Agent One',networkId:'fixture-network'}];
const row = { id:'r1',name:'人员加载恢复测试',priority:'normal',assignee:'',column:'doing',due:'',createdAt:'2026-10-09',owner:{kind:'user',id:'u1'},agent_owner:{kind:'node',id:'n1'},participants:[],description:'',checklist:[],project_id:null };
const server = createServer((req,res) => {
 const path = new URL(req.url,'http://fixture').pathname;
 if (path.startsWith('/api/')) {
  if (req.method !== 'GET') { writes++; res.writeHead(400).end('{}'); return; }
  if (path.endsWith('/people')) { reads++; if (mode === 'hung') return; }
  const data = path.endsWith('/people') ? {people} : path.endsWith('/projects') ? {projects:[]} : path.endsWith('/events') ? {events:[]} : path==='/api/auth/me' ? {user:{user_id:'u1'}} : {requirements:[row],capabilities:['agent_owner','description','checklist','projects','events']};
  res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); return;
 }
 res.setHeader('Content-Type',path==='/app.js'?'text/javascript':'text/html');
 res.end(path==='/app.js'?readFileSync('/app/people-loading.js'):'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root" style="height:100vh;display:flex"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
let checks = 0;
function ck(name, condition) { assert(condition,name); checks++; console.log(`PASS ${name}`); }
try {
 for (const width of [390,1280]) {
  mode='hung'; reads=0;
  const page = await browser.newPage({viewport:{width,height:900}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByTestId('req-card-r1').click();
  await page.getByTestId('req-detail').waitFor();
  await page.getByTestId('req-edit-owner-agent').click();
  await page.getByTestId('req-people-error').waitFor({timeout:15000});
  ck(`${width}: bounded failure visible`,(await page.getByTestId('req-people-error').innerText()).includes('超时'));
  ck(`${width}: one shared error, not contradictory participant errors`,await page.getByText('人员加载超时，请重试',{exact:true}).count()===1);
  ck(`${width}: no endless loading label`,!(await page.getByTestId('req-properties').innerText()).includes('加载人员'));
  ck(`${width}: simultaneous board/detail/role reads coalesced`,reads===1);
  await page.screenshot({path:`${out}/${width}-timeout.png`,fullPage:true});
  mode='healthy';
  await page.getByTestId('req-people-retry').click();
  await page.getByTestId('req-edit-owner-agent').filter({hasText:'Agent One'}).waitFor();
  ck(`${width}: failure clears after retry`,await page.getByTestId('req-people-error').count()===0);
  ck(`${width}: owner resolved`,(await page.getByTestId('req-edit-owner').innerText()).includes('Alice'));
  ck(`${width}: participants recover with same retry`,await page.getByTestId('edit-participants').isEnabled());
  const before=reads;
  mode='hung';
  await page.getByTestId('req-edit-owner-agent').click();
  // The picker appears without waiting for the background refresh to finish.
  await page.getByTestId(width > 700 ? 'people-dropdown' : 'people-panel').waitFor({timeout:1500});
  ck(`${width}: warm picker opens while refresh is hung`,reads===before+1);
  ck(`${width}: name remains during background refresh`,(await page.getByTestId('req-edit-owner-agent').innerText()).includes('Agent One'));
  await page.screenshot({path:`${out}/${width}-picker.png`,fullPage:true});
  await page.close();
 }
 ck('read-only scenario never mutates Hub',writes===0);
 console.log(`${checks}/${checks} passed`);
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
