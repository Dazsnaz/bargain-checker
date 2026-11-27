// Price helpers. Prices are kept as whole pence (integers) everywhere.
// Loaded as a classic script (content script, service worker) and by Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BC = Object.assign(root.BC || {}, api);
})(globalThis, function () {
  /**
   * Turn "£1,299.99", "1299.99", 1299.99 or "£12" into pence (129999).
   * Returns null when no sensible price is found.
   */
  function parsePrice(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') {
      return Number.isFinite(input) && input > 0 ? Math.round(input * 100) : null;
    }
    const text = String(input).replace(/ /g, ' ');
    const m = text.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
    if (!m) return null;
    const pounds = parseInt(m[1].replace(/,/g, ''), 10);
    const pence = m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0;
    const total = pounds * 100 + pence;
    return total > 0 ? total : null;
  }

  /** 129999 -> "£1,299.99"; whole pounds drop the ".00". */
  function formatPrice(pence) {
    if (pence === null || pence === undefined) return '–';
    const pounds = Math.floor(pence / 100);
    const rest = pence % 100;
    const p = pounds.toLocaleString('en-GB');
    return rest === 0 ? `£${p}` : `£${p}.${String(rest).padStart(2, '0')}`;
  }

  return { parsePrice, formatPrice };
});
