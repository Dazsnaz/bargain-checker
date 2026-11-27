const test = require('node:test');
const assert = require('node:assert/strict');
const { computeVerdict, dailyPrices, RULES, DAY } = require('../../src/lib/verdict.js');

const NOW = Date.UTC(2026, 10, 27, 12); // 27 Nov 2026
const daysAgo = (n) => NOW - n * DAY;

// One observation per day from `from` days ago to `to` days ago, at price(dayOffset).
function daily(from, to, price) {
  const pts = [];
  for (let d = from; d >= to; d--) pts.push({ t: daysAgo(d), p: typeof price === 'function' ? price(d) : price });
  return pts;
}

test('genuine deal: well below the usual price', () => {
  const v = computeVerdict({ points: daily(200, 1, 7900), current: 5900, was: 7900, now: NOW });
  assert.equal(v.verdict, 'genuine');
  assert.equal(v.typical, 7900);
  assert.equal(v.wasInflated, false);
  assert.match(v.reason, /25% below the usual price/);
});

test('normal price: the "sale" price is what it usually costs', () => {
  const v = computeVerdict({ points: daily(200, 1, 4900), current: 4900, was: 5500, now: NOW });
  // was £55 never charged -> inflated was-price
  assert.equal(v.verdict, 'inflated');
  assert.equal(v.daysAtWas, 0);

  const plain = computeVerdict({ points: daily(200, 1, 4900), current: 4800, now: NOW });
  assert.equal(plain.verdict, 'normal');
  assert.match(plain.reason, /only 2% below usual/);
});

test('inflated: price pushed up just before the sale is ignored', () => {
  // Usually £49; raised to £79 for the last 10 days, now "£59, was £79".
  const pts = daily(200, 11, 4900).concat(daily(10, 1, 7900));
  const v = computeVerdict({ points: pts, current: 5900, was: 7900, now: NOW });
  assert.equal(v.typical, 4900);
  assert.equal(v.verdict, 'inflated');
  assert.ok(v.daysAtWas < RULES.MIN_DAYS_AT_WAS);
  assert.match(v.reason, /charged on 10 of the last/);
});

test('genuine deal still warns when the was-price is exaggerated', () => {
  const v = computeVerdict({ points: daily(200, 1, 10000), current: 7000, was: 15000, now: NOW });
  assert.equal(v.verdict, 'genuine');
  assert.equal(v.wasInflated, true);
  assert.ok(v.notes.some((n) => /"was" price/.test(n)));
});

test('notes when it has been cheaper before', () => {
  const pts = daily(200, 1, (d) => (d > 100 && d < 120 ? 6000 : 10000));
  const v = computeVerdict({ points: pts, current: 8500, now: NOW });
  assert.equal(v.verdict, 'genuine');
  assert.equal(v.low, 6000);
  assert.ok(v.notes.some((n) => /It has been cheaper: £60/.test(n)));
});

test('not enough history', () => {
  const v = computeVerdict({ points: daily(5, 1, 4900), current: 3900, was: 5900, now: NOW });
  assert.equal(v.verdict, 'unknown');
  assert.match(v.reason, /Only 5 days/);
  assert.equal(computeVerdict({ points: [], current: 100, now: NOW }).verdict, 'unknown');
});

test('our own sparse observations only carry for 14 days', () => {
  const days = dailyPrices([{ t: daysAgo(60), p: 1000 }], NOW, RULES);
  assert.equal(days.size, RULES.MAX_CARRY_DAYS);
});

test('Keepa change-based points carry until the next change; null ends a price', () => {
  const pts = [{ t: daysAgo(150), p: 2000, k: 1 }, { t: daysAgo(20), p: null, k: 1 }, { t: daysAgo(10), p: 2500, k: 1 }];
  const days = dailyPrices(pts, NOW, RULES);
  assert.equal(days.size, 130 + 11);
  const v = computeVerdict({ points: pts, current: 1500, now: NOW });
  assert.equal(v.typical, 2000);
  assert.equal(v.verdict, 'genuine');
});
