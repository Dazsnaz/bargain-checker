const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrice, formatPrice } = require('../../src/lib/price.js');

test('parsePrice reads common UK price formats', () => {
  assert.equal(parsePrice('£1,299.99'), 129999);
  assert.equal(parsePrice('£12'), 1200);
  assert.equal(parsePrice('Now £49.5'), 4950);
  assert.equal(parsePrice('1299.99'), 129999);
  assert.equal(parsePrice(19.99), 1999);
  assert.equal(parsePrice('£ 899.00'), 89900);
  assert.equal(parsePrice('free'), null);
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(0), null);
});

test('formatPrice drops .00 and adds thousands commas', () => {
  assert.equal(formatPrice(129999), '£1,299.99');
  assert.equal(formatPrice(7900), '£79');
  assert.equal(formatPrice(5), '£0.05');
  assert.equal(formatPrice(null), '–');
});
