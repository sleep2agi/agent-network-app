import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.OUT||'/output';mkdirSync(out,{recursive:true});
const base={priority:'normal',assignee:'',due:'2026-10-01',column:'pool',createdAt:'2026-09-29',owner:{kind:'user',id:'u1'},agent_owner:{kind:'node',id:'n1'},participants:[],description:'',checklist:[],project_id:'p1',parent_id:null,children:{total:0,done:0}};
const cols=['pool','todo','doing','review','done'];
const rows=Array.from({length:6},(_,i)=>({...base,id:`r${i+1}`,column:cols[i%cols.length],name:`用户任务标题 ${i+1}：桌面任务列表的标题经常很长，列宽不够时会被截断，需要拖动列边界把标题列拉宽才能看全`}));
let writes=0;
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'){writes++;res.statusCode=400;res.end(JSON.stringify({error:'fixture is read-only'}));return;}
  const body=path.endsWith('/projects')?{projects:[{id:'p1',name:'用户项目名',color:'#167d8d',archived:false}]}:
   path.endsWith('/people')?{people:[{kind:'user',id:'u1',name:'用户负责人',networkId:'fixture-network'},{kind:'node',id:'n1',name:'用户Agent',networkId:'fixture-network'}]}:
   path==='/api/auth/me'?{user:{id:'u1'}}:{requirements:rows.map((r,i)=>({...r,createdAt:new Date(Date.now()-(i+1)*86400000).toISOString(),updatedAt:new Date(Date.now()-(i+1)*180000).toISOString()})),capabilities:['agent_owner','description','checklist','projects','due_datetime','sub_requirements']};
  res.end(JSON.stringify(body));return;
 }
 res.setHeader('Content-Type',path==='/app.js'?'text/javascript':'text/html');
 res.end(path==='/app.js'?readFileSync(out+'/task-widths.js'):'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{display:flex;height:100vh}</style><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--no-sandbox']});
let p=0,t=0;const results=[],tables={};
const ck=(name,ok,detail)=>{t++;if(ok)p++;results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'}: ${name} ${detail?JSON.stringify(detail):''}`);};
const near=(a,b)=>Math.abs(a-b)<=1;

try {
 for(const [w,h] of [[1440,900],[1200,800],[1920,1080]]){
  const tag=`${w}x${h}`;
  const page=await browser.newPage({viewport:{width:w,height:h}});
  page.setDefaultTimeout(8000);
  page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  const list=async()=>{await page.getByTestId('tasks-view-list').click();await page.getByTestId('req-row-r6').waitFor();};
  await page.goto(url);await page.evaluate(()=>localStorage.clear());await page.reload();await list();
  const ids=await page.$$eval('[data-testid^="task-column-"]',els=>els.map(e=>e.getAttribute('data-testid').slice('task-column-'.length)));
  // One measurement pass: every header cell and every body cell, by column.
  const measure=async()=>page.evaluate(({ids})=>{
   const box=id=>{const r=document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();return r?{x:+r.x.toFixed(1),w:+r.width.toFixed(1)}:null;};
   const o={};for(const id of ids){o[id]={head:box(`task-column-${id}`),cells:[1,2,3,4,5,6].map(i=>box(`task-cell-r${i}-${id}`))};}
   return o;
  },{ids});
  const scroll=async()=>page.evaluate(()=>{
   const head=document.querySelector('[data-testid="task-column-title"]');
   let el=head.parentElement;while(el&&!(el.scrollWidth>el.clientWidth&&getComputedStyle(el).overflowX!=='visible'&&getComputedStyle(el).overflowX!=='hidden'))el=el.parentElement;
   const cardEl=document.querySelector('[data-testid="req-list"]'),card=cardEl.getBoundingClientRect(),se=document.scrollingElement;
   return {inner:el?{scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,insideCard:cardEl.contains(el)}:null,page:{scrollWidth:se.scrollWidth,clientWidth:se.clientWidth,scrollHeight:se.scrollHeight,clientHeight:se.clientHeight},card:{x:card.x,w:card.width}};
  });
  const before=await measure();
  const s0=await scroll();
  // Default columns already total 1212px (#513), wider than the card at both sizes, so
  // the baseline itself may overflow; widths only have to add exactly their delta.
  const sw0=s0.inner?s0.inner.scrollWidth:s0.page.clientWidth,cw0=s0.inner?s0.inner.clientWidth:null;
  ck(`${tag} baseline page body does not scroll`,s0.page.scrollWidth===s0.page.clientWidth,s0);
  ck(`${tag} header/cell aligned before`,ids.every(id=>before[id].cells.every(c=>near(c.x,before[id].head.x)&&near(c.w,before[id].head.w))));
  await page.screenshot({path:`${out}/${tag}-before.png`});

  const hb=await page.getByTestId('task-col-resize-title').boundingBox();
  ck(`${tag} handle 6-8px wide, full header height, on the title/next boundary`,hb.width>=6&&hb.width<=8&&hb.height>=39&&near(hb.x+hb.width/2,(before.title.head.x+before.title.head.w+before[ids[1]].head.x)/2),{hb,title:before.title.head,next:before[ids[1]].head});
  const cx=hb.x+hb.width/2,cy=hb.y+hb.height/2;
  await page.mouse.move(cx,cy);
  ck(`${tag} col-resize cursor`,await page.getByTestId('task-col-resize-title').evaluate(e=>getComputedStyle(e).cursor)==='col-resize');
  await page.screenshot({path:`${out}/${tag}-hover.png`,clip:{x:Math.max(0,cx-240),y:hb.y-20,width:480,height:160}});
  const sort0=await page.getByTestId('req-sort-title').getAttribute('aria-selected');
  await page.mouse.down();
  for(let i=1;i<=10;i++)await page.mouse.move(cx+20*i,cy);
  await page.screenshot({path:`${out}/${tag}-dragging.png`});
  await page.mouse.up();
  const after=await measure();
  const dTitle=after.title.head.w-before.title.head.w;
  ck(`${tag} header title +200`,near(dTitle,200),{before:before.title.head.w,after:after.title.head.w});
  ck(`${tag} every row title cell +200`,after.title.cells.every((c,i)=>near(c.w-before.title.cells[i].w,200)),after.title.cells.map((c,i)=>+(c.w-before.title.cells[i].w).toFixed(1)));
  const others=ids.filter(id=>id!=='title');
  ck(`${tag} other columns keep widths`,others.every(id=>near(after[id].head.w,before[id].head.w)&&after[id].cells.every((c,i)=>near(c.w,before[id].cells[i].w))),Object.fromEntries(others.map(id=>[id,[before[id].head.w,after[id].head.w]])));
  ck(`${tag} header/cell aligned after`,ids.every(id=>after[id].cells.every(c=>near(c.x,after[id].head.x)&&near(c.w,after[id].head.w))));
  ck(`${tag} handle click did not toggle sort`,await page.getByTestId('req-sort-title').getAttribute('aria-selected')===sort0);
  const s1=await scroll();
  ck(`${tag} table scrolls horizontally inside its card`,!!s1.inner&&s1.inner.insideCard&&(cw0===null?s1.inner.scrollWidth>s1.inner.clientWidth:near(s1.inner.scrollWidth-sw0,200)),{baseline:s0.inner,after:s1.inner});
  ck(`${tag} page body does not scroll`,s1.page.scrollWidth===s1.page.clientWidth&&s1.page.scrollHeight===s1.page.clientHeight,s1.page);
  await page.screenshot({path:`${out}/${tag}-after.png`});
  await page.evaluate(()=>{const head=document.querySelector('[data-testid="task-column-title"]');let el=head.parentElement;while(el&&!(el.scrollWidth>el.clientWidth))el=el.parentElement;el.scrollLeft=el.scrollWidth;});
  const scrolled=await measure();
  const last=ids[ids.length-1];
  ck(`${tag} scrolled: last column reaches card edge`,near(scrolled[last].head.x+scrolled[last].head.w+16,s1.card.x+s1.card.w)||scrolled[last].head.x+scrolled[last].head.w<=s1.card.x+s1.card.w,{last:scrolled[last].head,card:s1.card});
  await page.screenshot({path:`${out}/${tag}-scrolled.png`});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('task_list_fields_v1')));
  ck(`${tag} persisted in the #513 fields key`,near(saved.find(f=>f.id==='title').width,after.title.head.w),saved.find(f=>f.id==='title'));
  await page.reload();await list();
  const reloaded=await measure();
  ck(`${tag} reload keeps widths`,ids.every(id=>near(reloaded[id].head.w,after[id].head.w)),Object.fromEntries(ids.map(id=>[id,reloaded[id].head.w])));

  // min clamp: owner can't go below 64
  const ob=await page.getByTestId(`task-col-resize-${ids[1]}`).boundingBox();
  await page.mouse.move(ob.x+ob.width/2,ob.y+ob.height/2);await page.mouse.down();await page.mouse.move(ob.x-300,ob.y+ob.height/2,{steps:6});await page.mouse.up();
  const clamped=await measure();
  ck(`${tag} ${ids[1]} clamps at 64px`,near(clamped[ids[1]].head.w,64)&&clamped[ids[1]].cells.every(c=>near(c.w,64)),clamped[ids[1]].head);
  // hidden columns keep their width
  await page.getByTestId('task-fields-button').click();
  await page.getByTestId(`task-field-toggle-${ids[1]}`).click();
  await page.getByTestId(`task-field-toggle-${ids[1]}`).click();
  await page.getByLabel(/Close field settings|关闭字段配置/).last().click();
  ck(`${tag} hide+show keeps width`,near((await page.getByTestId(`task-column-${ids[1]}`).boundingBox()).width,64));
  // double-click resets
  const tb=await page.getByTestId('task-col-resize-title').boundingBox();
  await page.mouse.dblclick(tb.x+tb.width/2,tb.y+tb.height/2);
  const reset=await measure();
  ck(`${tag} double-click resets title to default`,(await page.evaluate(()=>JSON.parse(localStorage.getItem('task_list_fields_v1')))).find(f=>f.id==='title').width===undefined);
  await page.getByTestId(`task-col-resize-${ids[1]}`).dblclick();
  const reset2=await measure();
  ck(`${tag} double-click resets both back to the initial layout`,ids.every(id=>near(reset2[id].head.w,before[id].head.w)),Object.fromEntries(ids.map(id=>[id,[before[id].head.w,reset2[id].head.w]])));
  const s2=await scroll();
  ck(`${tag} scroll width back to baseline after reset`,cw0===null?!s2.inner:near(s2.inner.scrollWidth,sw0),{baseline:s0.inner,reset:s2.inner});
  // keyboard + menu reset
  await page.getByTestId('task-col-resize-status').focus();
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  ck(`${tag} arrow keys resize`,near((await page.getByTestId('task-column-status').boundingBox()).width,before.status.head.w+32));
  const titleNow=(await page.getByTestId('task-column-title').boundingBox()).width;
  await page.getByTestId('task-col-resize-title').focus();await page.keyboard.press('ArrowRight');
  ck(`${tag} arrow key grows title from its rendered width`,near((await page.getByTestId('task-column-title').boundingBox()).width,titleNow+16),{rendered:titleNow});
  await page.getByTestId('task-fields-button').click();
  await page.evaluate(()=>window.switchLanguage('zh'));
  ck(`${tag} zh reset-widths label`,await page.getByTestId('task-fields-reset-widths').getByText('恢复默认列宽',{exact:true}).waitFor().then(()=>true,()=>false));
  await page.screenshot({path:`${out}/${tag}-menu-zh.png`});
  await page.getByTestId('task-fields-reset-widths').click();
  ck(`${tag} 恢复默认列宽 clears widths but keeps order/visibility`,(await page.evaluate(()=>JSON.parse(localStorage.getItem('task_list_fields_v1')))).every(f=>f.width===undefined));
  ck(`${tag} zh handle label`,(await page.getByTestId('task-col-resize-title').getAttribute('aria-label'))?.startsWith('拖动调整 标题 列宽'));
  await page.evaluate(()=>window.switchLanguage('en'));
  tables[tag]={before,after,reloaded,clamped,reset:reset2,handle:hb,scroll:s1};
  await page.close();
 }
 const fold=await browser.newPage({viewport:{width:1000,height:700},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 15; Xiaomi MIX Fold) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'});
 await fold.goto(`http://127.0.0.1:${server.address().port}`);await fold.getByTestId('tasks-view-list').tap();await fold.getByTestId('req-row-r1').waitFor();
 ck('touch table has no resize handles',await fold.locator('[data-testid^="task-col-resize-"]').count()===0&&await fold.getByTestId('task-column-title').count()===1);
 await fold.close();
 ck('widths never write Hub',writes===0);
}finally{await browser.close();server.close();writeFileSync(out+'/measurements.json',JSON.stringify({passed:p,total:t,results,tables},null,2));}
console.log(`${p}/${t} passed`);process.exit(p===t?0:1);
