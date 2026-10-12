import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'src/frontend/package.json'));
const { chromium } = require('playwright-core');
const executablePath = process.env.BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!executablePath) throw new Error('Set BROWSER_PATH to an installed Chromium browser');
const out = path.join(root, 'artifacts/prototype');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
try {
  await page.goto(process.env.PROTOTYPE_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  const links = await page.locator('nav a').evaluateAll(nodes => nodes.map(n => ({ label: n.textContent.trim(), href: n.getAttribute('href') })));
  if (links.length < 8) throw new Error(`Expected at least 8 navigation pages, got ${links.length}`);
  // The dashboard must offer a suggested review path whose links all resolve to real pages.
  const pathPanel = page.getByRole('region', { name: '部门评审建议路径' });
  const steps = await pathPanel.locator('ol li a').evaluateAll(nodes => nodes.map(node => ({ label: node.textContent.trim(), href: node.getAttribute('href') })));
  if (steps.length < 5) throw new Error(`expected a suggested review path, got ${steps.length} step(s)`);
  const routes = new Set(links.map(link => link.href));
  for (const step of steps) if (!routes.has(step.href)) throw new Error(`review path step ${step.label} links to unknown route ${step.href}`);
  if (!(await pathPanel.innerText()).includes('自动化检查通过不代填部门结论')) throw new Error('review path must state that automation does not replace department conclusions');
  for (const link of links) {
    await page.goto(new URL(link.href, page.url()).href, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    if (body.length < 100) throw new Error(`Empty page: ${link.label}`);
    // Every page must state its build id, data mode and page-level limitations.
    const strip = await page.getByLabel('原型构建与范围').innerText();
    const limits = (await page.getByLabel('本页限制说明').innerText()).trim();
    if (limits.length < 12) throw new Error(`Missing page limitations on ${link.label}: ${limits}`);
    if (!/模拟|合成|本机|Demo|离线|未连接|不连接|规划/.test(limits)) throw new Error(`Page limitations must state the demo boundary on ${link.label}: ${limits}`);
    if (!/构建 \S{1,40}/.test(strip)) throw new Error(`Missing build id on ${link.label}: ${strip}`);
    if (!strip.includes('数据模式：全部为模拟') || !strip.includes('未连接真实设备')) throw new Error(`Missing data-mode disclosure on ${link.label}: ${strip}`);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (mobileOverflow) throw new Error(`Mobile overflow: ${link.label}`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    results.push({ page: link.label, url: page.url(), rendered: true, mobileOverflow });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.PROTOTYPE_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  results.push({ page: 'mobile', viewport: 390, overflow });
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  if (overflow) throw new Error('Mobile viewport horizontal overflow');
  writeFileSync(path.join(out, 'smoke-results.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, pages: links.length, results }, null, 2));
} catch (error) {
  writeFileSync(path.join(out, 'smoke-results.json'), JSON.stringify({ passed: false, error: error.message, results, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
