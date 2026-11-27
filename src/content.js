// Runs on supported shop pages: reads the product price, asks the service
// worker for a verdict, and shows a small badge in the corner of the page.
(function () {
  const { extractFromDocument, formatPrice, LABELS } = globalThis.BC;
  const HOST_ID = 'bargain-checker-root';
  let lastSignature = null;
  let current = null; // { obs, result }

  const COLORS = {
    genuine: { bg: '#dafbe1', fg: '#116329', edge: '#1a7f37' },
    normal: { bg: '#f6f8fa', fg: '#424a53', edge: '#8c959f' },
    inflated: { bg: '#ffebe9', fg: '#a40e26', edge: '#cf222e' },
    unknown: { bg: '#fff8c5', fg: '#7d4e00', edge: '#bf8700' },
  };

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (reply) => resolve(chrome.runtime.lastError ? null : reply));
      } catch (e) { resolve(null); } // extension was reloaded; the page needs a refresh
    });
  }

  function sparkline(history, width, height) {
    const pts = history.filter((x) => x.p);
    if (pts.length < 2) return '';
    const t0 = pts[0].t, t1 = Date.now();
    const ps = pts.map((x) => x.p);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const X = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (width - 4) + 2;
    const Y = (p) => hi === lo ? height / 2 : height - 3 - ((p - lo) / (hi - lo)) * (height - 6);
    // Step line: a price holds until the next point.
    let d = `M${X(pts[0].t).toFixed(1)} ${Y(pts[0].p).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += `H${X(pts[i].t).toFixed(1)}V${Y(pts[i].p).toFixed(1)}`;
    d += `H${X(t1).toFixed(1)}`;
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="Price history"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
      <div class="range"><span>${formatPrice(lo)}</span><span>${formatPrice(hi)}</span></div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render() {
    if (!current) return;
    const { obs, result } = current;
    const v = result.verdict;
    const c = COLORS[v.verdict] || COLORS.unknown;
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);
    }
    const open = host.dataset.open === '1';
    const others = (result.others || []).filter((o) => o.price < obs.price);
    const keepaNote = result.keepaStatus === 'no-key'
      ? '<p class="note">Add a Keepa API key in settings to get years of Amazon price history.</p>'
      : result.keepaStatus && result.keepaStatus !== 'ok' ? '<p class="note">Could not reach Keepa just now.</p>' : '';
    host.shadowRoot.innerHTML = `
      <style>
        :host { all: initial; }
        .card { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 320px;
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          background: #fff; color: #1f2328; border: 1px solid ${c.edge}; border-radius: 10px;
          box-shadow: 0 4px 16px rgba(0,0,0,.15); overflow: hidden; }
        .head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: ${c.bg}; color: ${c.fg};
          cursor: pointer; border: 0; width: 100%; font: inherit; text-align: left; }
        .label { font-weight: 600; flex: 1; }
        .price { font-weight: 600; }
        .x { background: none; border: 0; color: inherit; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 0 0 4px; }
        .body { padding: 10px 12px; display: ${open ? 'block' : 'none'}; }
        .body p { margin: 0 0 6px; }
        .note { color: #59636e; font-size: 12px; }
        .spark { color: ${c.edge}; margin: 6px 0 2px; }
        .range { display: flex; justify-content: space-between; color: #59636e; font-size: 11px; }
        ul { margin: 4px 0 6px; padding-left: 18px; }
        a { color: #0969da; }
        .watch { margin-top: 6px; padding: 5px 10px; border: 1px solid #d1d9e0; border-radius: 6px; background: #f6f8fa;
          cursor: pointer; font: inherit; color: #1f2328; }
      </style>
      <div class="card" role="region" aria-label="Bargain checker">
        <div class="head" role="button" tabindex="0" aria-expanded="${open}">
          <span class="label">${LABELS[v.verdict]}</span>
          <span class="price">${formatPrice(obs.price)}${obs.was ? ` <s style="font-weight:400">${formatPrice(obs.was)}</s>` : ''}</span>
          <button class="x" title="Hide for this page" aria-label="Hide">×</button>
        </div>
        <div class="body">
          <p>${escapeHtml(v.reason)}</p>
          ${v.notes.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('')}
          <div class="spark">${sparkline(result.history || [], 296, 44)}</div>
          ${others.length ? `<p>Seen cheaper this week:</p><ul>${others.map((o) => `<li><a href="${escapeHtml(o.url)}" target="_blank" rel="noopener">${escapeHtml(o.shop)}</a> ${formatPrice(o.price)}</li>`).join('')}</ul>` : ''}
          ${keepaNote}
          <button class="watch">${result.watched ? 'Stop watching' : 'Watch this product daily'}</button>
        </div>
      </div>`;
    const root = host.shadowRoot;
    const toggle = () => { host.dataset.open = open ? '0' : '1'; render(); };
    root.querySelector('.head').addEventListener('click', toggle);
    root.querySelector('.head').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    root.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); host.remove(); });
    root.querySelector('.watch').addEventListener('click', async () => {
      const r = await send({ type: 'toggleWatch', key: obs.key });
      if (r) { current.result.watched = r.watched; render(); }
    });
  }

  async function check() {
    const obs = extractFromDocument(document, location.href);
    if (!obs) return false;
    const signature = `${obs.key}|${obs.price}|${obs.was}`;
    if (signature === lastSignature) return true;
    lastSignature = signature;
    const result = await send({ type: 'observe', obs });
    if (!result || result.error) return true;
    current = { obs, result };
    render();
    return true;
  }

  // Prices are often drawn by scripts after load, and some shops change product
  // without a full page load, so re-check a few times and when the URL changes.
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    const found = await check();
    if ((found && tries >= 3) || tries >= 10) clearInterval(timer);
  }, 1500);
  check();

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSignature = null;
      const host = document.getElementById(HOST_ID);
      if (host) host.remove();
      current = null;
      setTimeout(check, 1500);
    }
  }, 1000);
})();
