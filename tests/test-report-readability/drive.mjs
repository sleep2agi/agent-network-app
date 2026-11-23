import {serveExport,initScript,ANDROID_UA} from '../test-layout-sweep/harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const web=await serveExport(process.env.WEB_DIR), browser=await chromium.launch({executablePath:'/usr/bin/chromium'});
const report='## 客户端测试报告\n三项检查已完成，明细如下。\n\n---\n\n| 模块 / 专项 | 结论 | 核心实测数据 |\n|---|---|---|\n| 基础链路 | PASS | 冷启动 `About=1.20.14-alpha.709`，详见 [迁移记录](https://example.org/report)。 |\n| 页面回归 | PASS | `safeStorage` 可用，`keysReady=true`。 |\n| 密钥校验 | PASS | 核心路径均通过，`pageErrors=0`。 |';
try{for(const width of [390,960,1440])for(const theme of ['light','dark']){
  const p=await browser.newPage({viewport:{width,height:width===390?844:900},locale:'zh-CN',colorScheme:theme,...(width<1440?{userAgent:ANDROID_UA,hasTouch:true}:{})});
  await p.addInitScript(initScript,{theme});await p.goto(web.url+'?safeAreaSim=0,0,0,0');await p.waitForFunction(()=>!!window.__anetLayoutSweep);
  await p.evaluate(report=>{const now=new Date().toISOString();window.__chatTasksPaged=true;window.__userMessagesFixture=[];window.__chatTasksFixture=[{task_id:'report',from_name:'tester',to_name:'示例-A',content:'请给我测试报告。',result:report,status:'replied',created_at:now,completed_at:now}];window.__anetLayoutSweep.setScreen({name:'chat',alias:'示例-A'})},report);
  await p.getByText('客户端测试报告',{exact:true}).waitFor();await p.evaluate(()=>document.fonts.ready);await p.getByText('pageErrors=0',{exact:true}).scrollIntoViewIfNeeded();await p.screenshot({path:`/out/${process.env.PHASE}-${width}-${theme}.png`});
  const bounds=await p.getByText('pageErrors=0',{exact:true}).evaluate(el=>{
    const box=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width}};
    const clips=[]; for(let n=el.parentElement;n;n=n.parentElement){const css=getComputedStyle(n);if(/scroll|auto|hidden/.test(css.overflowY)&&n.scrollHeight>n.clientHeight+1) clips.push(box(n));}
    return {last:box(el),clips,model:box(document.querySelector('[data-testid="composer-model-row"]'))};
  });console.log(JSON.stringify({width,theme,...bounds,table:await p.getByText('模块 / 专项',{exact:true}).count()}));await p.close();
}}finally{await browser.close();web.close()}
