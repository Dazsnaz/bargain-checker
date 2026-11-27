// Loads the real extension into Chromium and serves fake shop pages from
// fixtures, so the whole flow (read price -> store -> verdict -> badge) runs.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '../../src');
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const DAY = 24 * 60 * 60 * 1000;

let context, worker;

test.before(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-e2e-'));
  context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const pages = {
    'https://www.argos.co.uk/product/1234567': 'argos-product.html',
    'https://www.amazon.co.uk/dp/B0TEST0001': 'amazon-product.html',
    'https://www.currys.co.uk/products/test-drill-10200300.html': 'currys-product.html',
  };
  await context.route(/^https:\/\/(www\.)?(argos\.co\.uk|amazon\.co\.uk|currys\.co\.uk)\//, (route) => {
    const url = route.request().url().split('?')[0];
    const file = pages[url];
    if (file) route.fulfill({ status: 200, contentType: 'text/html', body: fixture(file) });
    else route.fulfill({ status: 404, body: 'not found' });
  });
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
});

test.after(async () => { if (context) await context.close(); });

async function badgeText(page) {
  const host = page.locator('#bargain-checker-root');
  await host.waitFor({ state: 'attached', timeout: 10000 });
  return host.evaluate((el) => el.shadowRoot.textContent.replace(/\s+/g, ' ').trim());
}

test('flags an inflated was-price on Argos using stored history', async () => {
  // 200 days at £49.99, then pushed to £79.99 ten days ago.
  await worker.evaluate(async (DAY) => {
    const now = Date.now();
    const points = [];
    for (let d = 200; d >= 1; d--) points.push({ t: now - d * DAY, p: d > 10 ? 4999 : 7999 });
    await chrome.storage.local.set({ 'p:argos:1234567': { key: 'argos:1234567', shop: 'argos', points } });
  }, DAY);
  const page = await context.newPage();
  await page.goto('https://www.argos.co.uk/product/1234567');
  const text = await badgeText(page);
  assert.match(text, /Inflated "was" price/);
  assert.match(text, /£59\.99/);
  assert.match(text, /£79\.99/);
  // Open the card and check the explanation.
  await page.locator('#bargain-checker-root').evaluate((el) => el.shadowRoot.querySelector('.head').click());
  const open = await badgeText(page);
  assert.match(open, /Usually £49\.99/);
  assert.match(open, /charged on 10 of the last/);
  await page.close();
});

test('shows "not enough history" on a new Amazon product and suggests Keepa', async () => {
  const page = await context.newPage();
  await page.goto('https://www.amazon.co.uk/dp/B0TEST0001');
  const text = await badgeText(page);
  assert.match(text, /Not enough history/);
  assert.match(text, /£39\.99/);
  assert.match(text, /£59\.99/);
  assert.match(text, /Keepa API key/);
  const stored = await worker.evaluate(() => chrome.storage.local.get('p:amazon:B0TEST0001'));
  assert.equal(stored['p:amazon:B0TEST0001'].name, 'Test Wireless Headphones');
  await page.close();
});

test('matches the same product across shops by barcode', async () => {
  const page = await context.newPage();
  await page.goto('https://www.currys.co.uk/products/test-drill-10200300.html');
  await badgeText(page);
  await page.close();
  // Back on Argos (£59.99), Currys at £54.99 is listed as cheaper.
  const argos = await context.newPage();
  await argos.goto('https://www.argos.co.uk/product/1234567');
  await badgeText(argos);
  await argos.locator('#bargain-checker-root').evaluate((el) => el.shadowRoot.querySelector('.head').click());
  assert.match(await badgeText(argos), /Seen cheaper this week:\s*Currys £54\.99/);
  await argos.close();
});

test('watch list: toggling and the daily re-check record a new price', async () => {
  const page = await context.newPage();
  await page.goto('https://www.currys.co.uk/products/test-drill-10200300.html');
  await badgeText(page);
  await page.locator('#bargain-checker-root').evaluate((el) => {
    el.shadowRoot.querySelector('.head').click();
  });
  await page.locator('#bargain-checker-root').evaluate((el) => el.shadowRoot.querySelector('.watch').click());
  await page.waitForFunction(() => document.querySelector('#bargain-checker-root').shadowRoot.textContent.includes('Stop watching'));
  const watch = await worker.evaluate(() => chrome.storage.local.get('watch'));
  assert.deepEqual(watch.watch, ['currys:10200300']);
  // Pretend the last observation was yesterday so the re-check stores a new point.
  const results = await worker.evaluate(async () => {
    const r = await chrome.storage.local.get('p:currys:10200300');
    const p = r['p:currys:10200300'];
    p.points = p.points.map((x) => ({ ...x, t: x.t - 86400000 }));
    await chrome.storage.local.set({ 'p:currys:10200300': p });
    return self.bargainChecker.checkWatchList();
  });
  assert.deepEqual(results, [{ key: 'currys:10200300', status: 'ok', price: 5499 }]);
  const after = await worker.evaluate(() => chrome.storage.local.get('p:currys:10200300'));
  assert.equal(after['p:currys:10200300'].points.length, 2);
  await page.close();
});

test('popup lists watched and recent products', async () => {
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/ui/popup.html`);
  await page.locator('#watched li a').first().waitFor();
  assert.match(await page.locator('#watched').textContent(), /Test Cordless Drill 18V/);
  assert.match(await page.locator('#recent').textContent(), /Test Wireless Headphones/);
  await page.close();
});
