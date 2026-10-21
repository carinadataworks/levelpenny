/* Unit tests: node --test tests/  (Node 18+). Every expected number below was worked out by hand. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
const D = require('../js/docs.js');
const ST = require('../js/store.js');
const CSV = require('../js/csv.js');
const T = require('../js/templates.js');
const CFG = require('../js/config.js');

const deck = () => JSON.parse(JSON.stringify(T.find(t => t.id === 'deck-repair').job));
function noBadNumbers(obj, path = 'result') {
  if (typeof obj === 'number') assert.ok(Number.isFinite(obj), `${path} is ${obj}`);
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) noBadNumbers(v, `${path}.${k}`);
}

// ---------------- parsing & money safety ----------------
test('num(): blanks, junk, currency symbols and commas', () => {
  assert.equal(C.num(''), 0);
  assert.equal(C.num(null), 0);
  assert.equal(C.num(undefined), 0);
  assert.equal(C.num('abc'), 0);
  assert.equal(C.num('1,250.50'), 1250.5);
  assert.equal(C.num('$99'), 99);
  assert.equal(C.num(' 12 '), 12);
  assert.equal(C.num('.5'), 0.5);
  assert.equal(C.num('1e400'), 0);
  assert.equal(C.num(NaN), 0);
  assert.equal(C.num(Infinity), 0);
  assert.equal(C.num('-5'), -5);
});
test('isValidInput(): flags junk but accepts blanks and formatted numbers', () => {
  for (const ok of ['', '0', '12', '12.5', '$1,200.00', '.75', '7%']) assert.equal(C.isValidInput(ok), true, ok);
  for (const bad of ['abc', '12..5', '1e5', '--3', 'NaN', 'Infinity']) assert.equal(C.isValidInput(bad), false, bad);
});
test('toCents(): float-safe and never negative', () => {
  assert.equal(C.toCents('19.99'), 1999);
  assert.equal(C.toCents(1.005), 101);       // naive Math.round(1.005*100) gives 100
  assert.equal(C.toCents('0.1'), 10);
  assert.equal(C.toCents(-20), 0);
  assert.equal(C.toCents('junk'), 0);
  assert.equal(C.toCents('1,234.567'), 123457);
});
test('line math stays in cents: 3 × $0.10 = $0.30 exactly, 1.5 × $3.33 = $5.00', () => {
  const r = C.calculate({ price: 10, materials: [{ qty: 3, unitCost: '0.10' }, { qty: 1.5, unitCost: '3.33' }], fee: { preset: 'none' } });
  assert.equal(r.direct.materialsLines[0].cents, 30);
  assert.equal(r.direct.materialsLines[1].cents, 500); // 499.5 rounds half up
  assert.equal(r.direct.materials, 530);
});

// ---------------- core calculation: hand-checked scenarios ----------------
test('Scenario A — deck repair template, every output hand-checked', () => {
  const r = C.calculate(deck());
  // materials 40×14.98 + 6×22.47 + 3×42.97 + 68.50 + 3×46 = 599.20+134.82+128.91+68.50+138.00
  assert.equal(r.direct.materials, 106943);
  assert.equal(r.direct.labor, 83200);          // 16×32 + 16×20
  assert.equal(r.direct.mileage, 5880);         // 84 × 0.70
  assert.equal(r.direct.travel, 13380);         // + 75 delivery
  assert.equal(r.direct.equipment + r.direct.permits + r.direct.other, 34500);
  assert.equal(r.direct.total, 238023);
  assert.equal(r.feesCents, 12640);             // 4850×2.6% = 126.10 + 2×0.15
  assert.equal(r.overheadCents, 48500);         // 10% of price
  assert.equal(r.totalCostsCents, 299163);
  assert.equal(r.grossProfitCents, 246977);
  assert.equal(r.profitBeforeTaxCents, 185837);
  assert.equal(r.taxSetAsideCents, 46459);      // 25% of 1858.37 = 464.5925
  assert.equal(r.netProfitCents, 139378);
  assert.equal(r.totalHours, 42);
  assert.equal(r.profitPerHourCents, 3319);     // 1393.78 / 42 = 33.185
  assert.equal(r.profitPerHourOwnerCents, 13938);
  assert.equal(r.billedRateCents, 11548);       // 4850 / 42
  assert.ok(Math.abs(r.netMargin - 0.287377) < 1e-6);
  assert.ok(Math.abs(r.markup - 0.621190) < 1e-6);
  assert.equal(r.breakEvenCents, 272372);
  assert.equal(r.isLoss, false);
});
test('Scenario B — simple job, no fees/overhead/tax', () => {
  const job = { price: '1000', materialsMode: 'total', materialsTotal: '200', crew: [{ wage: '25', hours: '8' }], ownerHours: '2', fee: { preset: 'none' } };
  const r = C.calculate(job);
  assert.equal(r.totalCostsCents, 40000);
  assert.equal(r.netProfitCents, 60000);
  assert.equal(r.netMargin, 0.6);
  assert.equal(r.markup, 1.5);
  assert.equal(r.profitPerHourCents, 6000);     // 600 / 10 h
  assert.equal(r.billedRateCents, 10000);
  assert.equal(r.breakEvenCents, 40000);
  const owner = C.calculate({ ...job, hoursBasis: 'owner' });
  assert.equal(owner.profitPerHourCents, 30000); // 600 / 2 h
});
test('Scenario C — card fee presets', () => {
  const stripe = { preset: 'stripe', pct: 2.9, fixed: 0.30, payments: 1 };
  assert.equal(C.calculate({ price: 100, fee: stripe }).feesCents, 320);
  assert.equal(C.calculate({ price: 100, fee: { ...stripe, payments: 2 } }).feesCents, 350);
  assert.equal(C.calculate({ price: 250, fee: { preset: 'square', pct: 2.6, fixed: 0.15, payments: 1 } }).feesCents, 665);
  assert.equal(C.calculate({ price: 0, fee: stripe }).feesCents, 0, 'no fee when nothing is charged');
  assert.equal(C.calculate({ price: 100, fee: { preset: 'none', pct: 5, fixed: 1 } }).feesCents, 0);
  assert.equal(C.calculate({ price: 100, fee: { preset: 'custom', pct: 3.5, fixed: 0, payments: '' } }).feesCents, 350);
});
test('Scenario D — negative profit is flagged, no tax on a loss', () => {
  const r = C.calculate({ price: 500, materialsMode: 'total', materialsTotal: 600, taxPct: 25, fee: { preset: 'none' } });
  assert.equal(r.netProfitCents, -10000);
  assert.equal(r.taxSetAsideCents, 0);
  assert.equal(r.isLoss, true);
  assert.equal(r.netMargin, -0.2);
  assert.ok(r.warnings.some(w => w.code === 'loss'));
  assert.equal(r.breakEvenCents, 60000);
});
test('Scenario E — blank job never yields NaN or Infinity', () => {
  const r = C.calculate(C.blankJob());
  noBadNumbers(r);
  assert.equal(r.netProfitCents, 0);
  assert.equal(r.netMargin, null);
  assert.equal(r.markup, null);
  assert.equal(r.profitPerHourCents, null);
  assert.equal(r.billedRateCents, null);
  assert.equal(r.breakEvenCents, 31, 'only the 30¢ Stripe fixed fee to cover: 30 / (1 − 2.9%) → 31¢');
  assert.equal(C.calculate({ ...C.blankJob(), fee: { preset: 'none' } }).breakEvenCents, 0);
  assert.ok(r.warnings.some(w => w.code === 'no-price'));
  assert.ok(r.warnings.some(w => w.code === 'no-hours'));
  noBadNumbers(C.calculate({}));
  noBadNumbers(C.calculate(undefined));
});
test('Scenario F — garbage everywhere is treated as 0', () => {
  const r = C.calculate({ price: 'lots', materials: [{ qty: 'x', unitCost: '1e999' }], crew: [{ wage: NaN, hours: Infinity }], ownerHours: '-4', miles: 'far', taxPct: '500', overhead: { mode: 'percent', value: 'abc' } });
  noBadNumbers(r);
  assert.equal(r.totalCostsCents, 0);
  assert.equal(r.ownerHours, 0);
  assert.equal(r.taxPct, 100, 'percentages are capped at 100');
});
test('Zero hours: profit per hour is null (shown as —), not Infinity', () => {
  const r = C.calculate({ price: 300, fee: { preset: 'none' } });
  assert.equal(r.profitPerHourCents, null);
  assert.equal(r.billedRateCents, null);
  const r2 = C.calculate({ price: 300, crew: [{ wage: 20, hours: 5 }], hoursBasis: 'owner', fee: { preset: 'none' } });
  assert.equal(r2.profitPerHourCents, null, 'owner-only with no owner hours');
  assert.equal(r2.profitPerHourAllCents, 4000);
});
test('Overhead: percent of price or flat', () => {
  assert.equal(C.calculate({ price: 1000, overhead: { mode: 'percent', value: 10 }, fee: { preset: 'none' } }).overheadCents, 10000);
  assert.equal(C.calculate({ price: 1000, overhead: { mode: 'flat', value: '50' }, fee: { preset: 'none' } }).overheadCents, 5000);
  assert.equal(C.calculate({ price: 1000, overhead: { mode: 'none', value: '50' }, fee: { preset: 'none' } }).overheadCents, 0);
});
test('Shipping + mileage, other cost categories', () => {
  const r = C.calculate({ shipping: '25', miles: '12.5', mileRate: '0.655', otherCosts: [{ category: 'subcontractor', amount: 400 }, { category: 'permits', amount: 85 }, { category: 'bogus', amount: 10 }] });
  assert.equal(r.direct.mileage, 825);          // 12.5 × $0.66 (0.655 → 66¢)
  assert.equal(r.direct.travel, 3325);
  assert.equal(r.direct.subcontractor, 40000);
  assert.equal(r.direct.permits, 8500);
  assert.equal(r.direct.other, 1000, 'unknown category falls back to other');
});
test('Break-even is the exact lowest cent with fees and overhead', () => {
  const j = deck();
  const be = C.breakEven(j);
  assert.ok(C.calculate(j, { priceCents: be }).profitBeforeTaxCents >= 0);
  assert.ok(C.calculate(j, { priceCents: be - 1 }).profitBeforeTaxCents < 0);
  assert.equal(C.breakEven({ materialsMode: 'total', materialsTotal: 100, fee: { preset: 'custom', pct: 60, fixed: 0 }, overhead: { mode: 'percent', value: 50 } }), null);
});

// ---------------- reverse mode ----------------
test('Reverse: 30% target margin on the deck job', () => {
  const j = deck();
  const q = C.priceForTarget(j, { type: 'margin', value: 30 });
  assert.equal(q.ok, true);
  // (1-t)C / ((1-t)k - m) = 0.75 × 238,053 / (0.75 × 0.874 − 0.30) = $5,022.215 → $5,022.22
  assert.equal(q.priceCents, 502222);
  assert.ok(q.result.netMargin >= 0.30);
  const below = C.calculate(j, { priceCents: q.priceCents - 1 });
  assert.ok(below.netProfitCents < 0.30 * (q.priceCents - 1));
});
test('Reverse: $50/hr target over all 42 hours', () => {
  const q = C.priceForTarget(deck(), { type: 'hourly', value: 50 });
  // net 2,100 → pre-tax 2,800 → (2,800 + 2,380.53) / 0.874 = $5,927.38
  assert.equal(q.priceCents, 592738);
  assert.ok(q.result.profitPerHourCents >= 5000);
});
test('Reverse: hourly target on owner hours only uses owner hours', () => {
  const j = { ...deck(), hoursBasis: 'owner' };
  const q = C.priceForTarget(j, { type: 'hourly', value: 150 });
  assert.ok(q.ok);
  assert.ok(q.result.netProfitCents >= 150000);   // 10 owner hours × $150
  assert.ok(C.calculate(j, { priceCents: q.priceCents - 1 }).netProfitCents < 150000);
});
test('Reverse: profit target with rounding up to $25', () => {
  const q = C.priceForTarget(deck(), { type: 'profit', value: 1000, roundTo: 25 });
  assert.equal(q.priceCents % 2500, 0);
  assert.ok(q.result.netProfitCents >= 100000);
  assert.ok(q.priceCents - C.priceForTarget(deck(), { type: 'profit', value: 1000 }).priceCents < 2500);
});
test('Reverse: impossible targets explain themselves', () => {
  const r1 = C.priceForTarget(deck(), { type: 'margin', value: 80 });
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /65\.5%/);             // 0.75 × 0.874 = 65.55%, rounded down to stay honest
  const r2 = C.priceForTarget({ price: 100 }, { type: 'hourly', value: 40 });
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /hours/i);
  const r3 = C.priceForTarget({ fee: { preset: 'custom', pct: 70 }, overhead: { mode: 'percent', value: 40 }, materialsTotal: 1, materialsMode: 'total' }, { type: 'margin', value: 10 });
  assert.equal(r3.ok, false);
  assert.equal(C.priceForTarget(deck(), { type: 'margin', value: -5 }).ok, false);
});
test('Reverse: 0% margin equals break-even', () => {
  const j = deck();
  assert.equal(C.priceForTarget(j, { type: 'margin', value: 0 }).priceCents, C.breakEven(j));
});

// ---------------- formatting ----------------
test('Formatting helpers', () => {
  assert.equal(C.money(123456), '$1,234.56');
  assert.equal(C.money(-500), '−$5.00');
  assert.equal(C.money(null), '—');
  assert.equal(C.money(NaN), '—');
  assert.equal(C.percent(0.287377), '28.7%');
  assert.equal(C.percent(-0.2), '−20.0%');
  assert.equal(C.percent(null), '—');
  assert.equal(C.hours(1), '1 hr');
  assert.equal(C.hours(1.25), '1.25 hrs');
  assert.equal(C.hours(42), '42 hrs');
});

test('Every template computes cleanly and profitably', () => {
  assert.ok(T.length >= 4);
  for (const t of T) {
    const r = C.calculate(t.job);
    noBadNumbers(r);
    assert.ok(r.netProfitCents > 0, t.id + ' should be a profitable example');
    assert.ok(r.profitPerHourCents > 0, t.id);
  }
  const lawn = C.calculate(T.find(t => t.id === 'lawn-care').job);
  // 85 − 6.50 − 22.50 − 8.40 − 4.00 − (2.21+0.15) − 6.80 = 34.44 pre-tax; 20% → 6.89; net 27.55; / 2.5 h = 11.02
  assert.equal(lawn.profitBeforeTaxCents, 3444);
  assert.equal(lawn.netProfitCents, 2755);
  assert.equal(lawn.profitPerHourCents, 1102);
});

// ---------------- documents ----------------
const profile = () => ({ ...D.defaultProfile(), companyName: 'Ridgeline Carpentry LLC', phone: '(555) 010-2000', email: 'office@ridgeline.example', license: 'NC-GC-12345', address: '12 Shop Rd\nAsheville, NC', paymentLink: 'https://buy.stripe.com/test_abc123' });

test('docTotals(): subtotal, discount, partial taxability, payments', () => {
  const doc = { lines: [{ qty: '2', unitPrice: '100', taxable: true }, { qty: '1', unitPrice: '50', taxable: false }], discount: { mode: 'flat', value: '25' }, salesTaxPct: '6.5', paid: '100' };
  const t = D.docTotals(doc);
  assert.equal(t.subtotal, 25000);
  assert.equal(t.discount, 2500);
  assert.equal(t.taxBase, 18000);                  // taxable 200 × (225/250)
  assert.equal(t.salesTax, 1170);
  assert.equal(t.total, 23670);
  assert.equal(t.balance, 13670);
  assert.equal(D.docTotals({ lines: [{ qty: 1, unitPrice: 80 }], discount: { mode: 'flat', value: 500 } }).total, 0, 'discount capped at subtotal');
  assert.equal(D.docTotals({ lines: [{ qty: 4, unitPrice: '12.50' }], discount: { mode: 'percent', value: 10 } }).total, 4500);
  noBadNumbers(D.docTotals({ lines: [{ qty: 'x', unitPrice: 'y' }], discount: {}, salesTaxPct: 'z', paid: 'q' }));
  noBadNumbers(D.docTotals({}));
});
test('buildLinesFromJob(): "match" pricing hits the job price to the cent', () => {
  for (const t of T) {
    const lines = D.buildLinesFromJob(t.job, { markupPct: 15, pricing: 'match' });
    const sum = lines.reduce((s, l) => s + D.lineAmount(l), 0);
    assert.equal(sum, C.toCents(t.job.price), t.id);
    for (const l of lines) assert.ok(D.lineAmount(l) >= 0);
  }
  const lines = D.buildLinesFromJob(deck(), { markupPct: 15 });
  const deckBoards = lines.find(l => /decking/.test(l.description));
  assert.equal(deckBoards.unitPrice, '17.23');      // 14.98 × 1.15 = 17.227
  assert.equal(deckBoards.qty, '40');
  assert.equal(lines[0].kind, 'labor');
});
test('buildLinesFromJob(): cost + markup and summary detail', () => {
  const lines = D.buildLinesFromJob(deck(), { markupPct: 20, pricing: 'markup', detail: 'summary' });
  assert.equal(lines.length, 3);
  const labor = lines.find(l => l.kind === 'labor');
  assert.equal(C.toCents(labor.unitPrice), 99840);  // 832 × 1.2
  const sum = lines.reduce((s, l) => s + D.lineAmount(l), 0);
  assert.equal(sum, Math.round(238023 * 1.2));      // all direct costs × 1.2
});
test('Numbering auto-increments per document type; dates roll over months and years', () => {
  let p = profile();
  const a = D.newDoc('estimate', deck(), p, { today: '2026-10-21' }); p = a.profile;
  const b = D.newDoc('estimate', deck(), p, { today: '2026-10-21' }); p = b.profile;
  const c = D.newDoc('invoice', deck(), p, { today: '2026-12-25' }); p = c.profile;
  assert.equal(a.doc.number, 'EST-1001');
  assert.equal(b.doc.number, 'EST-1002');
  assert.equal(c.doc.number, 'INV-1001');
  assert.equal(p.nextEstimate, 1003);
  assert.equal(p.nextInvoice, 1002);
  assert.equal(a.doc.dueDate, '2026-11-20');        // valid 30 days
  assert.equal(c.doc.dueDate, '2027-01-08');        // due 14 days
  assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addDays('garbage', 3), '');
  assert.equal(D.formatNumber('Q-', '0'), 'Q-1');
});
test('convertToInvoice(): new invoice number, same lines, estimate marked accepted', () => {
  let p = profile();
  const e = D.newDoc('estimate', deck(), p, { today: '2026-10-21' }); p = e.profile;
  e.doc.paid = '1000'; e.doc.salesTaxPct = '7';
  const res = D.convertToInvoice(e.doc, p, { today: '2026-10-30' });
  assert.equal(res.invoice.type, 'invoice');
  assert.equal(res.invoice.number, 'INV-1001');
  assert.equal(res.invoice.fromEstimate, 'EST-1001');
  assert.equal(res.invoice.dueDate, '2026-11-13');
  assert.equal(res.invoice.status, 'draft');
  assert.equal(res.invoice.paid, '', 'deposit requested is not assumed paid');
  assert.equal(res.estimate.status, 'accepted');
  assert.equal(res.estimate.convertedTo, 'INV-1001');
  assert.equal(e.doc.status, 'draft', 'input estimate is not mutated');
  assert.equal(D.docTotals(res.invoice).subtotal, D.docTotals(e.doc).subtotal);
  assert.notEqual(res.invoice.lines[0].id, e.doc.lines[0].id);
  assert.equal(res.profile.nextInvoice, 1002);
});

// ---------------- privacy: customer documents never leak internal numbers ----------------
const FORBIDDEN_WORDS = ['profit', 'margin', 'wage', 'overhead', 'internal', 'set-aside', 'break-even', 'markup', 'per hour', '/hr', 'card fee', 'tax set',
  'burden', 'payroll', 'fica', 'workers', 'per diem', 'loaded', '1099', 'benefit', 'unemployment'];
function internalMoneyStrings(job) {
  const r = C.calculate(job), d = r.direct, m = C.money;
  const out = new Set([m(r.netProfitCents), m(r.totalCostsCents), m(r.grossProfitCents), m(r.profitBeforeTaxCents), m(r.taxSetAsideCents), m(r.feesCents), m(r.overheadCents), m(d.total), m(d.labor), m(d.materials)]);
  d.crewLines.forEach(c => { out.add(m(c.wageCents)); out.add(m(c.cents)); });
  d.materialsLines.forEach(l => { out.add(m(l.unitCents)); out.add(m(l.cents)); });
  d.otherLines.forEach(l => out.add(m(l.cents)));
  if (r.profitPerHourCents !== null) out.add(m(r.profitPerHourCents));
  if (d.mileage) out.add(m(d.mileage));
  return [...out].filter(s => s !== '$0.00');
}
test('LEAK CHECK — estimates & invoices for every template, every pricing mode', () => {
  let checked = 0;
  for (const t of T) {
    for (const type of ['estimate', 'invoice']) {
      for (const opts of [{ markupPct: 15, pricing: 'match', detail: 'itemized' }, { markupPct: 25, pricing: 'markup', detail: 'itemized' }, { markupPct: 15, pricing: 'match', detail: 'summary' }]) {
        const job = { ...t.job, id: 'j1', burden: { ...C.DEFAULT_BURDEN, benefitsHourly: '1.25' }, crew: t.job.crew.map((c, i) => ({ ...c, perDiem: '35', type: i === 1 ? 'sub' : 'employee' })) };
        const { doc } = D.newDoc(type, job, profile(), opts);
        const html = D.renderCustomerDoc(doc, profile(), CFG);
        const text = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').toLowerCase();
        for (const w of FORBIDDEN_WORDS) assert.ok(!text.includes(w), `${t.id}/${type}/${opts.pricing}: customer doc mentions "${w}"`);
        for (const c of t.job.crew) if (c.name) assert.ok(!html.includes(c.name), `${t.id}: crew name "${c.name}" leaked`);
        if (t.job.notes) assert.ok(!html.includes(t.job.notes), `${t.id}: internal job notes leaked`);
        // Totals the customer is meant to see are exempt (e.g. in match mode the job price IS the subtotal).
        const tot = D.docTotals(doc);
        const allowed = new Set([...tot.amounts, tot.subtotal, tot.total, tot.balance, ...doc.lines.map(l => C.toCents(l.unitPrice))].map(c => C.money(c)));
        for (const s of [...internalMoneyStrings(t.job), ...internalMoneyStrings(job)]) if (!allowed.has(s)) assert.ok(!html.includes(s), `${t.id}/${type}/${opts.pricing}: internal amount ${s} leaked`);
        // The stored document carries no internal fields at all.
        const json = JSON.stringify(doc);
        for (const k of ['wage', 'cents', 'cost', 'profit', 'margin', 'overhead', 'hours', 'crew', 'taxPct', 'ownerHours', 'materials', 'fee']) assert.ok(!new RegExp(`"${k}":`, 'i').test(json), `doc JSON has key ${k}`);
        assert.deepEqual(Object.keys(doc.lines[0]).sort(), ['description', 'id', 'kind', 'qty', 'taxable', 'unit', 'unitPrice']);
        checked++;
      }
    }
  }
  assert.equal(checked, T.length * 6);
});
test('LEAK CHECK — renderCustomerDoc has no access to the job: signature takes only (doc, profile, cfg)', () => {
  assert.equal(D.renderCustomerDoc.length, 3);
  const src = D.renderCustomerDoc.toString();
  assert.ok(!/calculate\(|directCosts\(/.test(src), 'customer renderer must not compute job costs');
});
test('Internal job sheet does show costs, profit and per-hour (and the disclaimer)', () => {
  const j = deck(), r = C.calculate(j);
  const html = D.renderJobSheet(j, r, profile(), CFG);
  assert.match(html, /INTERNAL/);
  assert.ok(html.includes('$1,393.78'));
  assert.ok(html.includes('$33.19'));
  assert.ok(html.includes('Lead carpenter'));
  assert.ok(html.includes('Estimates only, based on the numbers you enter. Not financial or tax advice.'));
});
test('Estimate has signature line; invoice has balance and pay-online link + QR', () => {
  const p = profile();
  const est = D.newDoc('estimate', deck(), p).doc;
  const inv = D.newDoc('invoice', deck(), p).doc;
  const eh = D.renderCustomerDoc(est, p, CFG), ih = D.renderCustomerDoc(inv, p, CFG);
  assert.match(eh, /Customer signature/);
  assert.doesNotMatch(eh, /Pay online/);
  assert.doesNotMatch(ih, /Customer signature/);
  assert.match(ih, /Balance due/);
  assert.match(ih, /Pay online/);
  assert.match(ih, /href="https:\/\/buy\.stripe\.com\/test_abc123"/);
  assert.match(ih, /<svg[^>]*viewBox/);
  assert.match(ih, /License #NC-GC-12345/);
  inv.status = 'paid';
  const paid = D.renderCustomerDoc(inv, p, CFG);
  assert.match(paid, /PAID/);
  assert.doesNotMatch(paid, /Pay online/);
});
test('Payment links: only http(s), bare domains get https://, unsafe links never print', () => {
  assert.equal(D.safeUrl('square.link/u/AbC'), 'https://square.link/u/AbC');
  assert.equal(D.safeUrl('https://paypal.me/ridgeline'), 'https://paypal.me/ridgeline');
  assert.equal(D.safeUrl('javascript:alert(1)'), '');
  assert.equal(D.safeUrl('data:text/html,hi'), '');
  assert.equal(D.safeUrl('https://x.com/"><script>'), '');
  assert.equal(D.safeUrl(''), '');
  const p = { ...profile(), paymentLink: 'javascript:alert(1)' };
  const html = D.renderCustomerDoc(D.newDoc('invoice', deck(), p).doc, p, CFG);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /Pay online/);
});
test('Customer docs escape user text (no HTML injection)', () => {
  const p = { ...profile(), companyName: '<img src=x onerror=alert(1)>' };
  const job = { ...deck(), customer: { name: '<script>alert(1)</script>' } };
  const html = D.renderCustomerDoc(D.newDoc('estimate', job, p).doc, p, CFG);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  const bad = { ...profile(), logo: 'javascript:alert(1)' };
  assert.doesNotMatch(D.renderCustomerDoc(D.newDoc('estimate', deck(), bad).doc, bad, CFG), /<img/);
});

// ---------------- storage & backup ----------------
function memStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }
test('Store: round trip, corrupted data falls back safely, blocked storage is survivable', () => {
  const mem = memStorage();
  const s = ST.create(mem, 'jpc');
  assert.equal(s.available, true);
  s.saveJobs([{ id: 'a' }]);
  assert.deepEqual(s.loadJobs(), [{ id: 'a' }]);
  mem.setItem('jpc.jobs.v1', '{not json');
  assert.deepEqual(s.loadJobs(), []);
  mem.setItem('jpc.docs.v1', '"a string"');
  assert.deepEqual(s.loadDocs(), []);
  assert.equal(s.termsAccepted(), false);
  s.acceptTerms('v1');
  assert.equal(s.termsAccepted(), true);
  const blocked = ST.create({ getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() {} });
  assert.equal(blocked.available, false);
  assert.deepEqual(blocked.loadJobs(), []);
  assert.equal(blocked.saveJobs([]), false);
});
test('Backup: makeBackup → parseBackup round trip with summary', () => {
  const data = { profile: profile(), jobs: [{ id: 'j1', name: 'Deck' }, { id: 'j2' }], docs: [{ id: 'd1', type: 'estimate', lines: [] }, { id: 'd2', type: 'invoice', lines: [] }, { id: 'd3', type: 'invoice', lines: [] }], draft: deck() };
  const text = JSON.stringify(ST.makeBackup(data, 'Job Profit Calculator', new Date('2026-10-21T14:00:00Z')));
  const res = ST.parseBackup(text);
  assert.equal(res.ok, true);
  assert.deepEqual(res.summary, { jobs: 2, estimates: 1, invoices: 2, exportedAt: '2026-10-21T14:00:00.000Z' });
  assert.equal(res.data.profile.companyName, 'Ridgeline Carpentry LLC');
  assert.equal(res.data.draft.name, deck().name);
});
test('Backup: rejects invalid files with a plain-English reason', () => {
  assert.match(ST.parseBackup('nope').error, /not valid JSON/);
  assert.match(ST.parseBackup('{"hello":1}').error, /not a backup/);
  assert.match(ST.parseBackup(JSON.stringify({ format: ST.BACKUP_FORMAT, version: 99, jobs: [], docs: [] })).error, /newer version/);
  assert.match(ST.parseBackup(JSON.stringify({ format: ST.BACKUP_FORMAT, version: 1 })).error, /missing/);
  const r = ST.parseBackup(JSON.stringify({ format: ST.BACKUP_FORMAT, version: 1, jobs: [null, { id: 'ok' }, 5], docs: [{ id: 'd' }, { id: 'e', lines: [] }] }));
  assert.equal(r.summary.jobs, 1);
  assert.equal(r.data.docs.length, 1);
});

// ---------------- CSV ----------------
test('CSV: job export has line items and hand-checked results', () => {
  const j = deck(), csv = CSV.jobToCsv(j, C.calculate(j), 'Job Profit Calculator');
  assert.match(csv, /^Job Profit Calculator,Job export/);
  assert.match(csv, /Materials,"Pressure-treated 5\/4×6 decking, 12 ft",40,14\.98,599\.20/);
  assert.match(csv, /Labor,Lead carpenter,16,32\.00,512\.00/);
  assert.match(csv, /Net profit,1393\.78/);
  assert.match(csv, /Profit per hour \(all hours\),33\.19/);
  assert.match(csv, /Break-even price,2723\.72/);
});
test('CSV: escaping and spreadsheet formula-injection guard', () => {
  assert.equal(CSV.cell('a,b'), '"a,b"');
  assert.equal(CSV.cell('say "hi"'), '"say ""hi"""');
  assert.equal(CSV.cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(CSV.cell('-12.50'), '-12.50');
  assert.equal(CSV.cell(null), '');
  const all = CSV.jobsToCsv(T.map(t => ({ job: t.job, result: C.calculate(t.job) })));
  assert.equal(all.trim().split('\r\n').length, T.length + 1);
});
test('CSV: blank worksheet is named from config and lists every field', () => {
  const w = CSV.worksheetCsv(CFG.name);
  assert.ok(w.startsWith(CFG.name + ' - blank job worksheet'));
  for (const f of ['Price you charge', 'Material line 1', 'Crew member 1', 'Your hours', 'Miles driven', 'Fee percent', 'Permit', 'Subcontractor', 'Overhead', 'tax set-aside', 'Profit per hour']) assert.ok(w.includes(f), f);
});
test('Config: one place for the product name', () => {
  assert.equal(CFG.name, 'Job Profit Calculator');
  assert.equal(CFG.company, 'Carina Dataworks');
});

// ---------------- Labor burden (employee cost) ----------------
test('Labor burden: one employee, every part hand-checked', () => {
  // $22/hr × 14 h = $308.00 wages; burden 7.65 + 3 + 5 = 15.65% → 308 × 0.1565 = 48.202 → $48.20;
  // benefits $1.50/hr × 14 = $21.00; per diem $40 → burden $109.20; line $417.20; loaded 417.20 / 14 = $29.80/hr
  const b = { payrollPct: '7.65', unemploymentPct: '3', compPct: '5', benefitsPct: '0', benefitsHourly: '1.50' };
  const l = C.crewLine({ name: 'Helper', wage: '22', hours: '14', perDiem: '40' }, b);
  assert.equal(l.wagesCents, 30800);
  assert.equal(l.burdenPctCents, 4820);
  assert.equal(l.burdenHourlyCents, 2100);
  assert.equal(l.perDiemCents, 4000);
  assert.equal(l.burdenCents, 10920);
  assert.equal(l.cents, 41720);
  assert.equal(l.loadedHourlyCents, 2980);
  // with no hours yet, the loaded rate is the rate itself: 22 × 1.1565 = 25.443 → 25.44 + 1.50 = $26.94
  assert.equal(C.crewLine({ wage: '22', hours: '' }, b).loadedHourlyCents, 2694);
});
test('Labor burden: 1099 subcontractors get none (no %, no $/hr, no per diem)', () => {
  const l = C.crewLine({ wage: '45', hours: '10', type: 'sub', perDiem: '40' }, { ...C.DEFAULT_BURDEN, benefitsHourly: '2' });
  assert.equal(l.type, 'sub');
  assert.equal(l.burdenCents, 0);
  assert.equal(l.cents, 45000);
  assert.equal(l.loadedHourlyCents, 4500);
  // no burden settings at all (older saved jobs) = no burden
  assert.equal(C.calculate({ crew: [{ wage: '20', hours: '10' }] }).direct.labor, 20000);
  // junk and negative burden inputs count as 0; each % is capped at 100
  assert.equal(C.crewLine({ wage: '10', hours: '1' }, { payrollPct: 'abc', compPct: '-5', unemploymentPct: '250' }).cents, 2000);
});
test('Labor burden flows into total costs, profit, profit/hour and break-even (deck job, default example rates)', () => {
  const j = { ...deck(), burden: { ...C.DEFAULT_BURDEN } };
  const r = C.calculate(j);
  // wages 16×32 + 16×20 = 832.00; burden 15.65%: 512 × .1565 = 80.128 → 80.13, 320 × .1565 = 50.08 → $130.21
  assert.equal(r.direct.laborWages, 83200);
  assert.equal(r.direct.laborBurden, 13021);
  assert.equal(r.direct.labor, 96221);
  assert.equal(r.totalCostsCents, 312184);         // 2991.63 + 130.21
  assert.equal(r.profitBeforeTaxCents, 172816);    // 4850 − 3121.84
  assert.equal(r.taxSetAsideCents, 43204);         // 25% of 1728.16
  assert.equal(r.netProfitCents, 129612);          // 1728.16 − 432.04
  assert.equal(r.profitPerHourCents, 3086);        // 1296.12 / 42 = 30.86
  assert.deepEqual(r.direct.crewLines.map(c => c.loadedHourlyCents), [3701, 2313]); // 592.13/16, 370.08/16
  // break-even: fixed costs 2510.44 + 0.30 = 2510.74, kept share 1 − 2.6% − 10% = 0.874 → 2872.70
  assert.equal(r.breakEvenCents, 287270);
  const p = C.calculate(j, { priceCents: r.breakEvenCents });
  assert.ok(p.profitBeforeTaxCents >= 0 && C.calculate(j, { priceCents: r.breakEvenCents - 1 }).profitBeforeTaxCents < 0);
});
test('Labor burden raises the Find my price quote, and a sub on the same hours lowers it back', () => {
  const plain = C.priceForTarget(deck(), { type: 'margin', value: 30, roundTo: 25 });
  const loaded = C.priceForTarget({ ...deck(), burden: { ...C.DEFAULT_BURDEN } }, { type: 'margin', value: 30, roundTo: 25 });
  assert.equal(plain.priceCents, 502500);
  assert.equal(loaded.priceCents, 530000);
  assert.ok(loaded.result.netMargin >= 0.3);
  const subs = { ...deck(), burden: { ...C.DEFAULT_BURDEN }, crew: deck().crew.map(c => ({ ...c, type: 'sub' })) };
  assert.equal(C.priceForTarget(subs, { type: 'margin', value: 30, roundTo: 25 }).priceCents, plain.priceCents);
});
test('Labor burden shows on the internal job sheet and CSV, never on customer documents', () => {
  const j = { ...deck(), burden: { ...C.DEFAULT_BURDEN } }, r = C.calculate(j);
  const sheet = D.renderJobSheet(j, r, profile(), CFG);
  assert.ok(sheet.includes('labor burden $130.21'));
  assert.ok(sheet.includes('loaded $37.01/hr'));
  const csv = CSV.jobToCsv(j, r, CFG.name);
  assert.match(csv, /Labor burden,"Lead carpenter — payroll tax, comp, benefits",16,37.01,80.13/);
  const { doc } = D.newDoc('estimate', { ...j, id: 'j1' }, profile(), { pricing: 'match', detail: 'itemized', markupPct: 15 });
  const html = D.renderCustomerDoc(doc, profile(), CFG).toLowerCase();
  for (const w of ['burden', '130.21', '37.01', 'loaded', 'payroll']) assert.ok(!html.includes(w), 'customer doc leaks ' + w);
});
