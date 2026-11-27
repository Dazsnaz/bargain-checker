const test = require('node:test');
const assert = require('node:assert/strict');
const { productFromJsonLd, wasFromText, extractFromHtml } = require('../../src/lib/extract.js');

test('reads a schema.org Product with an Offer', () => {
  const p = productFromJsonLd([JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product', name: 'Cordless Drill', gtin13: '5059340123456', brand: { name: 'Erbauer' },
    offers: { '@type': 'Offer', price: '59.00', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' },
  })]);
  assert.equal(p.name, 'Cordless Drill');
  assert.equal(p.gtin, '5059340123456');
  assert.equal(p.price, 5900);
  assert.equal(p.brand, 'Erbauer');
});

test('handles @graph, arrays of offers, list price and bad JSON', () => {
  const p = productFromJsonLd(['{not json', JSON.stringify({ '@graph': [
    { '@type': 'WebPage' },
    { '@type': ['Product'], name: 'TV', offers: [
      { price: 499, priceCurrency: 'GBP', availability: 'OutOfStock' },
      { priceCurrency: 'GBP', priceSpecification: [{ price: 449 }, { price: 599, priceType: 'https://schema.org/StrikethroughPrice' }] },
    ] },
  ] })]);
  assert.equal(p.price, 44900);
  assert.equal(p.was, 59900);
});

test('ignores non-GBP offers', () => {
  const p = productFromJsonLd([JSON.stringify({ '@type': 'Product', name: 'X', offers: { price: 10, priceCurrency: 'EUR' } })]);
  assert.equal(p.price, null);
});

test('finds "was" prices in text', () => {
  assert.equal(wasFromText('Now £59.99 Was £79.99', 5999), 7999);
  assert.equal(wasFromText('RRP: £1,099', 89900), 109900);
  assert.equal(wasFromText('£59 Save £20', 5900), 7900);
  assert.equal(wasFromText('Was £40', 5900), null); // lower than current: not a was-price
  assert.equal(wasFromText('Free delivery', 5900), null);
});

test('extracts from raw HTML for the daily watch-list check', () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Kettle', gtin13: '123', offers: { price: '29.99', priceCurrency: 'GBP' } })}</script></head></html>`;
  const o = extractFromHtml(html, 'https://www.argos.co.uk/product/1234567');
  assert.deepEqual(
    { key: o.key, price: o.price, name: o.name, gtin: o.gtin },
    { key: 'argos:1234567', price: 2999, name: 'Kettle', gtin: '123' },
  );
  assert.equal(extractFromHtml(html, 'https://example.com/x'), null);
});
