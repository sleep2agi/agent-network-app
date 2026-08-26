import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseUrl = process.env.BASE_URL || 'http://anet-onboarding-preview-server:4173';
const outputDir = process.env.EVIDENCE_DIR || '/evidence';
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function open(name, query, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: false });
  return page;
}

const dark = await open('first-run-dark', 'screen=first-run&theme=dark', { width: 1280, height: 800 });
await dark.getByText('让 Agent 在这里协作').waitFor();
await dark.getByText('创建本地工作区').waitFor();
await dark.close();

const light = await open('first-run-light', 'screen=first-run&theme=light', { width: 1280, height: 800 });
await light.getByText('本地优先').waitFor();
await light.close();

const compact = await open('first-run-compact', 'screen=first-run&theme=dark', { width: 420, height: 520 });
const compactPrimary = compact.getByText('创建本地工作区');
await compactPrimary.scrollIntoViewIfNeeded();
const primaryBox = await compactPrimary.boundingBox();
if (!primaryBox || primaryBox.y < 0 || primaryBox.y + primaryBox.height > 520) {
  throw new Error('compact primary action cannot be scrolled fully into view');
}
await compact.getByText('使用已有服务器登录').scrollIntoViewIfNeeded();
await compact.screenshot({ path: `${outputDir}/first-run-compact-scrolled.png`, fullPage: false });
await compact.close();

const login = await open('login-dark', 'screen=login&theme=dark', { width: 1280, height: 800 });
await login.getByLabel('服务器地址').fill('not a valid url');
await login.getByLabel('用户名').fill('vincent');
const passwordField = login.getByRole('textbox', { name: '密码', exact: true });
await passwordField.fill('redacted-password');
await login.getByLabel('显示密码').click();
await login.getByLabel('隐藏密码').waitFor();
await login.getByTestId('login-submit').click();
await login.getByTestId('login-error-bad-url').waitFor();
await login.screenshot({ path: `${outputDir}/login-error-visible-password.png`, fullPage: false });
await login.close();

await browser.close();
console.log('RESULT: PASS (dark/light/compact/login interactive renders)');
