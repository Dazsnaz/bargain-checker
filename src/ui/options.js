function send(msg) { return chrome.runtime.sendMessage(msg); }

const keepa = document.getElementById('keepa');
const saved = document.getElementById('saved');

send({ type: 'getSettings' }).then((s) => { keepa.value = s.keepaKey || ''; });

document.getElementById('save').addEventListener('click', async () => {
  await send({ type: 'saveSettings', settings: { keepaKey: keepa.value.trim() } });
  saved.textContent = 'Saved.';
  setTimeout(() => { saved.textContent = ''; }, 2000);
});

document.getElementById('export').addEventListener('click', async () => {
  const data = await send({ type: 'exportData' });
  if (data.settings) data.settings = Object.assign({}, data.settings, { keepaKey: data.settings.keepaKey ? '(hidden)' : '' });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bargain-checker-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('clear').addEventListener('click', async (e) => {
  const btn = e.target;
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1';
    btn.textContent = 'Press again to delete everything';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Delete all history'; }, 4000);
    return;
  }
  await send({ type: 'clearData' });
  btn.dataset.confirm = '';
  btn.textContent = 'Deleted';
});
