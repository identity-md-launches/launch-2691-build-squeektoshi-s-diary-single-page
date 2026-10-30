import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const flag = process.argv.indexOf('--playwright');
const { chromium, webkit } = await import(flag < 0 ? 'playwright' : pathToFileURL(resolve(process.argv[flag + 1])).href);
const base = resolve('dist');
const out = resolve('test/scratch/browser');
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = resolve(base, decodeURIComponent(url.pathname).replace(/^\/preview\//, '') || 'index.html');
  if (!url.pathname.startsWith('/preview/') || !path.startsWith(base + '/')) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const HOUR = 3600000, DAY = 24 * HOUR;
const day = Math.floor(Date.now() / DAY) * DAY;
const date = t => new Date(t).toISOString();

// Synthetic observations exist only in this test harness, never in the site or export.
function fixture(path, phase = 'IDLE', partial = false) {
  const generatedAt = date(Date.now());
  if (path.endsWith('/status')) return { generatedAt, measurement: partial ? { coreStatus: phase } : { coreStatus: phase, rpmMilli: phase === 'SPINNING' ? 12500 : 0, speedMmPerSecond: phase === 'SPINNING' ? 250 : 0, distanceMm: 11500044, cumulativeWorkUnits: '45758', observedAt: generatedAt, freshness: 'online', staleAfterSeconds: 120 }, builder: { anchor: { blockHeight: '4118', blockProgress: '503463521' } } };
  if (path.endsWith('/economy/state')) return { status: 'available', generatedAt, asset: { decimals: 18 }, supply: partial ? {} : { totalMintedBaseUnits: '16387784752755398547956254', liveSupplyBaseUnits: '16387784752755398547956254', capBaseUnits: '2100000000000000000000000000' } };
  const range = new URL(path, 'https://api.squeekchain.com').searchParams.get('range');
  const hours = range === '24h' ? 1 : range === '7d' ? 6 : 24;
  const count = range === '24h' ? 24 : range === '7d' ? 28 : 30;
  const start = range === '30d' ? day - 29 * DAY + 12 * HOUR : range === '7d' ? day - 6 * DAY : day - 12 * HOUR;
  return { status: 'available', generatedAt, summary: { workAdded: '4800' }, buckets: partial ? [] : Array.from({ length: count }, (_, i) => ({ startAt: date(start + i * hours * HOUR), endAt: date(start + (i + 1) * hours * HOUR), workAdded: i % 5 === 0 ? '0' : String((i + 1) * 17), settlementCount: '6' })) };
}
const results = [];
const browsers = [];
try {
 for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  let browser;
  try { browser = await engine.launch({ headless: true }); browsers.push(browser); }
  catch { results.push({ engine: name, status: 'unavailable', limitation: 'Browser runtime could not launch; this engine was not tested.' }); continue; }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  let failed = false, partial = false, phase = 'IDLE', malformed = false;
  const calls = [];
  await context.route('https://api.squeekchain.com/**', async route => {
    const path = new URL(route.request().url()).pathname + new URL(route.request().url()).search;
    calls.push(path);
    if (failed) await route.fulfill({ status: 503, body: '{}' });
    else await route.fulfill({ json: malformed ? {} : fixture(path, phase, partial) });
  });
  const page = await context.newPage();
  await page.clock.install();
  const scriptErrors = [], missingLocal = [];
  page.on('pageerror', e => scriptErrors.push(e.message));
  page.on('response', r => { if (r.url().startsWith(url) && r.status() >= 400) missingLocal.push(r.url()); });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('h1').textContent.includes('napping'));
  assert.equal(await page.locator('#rpm').textContent(), '0');
  assert.equal(await page.locator('#distance').textContent(), '11.5');
  assert.equal(await page.locator('.heat-cell').count(), 168);
  assert.equal(await page.locator('.entry-card').count(), 7);
  for (const [selector, attribute] of [['link[rel=icon]', 'href'], ['meta[property="og:image"]', 'content']]) {
    const relative = await page.locator(selector).getAttribute(attribute);
    assert.ok(relative.startsWith('./'), 'Share asset must use a relative URL');
    const response = await context.request.get(new URL(relative, page.url()).href);
    assert.equal(response.status(), 200, 'Share asset exists in production export');
    if (attribute === 'content') { const png = await response.body(); assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630); }
  }
  const action = await page.getByRole('button', { name: '30 days', exact: true }).boundingBox();
  assert.ok(action && action.y + action.height <= 844, 'Range control must be on first mobile screen');
  await page.screenshot({ path: `${out}/${name}-390.png` });
  await page.getByRole('button', { name: '30 days', exact: true }).click();
  assert.equal(await page.locator('.heat-cell').count(), 720);
  assert.equal(await page.getByRole('button', { name: '30 days', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  assert.equal(await page.locator('.heat-cell').count(), 168);
  const cell = page.locator('.heat-cell:not(.is-future):not(.is-missing):not(.is-grouped)').first();
  await cell.click();
  assert.match(await page.locator('#cell-detail').innerText(), /passes.*Your local time:/s);
  assert.match(await cell.getAttribute('title'), /Your local time:/);
  const before = Number(await cell.getAttribute('data-start'));
  await cell.focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => Number(document.activeElement.dataset.start)), before + HOUR);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => Number(document.activeElement.dataset.start)), before + 25 * HOUR);
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => new Date(Number(document.activeElement.dataset.start)).getUTCHours()), 0);
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => new Date(Number(document.activeElement.dataset.start)).getUTCHours()), 23);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-selected')), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.heat-cell[aria-selected=true]').count(), 0);
  await page.getByRole('button', { name: 'Pause hamster animation' }).click();
  assert.equal(await page.locator('#motion-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.hamster-pixel').evaluate(e => getComputedStyle(e).animationPlayState), 'paused');
  await page.getByRole('button', { name: 'Resume hamster animation' }).click();
  await page.locator('#heatmap-method summary').click();
  assert.equal(await page.locator('#heatmap-method').getAttribute('open'), '');
  await page.locator('#heatmap-method summary').click();
  phase = 'SPINNING';
  await page.getByRole('button', { name: 'Refresh diary data' }).click();
  await page.waitForFunction(() => document.querySelector('#rpm').textContent === '12.5');
  assert.match(await page.locator('h1').innerText(), /running/);
  assert.equal(await page.locator('#speed').textContent(), '25');
  assert.equal(await page.locator('#hamster-scene').getAttribute('data-phase'), 'running');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${out}/${name}-running-390.png` });
  failed = true;
  const savedRpm = await page.locator('#rpm').textContent();
  await page.getByRole('button', { name: 'Refresh diary data' }).click();
  await page.waitForFunction(() => !document.querySelector('#offline-badge').hidden);
  assert.match(await page.locator('#offline-badge').innerText(), /Offline, showing last data/);
  assert.equal(await page.locator('#rpm').textContent(), savedRpm);
  assert.match(await page.locator('h1').innerText(), /was/);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('h1').textContent.includes('running'));
  assert.equal(await page.locator('#rpm').textContent(), savedRpm);
  assert.match(await page.locator('#sqk-minted').innerText(), /16,387,784.75/);
  const cache = await page.evaluate(() => localStorage.getItem('squeektoshi-diary:v1'));
  assert.doesNotMatch(cache, /signer|installationId|transactionHash|lastSignature/);
  failed = false; phase = 'IDLE';
  await page.getByRole('button', { name: 'Refresh diary data' }).click();
  await page.waitForFunction(() => document.querySelector('h1').textContent.includes('napping'));
  assert.equal(await page.locator('#offline-badge').isVisible(), false);
  malformed = true;
  await page.getByRole('button', { name: 'Refresh diary data' }).click();
  await page.waitForFunction(() => !document.querySelector('#offline-badge').hidden);
  assert.equal(await page.locator('#rpm').textContent(), '0');
  malformed = false;
  for (const width of [320, 390, 760, 1000, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.style.fontSize = '32px');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '200% text enlargement reflow');
  await page.screenshot({ path: `${out}/${name}-text-200.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  await page.getByRole('button', { name: 'Refresh diary data' }).click();
  await page.waitForFunction(() => document.querySelector('#refresh').disabled === false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${out}/${name}-1440.png`, fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.hamster-pixel').evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('.wheel-spokes').evaluate(e => getComputedStyle(e).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const beforePoll = calls.length;
  await page.clock.runFor(15001);
  await page.waitForFunction(() => document.querySelector('#refresh').disabled === false);
  assert.ok(calls.length > beforePoll, '15-second status polling');
  assert.ok(calls.slice(beforePoll).some(c => c === '/v1/status'));
  const focusCell = page.locator('.heat-cell[tabindex="0"]');
  await focusCell.focus();
  const focusedTime = await focusCell.getAttribute('data-start');
  const beforeMinute = calls.length;
  await page.clock.runFor(45001);
  await page.waitForFunction(() => document.activeElement.classList.contains('heat-cell'));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.start), focusedTime);
  assert.ok(calls.slice(beforeMinute).some(c => c.includes('range=7d')), '60-second history polling');
  await context.close();

  // A first visit while offline has no fabricated snapshot, and refresh recovers it.
  const cold = await browser.newContext({ viewport: { width: 390, height: 844 } });
  failed = true;
  await cold.route('https://api.squeekchain.com/**', r => failed ? r.fulfill({ status: 503, body: '{}' }) : r.fulfill({ json: fixture(new URL(r.request().url()).pathname + new URL(r.request().url()).search, 'IDLE', partial) }));
  const coldPage = await cold.newPage();
  await coldPage.goto(url);
  await coldPage.waitForFunction(() => document.querySelector('#offline-badge').textContent.includes('no saved data'));
  assert.equal(await coldPage.locator('#rpm').textContent(), '–');
  assert.doesNotMatch(await coldPage.locator('body').innerText(), /NaN|undefined/);
  assert.equal(await coldPage.locator('.heat-cell:not(.is-missing):not(.is-future)').count(), 0);
  failed = false;
  await coldPage.getByRole('button', { name: 'Refresh diary data' }).click();
  await coldPage.waitForFunction(() => document.querySelector('#rpm').textContent === '0');
  partial = true;
  await coldPage.getByRole('button', { name: 'Refresh diary data' }).click();
  await coldPage.waitForFunction(() => document.querySelector('#rpm').textContent === '–');
  assert.doesNotMatch(await coldPage.locator('body').innerText(), /NaN|undefined/);
  await cold.close();
  assert.deepEqual(scriptErrors, []); assert.deepEqual(missingLocal, []);
  results.push({ engine: name, status: 'passed', checks: ['first-screen action at 390', '7/30-day filters', 'hour selection and local-time detail', 'keyboard arrows/Home/End/Enter/Escape', 'animation pause', 'method disclosure', 'running/napping telemetry and units', 'offline retention and reload cache', 'recovery', 'malformed response retention', 'cold offline', 'partial fields', '15-second status and 60-second history polling', 'keyboard focus retained across history refresh', 'relative favicon and 1200x630 share image', 'reduced motion', '200% text enlargement', 'no page overflow at 320/390/760/1000/1440', 'no script errors or missing local resources'], apiReads: calls.length });
  await browser.close();
 }
} catch (e) {
 results.push({ status: 'failed', message: e.message });
 process.stderr.write(e.stack + '\n');
 process.exitCode = 1;
} finally {
 for (const browser of browsers) await browser.close();
 server.close();
 await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
 process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}
