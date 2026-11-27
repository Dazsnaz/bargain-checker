// Decides whether today's price is a genuine deal, using the price history.
//
// History is a list of points { t: ms timestamp, p: pence or null, k?: 1 }.
//   p === null means "not available" (out of stock); it ends the previous price.
//   k === 1 marks change-based data (from Keepa): the price holds until the next
//   point, however far away. Our own observations only hold for MAX_CARRY_DAYS,
//   because we cannot know what happened while nobody was looking.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const deps = isNode ? require('./price.js') : root.BC;
  const api = factory(deps);
  if (isNode) module.exports = api;
  root.BC = Object.assign(root.BC || {}, api);
})(globalThis, function (BC) {
  const { formatPrice } = BC;
  const DAY = 24 * 60 * 60 * 1000;

  const RULES = {
    TYPICAL_WINDOW_DAYS: 90,   // "usual price" = median over this many days...
    RECENT_SKIP_DAYS: 14,      // ...ending this many days ago (pre-sale price rises often happen here)
    LOW_WINDOW_DAYS: 180,      // "lowest recent price" window
    MIN_TYPICAL_DAYS: 21,      // need at least this many days of data in the typical window
    MIN_WAS_CHECK_DAYS: 30,    // need this many days of data before calling a was-price inflated
    MIN_DAYS_AT_WAS: 28,       // a genuine was-price was charged on at least this many of the last 180 days
    GENUINE_BELOW_TYPICAL: 0.90, // genuine deal = at least 10% under the usual price
    NEAR_LOW: 1.02,            // within 2% of the recent low counts as "at the low"
    MAX_CARRY_DAYS: 14,        // how long one of our own observations is assumed to hold
  };

  const VERDICTS = {
    GENUINE: 'genuine',
    NORMAL: 'normal',
    INFLATED: 'inflated',
    UNKNOWN: 'unknown',
  };

  function dayIndex(t) { return Math.floor(t / DAY); }

  /**
   * Turn sparse points into a map of day -> price (pence) for days with known prices.
   * The last price seen on a day wins.
   */
  function dailyPrices(points, now, rules) {
    const sorted = points.filter((x) => x && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
    const days = new Map();
    const today = dayIndex(now);
    for (let i = 0; i < sorted.length; i++) {
      const pt = sorted[i];
      if (pt.p === null || pt.p === undefined) continue;
      const start = dayIndex(pt.t);
      const next = sorted[i + 1];
      let end = next ? dayIndex(next.t) - 1 : today;
      if (next && dayIndex(next.t) === start) { days.set(start, pt.p); continue; } // superseded same day
      if (!pt.k) end = Math.min(end, start + rules.MAX_CARRY_DAYS - 1);
      end = Math.min(end, today);
      for (let d = start; d <= end; d++) days.set(d, pt.p);
    }
    return days;
  }

  function median(values) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  function shortDate(day) {
    return new Date(day * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  /**
   * @param {object} input
   * @param {Array}  input.points  price history (see top of file)
   * @param {number} input.current today's price in pence
   * @param {number} [input.was]   the shop's claimed "was" price in pence
   * @param {number} [input.now]   timestamp, defaults to Date.now()
   */
  function computeVerdict(input) {
    const rules = Object.assign({}, RULES, input.rules || {});
    const now = input.now || Date.now();
    const current = input.current;
    const was = input.was && input.was > current ? input.was : null;
    const days = dailyPrices(input.points || [], now, rules);
    const today = dayIndex(now);

    const typicalFrom = today - rules.RECENT_SKIP_DAYS - rules.TYPICAL_WINDOW_DAYS;
    const typicalTo = today - rules.RECENT_SKIP_DAYS - 1;
    const typicalValues = [];
    for (let d = typicalFrom; d <= typicalTo; d++) if (days.has(d)) typicalValues.push(days.get(d));
    const typical = median(typicalValues);

    let low = null, lowDay = null, covered180 = 0, daysAtWas = 0;
    for (let d = today - rules.LOW_WINDOW_DAYS; d < today; d++) {
      if (!days.has(d)) continue;
      const p = days.get(d);
      covered180++;
      if (low === null || p < low) { low = p; lowDay = d; }
      if (was && p >= was * 0.99) daysAtWas++;
    }

    const result = {
      verdict: VERDICTS.UNKNOWN,
      current,
      was,
      typical,
      typicalDays: typicalValues.length,
      low,
      lowDate: lowDay !== null ? shortDate(lowDay) : null,
      coveredDays: covered180,
      daysAtWas: was ? daysAtWas : null,
      wasInflated: false,
      reason: '',
      notes: [],
    };

    const wasChecked = was && covered180 >= rules.MIN_WAS_CHECK_DAYS;
    if (wasChecked && daysAtWas < rules.MIN_DAYS_AT_WAS) result.wasInflated = true;

    if (typical === null || typicalValues.length < rules.MIN_TYPICAL_DAYS) {
      result.verdict = result.wasInflated ? VERDICTS.INFLATED : VERDICTS.UNKNOWN;
      result.reason = covered180
        ? `Only ${covered180} day${covered180 === 1 ? '' : 's'} of price history so far.`
        : 'No price history yet. It will build up as you and the watch list see this product.';
      if (result.wasInflated) result.reason = wasReason(result) + ' ' + result.reason;
      return result;
    }

    const usual = `Usually ${formatPrice(typical)}`;
    const lowText = low !== null && low < typical ? `, lowest ${formatPrice(low)} (${result.lowDate})` : '';

    if (current <= typical * rules.GENUINE_BELOW_TYPICAL) {
      result.verdict = VERDICTS.GENUINE;
      const pct = Math.round((1 - current / typical) * 100);
      const atLow = low === null || current <= low * rules.NEAR_LOW;
      result.reason = `${pct}% below the usual price. ${usual}${lowText}.`;
      if (!atLow) result.notes.push(`It has been cheaper: ${formatPrice(low)} on ${result.lowDate}.`);
      if (result.wasInflated) result.notes.push(wasReason(result));
    } else if (result.wasInflated) {
      result.verdict = VERDICTS.INFLATED;
      result.reason = `${wasReason(result)} ${usual}${lowText}.`;
    } else {
      result.verdict = VERDICTS.NORMAL;
      const diff = current - typical;
      const vs = diff > 0 ? `${formatPrice(diff)} more than usual` : diff < 0 ? `only ${Math.round((1 - current / typical) * 100)}% below usual` : 'the usual price';
      result.reason = `This is ${vs}. ${usual}${lowText}.`;
    }
    return result;
  }

  function wasReason(r) {
    return `The "was" price of ${formatPrice(r.was)} was charged on ${r.daysAtWas} of the last ${r.coveredDays} days we have data for.`;
  }

  const LABELS = {
    genuine: 'Genuine deal',
    normal: 'Normal price',
    inflated: 'Inflated "was" price',
    unknown: 'Not enough history',
  };

  return { computeVerdict, dailyPrices, RULES, VERDICTS, LABELS, DAY };
});
