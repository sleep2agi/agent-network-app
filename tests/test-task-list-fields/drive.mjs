import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.OUT||'/output';mkdirSync(out,{recursive:true});
const base={priority:'normal',assignee:'',due:'2026-10-01',column:'pool',createdAt:'2026-09-29',owner:{kind:'user',id:'u1'},agent_owner:{kind:'node',id:'n1'},participants:[],description:'用户描述：不要翻译。',checklist:[{id:'c1',text:'用户清单：核验',done:false}],project_id:'p1',parent_id:null,children:{total:0,done:0}};
let writes=0, modernHub=false;
const rows=[{...base,id:'r1',name:'用户任务标题：不要翻译',children:{total:1,done:0}},{...base,id:'r2',name:'用户子需求标题',parent_id:'r1',external_ref:'github:demo/repo#1',external_url:'https://github.com/demo/repo/issues/1'}];
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'){writes++;res.statusCode=400;res.end(JSON.stringify({error:'fixture is read-only'}));return;}
  const body=path.endsWith('/projects')?{projects:[{id:'p1',name:'用户项目名',color:'#167d8d',archived:false}]}:
   path.endsWith('/people')?{people:[{kind:'user',id:'u1',name:'用户负责人',networkId:'fixture-network'},{kind:'node',id:'n1',name:'用户Agent',networkId:'fixture-network'}]}:
   path==='/api/auth/me'?{user:{id:'u1'}}:{requirements:rows,capabilities:['agent_owner','description','checklist','projects','due_datetime','sub_requirements']};
  if (body.requirements) body.requirements = body.requirements.map((r,i)=>({...r,createdAt:new Date(Date.now()-(i+1)*86400000).toISOString(),...(modernHub?{updatedAt:new Date(Date.now()-(i+1)*180000).toISOString(),updated_by:{kind:'user',id:'u1'}}:{})}));
  res.end(JSON.stringify(body));return;
 }
 res.setHeader('Content-Type',path==='/app.js'?'text/javascript':'text/html');
 res.end(path==='/app.js'?readFileSync('/output/task-language.js'):'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{display:flex;height:100vh}</style><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--no-sandbox']});
let p=0,t=0;const results=[];
const ck=(name,ok,detail)=>{t++;if(ok)p++;results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'}: ${name} ${detail?JSON.stringify(detail):''}`);};


try {
 const page=await browser.newPage({viewport:{width:1200,height:800}});
 page.setDefaultTimeout(8000);
 page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
 const url=`http://127.0.0.1:${server.address().port}`;
 const list=async()=>{await page.getByTestId('tasks-view-list').click();await page.getByTestId('req-row-r1').waitFor();};
 await page.goto(url);await list();
 ck('secondary fields hidden',await page.getByTestId('task-column-participants').count()===0&&await page.getByTestId('task-column-issues').count()===0);
 const button=await page.getByTestId('task-fields-button').boundingBox();
 await page.getByTestId('task-fields-button').click();
 const pop=await page.getByTestId('task-fields-popover').boundingBox();
 ck('anchored and inside viewport',pop.x>=0&&pop.x+pop.width<=1200&&pop.y+pop.height<=800&&Math.abs(pop.y-button.y-button.height-6)<2,{button,pop});
 ck('title locked',await page.getByTestId('task-field-toggle-title').isDisabled());
 ck('old Hub upgrade label',await page.getByTestId('task-fields-upgrade').count()===1);
 await page.screenshot({path:out+'/desktop-fields-en.png'});
 await page.getByTestId('task-fields-search').fill('Part');
 ck('search column names',await page.getByTestId('task-field-participants').count()===1&&await page.getByTestId('task-field-owner').count()===0);
 await page.getByTestId('task-field-toggle-participants').click();
 await page.getByTestId('task-fields-search').fill('');
 await page.getByTestId('task-field-toggle-owner').click();
 await page.getByTestId('task-field-drag-status').dragTo(page.getByTestId('task-field-title'));
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('task_list_fields_v1')));
 ck('drag persisted order',saved[0].id==='status',saved);
 await page.getByLabel('Close field settings',{exact:true}).last().click();
 ck('visible fields applied',await page.getByTestId('task-column-participants').count()===1&&await page.getByTestId('task-column-owner').count()===0);
 const head=await page.getByTestId('task-column-status').boundingBox(),cell=await page.getByTestId('task-cell-r1-status').boundingBox();
 ck('header cell alignment',Math.abs(head.x-cell.x)<1&&Math.abs(head.width-cell.width)<1,{head,cell});
 await page.screenshot({path:out+'/desktop-fields-custom.png'});
 await page.reload();await list();
 ck('reload retains fields',await page.getByTestId('task-column-owner').count()===0&&await page.getByTestId('task-column-participants').count()===1);
 await page.getByTestId('task-fields-button').click();
 await page.getByTestId('task-fields-reset').click();
 saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('task_list_fields_v1')));
 ck('reset default order and visibility',saved[0].id==='title'&&saved.find(f=>f.id==='owner').visible&&!saved.find(f=>f.id==='participants').visible);
 await page.getByTestId('task-field-drag-owner').focus();
 await page.keyboard.press('ArrowDown');
 saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('task_list_fields_v1')));
 ck('keyboard reorder',saved[2].id==='owner');
 await page.getByTestId('task-fields-reset').click();
 await page.evaluate(()=>window.switchLanguage('zh'));
 ck('live translation',await page.getByText('恢复默认',{exact:true}).count()===1);
 await page.screenshot({path:out+'/desktop-fields-zh.png'});
 await page.getByTestId('task-fields-search').focus();await page.keyboard.press('Escape');
 ck('escape closes popover',await page.getByTestId('task-fields-popover').count()===0);
 await page.getByTestId('req-row-r1').click();
 ck('row still opens detail',await page.getByTestId('req-detail').count()===1);
 await page.getByTestId('req-detail-close').click();
 await page.getByTestId('task-time-r1-updated').scrollIntoViewIfNeeded();
 ck('old Hub update is dash',await page.getByTestId('task-time-r1-updated').textContent()==='—');
 await page.getByTestId('req-sort-created').click();
 ck('created ascending order',await page.locator('[data-testid^="req-row-"]').first().getAttribute('data-testid')==='req-row-r2');
 await page.getByTestId('req-sort-created').click();
 ck('created descending order',await page.locator('[data-testid^="req-row-"]').first().getAttribute('data-testid')==='req-row-r1');
 modernHub=true;await page.reload();await list();
 await page.getByTestId('req-sort-updated').click();
 ck('updated ascending order',await page.locator('[data-testid^="req-row-"]').first().getAttribute('data-testid')==='req-row-r2');
 await page.getByTestId('req-sort-updated').click();
 ck('updated descending order',await page.locator('[data-testid^="req-row-"]').first().getAttribute('data-testid')==='req-row-r1');
 const time=page.getByTestId('task-time-r1-updated');await time.scrollIntoViewIfNeeded();await time.hover();
 const hint=await time.getAttribute('title');
 ck('hover hint has local seconds and updater',/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(hint||'')&&(hint||'').includes('用户负责人'));
 ck('relative update',await time.textContent()==='3 min ago');
 await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
 ck('long press exact without opening task',await page.getByTestId('task-time-exact').count()===1&&await page.getByTestId('req-detail').count()===0);
 await page.screenshot({path:out+'/desktop-time-exact.png'});
 await page.getByLabel('Close timestamp',{exact:true}).click();
 await page.getByTestId('task-fields-button').click();
 ck('modern Hub no upgrade marker',await page.getByTestId('task-fields-upgrade').count()===0);
 await page.getByLabel('Close field settings',{exact:true}).last().click();
 await page.screenshot({path:out+'/desktop-time-columns.png'});
 await page.close();
 const phone=await browser.newPage({viewport:{width:390,height:844}});
 await phone.goto(url);await phone.getByTestId('tasks-view-list').click();await phone.getByTestId('req-row-r1').waitFor();
 ck('phone grouped cards no field settings',await phone.getByTestId('task-fields-button').count()===0&&await phone.getByTestId('req-group-pool').count()===1);
 ck('preferences never write Hub',writes===0);
 await phone.close();
}finally{await browser.close();server.close();writeFileSync(out+'/measurements.json',JSON.stringify({passed:p,total:t,results},null,2));}
console.log(`${p}/${t} passed`);process.exit(p===t?0:1);
