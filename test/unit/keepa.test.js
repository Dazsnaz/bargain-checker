const test = require('node:test');
const assert = require('node:assert/strict');
const { keepaTimeToMs, keepaCsvToPoints, keepaProductToPoints, keepaUrl } = require('../../src/lib/keepa.js');

test('Keepa time is minutes since 2011-01-01 UTC', () => {
  assert.equal(new Date(keepaTimeToMs(0)).toISOString(), '2011-01-01T00:00:00.000Z');
});

test('converts csv pairs and treats -1 as unavailable', () => {
  const pts = keepaCsvToPoints([0, 1999, 60, -1, 120, 1799]);
  assert.deepEqual(pts.map((p) => p.p), [1999, null, 1799]);
  assert.ok(pts.every((p) => p.k === 1));
});

test('falls back to new-offer price when Amazon itself does not sell it', () => {
  const pts = keepaProductToPoints({ csv: [[0, -1], [0, 2500]] });
  assert.deepEqual(pts.map((p) => p.p), [2500]);
});

test('builds a UK request', () => {
  const u = new URL(keepaUrl('KEY', 'B0CHX1W1XY'));
  assert.equal(u.searchParams.get('domain'), '2');
  assert.equal(u.searchParams.get('asin'), 'B0CHX1W1XY');
});
