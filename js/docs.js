/*
 * JobDocs — customer documents (estimates/invoices) and the internal job sheet.
 * Pure functions, no DOM: unit-testable in Node.
 *
 * PRIVACY RULE: a customer document is built ONLY from customer-facing prices.
 * buildLinesFromJob() is the single bridge from internal costs to customer prices,
 * and it outputs nothing but description / qty / unit / unit price. The renderer
 * renderCustomerDoc() never receives the job or its calculation result.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./vendor/qrcode.js'));
  else root.JobDocs = factory(root.JobCalc, root.qrcode);
})(this, function (C, qrcode) {
  'use strict';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nl2br(s) { return esc(s).replace(/\r?\n/g, '<br>'); }
  function centsToStr(c) { return (Math.round(c) / 100).toFixed(2); }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function defaultProfile() {
    return {
      companyName: '', logo: '', paymentLink: '', address: '', phone: '', email: '', website: '', license: '',
      paymentTerms: 'Payment due within 14 days of invoice date. Card payments accepted; checks payable to the company name above.',
      estimateNotes: 'This estimate is based on the scope described above. Changes to scope, hidden damage or material price increases may change the final price.',
      invoiceNotes: 'Thank you for your business!',
      dueDays: 14, validDays: 30,
      salesTaxPct: '', markupPct: '15',
      estimatePrefix: 'EST-', invoicePrefix: 'INV-',
      nextEstimate: 1001, nextInvoice: 1001
    };
  }

  /** Accept only http(s) payment links. Bare domains like square.link/u/abc get https:// added. Returns '' if unsafe. */
  function safeUrl(u) {
    var s = String(u || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    if (!/^https?:\/\/[^\s/$.?#][^\s<>"']*$/i.test(s)) return '';
    return s;
  }

  /** QR code as inline SVG (black on white, prints in B&W). '' when unavailable. */
  function qrSvg(text) {
    if (!text || typeof qrcode !== 'function') return '';
    try {
      var q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true, title: 'QR code: pay online' });
    } catch (e) { return ''; }
  }

  function formatNumber(prefix, n) { return String(prefix || '') + String(Math.max(1, Math.floor(C.num(n)) || 1)); }

  /** Reserve the next number for a type. Returns { number, profile } with the counter advanced (pure). */
  function takeNumber(profile, type) {
    var p = Object.assign({}, defaultProfile(), profile);
    var key = type === 'invoice' ? 'nextInvoice' : 'nextEstimate';
    var prefix = type === 'invoice' ? p.invoicePrefix : p.estimatePrefix;
    var n = Math.max(1, Math.floor(C.num(p[key])) || 1);
    p[key] = n + 1;
    return { number: formatNumber(prefix, n), profile: p };
  }

  function isoDate(d) {
    var dt = d instanceof Date ? d : new Date();
    var m = String(dt.getMonth() + 1).padStart(2, '0'), day = String(dt.getDate()).padStart(2, '0');
    return dt.getFullYear() + '-' + m + '-' + day;
  }
  function addDays(iso, n) {
    var parts = String(iso || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(function (x) { return !Number.isFinite(x); })) return '';
    var d = new Date(parts[0], parts[1] - 1, parts[2] + Math.floor(C.num(n)));
    return isoDate(d);
  }
  function prettyDate(iso, locale) {
    var parts = String(iso || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(function (x) { return !Number.isFinite(x); })) return '';
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(locale || 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function line(kind, description, qty, unit, unitCents) {
    return { id: uid(), kind: kind, description: description, qty: String(qty), unit: unit || '', unitPrice: centsToStr(unitCents), taxable: true };
  }
  function lineAmount(l) { return Math.round(Number((C.num(l.qty) * C.toCents(l.unitPrice)).toFixed(6))); }

  /**
   * Turn a job's internal costs into customer-facing line items.
   * opts.markupPct   — markup applied to materials and other job costs (and labor in 'markup' mode)
   * opts.pricing     — 'match': labor line absorbs the difference so the subtotal equals the job price
   *                    'markup': every line is cost x (1 + markup)
   * opts.detail      — 'itemized' (one line per material/cost) or 'summary' (Labor / Materials / Other)
   */
  function buildLinesFromJob(job, opts) {
    opts = opts || {};
    var m = 1 + C.pct(opts.markupPct) / 100;
    var pricing = opts.pricing === 'markup' ? 'markup' : 'match';
    var detail = opts.detail === 'summary' ? 'summary' : 'itemized';
    var d = C.directCosts(job);
    var priceCents = C.toCents(job.price);
    var up = function (c) { return Math.round(c * m); };
    var lines = [];

    if (detail === 'itemized') {
      if (job.materialsMode === 'total') {
        if (d.materials > 0) lines.push(line('materials', 'Materials & supplies', 1, 'lot', up(d.materials)));
      } else {
        d.materialsLines.forEach(function (ml) {
          if (ml.cents <= 0) return;
          if (Number.isInteger(ml.qty)) lines.push(line('materials', ml.name, ml.qty, 'ea', up(ml.unitCents)));
          else lines.push(line('materials', ml.name + ' (' + ml.qty + ')', 1, 'lot', up(ml.cents)));
        });
      }
      if (d.travel > 0) lines.push(line('other', 'Delivery & travel', 1, 'lot', up(d.travel)));
      d.otherLines.forEach(function (ol) { if (ol.cents > 0) lines.push(line('other', ol.name, 1, 'lot', up(ol.cents))); });
    } else {
      if (d.materials > 0) lines.push(line('materials', 'Materials & supplies', 1, 'lot', up(d.materials)));
      var rest = d.travel + d.equipment + d.permits + d.subcontractor + d.other;
      if (rest > 0) lines.push(line('other', 'Equipment, permits, delivery & other job costs', 1, 'lot', up(rest)));
    }

    var nonLabor = lines.reduce(function (s, l) { return s + lineAmount(l); }, 0);
    var labor;
    if (pricing === 'match' && priceCents > 0) {
      labor = priceCents - nonLabor;
      if (labor < 0) {
        // Markup too high to fit the price: scale every line down uniformly instead.
        var scale = priceCents / (nonLabor || 1);
        lines.forEach(function (l) { l.unitPrice = centsToStr(Math.floor(C.toCents(l.unitPrice) * scale)); });
        nonLabor = lines.reduce(function (s, l) { return s + lineAmount(l); }, 0);
        labor = priceCents - nonLabor;
      }
    } else {
      labor = up(d.labor);
    }
    var hasHours = d.crewHours + C.num(job.ownerHours) > 0;
    if (labor > 0 || (pricing === 'match' && hasHours && priceCents > 0)) {
      lines.unshift(line('labor', 'Labor & workmanship', 1, 'job', Math.max(0, labor)));
    }
    if (lines.length === 0 && priceCents > 0) lines.push(line('labor', job.name || 'Services', 1, 'job', priceCents));
    return lines;
  }

  function newDoc(type, job, profile, opts) {
    opts = opts || {};
    var p = Object.assign({}, defaultProfile(), profile);
    var today = opts.today || isoDate(new Date());
    var taken = takeNumber(p, type);
    var cust = (job && job.customer) || {};
    var doc = {
      id: uid(), type: type === 'invoice' ? 'invoice' : 'estimate',
      number: taken.number, status: 'draft',
      date: today,
      dueDate: addDays(today, type === 'invoice' ? p.dueDays : p.validDays),
      jobId: (job && job.id) || null, jobName: (job && job.name) || '',
      customer: { name: cust.name || (job && job.client) || '', email: cust.email || '', phone: cust.phone || '', address: cust.address || '' },
      jobAddress: (job && job.jobAddress) || '',
      title: (job && job.name) || '',
      lines: job ? buildLinesFromJob(job, { markupPct: opts.markupPct !== undefined ? opts.markupPct : p.markupPct, pricing: opts.pricing, detail: opts.detail }) : [],
      discount: { mode: 'flat', value: '' },
      salesTaxPct: p.salesTaxPct || '',
      paid: '',
      terms: p.paymentTerms,
      notes: type === 'invoice' ? p.invoiceNotes : p.estimateNotes,
      fromEstimate: null
    };
    return { doc: doc, profile: taken.profile };
  }

  function docTotals(doc) {
    var lines = (doc && doc.lines) || [];
    var amounts = lines.map(lineAmount);
    var subtotal = amounts.reduce(function (s, a) { return s + a; }, 0);
    var taxableSub = lines.reduce(function (s, l, i) { return s + (l.taxable === false ? 0 : amounts[i]); }, 0);
    var dsc = (doc && doc.discount) || {};
    var discount = dsc.mode === 'percent' ? Math.round(subtotal * C.pct(dsc.value) / 100) : C.toCents(dsc.value);
    if (discount > subtotal) discount = subtotal;
    var afterDiscount = subtotal - discount;
    var taxBase = subtotal > 0 ? Math.round(taxableSub * afterDiscount / subtotal) : 0;
    var taxPct = C.pct(doc && doc.salesTaxPct);
    var salesTax = Math.round(taxBase * taxPct / 100);
    var total = afterDiscount + salesTax;
    var paid = C.toCents(doc && doc.paid);
    return { amounts: amounts, subtotal: subtotal, discount: discount, afterDiscount: afterDiscount, taxBase: taxBase, taxPct: taxPct, salesTax: salesTax, total: total, paid: paid, balance: total - paid };
  }

  /** Estimate -> invoice. Returns { invoice, estimate, profile } (inputs untouched). */
  function convertToInvoice(estimate, profile, opts) {
    opts = opts || {};
    var p = Object.assign({}, defaultProfile(), profile);
    var today = opts.today || isoDate(new Date());
    var taken = takeNumber(p, 'invoice');
    var inv = JSON.parse(JSON.stringify(estimate));
    inv.id = uid();
    inv.type = 'invoice';
    inv.number = taken.number;
    inv.status = 'draft';
    inv.date = today;
    inv.dueDate = addDays(today, p.dueDays);
    inv.fromEstimate = estimate.number;
    inv.terms = p.paymentTerms;
    inv.notes = p.invoiceNotes;
    inv.lines.forEach(function (l) { l.id = uid(); });
    // Deposit requested on the estimate is not assumed paid; user records payments on the invoice.
    inv.paid = '';
    var est = Object.assign({}, estimate, { status: 'accepted', convertedTo: inv.number });
    return { invoice: inv, estimate: est, profile: taken.profile };
  }

  var STATUS = {
    estimate: { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' },
    invoice: { draft: 'Draft', sent: 'Sent', paid: 'Paid' }
  };

  function companyBlock(profile) {
    var p = profile || {};
    var logo = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(p.logo || '') ? '<img class="doc-logo" src="' + p.logo + '" alt="">' : '';
    var contact = [p.phone, p.email, p.website].filter(Boolean).map(esc).join(' · ');
    return '<div class="doc-company">' + logo + '<div>' +
      '<div class="doc-company-name">' + esc(p.companyName || 'Your Company Name') + '</div>' +
      (p.address ? '<div>' + nl2br(p.address) + '</div>' : '') +
      (contact ? '<div>' + contact + '</div>' : '') +
      (p.license ? '<div>License #' + esc(p.license) + '</div>' : '') +
      '</div></div>';
  }

  /** Customer-facing HTML. Receives ONLY the document and the business profile. */
  function renderCustomerDoc(doc, profile, cfg) {
    cfg = cfg || {};
    var fmt = function (c) { return C.money(c, cfg); };
    var t = docTotals(doc);
    var isEst = doc.type !== 'invoice';
    var title = isEst ? 'Estimate' : 'Invoice';
    var c = doc.customer || {};
    var rows = (doc.lines || []).map(function (l, i) {
      return '<tr><td>' + esc(l.description || '') + '</td><td class="num">' + esc(C.num(l.qty)) + (l.unit ? ' ' + esc(l.unit) : '') +
        '</td><td class="num">' + fmt(C.toCents(l.unitPrice)) + '</td><td class="num">' + fmt(t.amounts[i]) + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="4" class="muted">No line items yet.</td></tr>';
    var tot = '<tr><th>Subtotal</th><td>' + fmt(t.subtotal) + '</td></tr>';
    if (t.discount > 0) tot += '<tr><th>Discount' + (doc.discount && doc.discount.mode === 'percent' ? ' (' + C.pct(doc.discount.value) + '%)' : '') + '</th><td>−' + fmt(t.discount) + '</td></tr>';
    if (t.taxPct > 0) tot += '<tr><th>Sales tax (' + t.taxPct + '%)</th><td>' + fmt(t.salesTax) + '</td></tr>';
    tot += '<tr class="doc-total"><th>Total</th><td>' + fmt(t.total) + '</td></tr>';
    if (t.paid > 0) {
      tot += '<tr><th>' + (isEst ? 'Deposit due on acceptance' : 'Payments received') + '</th><td>' + (isEst ? '' : '−') + fmt(t.paid) + '</td></tr>';
      tot += '<tr class="doc-balance"><th>' + (isEst ? 'Balance after deposit' : (t.balance < 0 ? 'Credit' : 'Balance due')) + '</th><td>' + fmt(Math.abs(t.balance)) + '</td></tr>';
    } else if (!isEst) {
      tot += '<tr class="doc-balance"><th>Balance due</th><td>' + fmt(t.balance) + '</td></tr>';
    }
    var meta = '<tr><th>' + title + ' #</th><td>' + esc(doc.number) + '</td></tr>' +
      '<tr><th>Date</th><td>' + esc(prettyDate(doc.date, cfg.locale)) + '</td></tr>' +
      (doc.dueDate ? '<tr><th>' + (isEst ? 'Valid until' : 'Due date') + '</th><td>' + esc(prettyDate(doc.dueDate, cfg.locale)) + '</td></tr>' : '') +
      (!isEst && doc.fromEstimate ? '<tr><th>Estimate ref.</th><td>' + esc(doc.fromEstimate) + '</td></tr>' : '');
    var stamp = !isEst && doc.status === 'paid' ? '<div class="doc-stamp" aria-label="Paid">PAID</div>' : '';
    var pay = '';
    var link = safeUrl(profile && profile.paymentLink);
    if (!isEst && link && doc.status !== 'paid' && t.balance > 0) {
      pay = '<section class="doc-pay"><div class="doc-pay-qr">' + qrSvg(link) + '</div><div><h3>Pay online</h3>' +
        '<p>Scan the code or visit:</p><p><a href="' + esc(link) + '">' + esc(link.replace(/^https?:\/\//, '')) + '</a></p>' +
        '<p class="muted">Amount due: ' + fmt(t.balance) + ' · Ref. ' + esc(doc.number) + '</p></div></section>';
    }
    var custLines = [c.name, c.address].filter(Boolean).map(nl2br).join('<br>');
    var custContact = [c.phone, c.email].filter(Boolean).map(esc).join(' · ');
    return '<article class="cdoc" data-doc-type="' + esc(doc.type) + '">' + stamp +
      '<header class="doc-head">' + companyBlock(profile) +
      '<div class="doc-title"><h2>' + title + '</h2><table class="doc-meta">' + meta + '</table></div></header>' +
      '<section class="doc-parties"><div><h3>' + (isEst ? 'Prepared for' : 'Bill to') + '</h3><p>' + (custLines || '<span class="muted">Customer name</span>') + (custContact ? '<br>' + custContact : '') + '</p></div>' +
      (doc.jobAddress ? '<div><h3>Job site</h3><p>' + nl2br(doc.jobAddress) + '</p></div>' : '') +
      (doc.title ? '<div><h3>Project</h3><p>' + esc(doc.title) + '</p></div>' : '') + '</section>' +
      '<table class="doc-lines"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="doc-bottom"><div class="doc-notes">' +
      (doc.terms ? '<h3>Payment terms</h3><p>' + nl2br(doc.terms) + '</p>' : '') +
      (doc.notes ? '<h3>Notes</h3><p>' + nl2br(doc.notes) + '</p>' : '') + '</div>' +
      '<table class="doc-totals">' + tot + '</table></div>' + pay +
      (isEst ? '<section class="doc-sign"><p>To accept this estimate, sign below. By signing you authorize the work described above at the prices shown and agree to the payment terms.</p>' +
        '<div class="sign-row"><div><span class="sign-line"></span>Customer signature</div><div><span class="sign-line"></span>Printed name</div><div><span class="sign-line short"></span>Date</div></div></section>' : '') +
      '<footer class="doc-foot">' + esc((profile && profile.companyName) || '') + (profile && profile.license ? ' · License #' + esc(profile.license) : '') + '</footer>' +
      '</article>';
  }

  /** Internal job sheet — full costs, profit and profit per hour. Marked INTERNAL. */
  function renderJobSheet(job, r, profile, cfg) {
    cfg = cfg || {};
    var fmt = function (c) { return C.money(c, cfg); };
    var d = r.direct;
    var row = function (label, cents, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td class="num">' + fmt(cents) + '</td></tr>'; };
    var mats = job.materialsMode === 'total' ? row('Materials (total)', d.materials) :
      d.materialsLines.map(function (m) { return row(esc(m.name) + ' <span class="muted">' + esc(m.qty) + ' × ' + fmt(m.unitCents) + '</span>', m.cents); }).join('');
    var crew = d.crewLines.map(function (p) { return row(esc(p.name) + ' <span class="muted">' + C.hours(p.hours) + ' × ' + fmt(p.wageCents) + '/hr</span>', p.cents); }).join('');
    var others = d.otherLines.map(function (o) { return row(esc(o.name) + ' <span class="muted">' + esc(C.OTHER_CATEGORIES[o.category]) + '</span>', o.cents); }).join('');
    var cust = job.customer || {};
    return '<article class="jobsheet">' +
      '<header class="doc-head">' + companyBlock(profile) + '<div class="doc-title"><h2>Job Sheet</h2><p class="internal-tag">INTERNAL — do not send to customer</p></div></header>' +
      '<section class="doc-parties"><div><h3>Job</h3><p>' + esc(job.name || 'Untitled job') + '</p></div>' +
      '<div><h3>Customer</h3><p>' + esc(cust.name || job.client || '—') + '</p></div>' +
      (job.jobAddress ? '<div><h3>Job site</h3><p>' + nl2br(job.jobAddress) + '</p></div>' : '') +
      '<div><h3>Printed</h3><p>' + esc(prettyDate(isoDate(new Date()), cfg.locale)) + '</p></div></section>' +
      '<div class="js-kpis">' +
      kpi('Price charged', fmt(r.priceCents)) + kpi('Total costs', fmt(r.totalCostsCents)) +
      kpi('Net profit', fmt(r.netProfitCents), r.isLoss ? 'neg' : '') + kpi('Net margin', C.percent(r.netMargin)) +
      kpi('Profit / hour (all hours)', r.profitPerHourAllCents === null ? '—' : fmt(r.profitPerHourAllCents)) +
      kpi('Profit / owner hour', r.profitPerHourOwnerCents === null ? '—' : fmt(r.profitPerHourOwnerCents)) +
      '</div>' +
      '<div class="js-cols"><table class="doc-lines js-table"><thead><tr><th>Cost</th><th class="num">Amount</th></tr></thead><tbody>' +
      '<tr class="grp"><td colspan="2">Materials</td></tr>' + (mats || row('None', 0)) +
      '<tr class="grp"><td colspan="2">Crew labor</td></tr>' + (crew || row('None', 0)) +
      '<tr class="grp"><td colspan="2">Shipping & travel</td></tr>' + row('Shipping / delivery', d.shippingFlat) + row('Mileage <span class="muted">' + esc(C.num(job.miles)) + ' mi × ' + fmt(C.toCents(job.mileRate)) + '</span>', d.mileage) +
      '<tr class="grp"><td colspan="2">Equipment, permits, subs & other</td></tr>' + (others || row('None', 0)) +
      '<tr class="grp"><td colspan="2">Price-based costs</td></tr>' +
      row('Card / payment fees <span class="muted">' + r.feePct + '% + ' + fmt(r.feeFixedCents) + ' × ' + r.feePayments + '</span>', r.feesCents) +
      row('Overhead allocation', r.overheadCents) +
      row('<strong>Total costs</strong>', r.totalCostsCents, 'sum') + '</tbody></table>' +
      '<table class="doc-lines js-table"><thead><tr><th>Profit</th><th class="num">Value</th></tr></thead><tbody>' +
      row('Price charged', r.priceCents) + row('Gross profit (price − direct costs)', r.grossProfitCents) +
      row('Profit before tax', r.profitBeforeTaxCents) + row('Tax set-aside (' + r.taxPct + '%)', r.taxSetAsideCents) +
      row('<strong>Net profit</strong>', r.netProfitCents, 'sum' + (r.isLoss ? ' neg' : '')) +
      '<tr><td>Net margin</td><td class="num">' + C.percent(r.netMargin) + '</td></tr>' +
      '<tr><td>Markup on costs</td><td class="num">' + C.percent(r.markup) + '</td></tr>' +
      '<tr><td>Hours <span class="muted">crew ' + C.hours(r.crewHours) + ' + owner ' + C.hours(r.ownerHours) + '</span></td><td class="num">' + C.hours(r.totalHours) + '</td></tr>' +
      '<tr><td>Billed rate (price ÷ hours)</td><td class="num">' + (r.billedRateCents === null ? '—' : fmt(r.billedRateCents) + '/hr') + '</td></tr>' +
      '<tr><td>Break-even price</td><td class="num">' + (r.breakEvenCents === null ? 'Not reachable' : fmt(r.breakEvenCents)) + '</td></tr>' +
      '</tbody></table></div>' +
      (job.notes ? '<section class="doc-notes"><h3>Notes</h3><p>' + nl2br(job.notes) + '</p></section>' : '') +
      '<p class="js-disclaimer">Estimates only, based on the numbers you enter. Not financial or tax advice.</p>' +
      '<footer class="doc-foot">' + esc(cfg.name || '') + ' · Internal job sheet</footer></article>';
  }
  function kpi(label, value, cls) { return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><strong>' + value + '</strong></div>'; }

  return {
    esc: esc, safeUrl: safeUrl, qrSvg: qrSvg, defaultProfile: defaultProfile, formatNumber: formatNumber, takeNumber: takeNumber,
    isoDate: isoDate, addDays: addDays, prettyDate: prettyDate,
    buildLinesFromJob: buildLinesFromJob, lineAmount: lineAmount, newDoc: newDoc, docTotals: docTotals,
    convertToInvoice: convertToInvoice, STATUS: STATUS,
    renderCustomerDoc: renderCustomerDoc, renderJobSheet: renderJobSheet
  };
});
