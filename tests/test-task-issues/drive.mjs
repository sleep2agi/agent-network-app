import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const original={id:'r1',name:'关联发布跟踪 Issue',priority:'normal',column:'pool',assignee:'',due:'',createdAt:'',owner:null,participants:[],issues:[{repo:'sleep2agi/agent-network',number:2079,title:'Release tracking'}],external_ref:'github:sleep2agi/agent-network-app#509',external_url:'https://github.com/sleep2agi/agent-network-app/issues/509'};
let row=structuredClone(original),writes=[];
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='PATCH'){
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=JSON.parse(raw);writes.push({path,body});
   if(body.issues?.some(i=>i.url.endsWith('/13'))){res.statusCode=400;res.end(JSON.stringify({error:'invalid_issues'}));return;}
   row={...row,issues:body.issues.map(i=>{const m=/https:\/\/github.com\/(.+)\/issues\/(\d+)/.exec(i.url);return{repo:m[1],number:Number(m[2]),title:i.title||''}})};
   res.end(JSON.stringify({requirement:row}));return;
  }
  const body=path.endsWith('/people')?{people:[]}:path==='/api/auth/me'?{user:{id:'u1'}}:{requirements:[row],capabilities:[]};
  res.end(JSON.stringify(body));return;
 }
 res.setHeader('Content-Type',path==='/app.js'?'text/javascript':'text/html');
 res.end(path==='/app.js'?readFileSync('/output/task-language.js'):'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{display:flex;height:100vh}</style><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--no-sandbox']});const results=[];
const ck=(name,ok,data)=>{results.push({name,ok,data});console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(data??'')}`);};
try{for(const[name,width,height]of[['desktop',1200,800],['phone',390,844]]){
 row=structuredClone(original);writes=[];
 const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{window.opened=[];window.open=url=>{window.opened.push(url);return null}});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByTestId('tasks-view-board').click();await page.getByTestId('req-card-r1').waitFor();
 ck(name+' card count includes distinct sync source',await page.getByTestId('req-card-r1').getByTestId('req-issue-count-r1').getByText('2',{exact:true}).count()===1);
 await page.screenshot({path:`/output/${name}-board.png`});
 await page.getByTestId('req-card-r1').click();await page.getByTestId('req-detail').waitFor();
 // GitHub issues live inside the detail's 「更多」 disclosure since #510 — open it (the drive had been red since; 2026-10-02 sweep).
 if(await page.getByTestId('req-more').count()===0)await page.getByTestId('req-more-toggle').click();
 await page.getByTestId('req-issue-add').click();
 await page.getByTestId('req-issue-input').fill('not an issue');await page.getByTestId('req-issue-confirm').click();
 ck(name+' invalid local input never writes',writes.length===0&&await page.getByTestId('req-issue-error').isVisible());
 await page.getByTestId('req-issue-input').fill('acme/widgets#13');await page.getByTestId('req-issue-confirm').click();
 await page.getByTestId('req-issue-error').filter({hasText:'invalid_issues'}).waitFor();
 ck(name+' Hub rejection keeps original and draft',await page.getByTestId('req-issue-input').inputValue()==='acme/widgets#13'&&await page.getByTestId('req-issue-link-0').count()===1);
 await page.screenshot({path:`/output/${name}-issue-error.png`});
 await page.getByTestId('req-issue-input').fill('acme/widgets#14');await page.getByTestId('req-issue-confirm').click();await page.getByTestId('req-issue-link-1').waitFor();
 ck(name+' canonical issue-only PATCH',Object.keys(writes[1].body).join()==='issues'&&writes[1].body.issues[1].url==='https://github.com/acme/widgets/issues/14'&&writes[1].body.issues[0].title==='Release tracking');
 await page.getByTestId('req-issue-link-1').click();await page.getByTestId('req-issue-source-link').click();
 ck(name+' opens via external helper',JSON.stringify(await page.evaluate(()=>window.opened))===JSON.stringify(['https://github.com/acme/widgets/issues/14',original.external_url]));
 await page.getByTestId('req-issues').scrollIntoViewIfNeeded();
 const bounds=await page.getByTestId('req-issues').boundingBox();
 ck(name+' binding region fits',bounds.x>=0&&bounds.x+bounds.width<=width+1,bounds);
 const chip=await page.getByTestId('req-issue-link-0').boundingBox();const remove=await page.getByTestId('req-issue-remove-0').boundingBox();
 ck(name+' chip controls align',Math.abs(chip.y-remove.y)<1&&remove.width>=44&&remove.x+remove.width<=width,{chip,remove});
 await page.screenshot({path:`/output/${name}-issues-en.png`});
 await page.evaluate(()=>window.switchLanguage('zh'));await page.screenshot({path:`/output/${name}-issues-zh.png`});
 ck(name+' source is labelled read-only',await page.getByTestId('req-issue-source').getByText('同步来源').count()===1&&await page.getByTestId('req-issue-source-remove').count()===0);
 await page.getByTestId('req-issue-remove-1').click();await page.getByTestId('req-issue-link-1').waitFor({state:'detached'});
 ck(name+' unlink preserves source identity',row.issues.length===1&&row.external_ref===original.external_ref&&row.external_url===original.external_url&&Object.keys(writes[2].body).join()==='issues');
 await page.getByTestId('req-detail-close').click();
 const list=page.getByRole('tab',{name:'列表',exact:true});await list.click();
 // Desktop list: the GitHub column is off by default since list field settings (#513) — turn it on the way a user does.
 if(await page.getByTestId('task-fields-button').count()){await page.getByTestId('task-fields-button').click();await page.getByTestId('task-field-toggle-issues').click();await page.keyboard.press('Escape');await page.waitForTimeout(200);}
 const target=page.getByTestId('req-row-r1');
 ck(name+' list count visible',await target.getByTestId('req-issue-count-r1').getByText('2',{exact:true}).count()===1);
 await page.screenshot({path:`/output/${name}-list.png`});
 await page.close();
}}finally{await browser.close();server.close();writeFileSync('/output/measurements.json',JSON.stringify(results,null,2));}
console.log(`${results.filter(r=>r.ok).length}/${results.length} passed`);process.exit(results.every(r=>r.ok)?0:1);
