/*
 * JobCalc — pure calculation engine (no DOM). All money is handled in integer
 * cents; percentages are plain numbers (2.9 means 2.9%). Every function is
 * defensive: blanks, junk text, NaN and Infinity all become 0, costs can never
 * go negative, and ratios that are undefined (divide by zero) return null.
 *
 * Definitions (also documented in guide.html):
 *   direct costs   = materials + crew labor + shipping/travel + equipment + permits + subcontractors + other
 *   card fees      = price x fee% + fixed fee x number of payments (0 when price is 0)
 *   overhead       = price x overhead%   OR a flat amount
 *   total costs    = direct costs + card fees + overhead
 *   gross profit   = price - direct costs
 *   profit before tax = price - total costs
 *   tax set-aside  = profit before tax x tax%  (only when profit is positive)
 *   net profit     = profit before tax - tax set-aside
 *   net margin     = net profit / price
 *   markup         = (price - total costs) / total costs
 *   profit / hour  = net profit / hours (crew + owner hours, or owner hours only)
 *   billed rate    = price / total hours
 *   break-even     = lowest price where profit before tax >= 0
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JobCalc = factory();
})(this, function () {
  'use strict';

  var NUM_RE = /^-?(\d+\.?\d*|\.\d+)$/;

  function clean(v) { return String(v).replace(/[$,\s%]/g, ''); }

  /** Parse any user value to a finite number. Blank/invalid -> 0. */
  function num(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    var s = clean(v);
    if (!NUM_RE.test(s)) return 0;
    var n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  /** True when the raw input is blank or a parseable number (used for inline validation). */
  function isValidInput(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'number') return Number.isFinite(v);
    var s = clean(v);
    if (s === '') return true;
    return NUM_RE.test(s) && Number.isFinite(Number(s));
  }

  function nonNeg(v) { var n = num(v); return n > 0 ? n : 0; }

  /** Dollars -> integer cents, immune to 1.005*100 = 100.4999 style float error. */
  function toCents(v) { return Math.round(Number((nonNeg(v) * 100).toFixed(6))); }

  /** Signed version for things like a discount that are still never negative in practice. */
  function pct(v) { var n = nonNeg(v); return n > 100 ? 100 : n; }

  function round(x) { return Math.round(Number(x.toFixed(6))); }

  function ratio(a, b) { return b > 0 ? a / b : null; }

  var PRESETS = {
    stripe: { label: 'Stripe', pct: 2.9, fixed: 0.30 },
    square: { label: 'Square', pct: 2.6, fixed: 0.15 },
    none: { label: 'No card fee (cash/check)', pct: 0, fixed: 0 }
  };

  var OTHER_CATEGORIES = {
    equipment: 'Equipment / rental',
    permits: 'Permits & fees',
    subcontractor: 'Subcontractors',
    other: 'Other'
  };

  function blankJob() {
    return {
      id: null, name: '', client: '', notes: '',
      customer: { name: '', email: '', phone: '', address: '' }, jobAddress: '',
      price: '',
      materialsMode: 'itemized', materials: [], materialsTotal: '',
      crew: [], ownerHours: '',
      shipping: '', miles: '', mileRate: '0.70',
      fee: { preset: 'stripe', pct: '2.9', fixed: '0.30', payments: '1' },
      otherCosts: [],
      overhead: { mode: 'none', value: '' },
      taxPct: '',
      hoursBasis: 'all'
    };
  }

  /** Cost lines that do not depend on the price. */
  function directCosts(job) {
    job = job || {};
    var materialsLines = [];
    var materials = 0;
    if (job.materialsMode === 'total') {
      materials = toCents(job.materialsTotal);
    } else {
      (job.materials || []).forEach(function (m) {
        var c = round(nonNeg(m.qty) * toCents(m.unitCost));
        materialsLines.push({ name: m.name || 'Material', qty: nonNeg(m.qty), unitCents: toCents(m.unitCost), cents: c });
        materials += c;
      });
    }
    var crewLines = [];
    var labor = 0, crewHours = 0;
    (job.crew || []).forEach(function (p) {
      var h = nonNeg(p.hours);
      var c = round(toCents(p.wage) * h);
      crewLines.push({ name: p.name || 'Crew member', wageCents: toCents(p.wage), hours: h, cents: c });
      labor += c; crewHours += h;
    });
    var shippingFlat = toCents(job.shipping);
    var mileage = round(nonNeg(job.miles) * toCents(job.mileRate));
    var other = { equipment: 0, permits: 0, subcontractor: 0, other: 0 };
    var otherLines = [];
    (job.otherCosts || []).forEach(function (o) {
      var cat = OTHER_CATEGORIES[o.category] ? o.category : 'other';
      var c = toCents(o.amount);
      other[cat] += c;
      otherLines.push({ name: o.name || OTHER_CATEGORIES[cat], category: cat, cents: c });
    });
    var travel = shippingFlat + mileage;
    var total = materials + labor + travel + other.equipment + other.permits + other.subcontractor + other.other;
    return {
      materials: materials, materialsLines: materialsLines,
      labor: labor, crewLines: crewLines, crewHours: crewHours,
      shippingFlat: shippingFlat, mileage: mileage, travel: travel,
      equipment: other.equipment, permits: other.permits, subcontractor: other.subcontractor, other: other.other,
      otherLines: otherLines,
      total: total
    };
  }

  function feeSettings(job) {
    var f = (job && job.fee) || {};
    if (f.preset === 'none') return { pct: 0, fixedCents: 0, payments: 0 };
    var payments = Math.floor(nonNeg(f.payments === undefined || f.payments === '' ? 1 : f.payments));
    return { pct: pct(f.pct), fixedCents: toCents(f.fixed), payments: payments };
  }

  function feeFor(priceCents, fs) {
    if (priceCents <= 0) return 0;
    return round(priceCents * fs.pct / 100) + fs.fixedCents * fs.payments;
  }

  function overheadSettings(job) {
    var o = (job && job.overhead) || {};
    if (o.mode === 'percent') return { pct: pct(o.value), flatCents: 0 };
    if (o.mode === 'flat') return { pct: 0, flatCents: toCents(o.value) };
    return { pct: 0, flatCents: 0 };
  }

  /**
   * Full calculation. opts.priceCents overrides the job's price (used by reverse mode).
   */
  function calculate(job, opts) {
    job = job || {};
    opts = opts || {};
    var price = opts.priceCents !== undefined ? Math.max(0, Math.round(opts.priceCents)) : toCents(job.price);
    var d = directCosts(job);
    var fs = feeSettings(job);
    var os = overheadSettings(job);
    var fees = feeFor(price, fs);
    var overhead = os.flatCents + round(price * os.pct / 100);
    var totalCosts = d.total + fees + overhead;
    var gross = price - d.total;
    var pbt = price - totalCosts;
    var taxPct = pct(job.taxPct);
    var tax = pbt > 0 ? round(pbt * taxPct / 100) : 0;
    var net = pbt - tax;
    var ownerHours = nonNeg(job.ownerHours);
    var totalHours = d.crewHours + ownerHours;
    var basis = job.hoursBasis === 'owner' ? 'owner' : 'all';
    var basisHours = basis === 'owner' ? ownerHours : totalHours;
    var be = opts._noBE ? undefined : breakEven(job);

    var warnings = [];
    if (price === 0) warnings.push({ code: 'no-price', text: 'Enter the price you charge to see your profit.' });
    if (basisHours === 0) warnings.push({ code: 'no-hours', text: basis === 'owner' ? 'Enter your own hours to see profit per hour.' : 'Enter crew or owner hours to see profit per hour.' });
    if (price > 0 && net < 0) warnings.push({ code: 'loss', text: 'This job loses money: costs are higher than the price.' });

    return {
      priceCents: price,
      direct: d,
      feesCents: fees, feePct: fs.pct, feeFixedCents: fs.fixedCents, feePayments: fs.payments,
      overheadCents: overhead,
      totalCostsCents: totalCosts,
      grossProfitCents: gross,
      profitBeforeTaxCents: pbt,
      taxPct: taxPct,
      taxSetAsideCents: tax,
      netProfitCents: net,
      netMargin: ratio(net, price),
      grossMargin: ratio(gross, price),
      markup: ratio(price - totalCosts, totalCosts),
      ownerHours: ownerHours, crewHours: d.crewHours, totalHours: totalHours,
      hoursBasis: basis, basisHours: basisHours,
      profitPerHourCents: basisHours > 0 ? Math.round(net / basisHours) : null,
      profitPerHourAllCents: totalHours > 0 ? Math.round(net / totalHours) : null,
      profitPerHourOwnerCents: ownerHours > 0 ? Math.round(net / ownerHours) : null,
      billedRateCents: totalHours > 0 ? Math.round(price / totalHours) : null,
      breakEvenCents: be,
      isLoss: price > 0 && net < 0,
      warnings: warnings
    };
  }

  /** Walk an estimate to the exact lowest cent that satisfies ok(p). ok must be monotonic. */
  function settle(estimate, ok) {
    var p = Math.max(0, Math.ceil(estimate));
    var guard = 0;
    while (!ok(p) && guard++ < 100000) p++;
    guard = 0;
    while (p > 0 && ok(p - 1) && guard++ < 100000) p--;
    return p;
  }

  function priceInputs(job) {
    var d = directCosts(job), fs = feeSettings(job), os = overheadSettings(job);
    var k = 1 - fs.pct / 100 - os.pct / 100;           // share of each price dollar left after % costs
    var C = d.total + fs.fixedCents * fs.payments + os.flatCents; // fixed costs
    return { k: k, C: C };
  }

  /** Lowest price (cents) where profit before tax is >= 0. null when impossible (fees+overhead >= 100%). */
  function breakEven(job) {
    var pi = priceInputs(job);
    if (pi.C === 0) return 0;
    if (pi.k <= 0) return null;
    return settle(pi.C / pi.k, function (p) { return calculate(job, { priceCents: p, _noBE: true }).profitBeforeTaxCents >= 0; });
  }

  /**
   * Reverse mode. target = { type: 'margin'|'hourly'|'profit', value, roundTo (dollars, optional) }
   * Returns { ok, priceCents, reason, result }.
   */
  function priceForTarget(job, target) {
    target = target || {};
    var pi = priceInputs(job);
    var t = pct(job.taxPct) / 100;
    var type = target.type || 'margin';
    var value = num(target.value);
    if (value < 0) return { ok: false, reason: 'Enter a target of zero or more.' };
    if (pi.k <= 0) return { ok: false, reason: 'Card fees plus overhead are 100% or more of the price, so no price can be profitable. Lower those percentages.' };
    var estimate, ok;
    if (type === 'margin') {
      var m = value / 100;
      var maxM = (1 - t) * pi.k;
      if (m >= maxM) {
        return { ok: false, reason: 'A ' + value + '% margin is not reachable: after card fees, overhead and tax set-aside the most any price can keep is ' + (Math.floor(maxM * 1000) / 10).toFixed(1) + '%.' };
      }
      estimate = m === 0 ? pi.C / pi.k : (1 - t) * pi.C / ((1 - t) * pi.k - m);
      ok = function (p) { var r = calculate(job, { priceCents: p, _noBE: true }); return p > 0 ? r.netProfitCents >= m * p - 1e-9 && r.profitBeforeTaxCents >= 0 : pi.C === 0; };
    } else {
      var targetNet;
      if (type === 'hourly') {
        var h = job.hoursBasis === 'owner' ? nonNeg(job.ownerHours) : directCosts(job).crewHours + nonNeg(job.ownerHours);
        if (h === 0) return { ok: false, reason: job.hoursBasis === 'owner' ? 'Enter your own hours first — profit per hour needs hours.' : 'Enter crew or owner hours first — profit per hour needs hours.' };
        targetNet = Math.round(toCents(value) * h);
      } else {
        targetNet = toCents(value);
      }
      if (t >= 1 && targetNet > 0) return { ok: false, reason: 'A 100% tax set-aside leaves no profit. Lower the tax set-aside.' };
      estimate = (targetNet / (1 - t) + pi.C) / pi.k;
      ok = function (p) { var r = calculate(job, { priceCents: p, _noBE: true }); return r.netProfitCents >= targetNet && r.profitBeforeTaxCents >= 0; };
    }
    var p = settle(estimate, ok);
    var step = toCents(target.roundTo);
    if (step > 0) p = Math.ceil(p / step) * step;
    return { ok: true, priceCents: p, result: calculate(job, { priceCents: p }) };
  }

  // ---------- formatting ----------
  var fmtCache = {};
  function money(cents, opts) {
    opts = opts || {};
    if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
    var locale = opts.locale || 'en-US', currency = opts.currency || 'USD';
    var key = locale + currency;
    if (!fmtCache[key]) fmtCache[key] = new Intl.NumberFormat(locale, { style: 'currency', currency: currency });
    var s = fmtCache[key].format(Math.abs(cents) / 100);
    return cents < 0 ? '−' + s : s;
  }
  function percent(r, digits) {
    if (r === null || r === undefined || !Number.isFinite(r)) return '—';
    var s = (Math.abs(r) * 100).toFixed(digits === undefined ? 1 : digits) + '%';
    return r < 0 ? '−' + s : s;
  }
  function hours(h) {
    var n = Math.round(h * 100) / 100;
    return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')) + (n === 1 ? ' hr' : ' hrs');
  }

  return {
    num: num, isValidInput: isValidInput, toCents: toCents, pct: pct,
    PRESETS: PRESETS, OTHER_CATEGORIES: OTHER_CATEGORIES,
    blankJob: blankJob, directCosts: directCosts, calculate: calculate,
    breakEven: breakEven, priceForTarget: priceForTarget, feeFor: feeFor,
    money: money, percent: percent, hours: hours
  };
});
