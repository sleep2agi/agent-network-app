// Reuse the historical mounted fixture unchanged, except for portable tool paths.
// Assertions are preserved; use a valid synthetic server ID for today's validator.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const original = await readFile(new URL('../evidence/4150/neg-create-ui.mjs', import.meta.url), 'utf8');
const source = original
  .replaceAll('osrv_1', 'osrv_00000000-0000-0000-0000-000000000001')
  .replaceAll('srcdir_sel1', 'srcdir_00000000-0000-0000-0000-000000000003')
  .replaceAll('srcdir_1', 'srcdir_00000000-0000-0000-0000-000000000002')
  .replace("'/tmp/opencode/app-4130-modelline/tests/test-layout-sweep/harness.mjs'", JSON.stringify(new URL('../test-layout-sweep/harness.mjs', import.meta.url).href))
  .replace("'/home/vansin/agent-network-dashboard/node_modules/playwright/index.mjs'", JSON.stringify(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href))
  .replace('executablePath: findChromium()', 'executablePath: process.env.CHROMIUM_PATH')
  .replace("if (p === '/api/status'", `if (p === '/api/node-session-control/source' && bodyText) {
        const body = JSON.parse(bodyText);
        (window.__calls.fork ??= []).push(body);
        return { ...body, ok: true, request_id: 'fork_fixture', status: 'registration_confirmed' };
      }
      if (p === '/api/status'`)
  .replace('const fail = results.filter', `// Real existing Clone dialog's managed-fork action, not project-create.
{
  const { ctx, page, errors } = await scenario('ok');
  await page.locator('[data-testid="source-fork-child-name"]').fill('fork-child');
  await page.locator('[data-testid="source-fork-submit"]').click();
  await page.waitForFunction(() => window.__calls.fork?.length === 1);
  const body = (await page.evaluate(() => window.__calls.fork))[0];
  ck('F managed fork exact six fields', Object.keys(body).sort().join(',') === 'child_name,intent_id,mode,network_id,session_id,source_node_id');
  ck('F managed fork preserves native ses and mode', body.session_id === 'ses_A' && body.mode === 'fork_independent' && body.child_name === 'fork-child');
  ck('F no project-create POST for fork', (await page.evaluate(() => window.__calls.create.length)) === 0);
  ck('F no page errors', errors.length === 0);
  await ctx.close();
}
const fail = results.filter`);
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
