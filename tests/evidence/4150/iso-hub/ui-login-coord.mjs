import { readFileSync } from "node:fs";
import { chromium } from "/pw/node_modules/playwright/index.mjs";
const cred = JSON.parse(readFileSync("/cred/operator.json","utf8"));
const ready = JSON.parse(readFileSync("/cred/ready.json","utf8"));
const b = await chromium.launch({ args: ["--no-sandbox","--disable-gpu"] });
let ok = 0;
for (let n = 1; n <= 3; n++) {
  const ctx = await b.newContext(); const p = await ctx.newPage();
  let called = 0;
  p.on("request", r => { if (r.url().includes("/api/auth/login")) called++; });
  await p.goto(ready.ui_url, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2500);
  const i = p.locator("input");
  await i.nth(0).click(); await i.nth(0).type(ready.hub_url, { delay: 5 });
  await i.nth(1).click(); await i.nth(1).type(cred.username, { delay: 5 });
  await i.nth(2).click(); await i.nth(2).type(cred.password, { delay: 5 });
  await p.waitForTimeout(500);
  const box = await p.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find(n => (n.textContent || "").trim() === "登录工作区");
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  });
  if (box) await p.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await p.waitForTimeout(6000);
  const body = await p.locator("body").innerText();
  const loggedIn = !body.includes("登录工作区");
  if (loggedIn) ok++;
  console.log(`run${n}: box=${JSON.stringify(box)} loggedIn=${loggedIn} loginRequests=${called}`);
  await ctx.close();
}
console.log(`SUMMARY ok=${ok}/3`);
await b.close();
