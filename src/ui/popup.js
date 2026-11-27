const { formatPrice, LABELS } = globalThis.BC;

function send(msg) { return chrome.runtime.sendMessage(msg); }

function item(p) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = p.name || p.key;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${p.shop} · ${formatPrice(p.price)}`;
  const tag = document.createElement('span');
  tag.className = `tag ${p.verdict}`;
  tag.textContent = LABELS[p.verdict];
  li.append(a, meta, tag);
  return li;
}

function fill(el, items, empty) {
  el.replaceChildren();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = empty;
    el.append(li);
    return;
  }
  items.forEach((p) => el.append(item(p)));
}

async function load() {
  const data = await send({ type: 'overview' });
  fill(document.getElementById('watched'), data.products.filter((p) => p.watched),
    'Nothing yet. Open a product and press "Watch this product daily".');
  fill(document.getElementById('recent'), data.products.filter((p) => !p.watched).slice(0, 10),
    'Visit a product on a supported shop to start building its price history.');
  const last = data.lastWatchCheck;
  document.getElementById('last-check').textContent = last
    ? `Last checked ${new Date(last.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`
    : '';
}

document.getElementById('check-now').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Checking…';
  await send({ type: 'checkWatchNow' });
  e.target.disabled = false;
  e.target.textContent = 'Check watched prices now';
  load();
});

load();
