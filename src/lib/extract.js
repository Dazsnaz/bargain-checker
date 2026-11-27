// Reads the product name, barcode, current price and "was" price from a page.
// Two entry points:
//   extractFromDocument(document, url)  - in the content script, with a real DOM
//   extractFromHtml(html, url)          - in the service worker (no DOM), for watch-list checks
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const deps = isNode
    ? Object.assign({}, require('./price.js'), require('./sites.js'))
    : root.BC;
  const api = factory(deps);
  if (isNode) module.exports = api;
  root.BC = Object.assign(root.BC || {}, api);
})(globalThis, function (BC) {
  const { parsePrice, shopForUrl, productKey } = BC;

  // ---------- JSON-LD (schema.org Product) ----------

  function flattenLd(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { node.forEach((n) => flattenLd(n, out)); return out; }
    out.push(node);
    if (node['@graph']) flattenLd(node['@graph'], out);
    if (node.mainEntity) flattenLd(node.mainEntity, out);
    if (node.hasVariant) flattenLd(node.hasVariant, out);
    return out;
  }

  function isType(node, type) {
    const t = node['@type'];
    return Array.isArray(t) ? t.includes(type) : t === type;
  }

  function firstOffer(offers) {
    if (!offers) return null;
    const list = Array.isArray(offers) ? offers : [offers];
    // Prefer an in-stock offer in pounds.
    const usable = list.filter((o) => o && typeof o === 'object');
    return (
      usable.find((o) => (o.priceCurrency || 'GBP') === 'GBP' && !/OutOfStock/i.test(o.availability || '')) ||
      usable[0] || null
    );
  }

  function offerPrice(offer) {
    if (!offer) return null;
    if (offer.priceCurrency && offer.priceCurrency !== 'GBP') return null;
    if (isType(offer, 'AggregateOffer')) return parsePrice(offer.lowPrice ?? offer.price);
    if (offer.price !== undefined) return parsePrice(offer.price);
    const spec = Array.isArray(offer.priceSpecification) ? offer.priceSpecification : [offer.priceSpecification];
    const s = spec.find((x) => x && x.price !== undefined && !/ListPrice|StrikethroughPrice/i.test(x.priceType || ''));
    return s ? parsePrice(s.price) : null;
  }

  function offerListPrice(offer) {
    if (!offer) return null;
    const spec = Array.isArray(offer.priceSpecification) ? offer.priceSpecification : [offer.priceSpecification];
    const s = spec.find((x) => x && /ListPrice|StrikethroughPrice/i.test(x.priceType || ''));
    return s ? parsePrice(s.price) : null;
  }

  /** Parse the text of JSON-LD script blocks into product details. */
  function productFromJsonLd(blockTexts) {
    const nodes = [];
    for (const text of blockTexts) {
      try { flattenLd(JSON.parse(text), nodes); } catch (e) { /* some shops ship invalid JSON; skip */ }
    }
    const product = nodes.find((n) => isType(n, 'Product') && n.offers) || nodes.find((n) => isType(n, 'Product'));
    if (!product) return null;
    const offer = firstOffer(product.offers);
    const gtin = product.gtin13 || product.gtin || product.gtin14 || product.gtin12 || product.gtin8 || (offer && offer.gtin13) || null;
    const brand = product.brand && (typeof product.brand === 'string' ? product.brand : product.brand.name);
    return {
      name: product.name ? String(product.name).trim() : null,
      gtin: gtin ? String(gtin).replace(/\D/g, '') || null : null,
      sku: product.sku ? String(product.sku) : null,
      brand: brand || null,
      price: offerPrice(offer),
      was: offerListPrice(offer),
    };
  }

  // ---------- "Was £X" text ----------

  const WAS_RE = /\b(?:was|rrp|previously|previous price|original price|list price)\b\s*:?\s*£\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
  const SAVE_RE = /\bsave\s*£\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;

  /**
   * Find a "was" price in a block of text. Only accepts one above the current price.
   * Falls back to "Save £X" (was = current + X).
   */
  function wasFromText(text, current) {
    if (!text) return null;
    const m = text.match(WAS_RE);
    if (m) {
      const was = parsePrice(m[1]);
      if (was && (!current || was > current)) return was;
    }
    if (current) {
      const s = text.match(SAVE_RE);
      if (s) {
        const save = parsePrice(s[1]);
        if (save && save < current * 4) return current + save;
      }
    }
    return null;
  }

  // ---------- Service worker: HTML string ----------

  function jsonLdBlocksFromHtml(html) {
    const blocks = [];
    const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) blocks.push(m[1]);
    return blocks;
  }

  function metaContent(html, prop) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
    const m = html.match(re);
    return m ? m[1] : null;
  }

  function extractFromHtml(html, url) {
    const shop = shopForUrl(url);
    if (!shop) return null;
    const ld = productFromJsonLd(jsonLdBlocksFromHtml(html)) || {};
    const price = ld.price || parsePrice(metaContent(html, 'product:price:amount')) || parsePrice(metaContent(html, 'price'));
    if (!price) return null;
    return {
      shop: shop.id,
      key: productKey(url, shop),
      url,
      name: ld.name || null,
      gtin: ld.gtin || null,
      price,
      was: ld.was && ld.was > price ? ld.was : null,
    };
  }

  // ---------- Content script: live DOM ----------

  function textOf(el) {
    if (!el) return '';
    return (el.getAttribute && el.getAttribute('content')) || el.textContent || '';
  }

  function firstPrice(doc, selectors) {
    for (const sel of selectors || []) {
      let el;
      try { el = doc.querySelector(sel); } catch (e) { continue; }
      const p = el && parsePrice(textOf(el));
      if (p) return { price: p, el };
    }
    return null;
  }

  /** Look for a was-price in the few elements around the price on screen. */
  function wasNear(el, current) {
    let node = el;
    for (let i = 0; node && i < 5; i++, node = node.parentElement) {
      const struck = node.querySelectorAll ? node.querySelectorAll('s, del, strike, [style*="line-through"]') : [];
      for (const s of struck) {
        const p = parsePrice(s.textContent);
        if (p && p > current) return p;
      }
      const text = node.innerText || node.textContent || '';
      if (text.length > 600) break; // gone too far up the page
      const w = wasFromText(text, current);
      if (w) return w;
    }
    return null;
  }

  function findPriceElement(doc, price) {
    // Find a small visible element whose text is this price, to anchor the was-price search.
    const candidates = doc.querySelectorAll('[class*="price" i], [data-test*="price" i], [data-testid*="price" i], [itemprop="price"]');
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (t.length < 40 && parsePrice(t) === price) return el;
    }
    return null;
  }

  function extractFromDocument(doc, url) {
    const shop = shopForUrl(url);
    if (!shop) return null;
    const blocks = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent);
    const ld = productFromJsonLd(blocks) || {};

    const fromSelectors = firstPrice(doc, shop.priceSelectors);
    const meta = doc.querySelector('meta[property="product:price:amount"], meta[itemprop="price"], [itemprop="price"][content]');
    const price = (fromSelectors && fromSelectors.price) || ld.price || (meta && parsePrice(meta.getAttribute('content'))) || null;
    if (!price) return null;

    // A product page has a product id in the URL or structured product data.
    const key = productKey(url, shop);
    const looksLikeProduct = !key.includes(':path:') || Object.keys(ld).length > 0;
    if (!looksLikeProduct) return null;

    let was = null;
    const wasSel = firstPrice(doc, shop.wasSelectors);
    if (wasSel && wasSel.price > price) was = wasSel.price;
    if (!was && ld.was && ld.was > price) was = ld.was;
    if (!was) {
      const anchor = (fromSelectors && fromSelectors.el) || findPriceElement(doc, price);
      if (anchor) was = wasNear(anchor, price);
    }

    let name = ld.name;
    if (!name && shop.nameSelectors) {
      const el = doc.querySelector(shop.nameSelectors.join(','));
      name = el ? el.textContent.trim() : null;
    }
    if (!name) {
      const og = doc.querySelector('meta[property="og:title"]');
      name = (og && og.getAttribute('content')) || doc.title || null;
    }

    return { shop: shop.id, key, url, name, gtin: ld.gtin || null, price, was };
  }

  return { productFromJsonLd, wasFromText, jsonLdBlocksFromHtml, extractFromHtml, extractFromDocument };
});
