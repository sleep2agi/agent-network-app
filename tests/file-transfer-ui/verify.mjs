import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { bootstrap } from './bootstrap.mjs';

const here = dirname(fileURLToPath(import.meta.url)), dist = resolve(here, '../../dist'), out = resolve(here, 'artifacts');
mkdirSync(out, { recursive: true });
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => ({ path: m[1], bytes: readFileSync(resolve(dist, `.${m[1]}`)) }));
if (!scripts.some(s => s.bytes.includes('attachment-file-save-as'))) throw new Error('Current dist does not contain the new file card. No build performed.');
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://fixture').pathname;
  const file = p === '/' ? resolve(dist, 'index.html') : resolve(dist, `.${decodeURIComponent(p)}`);
  if (!file.startsWith(dist + sep)) { res.writeHead(403); return res.end(); }
  try { if (!statSync(file).isFile()) throw Error(); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon' })[extname(file)] || 'application/octet-stream'); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const modulePath = process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`;
const { chromium } = await import(pathToFileURL(modulePath));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [], screenshots = [], errors = [], blocked = [], evidence = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
const tid = id => `[data-testid="${id}"]`;
const shot = async (page, name) => { await page.evaluate(() => document.fonts.ready); const path = resolve(out, `${name}.png`); await page.screenshot({ path }); screenshots.push(path); };
const wait = (page, f) => page.waitForFunction(f, null, { timeout: 12000 });
// Independent acceptance dictionary, not imported from production translations.
const copy = {
  zh: { queued: '等待上传', uploading: '上传中', uploaded: '已上传', waitingSend: '等待发送', sendFailed: '发送失败 · 点击重试整条消息', ready: '点击下载', downloading: '下载中', saved: '已保存', error: '下载失败 · 点击重试', saveHint: '选择位置保存 · Alt 点击直接存到下载', browserHint: '安全下载到浏览器', handedOff: '已交给浏览器下载 · 点击可再次下载', reveal: '在文件夹中显示', saveAs: '另存为' },
  en: { queued: 'Waiting to upload', uploading: 'Uploading', uploaded: 'Uploaded', waitingSend: 'Waiting to send', sendFailed: 'Failed to send · tap to retry the message', ready: 'Tap to download', downloading: 'Downloading', saved: 'Saved', error: 'Download failed · tap to retry', saveHint: 'Choose a save location · Alt-click to save to Downloads', browserHint: 'Download securely in your browser', handedOff: 'Handed to your browser · Click to download again', reveal: 'Show in folder', saveAs: 'Save as' },
};
async function statusCopy(page, status, language, tag) {
  const nodes = page.locator(tid(`attachment-file-status-${status}`));
  await nodes.first().waitFor();
  const texts = await nodes.allTextContents();
  check(`${tag}: ${language} ${status} exact dictionary`, texts.length > 0 && texts.every(t => t === copy[language][status]), texts);
  check(`${tag}: ${language} ${status} accessible label`, await nodes.evaluateAll((nodes, expected) => nodes.every(n => n.closest('[aria-label]')?.getAttribute('aria-label').includes(expected)), copy[language][status]));
}
async function switchLanguage(page, language) {
  // Exercise the installed cross-tab storage listener without reloading/remounting App.
  await page.evaluate(language => {
    const key = 'anet.language.v1', oldValue = localStorage.getItem(key);
    localStorage.setItem(key, language);
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: language, storageArea: localStorage }));
  }, language);
  await page.waitForFunction(expected => [...document.querySelectorAll('[data-testid="attachment-file-status-ready"]')].every(n => n.textContent === expected), copy[language].ready);
}
async function openAgent(page) {
  await page.locator(tid('agent-row-Fixture-Agent')).first().click({ timeout: 20000 });
  await page.locator(tid('chat-pane')).waitFor();
  await page.locator(tid('attachment-file-card')).first().waitFor({ timeout: 15000 });
}
async function inspectCards(page, tag) {
  await page.waitForFunction(() => [...document.querySelectorAll('img')].some(i => i.complete && i.naturalWidth > 0 && i.src.startsWith('blob:')), null, { timeout: 5000 }).catch(() => {});
  const cards = page.locator(tid('attachment-file-card'));
  const data = await cards.evaluateAll(elements => elements.map(e => {
    const b = e.getBoundingClientRect(), name = e.querySelector('[data-testid="attachment-file-name"]'), n = name.getBoundingClientRect(), icon = name.parentElement.nextElementSibling.getBoundingClientRect();
    const ancestors = []; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const r = p.getBoundingClientRect(); if (r.width > 0) ancestors.push({ left: r.left, right: r.right }); }
    const ext = e.querySelector('[data-testid="attachment-file-extension"]');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); ctx.font = getComputedStyle(ext).font;
    return { text: e.innerText, label: e.getAttribute('aria-label'), width: b.width, height: b.height, left: b.left, right: b.right, top: b.top, bottom: b.bottom, ext: ext?.textContent, extWidth: ext.getBoundingClientRect().width, extTextWidth: ctx.measureText(ext.textContent).width, nameRight: n.right, iconLeft: icon.left, contained: ancestors.every(r => b.left >= r.left - 1 && b.right <= r.right + 1), bg: getComputedStyle(e).backgroundColor };
  }));
  check(`${tag}: PPT PDF ZIP remote cards rendered`, data.length === 3 && ['.pptx', '.pdf', '.zip'].every(ext => data.some(c => c.ext === ext)), data);
  check(`${tag}: max 300px and contained`, data.length === 3 && data.every(c => c.width > 100 && c.width <= 300.5 && c.left >= 0 && c.right <= page.viewportSize().width + 1 && c.contained));
  check(`${tag}: cards visible, not blank`, data.length === 3 && data.every(c => c.height > 80 && c.bottom > 0 && c.top < page.viewportSize().height));
  check(`${tag}: document icons on right`, data.length === 3 && data.every(c => c.iconLeft >= c.nameRight));
  check(`${tag}: extension and zero-byte size`, data.some(c => c.ext === '.zip' && c.text.includes('0 B')) && data.some(c => c.ext === '.pptx' && c.text.includes('PPT')) && data.some(c => c.ext === '.pdf' && c.text.includes('PDF')));
  check(`${tag}: full extension visually readable without ellipsis`, data.every(c => c.extWidth >= c.extTextWidth - 1), data.map(c => ({ ext: c.ext, available: c.extWidth, required: c.extTextWidth })));
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  check(`${tag}: no horizontal page overflow`, overflow.scroll <= overflow.width, overflow);
  check(`${tag}: mixed image loaded`, await page.locator('img').evaluateAll(imgs => imgs.some(i => i.complete && i.naturalWidth > 0 && i.src.startsWith('blob:'))));
  return data;
}
try {
  for (const c of [ { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' }, { name: 'desktop-dark', width: 1440, height: 1000, theme: 'dark' }, { name: 'mobile-light', width: 390, height: 844, theme: 'light' }, { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' }, { name: 'desktop-en', width: 1440, height: 1000, theme: 'light', language: 'en' } ]) {
    const language = c.language || 'zh';
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: c.width, height: c.height }, colorScheme: c.theme, deviceScaleFactor: 1, acceptDownloads: true, serviceWorkers: 'block', ...(c.width === 390 ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36', hasTouch: true } : {}) });
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== new URL(url).origin) { blocked.push(route.request().url()); return route.abort(); } return route.continue(); });
    await context.addInitScript(bootstrap, { theme: c.theme, language });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push({ case: c.name, error: e.message }));
    try {
      await page.goto(url);
      await openAgent(page);
      await page.waitForTimeout(600);
      await inspectCards(page, `${c.name}/agent`);
      await statusCopy(page, 'ready', language, `${c.name}/agent`);
      check(`${c.name}: explicit stored language`, await page.evaluate(() => localStorage.getItem('anet.language.v1')) === language);
      check(`${c.name}: desktop save hint translated`, (await page.locator(tid('attachment-file-card')).allTextContents()).every(t => t.includes(copy[language].saveHint)));
      if (language === 'en') {
        await page.locator(tid('attachment-file-card')).first().evaluate(n => { window.__mountedFileCard = n; });
        for (const next of ['zh', 'en']) {
          await switchLanguage(page, next);
          await statusCopy(page, 'ready', next, 'runtime receive');
          check(`runtime receive: ${next} same mounted card and translated hint`, await page.locator(tid('attachment-file-card')).first().evaluate((n, hint) => n === window.__mountedFileCard && n.innerText.includes(hint), copy[next].saveHint));
          await shot(page, `runtime-receive-${next}`);
        }
      }
      await shot(page, `${c.name}-agent-received`);
      if (c.name === 'desktop-light' || language === 'en') {
        const card = page.locator(tid('attachment-file-card')).filter({ has: page.locator(tid('attachment-file-extension'), { hasText: '.pdf' }) }).first();
        const downloads = () => page.evaluate(() => window.__fixture.requests.filter(r => r.path === '/api/files/f_pdf00000001').length);
        const before = await downloads();
        await card.click(); await page.waitForTimeout(250);
        check('desktop: Save dialog cancel performs no file fetch', await downloads() === before && await page.locator(tid('attachment-file-status-ready')).count() === 3);
        await page.evaluate(() => { window.__fixture.savePath = '/Fixture/Chosen/Acceptance.pdf'; window.__fixture.delay.download = 600; });
        await card.click();
        await page.locator(tid('attachment-file-status-downloading')).waitFor();
        await statusCopy(page, 'downloading', language, c.name);
        check('desktop: downloading status and busy indicator', await page.locator(tid('attachment-file-busy')).count() === 1);
        await page.locator(tid('attachment-file-status-saved')).waitFor();
        await statusCopy(page, 'saved', language, c.name);
        check(`${c.name}: translated reveal and Save As controls`, await page.locator(tid('attachment-file-reveal')).innerText() === copy[language].reveal && await page.locator(tid('attachment-file-save-as')).innerText() === copy[language].saveAs);
        let calls = await page.evaluate(() => window.__fixture.calls);
        check('desktop: authenticated bytes saved to chosen path', calls.some(x => x.cmd === 'save_download' && x.args.targetPath === '/Fixture/Chosen/Acceptance.pdf' && Buffer.from(x.args.bytesBase64, 'base64').toString() === 'LOCAL ACCEPTANCE FILE BYTES') && await page.evaluate(() => window.__fixture.requests.some(r => r.path.endsWith('f_pdf00000001') && r.authorization === 'Bearer file_fixture_only')));
        await page.locator(tid('attachment-file-reveal')).click();
        await wait(page, () => window.__fixture.calls.some(c => c.cmd.includes('reveal_item_in_dir')));
        calls = await page.evaluate(() => window.__fixture.calls);
        check('desktop: saved file reveals in folder', calls.some(x => x.cmd === 'plugin:opener|reveal_item_in_dir' && JSON.stringify(x.args).includes('/Fixture/Chosen/Acceptance.pdf')), calls.filter(x => x.cmd.includes('opener')));
        await page.evaluate(() => { window.__fixture.savePath = '/Fixture/Second/Copy.pdf'; });
        await page.locator(tid('attachment-file-save-as')).click();
        await wait(page, () => window.__fixture.calls.some(c => c.cmd === 'save_download' && c.args.targetPath === '/Fixture/Second/Copy.pdf'));
        check('desktop: explicit Save As and remembered directory', await page.evaluate(() => window.__fixture.calls.filter(c => c.cmd === 'plugin:dialog|save').at(-1).args.options.defaultPath === '/Fixture/Chosen/Acceptance.pdf'));
        await shot(page, `${c.name}-saved`);
        const ppt = page.locator(tid('attachment-file-card')).filter({ has: page.locator(tid('attachment-file-extension'), { hasText: '.pptx' }) }).first();
        await page.evaluate(() => { window.__fixture.fail.download = 1; });
        await ppt.click(); await page.locator(tid('attachment-file-status-error')).waitFor();
        check('desktop: download failure visible with retry', await ppt.innerText().then(t => t.includes('503') && t.includes(copy[language].error)));
        await statusCopy(page, 'error', language, c.name);
        if (language === 'en') {
          for (const next of ['zh', 'en']) {
            await switchLanguage(page, next);
            await statusCopy(page, 'error', next, 'runtime download error');
            await statusCopy(page, 'saved', next, 'runtime saved');
            check(`runtime saved: ${next} reveal and Save As`, await page.locator(tid('attachment-file-reveal')).innerText() === copy[next].reveal && await page.locator(tid('attachment-file-save-as')).innerText() === copy[next].saveAs);
          }
        }
        await shot(page, `${c.name}-download-error`);
        await ppt.click(); await wait(page, () => document.querySelectorAll('[data-testid="attachment-file-status-saved"]').length === 2);
        check('desktop: download retry succeeds', true);
      }
      {
        if (c.width === 390) await page.locator(tid('chat-header-back')).click();
        await page.locator(tid('person-row-peer')).first().click();
        await page.locator(tid('dm-pane')).waitFor(); await page.locator(tid('attachment-file-card')).first().waitFor(); await page.waitForTimeout(400);
        await inspectCards(page, `${c.name}/dm`); await shot(page, `${c.name}-dm-received`);
        await statusCopy(page, 'ready', language, `${c.name}/dm`);
        if (c.width === 390) {
          await page.locator(tid('dm-header-back')).click();
        }
        await page.locator(tid('group-row-group-fixture')).first().click();
        await page.locator(tid('attachment-file-card')).first().waitFor(); await page.waitForTimeout(400);
        await inspectCards(page, `${c.name}/group`); await shot(page, `${c.name}-group-received`);
        await statusCopy(page, 'ready', language, `${c.name}/group`);
      }
    } catch (e) { check(`${c.name}: scenario completes`, false, e.message); await shot(page, `${c.name}-blocked`); }
    evidence.push({ case: c.name, text: await page.locator('body').innerText(), state: await page.evaluate(() => window.__fixture) });
    await context.close();
  }
  for (const { width, language } of [{ width: 1440, language: 'zh' }, { width: 390, language: 'zh' }, { width: 1440, language: 'en' }]) for (const fail of ['upload', 'task']) {
    const tag = `${language === 'en' ? 'desktop-en' : width === 390 ? 'mobile-dark' : 'desktop-light'}-${fail}-failure`;
    const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: width === 390 ? 'dark' : 'light', serviceWorkers: 'block' });
    await context.route('**/*', r => new URL(r.request().url()).origin === new URL(url).origin ? r.continue() : r.abort());
    await context.addInitScript(bootstrap, { theme: width === 390 ? 'dark' : 'light', language });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push({ case: tag, error: e.message }));
    try {
      await page.goto(url); await openAgent(page);
      const files = [{ name: 'Outgoing.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('LOCAL PPT ACCEPTANCE') }];
      if (width > 390) files.push(
        { name: 'Outgoing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('LOCAL PDF ACCEPTANCE') },
        { name: 'Outgoing.zip', mimeType: 'application/zip', buffer: Buffer.from('LOCAL ZIP ACCEPTANCE') },
        { name: 'Queue.txt', mimeType: 'text/plain', buffer: Buffer.from('LOCAL QUEUE ACCEPTANCE') },
        { name: 'Mixed.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });
      chooserPromise.catch(() => {});
      if (width > 390) await page.locator(tid('composer-desktop-plus')).click();
      else { await page.locator(tid('composer-plus')).click(); await page.getByRole('button', { name: /^(Choose files|选择文件)$/ }).click(); }
      const chooser = await chooserPromise; await chooser.setFiles(files);
      await page.locator(tid('composer-draft-file')).first().waitFor();
      check(`${tag}: real chooser creates file draft`, await page.locator(tid('composer-draft-file')).count() === (width > 390 ? 4 : 1));
      if (width > 390) check(`${tag}: mixed image and files in draft`, await page.locator(tid('composer-draft-thumb')).count() === 1);
      await page.evaluate(fail => { window.__fixture.requests = []; window.__fixture.fail[fail] = 1; window.__fixture.delay.upload = 2500; window.__fixture.delay.task = 800; window.__statusSeen = []; window.__statusTextSeen = []; const observer = new MutationObserver(() => { for (const e of document.querySelectorAll('[data-testid^="attachment-file-status-"]')) { const s = e.getAttribute('data-testid'); if (!window.__statusSeen.includes(s)) window.__statusSeen.push(s); const value = `${s}:${e.textContent}`; if (!window.__statusTextSeen.includes(value)) window.__statusTextSeen.push(value); } }); observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); }, fail);
      const input = page.locator('textarea').filter({ visible: true }).last();
      await input.fill('File transfer acceptance message');
      if (width > 390) await input.press('Enter'); else await page.locator(tid('composer-send')).click();
      await page.locator(tid('chat-local-file-card')).first().waitFor();
      await page.locator(tid('attachment-file-status-uploading')).first().waitFor();
      check(`${tag}: actual local card uploading`, true);
      await statusCopy(page, 'uploading', language, tag);
      if (width > 390) await statusCopy(page, 'queued', language, tag);
      if (language === 'en') for (const next of ['zh', 'en']) {
        await switchLanguage(page, next);
        await statusCopy(page, 'uploading', next, `${tag}/runtime`);
        await statusCopy(page, 'queued', next, `${tag}/runtime`);
      }
      if (width > 390) check(`${tag}: concurrency queue visible`, await page.locator(tid('attachment-file-status-queued')).count() > 0);
      await shot(page, `${tag}-uploading`);
      await page.locator(tid('attachment-file-status-sendFailed')).first().waitFor({ timeout: 20000 });
      await page.getByText(/^(Not delivered · Tap to retry|未送达 · 点击重试)$/).first().waitFor({ timeout: 20000 });
      await statusCopy(page, 'sendFailed', language, tag);
      if (language === 'en') for (const next of ['zh', 'en']) {
        await switchLanguage(page, next);
        await statusCopy(page, 'sendFailed', next, `${tag}/runtime`);
        await shot(page, `${tag}-runtime-${next}`);
      }
      const before = await page.evaluate(() => ({ posts: window.__fixture.requests.filter(r => r.method === 'POST' && ['/api/upload', '/api/task'].includes(r.path)), calls: window.__fixture.calls, seen: window.__statusSeen }));
      check(`${tag}: failed file still visible and retryable`, await page.locator(tid('chat-local-file-card')).first().getAttribute('role') === 'button');
      const localGeometry = await page.locator(tid('chat-local-file-card')).evaluateAll(cards => cards.map(e => {
        const b = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect();
        return { width: b.width, left: b.left, right: b.right, parentLeft: p.left, parentRight: p.right };
      }));
      check(`${tag}: outgoing cards contained with no horizontal overflow`, localGeometry.length === (width > 390 ? 4 : 1) && localGeometry.every(b => b.width > 100 && b.width <= 300.5 && b.left >= b.parentLeft - 1 && b.right <= b.parentRight + 1 && b.left >= 0 && b.right <= width) && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), localGeometry);
      check(`${tag}: intended failure reached`, before.posts.some(r => r.path === (fail === 'upload' ? '/api/upload' : '/api/task') && r.status === (fail === 'upload' ? 500 : 503)), before.posts.map(r => ({ path: r.path, status: r.status })));
      const outboxCalls = before.calls.filter(c => c.cmd === 'write_desktop_profile_file' && c.args.relativePath === 'outbox.json');
      let failedId; for (const c of outboxCalls.toReversed()) { const rows = JSON.parse(c.args.contents); if (rows.length) { failedId = rows.at(-1).id; break; } }
      await shot(page, `${tag}-failed`);
      // Remount the real chat so the retry must use outbox reconstruction, not only bubble-local state.
      if (width === 390) await page.locator(tid('chat-header-back')).click();
      await page.locator(tid('agent-row-Other-Agent')).first().click();
      if (width === 390) await page.locator(tid('chat-header-back')).click();
      await openAgent(page);
      await page.locator(tid('chat-local-file-card')).first().click();
      await wait(page, () => window.__fixture.requests.some(r => r.path === '/api/task' && r.method === 'POST' && r.status === 200));
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ posts: window.__fixture.requests.filter(r => r.method === 'POST' && ['/api/upload', '/api/task'].includes(r.path)), seen: window.__statusSeen }));
      const tasks = after.posts.filter(r => r.path === '/api/task'), success = tasks.filter(r => r.status === 200), body = JSON.parse(success[0]?.body || '{}');
      check(`${tag}: exactly one successful send with all attachments`, success.length === 1 && body.attachments?.length === files.length, body);
      const expectedUploads = files.length + (fail === 'upload' ? 1 : 0);
      check(`${tag}: upload memo reused across chat remount`, after.posts.filter(r => r.path === '/api/upload').length === expectedUploads, { uploads: after.posts.filter(r => r.path === '/api/upload').length, expectedUploads });
      check(`${tag}: retry preserves correlation ID`, !!failedId && body.meta?.client_request_id === failedId && tasks.every(t => JSON.parse(t.body).meta?.client_request_id === failedId), { failedId, requestIds: tasks.map(t => JSON.parse(t.body).meta?.client_request_id) });
      check(`${tag}: waitingSend and uploaded states observed`, after.seen.includes('attachment-file-status-waitingSend') && after.seen.includes('attachment-file-status-uploaded'), after.seen);
      const textSeen = await page.evaluate(() => window.__statusTextSeen);
      for (const status of ['waitingSend', 'uploaded']) check(`${tag}: ${language} ${status} observed exact dictionary`, textSeen.includes(`attachment-file-status-${status}:${copy[language][status]}`), textSeen);
      check(`${tag}: message text preserved`, body.task?.startsWith('File transfer acceptance message'));
      await shot(page, `${tag}-delivered`);
    } catch (e) { check(`${tag}: scenario completes`, false, e.message); await shot(page, `${tag}-blocked`); }
    evidence.push({ case: tag, text: await page.locator('body').innerText(), state: await page.evaluate(() => window.__fixture) });
    await context.close();
  }
  for (const language of ['zh', 'en']) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
    await context.route('**/*', r => new URL(r.request().url()).origin === new URL(url).origin ? r.continue() : r.abort());
    await context.addInitScript(bootstrap, { theme: 'light', browser: true, language }); const page = await context.newPage();
    page.on('pageerror', e => errors.push({ case: `browser-from-start-${language}`, error: e.message }));
    try {
      await page.goto(url); await openAgent(page);
      await page.waitForTimeout(600);
      check('browser: mixed authenticated image remains an image', await page.locator('img').evaluateAll(imgs => imgs.some(i => i.complete && i.naturalWidth > 0 && i.src.startsWith('blob:'))), 'Diagram.png must not become a generic FILE card in browser mode');
      const card = page.locator(tid('attachment-file-card')).filter({ has: page.locator(tid('attachment-file-extension'), { hasText: '.pdf' }) }).first();
      await statusCopy(page, 'ready', language, `browser-${language}`);
      check(`browser-${language}: translated secure download hint`, (await card.innerText()).includes(copy[language].browserHint));
      const downloadPromise = page.waitForEvent('download'); await card.click(); const download = await downloadPromise;
      await download.saveAs(resolve(out, 'browser-Acceptance.pdf'));
      const state = await page.evaluate(() => window.__fixture);
      check('browser: authenticated blob download without URL credentials', download.url().startsWith('blob:') && state.anchors.some(a => a.download === 'Acceptance.pdf' && a.href.startsWith('blob:') && !a.href.includes('file_fixture_only')) && state.requests.some(r => r.path.endsWith('f_pdf00000001') && r.authorization === 'Bearer file_fixture_only'));
      check('browser: downloaded bytes match response', readFileSync(resolve(out, 'browser-Acceptance.pdf'), 'utf8') === 'LOCAL ACCEPTANCE FILE BYTES');
      check('browser: no false saved-to-disk confirmation', await card.innerText().then(t => t.includes(copy[language].handedOff) && !t.includes(copy[language].saved)));
      await shot(page, language === 'zh' ? 'browser-authenticated-download' : 'browser-en-authenticated-download');
      if (language === 'en') for (const next of ['zh', 'en']) {
        await switchLanguage(page, next);
        await statusCopy(page, 'ready', next, 'runtime browser handoff');
        check(`runtime browser handoff: ${next} translated confirmation`, (await card.innerText()).includes(copy[next].handedOff), await card.innerText());
        await shot(page, `browser-handoff-runtime-${next}`);
      }
      const zero = page.locator(tid('attachment-file-card')).filter({ has: page.locator(tid('attachment-file-extension'), { hasText: '.zip' }) }).first();
      await zero.click();
      await page.waitForTimeout(600);
      check('browser: legitimate zero-byte file downloads', await page.evaluate(() => window.__fixture.anchors.some(a => a.download === 'Empty.zip')), 'A 200 response with zero bytes must still download');
      await shot(page, language === 'zh' ? 'browser-zero-byte-error' : 'browser-en-zero-byte');
    } catch (e) { check(`browser-${language}: nonempty download completes`, false, e.message); await shot(page, `browser-${language}-blocked`); }
    evidence.push({ case: `browser-from-start-${language}`, text: await page.locator('body').innerText(), state: await page.evaluate(() => window.__fixture) });
    await context.close();
  }
  check('security: no arbitrary open command in exercised flows', evidence.every(e => e.state.calls.every(c => !/open_path|open_url|shell\|open|shell\|execute|shell\|spawn/.test(c.cmd))));
  check('security: no credentials in requested URLs or anchors', evidence.every(e => e.state.requests.every(r => !r.query.includes('file_fixture_only')) && e.state.anchors.every(a => !a.href.includes('file_fixture_only'))));
  check('runtime: no uncaught page errors', errors.length === 0, errors);
  check('export: tested bundles unchanged during run', scripts.every(s => readFileSync(resolve(dist, `.${s.path}`)).equals(s.bytes)));
} finally {
  await browser.close(); await new Promise(r => server.close(r));
  const report = { scope: 'Unmodified exported full App; mocked Tauri IPC and in-memory Hub; no native shell or live Hub', dist: scripts.map(s => ({ path: s.path, sha256: createHash('sha256').update(s.bytes).digest('hex') })), passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results, screenshots, errors, blocked };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`${report.passed}/${results.length} passed; report: ${resolve(out, 'report.json')}`);
  process.exitCode = report.failed ? 1 : 0;
}
