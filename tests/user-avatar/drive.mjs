import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
mkdirSync('/output', {recursive:true});
let mode = 'ok', saved = {a:null,b:null}, writes=0, release;
const server=createServer(async (req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if (path.startsWith('/api/')) {
  const account=req.headers.authorization==='Bearer dummy-b'?'b':'a';
  res.setHeader('Content-Type','application/json');
  if (path==='/api/auth/me' && req.method==='GET') return res.end(JSON.stringify({user:{user_id:account,username:'same-name',...(mode==='old'?{}:{avatar_url:saved[account]})}}));
  if (path==='/api/auth/me/avatar' && req.method==='PUT') {
   writes++; let body=''; for await(const chunk of req) body+=chunk;
   if(mode==='fail') return res.writeHead(500).end('{"ok":false}');
   if(mode==='delay') await new Promise(r=>{release=r;});
   saved[account]=JSON.parse(body).avatar_url;
   return res.end(JSON.stringify({ok:true,user_id:account,avatar_url:saved[account]}));
  }
  return res.writeHead(404).end('{}');
 }
 res.setHeader('Content-Type',path==='/app.js'?'text/javascript':'text/html');
 res.end(path==='/app.js'?readFileSync('/app/user-avatar.js'):'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let count=0;const check=(name,ok)=>{assert(ok,name);count++;console.log('PASS',name);};
try {
 for(const width of [390,1280]) {
  mode='ok';saved={a:null,b:null};writes=0;
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByTestId('user-avatar-pick-3').click();
  await page.getByTestId('user-avatar-message').filter({hasText:'已保存到 Hub'}).waitFor();
  check(`${width}: pool persisted`,saved.a==='/avatars/avatar-03.webp');
  const image=await page.getByTestId('user-avatar-preview').getAttribute('src');
  await page.reload();await page.getByTestId('user-avatar-pick-3').waitFor();
  check(`${width}: reload reads Hub avatar`,image===await page.getByTestId('user-avatar-preview').getAttribute('src'));
  await page.screenshot({path:`/output/avatar-${width}.png`,fullPage:true});
  mode='fail';await page.getByTestId('user-avatar-pick-4').click();
  await page.getByTestId('user-avatar-message').filter({hasText:'无法确认'}).waitFor();
  check(`${width}: failure preserves preview`,image===await page.getByTestId('user-avatar-preview').getAttribute('src'));
  const before=writes;await page.getByTestId('user-avatar-url').fill('file:///private/photo');await page.getByTestId('user-avatar-save').click();
  await page.getByTestId('user-avatar-message').filter({hasText:'有效'}).waitFor();check(`${width}: invalid URL never sent`,writes===before);
  mode='ok';await page.getByTestId('user-avatar-reset').click();await page.getByTestId('user-avatar-message').filter({hasText:'已保存'}).waitFor();
  check(`${width}: reset persisted`,saved.a===null);
  mode='delay';await page.getByTestId('user-avatar-pick-5').click();
  await page.getByText('正在保存…',{exact:true}).waitFor();await page.locator('#switch').click();
  await page.getByTestId('user-avatar-pick-1').waitFor();
  const bImage=await page.getByTestId('user-avatar-preview').getAttribute('src');
  assert(release);const settled=page.waitForResponse(r=>r.url().endsWith('/api/auth/me/avatar'));release();mode='ok';
  await settled;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check(`${width}: late response cannot overwrite switched account`,saved.b===null && bImage===await page.getByTestId('user-avatar-preview').getAttribute('src') && await page.getByTestId('user-avatar-message').count()===0);
  check(`${width}: no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  mode='old';await page.reload();await page.getByTestId('user-avatar-message').filter({hasText:'尚不支持'}).waitFor();
  check(`${width}: old Hub cannot edit`,await page.getByTestId('user-avatar-pick-1').count()===0);
  await page.close();
 }
 console.log(`${count}/${count} passed`);
} finally {release?.();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
