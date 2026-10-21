/*
 * Pricing guard: the approved price set, the Free limit, the founding offer and the signup form.
 * Fails if a price drifts, an old placeholder comes back, a page shows a price that is not in
 * js/plans.js, a plan promises a feature that isn't built, or a signup destination is shipped.
 * Run: npm test
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../js/plans.js');
const CFG = require('../js/config.js');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['index.html', 'terms.html', 'privacy.html', 'guide.html', 'README.md', 'js/app.js', 'js/plans.js', 'js/page.js', 'js/config.js'];

test('approved price set (Kyle, Oct 21 2026): Free $0, Pro $9/mo or $79/yr, Business $19/mo or $169/yr', () => {
  assert.deepStrictEqual(P.PLANS.map(p => [p.id, p.name, p.monthlyCents, p.yearlyCents]), [
    ['free', 'Free', 0, 0], ['pro', 'Pro', 900, 7900], ['business', 'Business', 1900, 16900]
  ]);
  assert.deepStrictEqual(P.PLAN_OPTIONS.map(o => `${o.key}=${P.priceFor(o.key)} ${o.label}`), [
    'pro-monthly=$9/mo Pro monthly', 'pro-yearly=$79/yr Pro yearly', 'business-monthly=$19/mo Business monthly', 'business-yearly=$169/yr Business yearly'
  ]);
  assert.deepStrictEqual(P.PLAN_OPTIONS.map(P.foundingButtonText), [
    'Join founding list: Pro $9/mo', 'Join founding list: Pro $79/yr', 'Join founding list: Business $19/mo', 'Join founding list: Business $169/yr'
  ]);
  assert.strictEqual(P.fmt(P.yearlySavingsCents(P.plan('pro'))), '$29');
  assert.strictEqual(P.fmt(P.yearlySavingsCents(P.plan('business'))), '$59');
});

test('founding offer wording, 40% off, first 200 paid accounts; labelled planned / not billed', () => {
  assert.strictEqual(P.FOUNDING.text, 'Founding members: 40% off for life on Pro and Business while the subscription stays active. First 200 paid accounts.');
  assert.strictEqual(P.FOUNDING.percentOff, 40);
  assert.strictEqual(P.FOUNDING.seats, 200);
  assert.match(P.STATUS, /planned pricing, not billed yet/i);
});

test('Free plan: 3 saved jobs; Pro and Business unlimited', () => {
  assert.strictEqual(P.FREE_SAVED_JOBS, 3);
  assert.deepStrictEqual([0, 1, 2, 3, 4, 10].map(n => P.canSaveNew(n, 'free')), [true, true, true, false, false, false]);
  for (const p of ['pro', 'business']) assert.strictEqual(P.canSaveNew(500, p), true);
  assert.strictEqual(P.canSaveNew(3, undefined), false, 'unknown plan = Free');
  assert.strictEqual(P.usageText(2, 'free'), '2 of 3 free saved jobs used');
});

test('money format: whole dollars stay whole, cents shown when present', () => {
  assert.deepStrictEqual([0, 900, 7900, 16900, 540, 123456].map(P.fmt), ['$0', '$9', '$79', '$169', '$5.40', '$1,234.56']);
});

test('signup: validates email, plan and note; every plan option accepted; unknown plan rejected', () => {
  for (const o of P.PLAN_OPTIONS) {
    const r = P.signupPayload({ email: ' crew@example.com ', plan: o.key, note: ' 2-person crew ' }, 'App');
    assert.ok(r.ok, o.key);
    assert.deepStrictEqual(r.payload, { email: 'crew@example.com', plan: o.label, price: P.priceFor(o.key), note: '2-person crew', app: 'App', offer: 'founding-40' });
  }
  assert.ok(P.signupPayload({ email: 'a@b.co', plan: 'pro-monthly' }).ok, 'note is optional');
  assert.ok(P.signupPayload({ email: '', plan: 'pro-monthly' }).errors.email);
  assert.ok(P.signupPayload({ email: 'not-an-email', plan: 'pro-monthly' }).errors.email);
  assert.ok(P.signupPayload({ email: 'a@b.co', plan: 'agency-monthly' }).errors.plan);
  assert.ok(P.signupPayload({ email: 'a@b.co', plan: 'free' }).errors.plan, 'Free is not a founding option');
  assert.ok(P.signupPayload({ email: 'a@b.co', plan: 'pro-monthly', note: 'x'.repeat(501) }).errors.note);
});

test('fallback signup goes to LevelPenny\'s own FormSubmit inbox (never another product\'s); FormSubmit AJAX body', () => {
  assert.strictEqual(CFG.SIGNUP_ENDPOINT, 'https://formsubmit.co/ajax/levelpennyapp@gmail.com');
  assert.strictEqual(CFG.contactEmail, 'levelpennyapp@gmail.com');
  assert.strictEqual(P.hasEndpoint(CFG.SIGNUP_ENDPOINT), true);
  assert.strictEqual(P.hasEndpoint(''), false, 'empty = signups open soon');
  assert.strictEqual(P.hasEndpoint('http://example.com/f'), false);
  assert.strictEqual(P.hasEndpoint('mailto:someone@example.com'), false);
  for (const f of PAGES) assert.ok(!/skuclinicapp@gmail\.com/i.test(read(f)), f + ' must not use the SkuClinic inbox');
  const r = P.signupPayload({ email: 'a@b.co', plan: 'pro-yearly', note: 'hi' }, 'LevelPenny');
  assert.deepStrictEqual(P.formSubmitBody(r.payload), { email: 'a@b.co', _replyto: 'a@b.co', _subject: 'LevelPenny founding-list signup', _honey: '', _captcha: 'false', _template: 'table',
    Plan: 'Pro yearly', Price: '$79/yr', Offer: '40% off for life (founding member)', App: 'LevelPenny', Note: 'hi' });
  assert.ok(!('Note' in P.formSubmitBody(P.signupPayload({ email: 'a@b.co', plan: 'pro-yearly' }, 'LevelPenny').payload)), 'empty note omitted');
  assert.strictEqual(P.formSubmitOk(200, { success: 'true' }), true);
  assert.strictEqual(P.formSubmitOk(200, { success: 'false' }), false);
  assert.strictEqual(P.formSubmitOk(500, {}), false);
  for (const f of ['terms.html', 'privacy.html', 'guide.html']) assert.ok(read(f).includes('levelpennyapp@gmail.com'), f + ' shows the contact email');
});

test('SIGNUP_SCRIPT_URL is LevelPenny\'s deployed Google Apps Script /exec URL (live); script body = plain fields + form + empty honeypot', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(CFG, 'SIGNUP_SCRIPT_URL'));
  assert.strictEqual(CFG.SIGNUP_SCRIPT_URL, 'https://script.google.com/macros/s/AKfycbwvUUlnjZXPZZvl1VRDrjn2iprJ5-0X0YezuSq_bqbaPcrkRLgqzABeg0lIwDgmx4uhIQ/exec', 'live Apps Script deployment');
  assert.strictEqual(P.hasEndpoint(CFG.SIGNUP_SCRIPT_URL), true, 'script path wins over SIGNUP_ENDPOINT');
  for (const f of ['terms.html', 'privacy.html']) {
    assert.ok(!/formsubmit/i.test(read(f)), f + ' no longer says signups go through FormSubmit');
    assert.ok(/Google Apps Script/.test(read(f)) && /Google Sheet/.test(read(f)), f + ' says signups go through Google Apps Script into a Google Sheet');
  }
  assert.strictEqual(P.hasEndpoint('https://script.google.com/macros/s/X/exec'), true);
  const r = P.signupPayload({ email: 'a@b.co', plan: 'pro-yearly', note: 'hi' }, 'LevelPenny');
  assert.deepStrictEqual(P.scriptBody(r.payload), { form: 'signup', email: 'a@b.co', Plan: 'Pro yearly', Price: '$79/yr', Offer: '40% off for life (founding member)', App: 'LevelPenny', Note: 'hi', website: '' });
  assert.strictEqual(new URLSearchParams(P.scriptBody(r.payload)).toString(),
    'form=signup&email=a%40b.co&Plan=Pro+yearly&Price=%2479%2Fyr&Offer=40%25+off+for+life+%28founding+member%29&App=LevelPenny&Note=hi&website=');
});

test('old placeholder wording is gone', () => {
  for (const f of ['index.html', 'terms.html', 'privacy.html', 'guide.html', 'README.md', 'js/app.js']) {
    const t = read(f);
    for (const re of [/coming later/i, /to be announced/i, /nothing to buy today/i, /Contractor Pro/, /The Service is currently free\. Any future/]) assert.ok(!re.test(t), `${f}: ${re}`);
  }
});

test('every price shown on any page or doc is an approved price', () => {
  const allowed = new Set(['$0', ...P.PLAN_OPTIONS.map(o => P.fmt(o.priceCents)), '$29', '$59']);
  for (const f of PAGES) {
    const hits = read(f).match(/\$\d[\d,]*(?:\.\d+)?(?=\s*(?:\/\s*(?:mo|yr|month|year)|a month|a year|per month|per year|billed|<\/span>\/))/gi) || [];
    const bad = hits.filter(h => !allowed.has(h));
    assert.deepStrictEqual(bad, [], f);
  }
});

test('static pages: every [data-price] / [data-plan-text] fallback matches js/plans.js', () => {
  let n = 0;
  for (const f of ['index.html', 'terms.html', 'privacy.html', 'guide.html']) {
    const t = read(f);
    for (const m of t.matchAll(/data-price="([^"]+)">([^<]*)</g)) { n++; assert.strictEqual(m[2], P.priceFor(m[1]), `${f} ${m[1]}`); }
    for (const m of t.matchAll(/data-plan-text="([^"]+)">([^<]*)</g)) { n++; assert.strictEqual(m[2], P.textFor(m[1]), `${f} ${m[1]}`); }
  }
  assert.ok(n >= 8, 'price spans found: ' + n);
  for (const f of ['terms.html', 'guide.html']) assert.ok(read(f).includes('<script src="js/plans.js"></script>'), f + ' loads plans.js');
});

test('plans promise only features that exist in the app; unbuilt features are listed, never included', () => {
  const app = read('index.html') + read('js/app.js') + read('js/calc.js') + read('js/docs.js') + read('js/store.js') + read('js/csv.js');
  const evidence = [
    [/find my price/i, /id="modeReverse"/], [/saved jobs/i, /saveJobs/], [/templates/i, /id="tplGrid"/], [/field guide/i, /guide\.html/],
    [/worksheet/i, /worksheetCsv/], [/logo/i, /pfLogo/], [/numbering/i, /nextNumber|EST-|prefix/i], [/deposit/i, /deposit/i],
    [/signature/i, /sign/i], [/job profit sheet/i, /jobsheet/], [/backup/i, /makeBackup/], [/csv export/i, /jobsToCsv/],
    [/labor burden|1099/i, /burden/], [/overhead/i, /overhead/], [/profile defaults/i, /id="pfTax"[\s\S]*id="pfMarkup"/], [/profile defaults/i, /burdenPayrollPct/], [/profit per hour, net profit and margin/i, /value="pph"[\s\S]*value="margin"/]
  ];
  const all = P.PLANS.flatMap(p => p.includes);
  for (const f of all) {
    if (/^Everything in/.test(f)) continue;
    const ev = evidence.filter(([claim]) => claim.test(f));
    assert.ok(ev.length > 0, 'no evidence rule for feature: ' + f);
    for (const [, proof] of ev) assert.ok(proof.test(app), `feature "${f}" not found in app (${proof})`);
  }
  const text = all.join(' | ');
  for (const re of [/sync/i, /online payment|accept payment|stripe/i, /e-?signature/i, /team seat/i, /trial/i, /multiple tax/i]) assert.ok(!re.test(text), 'plan promises unbuilt: ' + re);
  assert.ok(P.NOT_BUILT.length >= 4);
});

test('product is named LevelPenny everywhere user-facing (terms/privacy: "LevelPenny, a Carina Dataworks product")', () => {
  assert.strictEqual(CFG.name, 'LevelPenny');
  assert.strictEqual(JSON.parse(read('package.json')).name, 'levelpenny');
  for (const f of ['index.html', 'terms.html', 'privacy.html', 'guide.html', 'README.md', 'js/app.js', 'js/csv.js', 'js/docs.js', 'package.json']) assert.ok(!/Job Profit Calculator/i.test(read(f)), f + ' still says Job Profit Calculator');
  for (const f of ['terms.html', 'privacy.html']) assert.ok(read(f).replace(/<[^>]+>/g, '').includes('LevelPenny, a Carina Dataworks product'), f);
  for (const f of ['index.html', 'terms.html', 'privacy.html', 'guide.html']) assert.match(read(f), /<title>[^<]*LevelPenny[^<]*<\/title>/, f + ' title');
});
