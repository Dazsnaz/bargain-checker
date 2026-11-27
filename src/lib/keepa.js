// Amazon UK price history from the Keepa API (https://keepa.com/#!api).
// Needs the user's own Keepa API key (a paid Keepa plan); without one, Amazon
// products just use our own recorded history like every other shop.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BC = Object.assign(root.BC || {}, api);
})(globalThis, function () {
  const KEEPA_DOMAIN_UK = 2;
  const KEEPA_EPOCH_MINUTES = 21564000; // Keepa time = minutes since 2011-01-01 UTC

  function keepaTimeToMs(keepaMinutes) {
    return (keepaMinutes + KEEPA_EPOCH_MINUTES) * 60000;
  }

  /**
   * Keepa's csv arrays are [time, price, time, price, ...]; price -1 = no offer.
   * csv[0] = sold by Amazon, csv[1] = cheapest new from any seller.
   * Prices are in the marketplace's smallest unit (pence for amazon.co.uk).
   * Returns history points { t, p, k: 1 } (k marks change-based data).
   */
  function keepaCsvToPoints(csv) {
    const points = [];
    if (!Array.isArray(csv)) return points;
    for (let i = 0; i + 1 < csv.length; i += 2) {
      const price = csv[i + 1];
      points.push({ t: keepaTimeToMs(csv[i]), p: price > 0 ? price : null, k: 1 });
    }
    return points;
  }

  /** Pick the best history from a Keepa product object: Amazon's own price, else new. */
  function keepaProductToPoints(product) {
    if (!product || !product.csv) return [];
    const amazon = keepaCsvToPoints(product.csv[0]);
    if (amazon.some((x) => x.p !== null)) return amazon;
    return keepaCsvToPoints(product.csv[1]);
  }

  function keepaUrl(key, asin) {
    const q = new URLSearchParams({ key, domain: String(KEEPA_DOMAIN_UK), asin, days: '365' });
    return `https://api.keepa.com/product?${q}`;
  }

  return { keepaTimeToMs, keepaCsvToPoints, keepaProductToPoints, keepaUrl };
});
