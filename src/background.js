// Service worker: stores price history, asks Keepa for Amazon history,
// works out verdicts, and re-checks the watch list once a day.
importScripts('lib/price.js', 'lib/sites.js', 'lib/extract.js', 'lib/verdict.js', 'lib/keepa.js');

const { computeVerdict, extractFromHtml, keepaProductToPoints, keepaUrl, shopForUrl, SHOPS, DAY } = self.BC;

const HEARTBEAT_MS = 20 * 60 * 60 * 1000; // record an unchanged price at most once every 20 hours
const MAX_POINTS = 1500;
const KEEPA_CACHE_MS = 12 * 60 * 60 * 1000;
const WATCH_ALARM = 'watch-check';
const WATCH_GAP_MS = 4000; // pause between shop requests during the daily check
const MAX_WATCH = 100;

// ---------- storage helpers ----------

async function get(key, fallback) {
  const r = await chrome.storage.local.get(key);
  return r[key] === undefined ? fallback : r[key];
}
async function set(key, value) { await chrome.storage.local.set({ [key]: value }); }

async function getSettings() { return get('settings', { keepaKey: '' }); }

// ---------- recording ----------

async function record(obs, now = Date.now()) {
  const id = `p:${obs.key}`;
  const product = await get(id, { key: obs.key, shop: obs.shop, points: [] });
  product.name = obs.name || product.name;
  product.url = obs.url || product.url;
  product.gtin = obs.gtin || product.gtin || null;
  product.lastWas = obs.was || null;
  product.lastSeen = now;
  const last = product.points[product.points.length - 1];
  if (!last || last.p !== obs.price || now - last.t >= HEARTBEAT_MS) {
    product.points.push({ t: now, p: obs.price });
    if (product.points.length > MAX_POINTS) product.points = product.points.slice(-MAX_POINTS);
  }
  await set(id, product);
  if (product.gtin) {
    const gid = `g:${product.gtin}`;
    const keys = await get(gid, []);
    if (!keys.includes(obs.key)) { keys.push(obs.key); await set(gid, keys); }
  }
  return product;
}

// ---------- Keepa (Amazon) ----------

async function keepaPoints(asin, { force = false } = {}) {
  const { keepaKey } = await getSettings();
  if (!keepaKey) return { points: [], status: 'no-key' };
  const cacheId = `keepa:${asin}`;
  const cached = await get(cacheId, null);
  if (cached && !force && Date.now() - cached.fetchedAt < KEEPA_CACHE_MS) return { points: cached.points, status: 'ok' };
  try {
    const res = await fetch(keepaUrl(keepaKey, asin));
    if (!res.ok) return { points: cached ? cached.points : [], status: `keepa-http-${res.status}` };
    const data = await res.json();
    const points = keepaProductToPoints(data.products && data.products[0]);
    await set(cacheId, { fetchedAt: Date.now(), points });
    return { points, status: 'ok' };
  } catch (e) {
    return { points: cached ? cached.points : [], status: 'keepa-error' };
  }
}

// ---------- verdict for one product ----------

async function otherShops(product) {
  if (!product.gtin) return [];
  const keys = await get(`g:${product.gtin}`, []);
  const out = [];
  for (const k of keys) {
    if (k === product.key) continue;
    const p = await get(`p:${k}`, null);
    const last = p && p.points[p.points.length - 1];
    if (last && last.p && Date.now() - last.t < 7 * DAY) {
      const shop = SHOPS.find((s) => s.id === p.shop);
      out.push({ key: k, shop: shop ? shop.name : p.shop, url: p.url, price: last.p, seen: last.t });
    }
  }
  return out.sort((a, b) => a.price - b.price);
}

async function assess(product, current, was) {
  let points = product.points;
  let keepaStatus = null;
  if (product.shop === 'amazon') {
    const asin = product.key.split(':')[1];
    const k = await keepaPoints(asin);
    keepaStatus = k.status;
    // Keepa history first, then our own observations from after Keepa's last point.
    if (k.points.length) {
      const lastKeepa = k.points[k.points.length - 1].t;
      points = k.points.concat(product.points.filter((x) => x.t > lastKeepa));
    }
  }
  const verdict = computeVerdict({ points, current, was });
  const since = Date.now() - 180 * DAY;
  return {
    verdict,
    keepaStatus,
    history: points.filter((x) => x.t >= since || x.k).slice(-400),
    others: await otherShops(product),
    watched: (await get('watch', [])).includes(product.key),
  };
}

// ---------- watch list ----------

async function toggleWatch(key) {
  let watch = await get('watch', []);
  if (watch.includes(key)) watch = watch.filter((k) => k !== key);
  else if (watch.length < MAX_WATCH) watch.push(key);
  await set('watch', watch);
  return watch.includes(key);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkWatchList() {
  const watch = await get('watch', []);
  const results = [];
  for (const key of watch) {
    const product = await get(`p:${key}`, null);
    if (!product || !product.url) continue;
    try {
      if (product.shop === 'amazon') {
        // Amazon pages are not fetched directly; Keepa gives the latest price when a key is set.
        const k = await keepaPoints(key.split(':')[1], { force: true });
        results.push({ key, status: k.status });
      } else {
        const res = await fetch(product.url, { credentials: 'omit' });
        const obs = res.ok ? extractFromHtml(await res.text(), product.url) : null;
        if (obs && obs.price) {
          obs.key = key; // keep the original key even if the URL now differs
          await record(obs);
          results.push({ key, status: 'ok', price: obs.price });
        } else {
          results.push({ key, status: res.ok ? 'no-price-found' : `http-${res.status}` });
        }
      }
    } catch (e) {
      results.push({ key, status: 'error' });
    }
    await sleep(WATCH_GAP_MS);
  }
  await set('lastWatchCheck', { at: Date.now(), results });
  return results;
}

async function overview() {
  const all = await chrome.storage.local.get(null);
  const watch = all.watch || [];
  const products = Object.keys(all)
    .filter((k) => k.startsWith('p:'))
    .map((k) => all[k])
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  const summary = products.map((p) => {
    const last = p.points[p.points.length - 1];
    const shop = SHOPS.find((s) => s.id === p.shop);
    return {
      key: p.key, name: p.name, url: p.url, shop: shop ? shop.name : p.shop,
      price: last ? last.p : null, was: p.lastWas || null, watched: watch.includes(p.key),
      verdict: last && last.p ? computeVerdict({ points: p.points, current: last.p, was: p.lastWas }).verdict : 'unknown',
    };
  });
  return { products: summary, lastWatchCheck: all.lastWatchCheck || null };
}

// ---------- wiring ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(WATCH_ALARM, { periodInMinutes: 24 * 60, delayInMinutes: 5 });
});
chrome.runtime.onStartup.addListener(async () => {
  if (!(await chrome.alarms.get(WATCH_ALARM))) chrome.alarms.create(WATCH_ALARM, { periodInMinutes: 24 * 60, delayInMinutes: 5 });
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === WATCH_ALARM) checkWatchList(); });

const handlers = {
  async observe({ obs }, sender) {
    if (!obs || !obs.key || !obs.price) return { error: 'bad-observation' };
    if (!shopForUrl(obs.url)) return { error: 'unsupported-shop' };
    const product = await record(obs);
    const result = await assess(product, obs.price, obs.was);
    if (sender && sender.tab && sender.tab.id !== undefined) setBadge(sender.tab.id, result.verdict.verdict);
    return result;
  },
  async toggleWatch({ key }) { return { watched: await toggleWatch(key) }; },
  async overview() { return overview(); },
  async checkWatchNow() { return { results: await checkWatchList() }; },
  async getSettings() { return getSettings(); },
  async saveSettings({ settings }) { await set('settings', Object.assign(await getSettings(), settings)); return { ok: true }; },
  async exportData() { return chrome.storage.local.get(null); },
  async clearData() {
    const settings = await getSettings();
    await chrome.storage.local.clear();
    await set('settings', settings);
    return { ok: true };
  },
};

const BADGE = { genuine: ['✓', '#1a7f37'], normal: ['=', '#6e7781'], inflated: ['!', '#cf222e'], unknown: ['?', '#9a6700'] };
function setBadge(tabId, verdict) {
  const [text, color] = BADGE[verdict] || BADGE.unknown;
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
  return true; // reply asynchronously
});

// Exposed for tests and the console.
self.bargainChecker = { record, assess, checkWatchList, overview };
