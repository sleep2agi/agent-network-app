// Real browser drive for the exported client against the isolated Hub.
// Captures console errors, failed requests and DOM text so first errors are exact.
import { chromium } from "/home/vansin/agent-network-dashboard/node_modules/playwright/index.mjs";

const URL_ = process.env.UI_URL || "http://127.0.0.1:8930/";
const HUB = process.env.HUB_URL || "http://127.0.0.1:8899";
const USER = process.env.ISO_USER || "";
const PASS = process.env.ISO_PASS || "";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
const consoleErrors = [], failed = [], hubCalls = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
page.on("requestfailed", r => failed.push(`${r.method()} ${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`));
page.on("response", r => { if (r.url().includes("/api/")) hubCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(HUB, "").slice(0, 120)}`); });

await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);
const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 700);
console.log("TITLE:", await page.title());
console.log("BODY:", JSON.stringify(bodyText));
console.log("INPUTS:", await page.locator("input").count(), "BUTTONS:", await page.locator("button,[role=button]").count());
console.log("HUB_CALLS:", JSON.stringify(hubCalls.slice(0, 10)));
console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors.slice(0, 6)));
console.log("FAILED:", JSON.stringify(failed.slice(0, 6)));

if (USER && PASS) {
  // try to fill hub url + credentials on the first screen
  const inputs = page.locator("input");
  const n = await inputs.count();
  console.log("FILL attempt with", n, "inputs");
  for (let i = 0; i < n; i++) {
    const ph = (await inputs.nth(i).getAttribute("placeholder")) ?? "";
    console.log(`  input[${i}] placeholder=${JSON.stringify(ph)}`);
  }
}
await browser.close();
