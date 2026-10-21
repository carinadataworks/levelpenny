/* App controller: DOM wiring, rendering, persistence. All math lives in calc.js / docs.js. */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG, C = window.JobCalc, D = window.JobDocs, T = window.JobTemplates, ST = window.JobStore, CSV = window.JobCsv;
  var store = ST.create(window.localStorage, CFG.storagePrefix);
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var money = function (c) { return C.money(c, CFG); };
  var esc = D.esc;
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var uid = function (p) { return (p || 'j') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var TERMS_VERSION = '2026-10-21';

  var S = {
    job: null, mode: 'profit', target: { type: 'margin', value: '30', roundTo: '25' },
    jobs: store.loadJobs(), docs: store.loadDocs(),
    profile: Object.assign(D.defaultProfile(), store.loadProfile() || {}),
    docId: null, view: 'calculator', docFilter: 'all', lastResult: null, lastQuote: null
  };

  // ---------- helpers ----------
  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function setPath(o, path, v) { var ks = path.split('.'), last = ks.pop(); var t = ks.reduce(function (a, k) { if (a[k] == null || typeof a[k] !== 'object') a[k] = {}; return a[k]; }, o); t[last] = v; }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); var a = arguments; t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function normalizeJob(j) {
    var b = C.blankJob(); j = j || {};
    var out = Object.assign(b, clone(j));
    out.customer = Object.assign(C.blankJob().customer, j.customer || {});
    out.fee = Object.assign(C.blankJob().fee, j.fee || {});
    out.overhead = Object.assign(C.blankJob().overhead, j.overhead || {});
    ['materials', 'crew', 'otherCosts'].forEach(function (k) { if (!Array.isArray(out[k])) out[k] = []; });
    return out;
  }
  function profileBurden() {
    var p = S.profile;
    return { payrollPct: String(p.burdenPayrollPct == null ? '' : p.burdenPayrollPct), unemploymentPct: String(p.burdenUnemploymentPct == null ? '' : p.burdenUnemploymentPct),
      compPct: String(p.burdenCompPct == null ? '' : p.burdenCompPct), benefitsPct: String(p.burdenBenefitsPct == null ? '' : p.burdenBenefitsPct),
      benefitsHourly: String(p.burdenBenefitsHourly == null ? '' : p.burdenBenefitsHourly) };
  }
  function blankCrew() { return { name: '', type: 'employee', wage: '', hours: '', perDiem: S.profile.burdenPerDiem ? String(S.profile.burdenPerDiem) : '' }; }
  function freshJob() {
    var j = normalizeJob(C.blankJob());
    j.burden = profileBurden();
    j.crew = [blankCrew()];
    j.materials = [{ name: '', qty: '1', unitCost: '' }];
    return j;
  }
  function slug(s) { return (String(s || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job').slice(0, 60); }
  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.textContent = filename; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  var toastTimer;
  function toast(msg, undo) {
    var t = $('#toast'); $('#toastMsg').textContent = msg;
    var u = $('#toastUndo'); u.hidden = !undo;
    u.onclick = function () { t.hidden = true; if (undo) undo(); };
    t.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, undo ? 7000 : 3500);
  }

  // ---------- config ----------
  function applyConfig() {
    $$('[data-app-name]').forEach(function (e) { e.textContent = CFG.name; });
    $$('[data-company]').forEach(function (e) { e.textContent = CFG.company; });
    document.title = CFG.name + ' — by ' + CFG.company;
  }

  // ---------- validation ----------
  function validateInput(inp) {
    if (!inp.hasAttribute('data-num')) return true;
    var v = inp.value, msg = '';
    if (!C.isValidInput(v)) msg = 'Enter a number, like 12.50. Counting it as 0 for now.';
    else if (C.num(v) < 0) msg = "Can't be negative. Counting it as 0.";
    inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
    var err = inp.id ? document.getElementById(inp.id + '-err') : null;
    if (!err) { var row = inp.closest('.line'); err = row && row.querySelector('.row-err'); }
    if (err) {
      if (msg) { err.textContent = msg; err.hidden = false; }
      else if (!(err.classList.contains('row-err') && err.closest('.line').querySelector('[aria-invalid="true"]'))) { err.textContent = ''; err.hidden = true; }
    }
    return !msg;
  }

  // ---------- job form binding ----------
  function fillJobForm() {
    var j = S.job;
    $$('[data-bind]').forEach(function (el) {
      var v = getPath(j, el.getAttribute('data-bind'));
      if (el.type === 'radio') el.checked = String(v) === el.value;
      else el.value = v == null ? '' : v;
      validateInput(el);
    });
    renderLists(); syncFormUi();
  }
  function syncFormUi() {
    var j = S.job;
    $('#secMaterials').classList.toggle('is-total', j.materialsMode === 'total');
    var none = j.fee.preset === 'none';
    ['#feePct', '#feeFixed', '#feePayments'].forEach(function (s) { $(s).disabled = none; });
    var oh = j.overhead.mode;
    $('#ohValueField').hidden = oh === 'none';
    $('#ohPre').hidden = oh !== 'flat'; $('#ohSuf').hidden = oh !== 'percent';
    $('#ohValueLabel').textContent = oh === 'flat' ? 'Overhead amount' : 'Overhead % of price';
  }

  var LIST_DEF = {
    materials: { el: '#materialsLines', blank: function () { return { name: '', qty: '1', unitCost: '' }; }, noun: 'material' },
    crew: { el: '#crewLines', blank: function () { return blankCrew(); }, noun: 'crew member' },
    otherCosts: { el: '#otherLines', blank: function (cat) { return { category: cat || 'other', name: '', amount: '' }; }, noun: 'cost' }
  };
  function field(id, label, key, val, opts) {
    opts = opts || {};
    var input = '<input id="' + id + '" data-key="' + key + '" type="text" value="' + esc(val) + '"' + (opts.num ? ' data-num inputmode="decimal"' : '') + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '>';
    if (opts.pre || opts.suf) input = '<div class="affix">' + (opts.pre ? '<span class="pre" aria-hidden="true">' + opts.pre + '</span>' : '') + input + (opts.suf ? '<span class="suf" aria-hidden="true">' + opts.suf + '</span>' : '') + '</div>';
    return '<div class="field ' + (opts.cls || '') + '"><label for="' + id + '">' + label + '</label>' + input + '</div>';
  }
  function renderLists() {
    var j = S.job;
    $('#materialsLines').innerHTML = j.materials.map(function (m, i) {
      return '<div class="line mat" data-i="' + i + '">' + field('m-name-' + i, 'Item', 'name', m.name, { cls: 'f-name', ph: 'e.g. 2×6 decking' }) +
        field('m-qty-' + i, 'Qty', 'qty', m.qty, { num: 1, cls: 'f-qty' }) + field('m-cost-' + i, 'Unit cost', 'unitCost', m.unitCost, { num: 1, pre: '$', cls: 'f-cost', ph: '0.00' }) +
        '<output class="line-total" aria-label="Line total"></output><button type="button" class="icon-btn" data-remove aria-label="Remove material ' + esc(m.name || (i + 1)) + '">×</button><p class="err row-err" hidden></p></div>';
    }).join('') || '<p class="hint empty-line">No materials yet.</p>';
    $('#crewLines').innerHTML = j.crew.map(function (p, i) {
      var sub = p.type === 'sub';
      var typeSel = '<div class="field f-type"><label for="c-type-' + i + '">Paid as</label><select id="c-type-' + i + '" data-key="type">' +
        '<option value="employee"' + (sub ? '' : ' selected') + '>Employee (W-2)</option><option value="sub"' + (sub ? ' selected' : '') + '>1099 / subcontractor</option></select></div>';
      var wage = field('c-wage-' + i, sub ? 'Hourly rate' : 'Hourly wage', 'wage', p.wage, { num: 1, pre: '$', cls: 'f-cost', ph: '0.00' });
      wage = wage.replace(/<\/div>$/, '<p class="hint loaded-rate" id="c-load-' + i + '" aria-live="polite"></p></div>');
      return '<div class="line crew' + (sub ? ' is-sub' : '') + '" data-i="' + i + '">' + field('c-name-' + i, 'Role / name', 'name', p.name, { cls: 'f-name', ph: 'e.g. Helper' }) + typeSel +
        wage + field('c-hours-' + i, 'Hours', 'hours', p.hours, { num: 1, cls: 'f-qty', ph: '0' }) +
        field('c-pd-' + i, 'Per diem / travel', 'perDiem', sub ? '' : p.perDiem, { num: 1, pre: '$', cls: 'f-pd', ph: '0.00' }).replace('<input ', sub ? '<input disabled title="1099 subcontractors get no burden or per diem" ' : '<input ') +
        '<output class="line-total" aria-label="Line total"></output><button type="button" class="icon-btn" data-remove aria-label="Remove crew member ' + esc(p.name || (i + 1)) + '">×</button><p class="err row-err" hidden></p></div>';
    }).join('') || '<p class="hint empty-line">No paid crew — just you? Leave this empty and enter your hours below.</p>';
    $('#otherLines').innerHTML = j.otherCosts.map(function (o, i) {
      var opts = Object.keys(C.OTHER_CATEGORIES).map(function (k) { return '<option value="' + k + '"' + (k === o.category ? ' selected' : '') + '>' + C.OTHER_CATEGORIES[k] + '</option>'; }).join('');
      return '<div class="line other" data-i="' + i + '"><div class="field f-cat"><label for="o-cat-' + i + '">Type</label><select id="o-cat-' + i + '" data-key="category">' + opts + '</select></div>' +
        field('o-name-' + i, 'Description', 'name', o.name, { cls: 'f-name', ph: 'e.g. Dumpster rental' }) + field('o-amt-' + i, 'Amount', 'amount', o.amount, { num: 1, pre: '$', cls: 'f-cost', ph: '0.00' }) +
        '<button type="button" class="icon-btn" data-remove aria-label="Remove cost ' + esc(o.name || (i + 1)) + '">×</button><p class="err row-err" hidden></p></div>';
    }).join('') || '<p class="hint empty-line">Nothing here yet. Add equipment rental, permits, subcontractors or anything else this job costs.</p>';
    $$('.lines [data-num]').forEach(validateInput);
  }

  function onJobInput(e) {
    var el = e.target;
    if (el.hasAttribute('data-bind')) {
      var path = el.getAttribute('data-bind');
      if (el.type === 'radio' && !el.checked) return;
      setPath(S.job, path, el.value);
      if (path === 'fee.preset' && C.PRESETS[el.value]) {
        S.job.fee.pct = String(C.PRESETS[el.value].pct); S.job.fee.fixed = C.PRESETS[el.value].fixed.toFixed(2);
        $('#feePct').value = S.job.fee.pct; $('#feeFixed').value = S.job.fee.fixed;
      }
      if ((path === 'fee.pct' || path === 'fee.fixed') && C.PRESETS[S.job.fee.preset] && S.job.fee.preset !== 'none') {
        var pr = C.PRESETS[S.job.fee.preset];
        if (C.num(S.job.fee.pct) !== pr.pct || C.num(S.job.fee.fixed) !== pr.fixed) { S.job.fee.preset = 'custom'; $('#feePreset').value = 'custom'; }
      }
      if (path === 'customer.name') S.job.client = el.value;
      syncFormUi();
    } else if (el.hasAttribute('data-key')) {
      var row = el.closest('.line'), list = row.parentElement.getAttribute('data-list');
      S.job[list][+row.getAttribute('data-i')][el.getAttribute('data-key')] = el.value;
      if (list === 'crew' && el.getAttribute('data-key') === 'type') {
        if (el.value === 'sub') S.job.crew[+row.getAttribute('data-i')].perDiem = '';
        var fid = el.id; renderLists(); var nf = document.getElementById(fid); if (nf) nf.focus();
      }
    } else return;
    validateInput(el);
    recalc();
  }

  // ---------- results ----------
  var SEGMENTS = [
    ['materials', 'Materials', '#2f5d8c'], ['labor', 'Crew labor', '#5a8fd0'], ['travel', 'Shipping & travel', '#8db4e2'],
    ['equipment', 'Equipment / rental', '#56657d'], ['permits', 'Permits & fees', '#8995a9'], ['subcontractor', 'Subcontractors', '#33415a'],
    ['other', 'Other costs', '#b4bdcc'], ['fees', 'Card fees', '#c26a2b'], ['overhead', 'Overhead', '#9b7b46'], ['tax', 'Tax set-aside', '#6e5aa0'], ['profit', 'Net profit', '#1f8a4c']
  ];
  function segValues(r) {
    var d = r.direct;
    return { materials: d.materials, labor: d.labor, travel: d.travel, equipment: d.equipment, permits: d.permits, subcontractor: d.subcontractor, other: d.other,
      fees: r.feesCents, overhead: r.overheadCents, tax: r.taxSetAsideCents, profit: Math.max(0, r.netProfitCents) };
  }
  function renderChart(r) {
    var v = segValues(r), price = r.priceCents;
    var total = SEGMENTS.reduce(function (s, x) { return s + v[x[0]]; }, 0);
    var base = Math.max(price, total);
    var el = $('#chart');
    if (base === 0) { el.innerHTML = '<p class="hint">Your cost breakdown appears here as you type.</p>'; return; }
    var bar = SEGMENTS.filter(function (x) { return v[x[0]] > 0; }).map(function (x) {
      return '<span class="seg-' + x[0] + '" style="width:' + (v[x[0]] / base * 100).toFixed(3) + '%;background:' + x[2] + '" title="' + x[1] + ': ' + money(v[x[0]]) + '"></span>';
    }).join('');
    var marker = r.isLoss && price > 0 ? '<span class="price-marker" style="left:' + (price / base * 100).toFixed(3) + '%"><span>Price</span></span>' : '';
    var desc = SEGMENTS.filter(function (x) { return v[x[0]] > 0; }).map(function (x) { return x[1] + ' ' + money(v[x[0]]); }).join(', ');
    var legend = SEGMENTS.filter(function (x) { return v[x[0]] > 0 || x[0] === 'profit'; }).map(function (x) {
      var isP = x[0] === 'profit', val = isP ? r.netProfitCents : v[x[0]];
      var share = price > 0 ? C.percent(val / price, 0) : '—';
      return '<li class="' + (isP ? 'lg-profit' + (val < 0 ? ' neg' : '') : '') + '"><span class="sw" style="background:' + (isP && val < 0 ? '#b42318' : x[2]) + '"></span><span class="lg-name">' + (isP && val < 0 ? 'Net loss' : x[1]) + '</span><span class="lg-val">' + money(val) + '</span><span class="lg-pct">' + share + '</span></li>';
    }).join('');
    el.innerHTML = '<div class="stack" role="img" aria-label="' + esc('Cost breakdown of ' + money(price) + ': ' + desc + (r.isLoss ? '. Costs exceed the price.' : '')) + '">' + bar + marker + '</div>' +
      '<ul class="legend">' + legend + '</ul><p class="legend-note">% of price charged</p>';
  }
  function renderMath(r) {
    var d = r.direct, rows = [];
    var add = function (op, label, c, cls) { rows.push('<tr class="' + (cls || '') + '"><td class="op">' + op + '</td><th scope="row">' + label + '</th><td class="num">' + money(c) + '</td></tr>'); };
    add('', 'Price charged', r.priceCents);
    if (d.materials) add('−', 'Materials', d.materials);
    if (d.labor) {
      if (d.laborBurden) { add('−', 'Crew wages', d.laborWages); add('−', 'Labor burden (payroll tax, comp, benefits, per diem)', d.laborBurden); }
      else add('−', 'Crew labor', d.labor);
    }
    if (d.travel) add('−', 'Shipping & travel', d.travel);
    if (d.equipment) add('−', 'Equipment / rental', d.equipment);
    if (d.permits) add('−', 'Permits & fees', d.permits);
    if (d.subcontractor) add('−', 'Subcontractors', d.subcontractor);
    if (d.other) add('−', 'Other costs', d.other);
    add('=', 'Gross profit', r.grossProfitCents, 'sum');
    add('−', 'Card fees (' + r.feePct + '% + ' + money(r.feeFixedCents) + ' × ' + r.feePayments + ')', r.feesCents);
    if (r.overheadCents) add('−', 'Overhead', r.overheadCents);
    add('=', 'Profit before tax', r.profitBeforeTaxCents, 'sum');
    if (r.taxPct) add('−', 'Tax set-aside (' + r.taxPct + '% of profit)', r.taxSetAsideCents);
    add('=', 'Net profit', r.netProfitCents, 'sum total' + (r.netProfitCents < 0 ? ' neg' : ''));
    rows.push('<tr><td class="op">÷</td><th scope="row">' + (r.hoursBasis === 'owner' ? 'Your hours' : 'All hours (crew ' + C.hours(r.crewHours) + ' + you ' + C.hours(r.ownerHours) + ')') + '</th><td class="num">' + C.hours(r.basisHours) + '</td></tr>');
    rows.push('<tr class="sum total"><td class="op">=</td><th scope="row">Profit per hour</th><td class="num">' + (r.profitPerHourCents === null ? '—' : money(r.profitPerHourCents)) + '</td></tr>');
    $('#mathTable').innerHTML = '<caption class="visually-hidden">Calculation steps</caption><tbody>' + rows.join('') + '</tbody>';
  }
  function biggestCost(r) {
    var v = segValues(r), best = null;
    SEGMENTS.forEach(function (x) { if (x[0] !== 'profit' && x[0] !== 'tax' && (!best || v[x[0]] > v[best[0]])) best = x; });
    return best && v[best[0]] > 0 ? best[1].toLowerCase() + ' (' + money(v[best[0]]) + ')' : null;
  }
  function renderResults(r) {
    var neg = r.netProfitCents < 0;
    var set = function (id, txt, isNeg) { var e = $(id); e.textContent = txt; e.classList.toggle('neg', !!isNeg); };
    set('#outNet', r.priceCents || r.totalCostsCents ? money(r.netProfitCents) : '—', neg);
    $('#outNetSub').textContent = r.priceCents ? 'on ' + money(r.priceCents) + ' · ' + C.percent(r.netMargin) + ' margin' : '';
    set('#outPph', r.profitPerHourCents === null ? '—' : money(r.profitPerHourCents) + '/hr', r.profitPerHourCents !== null && r.profitPerHourCents < 0);
    set('#outMargin', C.percent(r.netMargin), r.netMargin !== null && r.netMargin < 0);
    set('#outMarkup', C.percent(r.markup), r.markup !== null && r.markup < 0);
    set('#outCosts', money(r.totalCostsCents));
    set('#outGross', money(r.grossProfitCents), r.grossProfitCents < 0);
    set('#outRate', r.billedRateCents === null ? '—' : money(r.billedRateCents) + '/hr');
    set('#outBE', r.breakEvenCents === null ? 'Not reachable' : money(r.breakEvenCents));
    $('#mbNet').textContent = $('#outNet').textContent; $('#mbNet').classList.toggle('neg', neg);
    $('#mbPph').textContent = $('#outPph').textContent; $('#mbPph').classList.toggle('neg', $('#outPph').classList.contains('neg'));

    // Value message
    var vm = $('#valueMsg'), html, cls = '';
    if (!r.priceCents) html = S.mode === 'reverse' ? 'Set a target to get your quote price.' : 'Enter your price to see what you <strong>really</strong> make per hour after everything.';
    else if (r.profitPerHourCents === null) html = 'Net profit is <strong>' + money(r.netProfitCents) + '</strong>. Add hours to see what you really make per hour.';
    else if (neg) { cls = 'neg'; html = 'This job <strong>loses ' + money(-r.netProfitCents) + '</strong> — that\u2019s <strong>' + money(r.profitPerHourCents) + '</strong> for every hour worked.'; }
    else html = 'You really make <strong>' + money(r.profitPerHourCents) + '/hr</strong> ' + (r.hoursBasis === 'owner' ? 'of your own time' : 'per hour worked') + ' after everything' + (r.billedRateCents ? ' — not the ' + money(r.billedRateCents) + '/hr the price suggests.' : '.');
    vm.innerHTML = html; vm.className = 'value-msg ' + cls;

    // Loss explanation
    var la = $('#lossAlert');
    if (r.isLoss) {
      var big = biggestCost(r);
      la.innerHTML = '<strong>Losing money: ' + money(r.netProfitCents) + '.</strong> Your costs (' + money(r.totalCostsCents) + ') are more than the price (' + money(r.priceCents) + ').' +
        (big ? ' Biggest cost: ' + esc(big) + '.' : '') +
        (r.breakEvenCents === null ? ' Card fees plus overhead are 100% or more of the price, so no price can break even — lower those percentages.' : ' To break even, charge at least <strong>' + money(r.breakEvenCents) + '</strong>' + (S.mode === 'profit' ? ', or switch to <em>Find my price</em> to hit a real target.' : '.'));
      la.hidden = false;
    } else la.hidden = true;
    $('#warnings').innerHTML = r.warnings.filter(function (w) { return w.code !== 'loss' && !(w.code === 'no-price' && S.mode === 'reverse'); }).map(function (w) { return '<li>' + esc(w.text) + '</li>'; }).join('');

    // Section totals
    var d = r.direct;
    $('#matTotalOut').textContent = d.materials ? money(d.materials) : '';
    $('#laborTotalOut').textContent = d.labor ? money(d.labor) + ' · ' + C.hours(r.totalHours) : (r.totalHours ? C.hours(r.totalHours) : '');
    $('#travelTotalOut').textContent = d.travel ? money(d.travel) : '';
    $('#feeTotalOut').textContent = r.feesCents ? money(r.feesCents) : '';
    var oth = d.equipment + d.permits + d.subcontractor + d.other;
    $('#otherTotalOut').textContent = oth ? money(oth) : '';
    $$('#materialsLines .line').forEach(function (row, i) { var m = d.materialsLines[i]; row.querySelector('.line-total').textContent = m ? money(m.cents) : ''; });
    $$('#crewLines .line').forEach(function (row, i) {
      var c = d.crewLines[i]; row.querySelector('.line-total').textContent = c ? money(c.cents) : '';
      var lr = row.querySelector('.loaded-rate');
      if (lr && c) lr.textContent = c.type === 'sub' ? '1099 — no burden' : (c.wageCents ? 'Loaded cost ' + money(c.loadedHourlyCents) + '/hr' : '');
    });
    var b = C.burdenSettings(S.job.burden);
    $('#burdenSummary').textContent = (Math.round(b.pct * 100) / 100) + '% of wages' + (b.hourlyCents ? ' + ' + money(b.hourlyCents) + '/hr' : '') + (d.laborBurden ? ' · ' + money(d.laborBurden) + ' on this job' : '');
    renderChart(r); renderMath(r);
  }

  function renderQuote() {
    var t = S.target;
    var pr = C.priceForTarget(S.job, { type: t.type, value: t.value, roundTo: t.roundTo });
    var valid = C.isValidInput(t.value) && C.num(t.value) >= 0 && String(t.value).trim() !== '';
    S.lastQuote = valid && pr.ok ? pr : null;
    $('#quotePrice').textContent = S.lastQuote ? money(pr.priceCents) : '—';
    var r = S.lastQuote && pr.result;
    var note = '';
    if (!valid) note = 'Enter a target to calculate your quote.';
    else if (!pr.ok) note = pr.reason;
    else if (pr.priceCents === 0) note = 'Add your costs below to get a price.';
    else note = 'At this price: net profit ' + money(r.netProfitCents) + ', ' + C.percent(r.netMargin) + ' margin' + (r.profitPerHourCents !== null ? ', ' + money(r.profitPerHourCents) + '/hr' : '') + '. Break-even is ' + money(r.breakEvenCents) + '.';
    $('#quoteNote').textContent = note;
    $('#quoteOut').classList.toggle('bad', valid && !pr.ok);
    $('#useQuote').disabled = $('#quoteEstimate').disabled = !(S.lastQuote && pr.priceCents > 0);
    return S.lastQuote ? pr.result : null;
  }

  function saveDraftNow() { store.saveDraft(S.job); store.saveUi({ mode: S.mode, target: S.target }); }
  var saveDraft = debounce(saveDraftNow, 250);
  window.addEventListener('pagehide', function () { saveDraftNow(); persistDocs(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { saveDraftNow(); persistDocs(); } });

  function recalc() {
    var r = null;
    if (S.mode === 'reverse') r = renderQuote();
    if (!r) r = C.calculate(S.job);
    S.lastResult = r;
    renderResults(r);
    renderSaveStatus();
    saveDraft();
  }

  // ---------- modes ----------
  function setMode(m, focus) {
    S.mode = m === 'reverse' ? 'reverse' : 'profit';
    $('#calcGrid').classList.toggle('is-reverse', S.mode === 'reverse');
    $$('.modebar [role="tab"]').forEach(function (b) {
      var on = b.getAttribute('data-mode') === S.mode;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    $('#calcGrid').setAttribute('aria-labelledby', S.mode === 'reverse' ? 'modeReverse' : 'modeProfit');
    $('#secPrice legend').innerHTML = '<span class="num">1</span> ' + (S.mode === 'reverse' ? 'Your target' : 'Price');
    recalc();
  }
  function syncTargetUi() {
    var t = S.target.type;
    $$('input[name="targetType"]').forEach(function (r) { r.checked = r.value === t; });
    $('#targetValue').value = S.target.value;
    $('#roundTo').value = S.target.roundTo;
    $('#targetLabel').textContent = t === 'margin' ? 'Target net margin' : t === 'hourly' ? 'Target profit per hour' + (S.job.hoursBasis === 'owner' ? ' (your hours)' : ' (all hours)') : 'Target net profit for the job';
    $('#targetPre').hidden = t === 'margin'; $('#targetSuf').hidden = t !== 'margin';
    $('#targetSuf').textContent = '%';
  }

  // ---------- jobs ----------
  function savedVersion(id) { return S.jobs.filter(function (j) { return j.id === id; })[0]; }
  function stripMeta(j) { var c = clone(j); delete c.updatedAt; delete c.createdAt; return JSON.stringify(c); }
  function renderSaveStatus() {
    var el = $('#saveStatus'), sv = S.job.id && savedVersion(S.job.id);
    if (!sv) el.innerHTML = '<span class="pill pill-muted">Not saved</span>';
    else if (stripMeta(sv) !== stripMeta(S.job)) el.innerHTML = '<span class="pill pill-warn">Unsaved changes</span>';
    else el.innerHTML = '<span class="pill pill-ok">Saved</span>';
  }
  function persistJobs() { if (!store.saveJobs(S.jobs)) toast('Could not save — this browser\u2019s storage is full or disabled.'); }
  function saveJob() {
    var now = new Date().toISOString();
    if (!S.job.name.trim()) { S.job.name = 'Untitled job ' + (S.jobs.length + 1); $('#jobName').value = S.job.name; }
    if (S.job.id && savedVersion(S.job.id)) {
      S.job.updatedAt = now;
      S.jobs = S.jobs.map(function (j) { return j.id === S.job.id ? clone(S.job) : j; });
    } else {
      S.job.id = uid('j'); S.job.createdAt = now; S.job.updatedAt = now;
      S.jobs.push(clone(S.job));
    }
    persistJobs(); recalc(); saveDraftNow(); renderJobs();
    toast('Saved “' + S.job.name + '”');
  }
  function loadJob(j, msg) {
    S.job = normalizeJob(j); fillJobForm(); syncTargetUi(); recalc();
    if (msg) toast(msg);
  }
  function duplicateJob(src) {
    var copy = normalizeJob(clone(src || S.job));
    var now = new Date().toISOString();
    copy.id = uid('j'); copy.name = (copy.name || 'Untitled job') + ' (copy)'; copy.createdAt = now; copy.updatedAt = now;
    S.jobs.push(clone(copy)); persistJobs();
    loadJob(copy); renderJobs();
    toast('Saved a copy: “' + copy.name + '”. Edit it as a new job.');
  }
  function newJob() {
    var prev = clone(S.job);
    loadJob(freshJob()); go('calculator');
    $('#jobName').focus();
    toast('Started a new job', function () { loadJob(prev); });
  }
  function jobsWithResults() { return S.jobs.map(function (j) { return { job: j, result: C.calculate(j) }; }); }
  function renderJobs() {
    var list = jobsWithResults(), sort = $('#jobsSort').value;
    var key = { pph: function (x) { return x.result.profitPerHourCents === null ? -Infinity : x.result.profitPerHourCents; }, net: function (x) { return x.result.netProfitCents; }, margin: function (x) { return x.result.netMargin === null ? -Infinity : x.result.netMargin; } }[sort];
    if (sort === 'name') list.sort(function (a, b) { return (a.job.name || '').localeCompare(b.job.name || ''); });
    else if (key) list.sort(function (a, b) { return key(b) - key(a); });
    else list.sort(function (a, b) { return String(b.job.updatedAt || '').localeCompare(String(a.job.updatedAt || '')); });
    var best = null;
    list.forEach(function (x) { var v = x.result.profitPerHourCents; if (v !== null && (best === null || v > best)) best = v; });
    $('#jobsEmpty').hidden = list.length > 0; $('#jobsTableWrap').hidden = list.length === 0;
    $('#jobsTable tbody').innerHTML = list.map(function (x) {
      var r = x.result, j = x.job, neg = r.netProfitCents < 0;
      var isBest = list.length > 1 && best !== null && r.profitPerHourCents === best && best > 0;
      return '<tr data-id="' + esc(j.id) + '" class="' + (neg ? 'row-neg' : '') + '">' +
        '<th scope="row" data-label="Job"><span class="job-n">' + esc(j.name || 'Untitled job') + '</span>' + (isBest ? ' <span class="pill pill-gold">Best $/hr</span>' : '') + '<span class="job-c">' + esc((j.customer && j.customer.name) || j.client || '') + '</span></th>' +
        '<td class="num" data-label="Price">' + money(r.priceCents) + '</td><td class="num" data-label="Total costs">' + money(r.totalCostsCents) + '</td>' +
        '<td class="num ' + (neg ? 'neg' : '') + '" data-label="Net profit">' + money(r.netProfitCents) + '</td><td class="num ' + (neg ? 'neg' : '') + '" data-label="Margin">' + C.percent(r.netMargin) + '</td>' +
        '<td class="num" data-label="Hours">' + C.hours(r.totalHours) + '</td><td class="num strong ' + (r.profitPerHourCents < 0 ? 'neg' : '') + '" data-label="Profit / hr">' + (r.profitPerHourCents === null ? '—' : money(r.profitPerHourCents)) + '</td>' +
        '<td class="actions"><button class="btn btn-sm" data-act="open" type="button">Open</button><button class="btn btn-sm" data-act="dup" type="button">Duplicate</button><button class="btn btn-sm" data-act="est" type="button">Estimate</button><button class="btn btn-sm btn-danger-ghost" data-act="del" type="button" aria-label="Delete ' + esc(j.name) + '">Delete</button></td></tr>';
    }).join('');
  }

  // ---------- documents ----------
  function curDoc() { return S.docs.filter(function (d) { return d.id === S.docId; })[0] || null; }
  function persistDocs() { store.saveDocs(S.docs); }
  function persistProfile() { store.saveProfile(S.profile); }
  function createDoc(type, job) {
    var made = D.newDoc(type, job || S.job, S.profile);
    S.profile = made.profile; persistProfile(); fillProfile();
    S.docs.unshift(made.doc); persistDocs();
    S.docId = made.doc.id; go('documents'); renderDocs();
    toast((type === 'invoice' ? 'Invoice ' : 'Estimate ') + made.doc.number + ' created. Review it before sending.');
  }
  function docStatusChip(d) { return '<span class="pill pill-st-' + esc(d.status) + '">' + esc((D.STATUS[d.type] || {})[d.status] || d.status) + '</span>'; }
  function renderDocs() {
    var f = S.docFilter;
    var list = S.docs.filter(function (d) { return f === 'all' || d.type === f; });
    $('#docsEmpty').hidden = list.length > 0;
    $('#docsList').innerHTML = list.map(function (d) {
      var t = D.docTotals(d);
      return '<li><button type="button" data-doc="' + esc(d.id) + '" class="' + (d.id === S.docId ? 'active' : '') + '" aria-current="' + (d.id === S.docId) + '">' +
        '<span class="dl-top"><span class="dl-num">' + (d.type === 'invoice' ? 'Invoice ' : 'Estimate ') + esc(d.number) + '</span>' + docStatusChip(d) + '</span>' +
        '<span class="dl-bot"><span>' + esc(d.customer.name || 'No customer') + '</span><span>' + money(t.total) + '</span></span></button></li>';
    }).join('');
    var d = curDoc();
    $('#docWorkspace').hidden = !d;
    if (!d) return;
    fillDocForm(d); renderDocPreview();
  }
  function fillDocForm(d) {
    $('#docEditorTitle').textContent = (d.type === 'invoice' ? 'Invoice ' : 'Estimate ') + d.number;
    var st = D.STATUS[d.type];
    $('#docStatus').innerHTML = Object.keys(st).map(function (k) { return '<option value="' + k + '">' + st[k] + '</option>'; }).join('');
    $$('[data-dbind]').forEach(function (el) { var v = getPath(d, el.getAttribute('data-dbind')); el.value = v == null ? '' : v; validateInput(el); });
    $('#docDueLabel').textContent = d.type === 'invoice' ? 'Due date' : 'Valid until';
    $('#docPaidLabel').textContent = d.type === 'invoice' ? 'Payments received' : 'Deposit required';
    var conv = $('#convertDoc');
    conv.hidden = d.type === 'invoice';
    conv.textContent = d.convertedTo ? 'Open invoice ' + d.convertedTo : 'Convert to invoice';
    $('#rbJob').innerHTML = '<option value="__current">Current job: ' + esc(S.job.name || 'Untitled') + '</option>' + S.jobs.map(function (j) { return '<option value="' + esc(j.id) + '"' + (j.id === d.jobId ? ' selected' : '') + '>' + esc(j.name || 'Untitled') + '</option>'; }).join('');
    $('#rbMarkup').value = S.profile.markupPct;
    renderDocLines(d);
  }
  function renderDocLines(d) {
    $('#docLines').innerHTML = d.lines.map(function (l, i) {
      return '<div class="line docline" data-i="' + i + '">' +
        '<div class="field f-name"><label for="dl-desc-' + i + '">Description</label><input id="dl-desc-' + i + '" data-lkey="description" type="text" value="' + esc(l.description) + '"></div>' +
        '<div class="field f-qty"><label for="dl-qty-' + i + '">Qty</label><input id="dl-qty-' + i + '" data-lkey="qty" data-num inputmode="decimal" type="text" value="' + esc(l.qty) + '"></div>' +
        '<div class="field f-unit"><label for="dl-unit-' + i + '">Unit</label><input id="dl-unit-' + i + '" data-lkey="unit" type="text" value="' + esc(l.unit) + '"></div>' +
        '<div class="field f-cost"><label for="dl-price-' + i + '">Unit price</label><div class="affix"><span class="pre" aria-hidden="true">$</span><input id="dl-price-' + i + '" data-lkey="unitPrice" data-num inputmode="decimal" type="text" value="' + esc(l.unitPrice) + '"></div></div>' +
        '<div class="field f-tax"><label for="dl-tax-' + i + '">Taxable</label><input id="dl-tax-' + i + '" data-lkey="taxable" type="checkbox"' + (l.taxable === false ? '' : ' checked') + '></div>' +
        '<output class="line-total" aria-label="Line amount">' + money(D.lineAmount(l)) + '</output>' +
        '<button type="button" class="icon-btn" data-dl-remove aria-label="Remove line ' + esc(l.description || (i + 1)) + '">×</button><p class="err row-err" hidden></p></div>';
    }).join('') || '<p class="hint empty-line">No line items. Add one, or rebuild from a job below.</p>';
    $$('#docLines [data-num]').forEach(validateInput);
  }
  function renderDocPreview() {
    var d = curDoc(); if (!d) return;
    $('#docPreview').innerHTML = D.renderCustomerDoc(d, S.profile, CFG);
    $('#profileHint').hidden = !!(S.profile.companyName || '').trim();
    var t = D.docTotals(d), isInv = d.type === 'invoice';
    $('#docSum').innerHTML = '<div><dt>Subtotal</dt><dd>' + money(t.subtotal) + '</dd></div>' + (t.discount ? '<div><dt>Discount</dt><dd>−' + money(t.discount) + '</dd></div>' : '') +
      (t.taxPct ? '<div><dt>Sales tax</dt><dd>' + money(t.salesTax) + '</dd></div>' : '') + '<div><dt>Total</dt><dd class="strong">' + money(t.total) + '</dd></div>' +
      '<div><dt>' + (isInv ? 'Balance due' : 'Balance after deposit') + '</dt><dd>' + money(t.balance) + '</dd></div>';
    $$('#docLines .line').forEach(function (row, i) { if (d.lines[i]) row.querySelector('.line-total').textContent = money(D.lineAmount(d.lines[i])); });
  }
  var saveDocsSoon = debounce(persistDocs, 300);
  function renderDocsListShallow() {
    var d = curDoc(); if (!d) return;
    var btn = $('#docsList [data-doc="' + d.id + '"]'); if (!btn) return;
    var t = D.docTotals(d);
    btn.querySelector('.dl-top').innerHTML = '<span class="dl-num">' + (d.type === 'invoice' ? 'Invoice ' : 'Estimate ') + esc(d.number) + '</span>' + docStatusChip(d);
    btn.querySelector('.dl-bot').innerHTML = '<span>' + esc(d.customer.name || 'No customer') + '</span><span>' + money(t.total) + '</span>';
    $('#docEditorTitle').textContent = (d.type === 'invoice' ? 'Invoice ' : 'Estimate ') + d.number;
  }
  function onDocInput(e) {
    var d = curDoc(), el = e.target; if (!d) return;
    if (el.hasAttribute('data-dbind')) setPath(d, el.getAttribute('data-dbind'), el.value);
    else if (el.hasAttribute('data-lkey')) {
      var i = +el.closest('.line').getAttribute('data-i'), k = el.getAttribute('data-lkey');
      d.lines[i][k] = el.type === 'checkbox' ? el.checked : el.value;
    } else return;
    validateInput(el);
    renderDocPreview(); renderDocsListShallow(); saveDocsSoon();
  }
  function printNow(kind) {
    var root = $('#printRoot');
    if (kind === 'doc') { var d = curDoc(); if (!d) return; root.innerHTML = D.renderCustomerDoc(d, S.profile, CFG); }
    else root.innerHTML = D.renderJobSheet(S.job, S.lastResult || C.calculate(S.job), S.profile, CFG);
    document.body.setAttribute('data-print', kind);
    window.print();
  }
  window.addEventListener('beforeprint', function () {
    // Ctrl/Cmd+P without a button: print whatever the current screen is about.
    if (document.body.getAttribute('data-print')) return;
    var root = $('#printRoot');
    if (S.view === 'documents' && curDoc()) { root.innerHTML = D.renderCustomerDoc(curDoc(), S.profile, CFG); document.body.setAttribute('data-print', 'doc'); }
    else { root.innerHTML = D.renderJobSheet(S.job, S.lastResult || C.calculate(S.job), S.profile, CFG); document.body.setAttribute('data-print', 'jobsheet'); }
  });
  window.addEventListener('afterprint', function () { document.body.removeAttribute('data-print'); });

  // ---------- profile ----------
  function fillProfile() {
    $$('[data-pbind]').forEach(function (el) { var v = S.profile[el.getAttribute('data-pbind')]; el.value = v == null ? '' : v; });
    var lp = $('#logoPreview');
    lp.innerHTML = S.profile.logo ? '<img src="' + S.profile.logo + '" alt="Your logo">' : '<span class="muted">No logo</span>';
    $('#pfLogoRemove').hidden = !S.profile.logo;
  }
  var profileSaved = debounce(function () { persistProfile(); $('#profileSaved').textContent = 'Saved on this device.'; }, 300);
  function onProfileInput(e) {
    var el = e.target; if (!el.hasAttribute('data-pbind')) return;
    var k = el.getAttribute('data-pbind');
    S.profile[k] = el.value;
    if (k === 'paymentLink') {
      var bad = el.value.trim() && !D.safeUrl(el.value);
      el.setAttribute('aria-invalid', bad ? 'true' : 'false');
      var er = $('#pfPayLink-err'); er.hidden = !bad; er.textContent = bad ? 'Enter a web link that starts with https:// — it won\u2019t print until it\u2019s valid.' : '';
    }
    profileSaved();
  }
  function onLogo(e) {
    var file = e.target.files && e.target.files[0], err = $('#pfLogo-err');
    err.hidden = true;
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { err.textContent = 'Please choose a PNG, JPG, GIF or WebP image.'; err.hidden = false; return; }
    if (file.size > 2 * 1024 * 1024) { err.textContent = 'That image is over 2 MB. Please choose a smaller one.'; err.hidden = false; return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 600, maxH = 240, s = Math.min(1, max / img.width, maxH / img.height);
        var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        S.profile.logo = cv.toDataURL('image/png');
        persistProfile(); fillProfile(); renderDocPreview();
        toast('Logo saved');
      };
      img.onerror = function () { err.textContent = 'That file could not be read as an image.'; err.hidden = false; };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------- backup / restore ----------
  function backup() {
    var b = ST.makeBackup({ profile: S.profile, jobs: S.jobs, docs: S.docs, draft: S.job }, CFG.name);
    download(slug(CFG.name) + '-backup-' + D.isoDate(new Date()) + '.json', JSON.stringify(b, null, 2), 'application/json');
    toast('Backup downloaded: ' + S.jobs.length + ' jobs, ' + S.docs.length + ' documents.');
  }
  function restore(e) {
    var file = e.target.files && e.target.files[0], err = $('#restore-err');
    err.hidden = true;
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var res = ST.parseBackup(String(reader.result));
      e.target.value = '';
      if (!res.ok) { err.textContent = res.error; err.hidden = false; return; }
      var s = res.summary;
      var when = s.exportedAt ? ' (saved ' + new Date(s.exportedAt).toLocaleString(CFG.locale) + ')' : '';
      if (!window.confirm('Replace all data on this device with this backup' + when + '?\n\nIt contains ' + s.jobs + ' jobs, ' + s.estimates + ' estimates and ' + s.invoices + ' invoices. Your current jobs, documents and business profile on this device will be replaced.')) return;
      S.jobs = res.data.jobs; S.docs = res.data.docs;
      S.profile = Object.assign(D.defaultProfile(), res.data.profile || {});
      persistJobs(); persistDocs(); persistProfile();
      if (res.data.draft) loadJob(res.data.draft);
      S.docId = null; fillProfile(); renderJobs(); renderDocs(); recalc();
      toast('Backup restored: ' + s.jobs + ' jobs, ' + (s.estimates + s.invoices) + ' documents.');
    };
    reader.readAsText(file);
  }

  // ---------- templates ----------
  function renderTemplates() {
    $('#tplGrid').innerHTML = T.map(function (t) {
      var r = C.calculate(templateJob(t.id)); // with your profile labor burden, same as when loaded
      return '<article class="card tpl"><div class="tpl-top"><span class="tpl-icon" aria-hidden="true">' + t.icon + '</span><span class="tpl-trade">' + esc(t.trade) + '</span></div>' +
        '<h2>' + esc(t.job.name) + '</h2><p>' + esc(t.blurb) + '</p>' +
        '<dl class="tpl-stats"><div><dt>Price</dt><dd>' + money(r.priceCents) + '</dd></div><div><dt>Net profit</dt><dd>' + money(r.netProfitCents) + '</dd></div><div><dt>Profit / hr</dt><dd>' + (r.profitPerHourCents === null ? '—' : money(r.profitPerHourCents)) + '</dd></div></dl>' +
        '<div class="tpl-actions"><button class="btn btn-primary" type="button" data-tpl="' + t.id + '" data-tpl-act="load">Load into calculator</button><button class="btn" type="button" data-tpl="' + t.id + '" data-tpl-act="copy">Save a copy as my template</button></div></article>';
    }).join('');
  }
  function templateJob(id) { var t = T.filter(function (x) { return x.id === id; })[0]; if (!t) return null; var j = normalizeJob(clone(t.job)); if (!j.burden) j.burden = profileBurden(); return j; }

  // ---------- routing ----------
  var VIEWS = ['calculator', 'jobs', 'documents', 'blueprints', 'profile', 'plans'];
  function go(v, noScroll) {
    if (VIEWS.indexOf(v) < 0) v = 'calculator';
    S.view = v;
    $$('.view').forEach(function (s) { s.hidden = s.getAttribute('data-view') !== v; });
    $$('[data-view-link]').forEach(function (a) { if (a.getAttribute('data-view-link') === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.body.setAttribute('data-view', v);
    if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
    if (v === 'jobs') renderJobs();
    if (v === 'documents') renderDocs();
    if (!noScroll) window.scrollTo(0, 0);
  }

  // ---------- tour ----------
  var TOUR = [
    { target: '.modebar', title: 'Price a job — or check one', body: 'Choose “Find my price” to get the exact quote for the margin or hourly profit you want, or “Check my profit” when you already have a price. A sample deck repair is filled in so you can see it work.' },
    { target: '#secMaterials', title: 'Add every cost', body: 'Materials, crew hours, mileage, card fees, permits, subcontractors and overhead. Leave anything that doesn\u2019t apply blank — blanks count as zero.' },
    { target: '#results', title: 'See what you really make', body: 'Profit per hour = net profit ÷ hours worked, after every cost and your tax set-aside. Save the job, compare jobs, or turn it into a branded estimate.' }
  ];
  var tourI = 0, tourFirst = false;
  function tourShow(i) {
    tourI = i;
    var s = TOUR[i], el = $(s.target);
    $$('.tour-target').forEach(function (e) { e.classList.remove('tour-target'); });
    if (el) { el.classList.add('tour-target'); el.scrollIntoView({ block: window.innerWidth < 980 ? 'start' : 'center', behavior: 'auto' }); }
    $('#tourStep').textContent = 'Step ' + (i + 1) + ' of ' + TOUR.length;
    $('#tourTitle').textContent = s.title; $('#tourBody').textContent = s.body;
    $('#tourCred').hidden = i !== 0;
    var needAgree = tourFirst && !store.termsAccepted();
    $('#tourAgree').hidden = !(i === 0 && needAgree);
    $('#tourBack').hidden = i === 0;
    $('#tourNext').textContent = i === TOUR.length - 1 ? 'Done' : 'Next';
    tourGate();
  }
  function tourGate() {
    var blocked = tourFirst && !store.termsAccepted() && !$('#agreeTerms').checked;
    $('#tourNext').disabled = blocked; $('#tourSkip').disabled = blocked;
  }
  function tourOpen(first) {
    tourFirst = !!first; go('calculator', true);
    $('#tour').hidden = false; document.body.classList.add('touring');
    tourShow(0); $('#tourNext').disabled ? $('#agreeTerms').focus() : $('#tourNext').focus();
  }
  function tourClose() {
    if (tourFirst && !store.termsAccepted()) {
      if (!$('#agreeTerms').checked) return;
    }
    if ($('#agreeTerms').checked && !store.termsAccepted()) store.acceptTerms(TERMS_VERSION);
    $('#tour').hidden = true; document.body.classList.remove('touring');
    $$('.tour-target').forEach(function (e) { e.classList.remove('tour-target'); });
    store.setOnboarded(); $('#tourBtn').focus();
    window.scrollTo(0, 0);
  }

  // ---------- events ----------
  function bind() {
    var form = $('#jobForm'), calcView = $('section[data-view="calculator"]');
    calcView.addEventListener('input', onJobInput);
    calcView.addEventListener('change', function (e) { onJobInput(e); if (e.target.name === 'hoursBasis') syncTargetUi(); });
    form.addEventListener('click', function (e) {
      var add = e.target.closest('[data-add]');
      if (add) {
        var list = add.getAttribute('data-add');
        S.job[list].push(LIST_DEF[list].blank(add.getAttribute('data-cat')));
        renderLists(); recalc();
        var rows = $$(LIST_DEF[list].el + ' .line'); var last = rows[rows.length - 1];
        var f = last && last.querySelector(list === 'otherCosts' ? '[data-key="name"]' : 'input'); if (f) f.focus();
        return;
      }
      var rm = e.target.closest('[data-remove]');
      if (rm) {
        var row = rm.closest('.line'), l = row.parentElement.getAttribute('data-list'), i = +row.getAttribute('data-i');
        var removed = S.job[l].splice(i, 1)[0];
        renderLists(); recalc();
        toast('Removed ' + LIST_DEF[l].noun, function () { S.job[l].splice(i, 0, removed); renderLists(); recalc(); });
      }
    });
    // modes
    $$('.modebar [role="tab"]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
    $('.modebar').addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
      e.preventDefault(); setMode(S.mode === 'reverse' ? 'profit' : 'reverse', true);
    });
    $$('input[name="targetType"]').forEach(function (r) { r.addEventListener('change', function () { S.target.type = r.value; if (r.value === 'margin' && C.num(S.target.value) > 95) S.target.value = '30'; if (r.value !== 'margin' && S.target.value === '30') S.target.value = r.value === 'hourly' ? '60' : '1500'; syncTargetUi(); recalc(); }); });
    $('#targetValue').addEventListener('input', function (e) { S.target.value = e.target.value; validateInput(e.target); recalc(); });
    $('#roundTo').addEventListener('change', function (e) { S.target.roundTo = e.target.value; recalc(); });
    function applyQuote() {
      if (!S.lastQuote) return false;
      S.job.price = (S.lastQuote.priceCents / 100).toFixed(2); $('#price').value = S.job.price; return true;
    }
    $('#useQuote').addEventListener('click', function () { if (applyQuote()) { setMode('profit'); toast('Price set to ' + money(S.lastQuote.priceCents)); } });
    $('#quoteEstimate').addEventListener('click', function () { if (applyQuote()) { recalc(); createDoc('estimate', S.job); } });
    // job bar
    $('#saveJob').addEventListener('click', saveJob);
    $('#dupJob').addEventListener('click', function () { duplicateJob(); });
    $('#newJob').addEventListener('click', newJob);
    var mb = $('#moreBtn'), mm = $('#moreMenu');
    function menu(open) { mm.hidden = !open; mb.setAttribute('aria-expanded', String(open)); if (open) mm.querySelector('button').focus(); }
    mb.addEventListener('click', function () { menu(mm.hidden); });
    mm.addEventListener('keydown', function (e) {
      var items = $$('button', mm), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Escape') { menu(false); mb.focus(); }
    });
    document.addEventListener('click', function (e) { if (!mm.hidden && !e.target.closest('.menu')) menu(false); });
    mm.addEventListener('click', function (e) {
      var a = e.target.closest('[data-action]'); if (!a) return; menu(false);
      var act = a.getAttribute('data-action');
      if (act === 'estimate') createDoc('estimate', S.job);
      if (act === 'invoice') createDoc('invoice', S.job);
      if (act === 'print-jobsheet') printNow('jobsheet');
      if (act === 'export-csv') { download(slug(S.job.name) + '.csv', CSV.jobToCsv(S.job, C.calculate(S.job), CFG.name)); toast('CSV downloaded'); }
      if (act === 'templates') go('blueprints');
    });
    $('#mbSee').addEventListener('click', function (e) { e.preventDefault(); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    // jobs view
    $('#jobsSort').addEventListener('change', renderJobs);
    $('#exportAllCsv').addEventListener('click', function () { download(slug(CFG.name) + '-saved-jobs.csv', CSV.jobsToCsv(jobsWithResults())); toast('CSV downloaded'); });
    $('#jobsTable').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var id = b.closest('tr').getAttribute('data-id'), j = savedVersion(id); if (!j) return;
      var act = b.getAttribute('data-act');
      if (act === 'open') { loadJob(j); go('calculator'); toast('Opened “' + j.name + '”'); }
      if (act === 'dup') { duplicateJob(j); renderJobs(); }
      if (act === 'est') { loadJob(j); createDoc('estimate', j); }
      if (act === 'del') {
        var idx = S.jobs.indexOf(j); S.jobs.splice(idx, 1); persistJobs(); renderJobs(); renderSaveStatus();
        toast('Deleted “' + j.name + '”', function () { S.jobs.splice(idx, 0, j); persistJobs(); renderJobs(); renderSaveStatus(); });
      }
    });
    // documents view
    $('#newEstimate').addEventListener('click', function () { createDoc('estimate', S.job); });
    $('#newInvoice').addEventListener('click', function () { createDoc('invoice', S.job); });
    $$('input[name="docFilter"]').forEach(function (r) { r.addEventListener('change', function () { S.docFilter = r.value; renderDocs(); }); });
    $('#docsList').addEventListener('click', function (e) { var b = e.target.closest('[data-doc]'); if (!b) return; S.docId = b.getAttribute('data-doc'); renderDocs(); $('#docWorkspace').scrollIntoView({ block: 'start' }); });
    var df = $('#docForm');
    df.addEventListener('input', onDocInput); df.addEventListener('change', onDocInput);
    $('#addDocLine').addEventListener('click', function () { var d = curDoc(); d.lines.push({ id: uid('l'), kind: 'other', description: '', qty: '1', unit: '', unitPrice: '', taxable: true }); renderDocLines(d); renderDocPreview(); persistDocs(); var ins = $$('#docLines [data-lkey="description"]'); ins[ins.length - 1].focus(); });
    $('#docLines').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dl-remove]'); if (!b) return;
      var d = curDoc(), i = +b.closest('.line').getAttribute('data-i'), removed = d.lines.splice(i, 1)[0];
      renderDocLines(d); renderDocPreview(); persistDocs();
      toast('Removed line', function () { d.lines.splice(i, 0, removed); renderDocLines(d); renderDocPreview(); persistDocs(); });
    });
    $('#rbGo').addEventListener('click', function () {
      var d = curDoc(), sel = $('#rbJob').value, job = sel === '__current' ? S.job : savedVersion(sel);
      if (!d || !job) return;
      var prev = clone(d.lines);
      d.lines = D.buildLinesFromJob(job, { markupPct: $('#rbMarkup').value, pricing: $('#rbPricing').value, detail: $('#rbDetail').value });
      d.jobId = job.id || null;
      renderDocLines(d); renderDocPreview(); persistDocs(); renderDocsListShallow();
      toast('Line items rebuilt', function () { d.lines = prev; renderDocLines(d); renderDocPreview(); persistDocs(); });
    });
    $('#printDoc').addEventListener('click', function () { persistDocs(); printNow('doc'); });
    $('#convertDoc').addEventListener('click', function () {
      var d = curDoc(); if (!d || d.type !== 'estimate') return;
      if (d.convertedTo) { var inv = S.docs.filter(function (x) { return x.type === 'invoice' && x.number === d.convertedTo; })[0]; if (inv) { S.docId = inv.id; renderDocs(); return; } }
      var res = D.convertToInvoice(d, S.profile);
      S.profile = res.profile; persistProfile(); fillProfile();
      S.docs = S.docs.map(function (x) { return x.id === d.id ? res.estimate : x; });
      S.docs.unshift(res.invoice); persistDocs();
      S.docId = res.invoice.id; renderDocs();
      toast('Estimate ' + d.number + ' accepted → Invoice ' + res.invoice.number + ' created');
    });
    $('#dupDoc').addEventListener('click', function () {
      var d = curDoc(); if (!d) return;
      var t = D.takeNumber(S.profile, d.type); S.profile = t.profile; persistProfile(); fillProfile();
      var c = clone(d); c.id = uid('d'); c.number = t.number; c.status = 'draft'; c.date = D.isoDate(new Date()); delete c.convertedTo; c.fromEstimate = d.type === 'invoice' ? d.fromEstimate : null;
      S.docs.unshift(c); persistDocs(); S.docId = c.id; renderDocs(); toast('Duplicated as ' + c.number);
    });
    $('#delDoc').addEventListener('click', function () {
      var d = curDoc(); if (!d) return;
      var idx = S.docs.indexOf(d); S.docs.splice(idx, 1); persistDocs(); S.docId = null; renderDocs();
      toast('Deleted ' + d.number, function () { S.docs.splice(idx, 0, d); persistDocs(); S.docId = d.id; renderDocs(); });
    });
    // profile
    var pf = $('#profileForm');
    pf.addEventListener('input', onProfileInput); pf.addEventListener('change', onProfileInput);
    $('#pfLogo').addEventListener('change', onLogo);
    $('#pfLogoRemove').addEventListener('click', function () { var prev = S.profile.logo; S.profile.logo = ''; persistProfile(); fillProfile(); toast('Logo removed', function () { S.profile.logo = prev; persistProfile(); fillProfile(); }); });
    $$('[data-backup]').forEach(function (b) { b.addEventListener('click', backup); });
    $('#restoreFile').addEventListener('change', restore);
    $$('[data-goto-data]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); go('profile'); $('#dataTitle').scrollIntoView({ block: 'start' }); }); });
    // templates
    $('#tplGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tpl]'); if (!b) return;
      var j = templateJob(b.getAttribute('data-tpl')); if (!j) return;
      if (b.getAttribute('data-tpl-act') === 'copy') { j.name = j.name + ' (my template)'; loadJob(j); saveJob(); go('calculator'); toast('Saved “' + j.name + '” to your jobs. Change the numbers to yours.'); }
      else { j.id = null; var prev = clone(S.job); loadJob(j); go('calculator'); toast('Loaded template. Save it to keep your changes.', function () { loadJob(prev); }); }
    });
    $('#dlWorksheet').addEventListener('click', function () { download(slug(CFG.name) + '-worksheet.csv', CSV.worksheetCsv(CFG.name)); toast('Worksheet downloaded'); });
    // routing
    window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (VIEWS.indexOf(h) >= 0) go(h); });
    $$('[data-view-link]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); go(a.getAttribute('data-view-link')); }); });
    // tour
    $('#tourBtn').addEventListener('click', function () { tourOpen(false); });
    $('#burdenReset').addEventListener('click', function () { S.job.burden = profileBurden(); fillJobForm(); recalc(); toast('Labor burden set to your Business profile defaults.'); });
    $('#tourNext').addEventListener('click', function () { if (tourI < TOUR.length - 1) tourShow(tourI + 1); else tourClose(); });
    $('#tourBack').addEventListener('click', function () { if (tourI > 0) tourShow(tourI - 1); });
    $('#tourSkip').addEventListener('click', tourClose);
    $('#agreeTerms').addEventListener('change', function () { if ($('#agreeTerms').checked) store.acceptTerms(TERMS_VERSION); tourGate(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#tour').hidden) tourClose(); });
    // mobile bar: hide when results are on screen
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es.forEach(function (en) { document.body.classList.toggle('results-visible', en.isIntersecting); }); }, { threshold: 0.15 }).observe($('#results'));
    }
  }

  // ---------- init ----------
  function init() {
    applyConfig();
    var draft = store.loadDraft(), ui = store.loadUi();
    var first = !store.isOnboarded() && !draft && S.jobs.length === 0;
    S.job = draft ? normalizeJob(draft) : templateJob('deck-repair');
    if (ui.target) S.target = Object.assign(S.target, ui.target);
    bind(); fillJobForm(); syncTargetUi(); fillProfile(); renderTemplates();
    if (!store.available) toast('This browser is blocking local storage, so jobs can\u2019t be saved. Try a non-private window.');
    var h = location.hash.slice(1);
    go(VIEWS.indexOf(h) >= 0 ? h : 'calculator', true);
    setMode(ui.mode || 'profit');
    renderJobs();
    if (first || !store.termsAccepted()) tourOpen(true);
    document.documentElement.classList.add('ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
