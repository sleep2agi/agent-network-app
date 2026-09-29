import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.OUT||'/output';mkdirSync(out,{recursive:true});
const base={priority:'normal',assignee:'',due:'2026-10-01',column:'pool',createdAt:'2026-09-29',owner:{kind:'user',id:'u1'},agent_owner:{kind:'node',id:'n1'},participants:[],description:'用户描述：不要翻译。',checklist:[{id:'c1',text:'用户清单：核验',done:false}],project_id:'p1',parent_id:null,children:{total:0,done:0}};
let writes=0;
const rows=[{...base,id:'r1',name:'用户任务标题：不要翻译',children:{total:1,done:0}},{...base,id:'r2',name:'用户子需求标题',parent_id:'r1',external_ref:'github:demo/repo#1',external_url:'https://github.com/demo/repo/issues/1'}];
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'){writes++;res.statusCode=400;res.end(JSON.stringify({error:'fixture is read-only'}));return;}
  const body=path.endsWith('/projects')?{projects:[{id:'p1',name:'用户项目名',color:'#167d8d',archived:false}]}:
   path.endsWith('/people')?{people:[{kind:'user',id:'u1',name:'用户负责人',networkId:'fixture-network'},{kind:'node',id:'n1',name:'用户Agent',networkId:'fixture-network'}]}:
   path==='/api/auth/me'?{user:{id:'u1'}}:{requirements:rows,capabilities:['agent_owner','description','checklist','projects','due_datetime','sub_requirements']};
  res.end(JSON.stringify(body));return;
 }
 res.setHeader('Content-Type',path==='/app.js'?'text/javascript':'text/html');
 res.end(path==='/app.js'?readFileSync('/output/task-language.js'):'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{display:flex;height:100vh}</style><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--no-sandbox']});
let p=0,t=0;const results=[];
const ck=(name,ok,detail)=>{t++;if(ok)p++;results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'}: ${name} ${detail?JSON.stringify(detail):''}`);};
try{
 for(const [name,width,height] of [['desktop',1200,800],['phone',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000);
  page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByTestId('tasks-view-board').click();
  await page.getByTestId('req-card-r1').waitFor();await page.waitForTimeout(350);
  ck(`${name}: English board labels`,await page.getByText('Backlog',{exact:true}).count()>0&&await page.getByText('In progress',{exact:true}).count()>0);
  ck(`${name}: original task content remains`,await page.getByText(rows[0].name,{exact:true}).count()>0);
  const header=await page.getByTestId('task-header').evaluate(el=>{const b=el.getBoundingClientRect();return{x:b.x,right:b.right,width:b.width};});
  ck(`${name}: header fits`,header.x>=0&&header.right<=width+1,header);
  const button=await page.getByTestId('req-new').boundingBox();
  ck(`${name}: new button stays inside header`,button.x>=header.x&&button.x+button.width<=header.right+1,button);
  const columns=await Promise.all(['pool','doing','done'].map(async id=>page.getByTestId(`req-col-${id}`).boundingBox()));
  ck(`${name}: columns align`,columns.every(b=>b&&Math.abs(b.y-columns[0].y)<1&&Math.abs(b.width-columns[0].width)<1),columns);
  await page.screenshot({path:`${out}/${name}-board-en.png`});
  await page.getByTestId('req-card-r1').click();await page.getByTestId('req-detail').waitFor();await page.waitForTimeout(350);
  ck(`${name}: subtask section translated`,await page.getByText('Subtasks',{exact:true}).count()>0&&await page.getByText('New subtask',{exact:true}).count()>0);
  const detail=await page.getByTestId('req-detail').boundingBox();ck(`${name}: detail fits`,detail.x>=-1&&detail.x+detail.width<=width+1,detail);
  await page.getByTestId('req-edit-name').fill('用户草稿：保持不变');
  await page.screenshot({path:`${out}/${name}-detail-en.png`});
  await page.evaluate(()=>window.switchLanguage('zh'));
  ck(`${name}: live language change preserves draft`,await page.getByTestId('req-edit-name').inputValue()==='用户草稿：保持不变'&&await page.getByText('子需求',{exact:true}).count()>0);
  await page.screenshot({path:`${out}/${name}-detail-zh.png`});
  await page.evaluate(()=>window.switchLanguage('en'));
  await page.getByTestId('req-detail-close').click();
  if(name==='phone'){
   await page.getByTestId('task-filter-project').click();
   const menu=await page.getByTestId('task-filter-menu-project').boundingBox();
   ck('phone: English project menu fits',menu.x>=0&&menu.x+menu.width<=width,menu);
   await page.getByTestId('task-filter-manage-projects').click();
  }else await page.getByTestId('task-side-manage-projects').click();
  await page.getByTestId('project-manager').waitFor();await page.waitForTimeout(350);
  ck(`${name}: project manager translated`,await page.getByText('Manage projects',{exact:true}).count()>0&&await page.getByText('用户项目名',{exact:true}).count()>0);
  const project=await page.getByTestId('project-manager').boundingBox();ck(`${name}: project panel fits`,project.x>=-1&&project.x+project.width<=width+1,project);
  await page.screenshot({path:`${out}/${name}-projects-en.png`});
  ck(`${name}: read and language switch never write Hub`,writes===0,{writes});
  await page.close();
 }
}finally{await browser.close();server.close();writeFileSync(`${out}/measurements.json`,JSON.stringify({passed:p,total:t,results},null,2));}
console.log(`${p}/${t} passed`);process.exit(p===t?0:1);
