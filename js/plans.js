/*
 * Plans and prices — the ONE place prices, plan names, the Free limit and the founding offer live.
 * PLANNED pricing, not billed yet: there are no payments anywhere in this app.
 * The Plans page, upgrade prompts, signup form, terms and help read from here
 * (static pages fill [data-price] / [data-plan-text] spans from it). tests/pricing.test.js fails
 * if the approved price set changes or any page shows a price that is not listed here.
 *
 * Only list features that exist in the app today under `includes`. Anything not built goes in
 * NOT_BUILT and must never be promised as part of a plan.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JobPlans = factory();
})(this, function () {
  'use strict';

  var FREE_SAVED_JOBS = 3;
  var FOUNDING = {
    percentOff: 40, seats: 200,
    text: 'Founding members: 40% off for life on Pro and Business while the subscription stays active. First 200 paid accounts.'
  };
  var STATUS = 'Planned pricing, not billed yet. No payment details are collected anywhere in this app.';
  var TESTING_NOTE = 'While pricing is being tested, everything that is built works on Free except the saved-jobs limit.';

  // Prices in whole cents. Approved by Kyle, Oct 21 2026.
  var PLANS = [
    {
      id: 'free', name: 'Free', monthlyCents: 0, yearlyCents: 0,
      blurb: 'Price jobs right, for free. No time limit.',
      includes: [
        'The full calculator, including Find my price (reverse pricing from a target margin, profit per hour or profit $)',
        'Up to ' + FREE_SAVED_JOBS + ' saved jobs on this device',
        'Templates, printable field guide and blank job worksheet'
      ]
    },
    {
      id: 'pro', name: 'Pro', monthlyCents: 900, yearlyCents: 7900, featured: true,
      blurb: 'For the solo contractor who quotes every week.',
      includes: [
        'Everything in Free',
        'Unlimited saved jobs, with side-by-side comparison',
        'Branded estimates and invoices: your logo, numbering, sales tax, deposit, balance due and signature line',
        'Internal job profit sheet (print or PDF)',
        'One-click backup / restore and CSV export'
      ]
    },
    {
      id: 'business', name: 'Business', monthlyCents: 1900, yearlyCents: 16900,
      blurb: 'For a small crew with payroll.',
      includes: [
        'Everything in Pro',
        'Crew labor rates with labor burden: W-2 vs 1099, payroll tax, workers\u2019 comp, benefits, loaded cost per hour',
        'Business-profile defaults: labor burden on new jobs, sales tax and markup on new estimates',
        'Overhead on every job (% of price or flat)',
        'Compare saved jobs by profit per hour, net profit and margin',
        'CSV export of all saved jobs for your bookkeeper'
      ]
    }
  ];

  // Not built. Never promise these as part of a plan.
  var NOT_BUILT = [
    'Cloud sync across devices or accounts',
    'Online payments, emailing documents or e-signature',
    'Multiple tax rates or tax templates per document',
    'Team seats',
    'Free trial of Business'
  ];

  function plan(id) { for (var i = 0; i < PLANS.length; i++) if (PLANS[i].id === id) return PLANS[i]; return null; }

  /** "$9", "$79", "$5.40" — whole dollars stay whole. */
  function fmt(cents) {
    cents = Math.round(cents);
    var d = Math.floor(cents / 100), c = cents % 100;
    var s = String(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + s + (c ? '.' + (c < 10 ? '0' : '') + c : '');
  }
  function priceCents(p, period) { return period === 'yearly' ? p.yearlyCents : p.monthlyCents; }
  function perText(period) { return period === 'yearly' ? '/yr' : '/mo'; }
  function priceText(p, period) { return fmt(priceCents(p, period)) + perText(period); }
  /** What a year costs on monthly billing minus the yearly price. */
  function yearlySavingsCents(p) { return p.monthlyCents * 12 - p.yearlyCents; }

  // Every paid option a visitor can pick. key is used by the signup form and [data-price] spans.
  var PLAN_OPTIONS = [];
  PLANS.forEach(function (p) {
    if (!p.monthlyCents) return;
    ['monthly', 'yearly'].forEach(function (period) {
      PLAN_OPTIONS.push({
        key: p.id + '-' + period, plan: p.id, period: period,
        label: p.name + ' ' + period,                       // sent as "plan" with the signup
        short: p.name + ' ' + priceText(p, period),         // "Pro $9/mo"
        priceCents: priceCents(p, period)
      });
    });
  });
  function option(key) { for (var i = 0; i < PLAN_OPTIONS.length; i++) if (PLAN_OPTIONS[i].key === key) return PLAN_OPTIONS[i]; return null; }
  function foundingButtonText(o) { return 'Join founding list: ' + o.short; }

  /** Text for a [data-price] key: "pro-monthly" → "$9/mo", "free" → "$0", "free-jobs" → "3". */
  function priceFor(key) {
    if (key === 'free') return fmt(0);
    if (key === 'free-jobs') return String(FREE_SAVED_JOBS);
    var o = option(key); if (!o) return null;
    return fmt(o.priceCents) + perText(o.period);
  }
  function textFor(key) {
    if (key === 'founding') return FOUNDING.text;
    if (key === 'status') return STATUS;
    return null;
  }

  // ---------- Free limit ----------
  /** plan: 'free' | 'pro' | 'business'. Updating an already-saved job is always allowed. */
  function canSaveNew(savedCount, planId) {
    if (planId === 'pro' || planId === 'business') return true;
    return savedCount < FREE_SAVED_JOBS;
  }
  function usageText(savedCount, planId) {
    if (planId === 'pro' || planId === 'business') return savedCount + ' saved jobs';
    return savedCount + ' of ' + FREE_SAVED_JOBS + ' free saved jobs used';
  }

  // ---------- founding-list signup ----------
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var NOTE_MAX = 500;
  /** An endpoint counts only if it is an https URL. Empty = signups not open yet. */
  function hasEndpoint(url) { return /^https:\/\/[^\s/]+\.[^\s/]+/.test(String(url || '').trim()); }
  /** Validate the form. Returns { ok, errors: {email?, plan?, note?}, payload }. */
  function signupPayload(input, appName) {
    input = input || {};
    var email = String(input.email || '').trim(), note = String(input.note || '').trim();
    var o = option(String(input.plan || ''));
    var errors = {};
    if (!email) errors.email = 'Enter your email.';
    else if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'That email doesn\u2019t look right. Check it and try again.';
    if (!o) errors.plan = 'Choose a plan.';
    if (note.length > NOTE_MAX) errors.note = 'Keep the note under ' + NOTE_MAX + ' characters.';
    var ok = Object.keys(errors).length === 0;
    return {
      ok: ok, errors: errors,
      payload: ok ? { email: email, plan: o.label, price: o.short.replace(/^\S+ /, ''), note: note, app: appName || '', offer: 'founding-40' } : null
    };
  }
  /** FormSubmit AJAX body (same fields as SkuClinic's forms.js): honeypot, subject, table template, reply-to. */
  function formSubmitBody(payload) {
    var body = {
      email: payload.email, _replyto: payload.email,
      _subject: (payload.app || 'LevelPenny') + ' founding-list signup',
      _honey: '', _captcha: 'false', _template: 'table',
      Plan: payload.plan, Price: payload.price, Offer: FOUNDING.percentOff + '% off for life (founding member)', App: payload.app || ''
    };
    if (payload.note) body.Note = payload.note;
    return body;
  }
  /** FormSubmit answers 200 with {success:"false"} on some errors; treat that as a failure. */
  function formSubmitOk(status, data) { return status >= 200 && status < 300 && !(data && String(data.success) === 'false'); }

  /** Google Apps Script body (SIGNUP_SCRIPT_URL): the same fields without FormSubmit's _options, plus form and an empty honeypot. */
  function scriptBody(payload) {
    var fs = formSubmitBody(payload), body = { form: 'signup' };
    Object.keys(fs).forEach(function (k) { if (k.charAt(0) !== '_') body[k] = fs[k]; });
    body.website = '';
    return body;
  }

  return {
    FREE_SAVED_JOBS: FREE_SAVED_JOBS, FOUNDING: FOUNDING, STATUS: STATUS, TESTING_NOTE: TESTING_NOTE, PLANS: PLANS, NOT_BUILT: NOT_BUILT,
    PLAN_OPTIONS: PLAN_OPTIONS, NOTE_MAX: NOTE_MAX,
    plan: plan, option: option, fmt: fmt, priceText: priceText, priceCents: priceCents, yearlySavingsCents: yearlySavingsCents,
    foundingButtonText: foundingButtonText, priceFor: priceFor, textFor: textFor,
    canSaveNew: canSaveNew, usageText: usageText, hasEndpoint: hasEndpoint, signupPayload: signupPayload,
    formSubmitBody: formSubmitBody, formSubmitOk: formSubmitOk, scriptBody: scriptBody
  };
});
