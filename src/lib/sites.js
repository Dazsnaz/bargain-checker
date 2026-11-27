// The shops the extension supports, and how to recognise a product page on each.
// URL patterns and selectors are best guesses from public page structure and
// may need adjusting when a shop changes its site. The generic extractor
// (JSON-LD structured data, then "Was £X" text near the price) does most of
// the work, so a selector going stale should not break a shop completely.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BC = Object.assign(root.BC || {}, api);
})(globalThis, function () {
  const SHOPS = [
    {
      id: 'amazon',
      name: 'Amazon UK',
      hosts: ['amazon.co.uk'],
      // /dp/B0ABC12345, /gp/product/B0ABC12345, /gp/aw/d/B0ABC12345
      productId: /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i,
      priceSelectors: [
        '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
        '#corePrice_feature_div .a-price .a-offscreen',
        '#corePrice_desktop .a-price .a-offscreen',
        '#price_inside_buybox',
        '#priceblock_dealprice',
        '#priceblock_ourprice',
      ],
      wasSelectors: [
        '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen',
        '#corePrice_desktop .a-text-price .a-offscreen',
      ],
      nameSelectors: ['#productTitle'],
    },
    {
      id: 'argos',
      name: 'Argos',
      hosts: ['argos.co.uk'],
      productId: /\/product\/(\d+)/,
      priceSelectors: ['[data-test="product-price-primary"]', 'li[itemprop="price"]'],
      wasSelectors: ['[data-test="product-price-secondary"]'],
    },
    {
      id: 'currys',
      name: 'Currys',
      hosts: ['currys.co.uk'],
      productId: /-(\d{6,9})\.html/,
      priceSelectors: ['.product-price .value', '[data-testid="product-price"]'],
      wasSelectors: ['.was-price', '.price-was'],
    },
    {
      id: 'johnlewis',
      name: 'John Lewis',
      hosts: ['johnlewis.com'],
      productId: /\/p(\d{5,})/,
      priceSelectors: ['[data-testid="product:price"]', '.price--large'],
      wasSelectors: ['[data-testid="product:price:was"]', '.price--previous'],
    },
    {
      id: 'ao',
      name: 'AO',
      hosts: ['ao.com'],
      productId: /\/product\/([a-z0-9-]+?)(?:-\d+)?\.aspx/i,
      priceSelectors: ['[data-testid="product-price"]', '.price-current'],
      wasSelectors: ['.price-was', '[data-testid="was-price"]'],
    },
    {
      id: 'very',
      name: 'Very',
      hosts: ['very.co.uk'],
      productId: /\/(\d{6,})\.prd/,
      priceSelectors: ['[data-testid="product_price_current"]', '.priceNow'],
      wasSelectors: ['[data-testid="product_price_was"]', '.wasPrice'],
    },
    {
      id: 'bq',
      name: 'B&Q',
      hosts: ['diy.com'],
      productId: /\/(\d{6,})_BQ\.prd/i,
      priceSelectors: ['[data-testid="product-price"]', '[data-test-id="product-primary-price"]'],
      wasSelectors: ['[data-testid="product-was-price"]', '[data-test-id="product-was-price"]'],
    },
  ];

  function hostMatches(hostname, host) {
    return hostname === host || hostname.endsWith('.' + host);
  }

  /** Find the shop for a URL string, or null. */
  function shopForUrl(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    return SHOPS.find((s) => s.hosts.some((h) => hostMatches(u.hostname, h))) || null;
  }

  /**
   * A stable key for this product at this shop, e.g. "argos:8349024".
   * Falls back to the URL path when the shop's pattern does not match.
   */
  function productKey(url, shop) {
    shop = shop || shopForUrl(url);
    if (!shop) return null;
    const u = new URL(url);
    const m = (u.pathname + u.search).match(shop.productId);
    if (m) return `${shop.id}:${shop.id === 'amazon' ? m[1].toUpperCase() : m[1]}`;
    return `${shop.id}:path:${u.pathname.replace(/\/+$/, '')}`;
  }

  return { SHOPS, shopForUrl, productKey };
});
