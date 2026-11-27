const test = require('node:test');
const assert = require('node:assert/strict');
const { shopForUrl, productKey } = require('../../src/lib/sites.js');

test('recognises each supported shop', () => {
  const cases = {
    'https://www.amazon.co.uk/Some-Thing/dp/B0CHX1W1XY/ref=sr_1_1': 'amazon:B0CHX1W1XY',
    'https://www.amazon.co.uk/gp/product/b0chx1w1xy?th=1': 'amazon:B0CHX1W1XY',
    'https://www.argos.co.uk/product/8349024?clickSR=slp': 'argos:8349024',
    'https://www.currys.co.uk/products/samsung-55-tv-10251234.html': 'currys:10251234',
    'https://www.johnlewis.com/dyson-v15/p111222333': 'johnlewis:111222333',
    'https://ao.com/product/wgg04409gb-bosch-washing-machine-white-12345.aspx': 'ao:wgg04409gb-bosch-washing-machine-white',
    'https://www.very.co.uk/apple-airpods/1601234567.prd': 'very:1601234567',
    'https://www.diy.com/departments/drill/1234567_BQ.prd': 'bq:1234567',
  };
  for (const [url, key] of Object.entries(cases)) assert.equal(productKey(url), key, url);
});

test('ignores other sites and falls back to the path for unknown product URLs', () => {
  assert.equal(shopForUrl('https://www.example.com/dp/B0CHX1W1XY'), null);
  assert.equal(shopForUrl('https://notamazon.co.uk/'), null);
  assert.equal(productKey('https://www.argos.co.uk/browse/tv/'), 'argos:path:/browse/tv');
});
