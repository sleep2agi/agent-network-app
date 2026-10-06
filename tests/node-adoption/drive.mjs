import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '/qa-tools/node_modules/playwright/index.mjs';
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?readFileSync('/node-adoption.js'):'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const out='/output';mkdirSync(out,{recursive:true});let p=0,t=0;
const ck=(n,v)=>{t++;if(!v)throw Error(n);p++;console.log('PASS '+n);};
try{
 for(const [width,height] of [[1200,800],[390,844]]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:width===390});
  let writes=[],reads=0,status='pending',delayed=false,release;
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());reads++;
   const body=url.pathname==='/api/host-supervisors'?{ok:true,daemons:[{daemon_node_id:'fixture-daemon',alias:'演示 daemon',adopt_capable:true}]}:{ok:true,request:{kind:url.searchParams.get('kind'),request_id:'fixture-request',node_id:'fixture-node',status,error:status==='stop_failed'?'adopt_explicit_private_socket_required':null}};
   await route.fulfill({json:body});
  });
  await page.route('**/mcp',async route=>{writes.push(route.request().postDataJSON());if(delayed)await new Promise(r=>release=r);await route.fulfill({json:{result:{content:[{text:JSON.stringify(delayed?{ok:false,error:'adopt_active_binding_required'}:{ok:true,request_id:'fixture-request'})}]}}});});
  const open=mode=>page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
  await open('old');await page.waitForTimeout(200);
  ck('old Hub hides controls '+width,await page.getByTestId('node-adoption-controls').count()===0&&reads===0);
  await open('starting');
  ck('starting uses shared down state '+width,await page.getByTestId('adopt-stop').getAttribute('aria-disabled')==='true'&&await page.getByTestId('adopt-start').getAttribute('aria-disabled')!=='true');
  await open('active');
  ck('restart disabled '+width,await page.getByTestId('adopt-restart').getAttribute('aria-disabled')==='true');
  const boxes=await Promise.all(['adopt-start','adopt-stop','adopt-restart'].map(id=>page.getByTestId(id).boundingBox()));
  ck('buttons aligned and touch-sized '+width,boxes.every(b=>b&&b.height>=44&&Math.abs(b.y-boxes[0].y)<1));
  ck('no horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${out}/adopted-${width}x${height}.png`,fullPage:true});
  await page.getByTestId('adopt-stop').click();await page.getByTestId('adopt-confirm').click();
  await page.getByTestId('adopt-message').filter({hasText:'等待'}).waitFor();
  ck('accepted is pending '+width,writes.at(-1).params.name==='stop_node');
  status='stop_failed';await page.getByTestId('adopt-message').filter({hasText:'私有 tmux'}).waitFor();
  await open('stopped');status='started';await page.getByTestId('adopt-start').click();await page.getByTestId('adopt-confirm').click();
  await page.getByTestId('adopt-message').filter({hasText:'已完成'}).waitFor();ck('daemon start contract '+width,writes.at(-1).params.name==='start_node');
  await open('manual');await page.getByTestId('adopt-open').click();await page.getByTestId('adopt-daemon-fixture-daemon').click();await page.getByTestId('adopt-workdir').fill('/fixture/known-node');
  await page.screenshot({path:`${out}/adoption-${width}x${height}.png`,fullPage:true});
  ck('adoption form no horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  status='active';await page.getByTestId('adopt-confirm').click();await page.getByTestId('adopt-message').filter({hasText:'已完成'}).waitFor();
  ck('known-node adoption contract '+width,writes.at(-1).params.name==='request_adopt_node'&&writes.at(-1).params.arguments.workdir==='/fixture/known-node');
  await open('active');delayed=true;await page.getByTestId('adopt-stop').click();await page.getByTestId('adopt-confirm').click();
  while(!release)await page.waitForTimeout(10);
  await page.evaluate(()=>window.switchFixtureNode());release();await page.waitForTimeout(200);
  ck('late failure cannot cross node '+width,await page.getByTestId('adopt-message').count()===0);
  await page.close();
 }
 console.log(`${p}/${t} browser checks passed`);
}finally{await browser.close();server.close();}
