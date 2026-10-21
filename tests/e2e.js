/*
 * End-to-end test: a contractor prices, saves, reloads, reverse-prices, makes an estimate and
 * invoice, prints, exports and restores — in headless Chromium against a local static server.
 * Run: npm run test:e2e   (needs playwright-core + a Chromium; see README)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');
const { start } = require('./serve.js');
const { guardBrowser } = require('./netguard.js');
const P = require('../js/plans.js');
const CFG = require('../js/config.js');
const C = require('../js/calc.js');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screens');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jpc-e2e-'));
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const consoleProblems = [];
let current = '';
function check(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
async function step(name, fn) {
  current = name;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`[${label}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => consoleProblems.push(`[${label}] pageerror: ${e.message}`));
  page.on('requestfailed', r => consoleProblems.push(`[${label}] request failed: ${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('response', r => { if (r.status() >= 400) consoleProblems.push(`[${label}] HTTP ${r.status()}: ${r.url()}`); });
}
const text = (page, sel) => page.$eval(sel, e => e.textContent.trim());
const shot = (page, name, opts) => page.screenshot({ path: path.join(SHOTS, name), ...(opts || {}) });
async function axe(page, label) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'], rules: { region: { enabled: false } } })).violations
    .map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })));
  const serious = r.filter(v => v.impact === 'serious' || v.impact === 'critical');
  check(serious.length === 0, `${label}: axe serious/critical violations: ${JSON.stringify(serious, null, 1)}`);
  return r;
}
async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const p = path.join(TMP, dl.suggestedFilename());
  await dl.saveAs(p);
  return { name: dl.suggestedFilename(), path: p, text: fs.readFileSync(p, 'utf8') };
}
async function printTo(page, kind, pngName, pdfName) {
  // window.print() is stubbed (see init script); the app has already filled #printRoot.
  eq(await page.evaluate(() => window.__printed), kind, 'print() called for');
  const pdf = path.join(SHOTS, pdfName);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: pdf, format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: null });
  rasterize(pdf, pngName);
  await page.evaluate(() => { document.body.removeAttribute('data-print'); window.__printed = null; });
  return pdfPages(pdf);
}
/** The "printed" screenshot is page 1 of the real PDF, rasterized — exactly what comes out of the printer. */
function rasterize(pdf, pngName) {
  const base = path.join(SHOTS, pngName.replace(/\.png$/, ''));
  try { execFileSync('pdftoppm', ['-r', '110', '-png', '-singlefile', '-f', '1', '-l', '1', pdf, base], { stdio: 'ignore' }); } catch (e) { /* poppler not installed: PDFs still saved */ }
}
function pdfPages(p) { try { return Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [p]).toString())[1]); } catch (e) { return -1; } }
const INIT = () => { window.__printed = null; window.print = () => { window.__printed = document.body.getAttribute('data-print'); }; };

// The fence job entered below, as data, so expected numbers can be cross-checked with the engine.
const FENCE = {
  price: '3200', materialsMode: 'itemized',
  materials: [{ name: 'Cedar pickets', qty: '120', unitCost: '3.89' }, { name: 'Posts & concrete', qty: '1', unitCost: '286.40' }],
  crew: [{ name: 'Helper', wage: '22', hours: '14' }], ownerHours: '12', shipping: '', miles: '60', mileRate: '0.70',
  fee: { preset: 'stripe', pct: '2.9', fixed: '0.30', payments: '2' },
  otherCosts: [{ category: 'permits', name: 'Fence permit', amount: '75' }], overhead: { mode: 'percent', value: '10' }, taxPct: '25', hoursBasis: 'all',
  burden: { ...C.DEFAULT_BURDEN } // new jobs start with the Business profile's example labor burden
};

(async () => {
  const server = await start(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const blockedNet = [], submissions = [];
  const browser = guardBrowser(await chromium.launch(), BASE, blockedNet, 'chromium', submissions); // all non-local network is aborted
  console.log(`E2E against ${BASE}\n`);
  let backupFile = null, estimateNo = null, invoiceNo = null;

  // =============== DESKTOP ===============
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(BASE);

  await step('First run: welcome tour with credibility message and required Terms checkbox', async () => {
    await page.waitForSelector('#tour:not([hidden])');
    check((await text(page, '#tourCred')).includes('Made by professionals, for professionals.'), 'credibility line in welcome');
    check((await text(page, '.cred')).includes('Made by professionals, for professionals.'), 'credibility line in hero');
    check(await page.isVisible('#tourAgree'), 'terms checkbox shown');
    check(await page.isDisabled('#tourNext'), 'Next disabled until terms accepted');
    check(await page.isDisabled('#tourSkip'), 'Skip disabled until terms accepted');
    await shot(page, 'desktop-01-welcome.png');
    await page.check('#agreeTerms');
    check(!(await page.isDisabled('#tourNext')), 'Next enabled after agreeing');
    await page.click('#tourNext'); eq(await text(page, '#tourStep'), 'Step 2 of 3', 'tour step');
    await page.click('#tourNext'); eq(await text(page, '#tourStep'), 'Step 3 of 3', 'tour step');
    await page.click('#tourNext');
    check(await page.isHidden('#tour'), 'tour closed');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jpc.terms.v1')));
    check(stored && stored.accepted === true && stored.at, 'terms acceptance stored locally with timestamp');
  });

  await step('Example deck repair is prefilled with hand-checked results', async () => {
    eq(await page.inputValue('#price'), '4850', 'example price');
    eq(await text(page, '#outNet'), '$1,296.12', 'net profit');
    eq(await text(page, '#outPph'), '$30.86/hr', 'profit per hour');
    eq(await text(page, '#outMargin'), '26.7%', 'margin');
    eq(await text(page, '#outMarkup'), '55.4%', 'markup');
    eq(await text(page, '#outCosts'), '$3,121.84', 'total costs (incl. $130.21 example labor burden)');
    eq(await text(page, '#outBE'), '$2,872.70', 'break-even');
    eq(await text(page, '#outRate'), '$115.48/hr', 'billed rate');
    check((await text(page, '#valueMsg')).includes('You really make $30.86/hr'), 'value message');
    check((await text(page, '#resultsDisclaimer')) === 'Estimates only, based on the numbers you enter. Not financial or tax advice.', 'results disclaimer');
    check(await page.isVisible('#chart .stack'), 'cost chart drawn');
    eq(await page.locator('#chart .legend li').count(), 10, 'legend rows');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'desktop-02-calculator.png');
    await page.click('text=My hours only');
    eq(await text(page, '#outPph'), '$129.61/hr', 'owner-only profit per hour');
    await page.click('text=All hours');
    eq(await text(page, '#outPph'), '$30.86/hr', 'back to all hours');
  });

  await step('Contractor enters a new fence job from scratch', async () => {
    await page.click('#newJob');
    eq(await page.inputValue('#price'), '', 'new job is blank');
    eq(await text(page, '#outPph'), '—', 'no hours → dash, not NaN/Infinity');
    await page.fill('#jobName', 'Fence repair — Smith');
    await page.fill('#price', '3,200');
    await page.fill('#m-name-0', 'Cedar pickets'); await page.fill('#m-qty-0', '120'); await page.fill('#m-cost-0', '3.89');
    await page.click('[data-add="materials"]');
    await page.fill('#m-name-1', 'Posts & concrete'); await page.fill('#m-qty-1', '1'); await page.fill('#m-cost-1', '286.40');
    await page.fill('#c-name-0', 'Helper'); await page.fill('#c-wage-0', '22'); await page.fill('#c-hours-0', '14');
    await page.fill('#ownerHours', '12');
    await page.fill('#miles', '60');
    await page.selectOption('#feePreset', 'stripe');
    await page.fill('#feePayments', '2');
    await page.click('[data-add="otherCosts"][data-cat="permits"]');
    await page.fill('#o-name-0', 'Fence permit'); await page.fill('#o-amt-0', '75');
    await page.selectOption('#ohMode', 'percent'); await page.fill('#ohValue', '10');
    await page.fill('#taxPct', '25');
    // Hand check: materials 466.80+286.40, labor 308 + example burden 15.65% (48.20) = 356.20, miles 42, permit 75 → direct 1,226.40
    // fees 92.80+0.60 = 93.40, overhead 320 → total 1,639.80; pre-tax 1,560.20; tax 390.05; net 1,170.15; 26 h → 45.01/hr
    eq(await text(page, '#matTotalOut'), '$753.20', 'materials total');
    eq(await text(page, '#feeTotalOut'), '$93.40', 'card fees');
    eq(await text(page, '#outCosts'), '$1,639.80', 'total costs');
    eq(await text(page, '#outNet'), '$1,170.15', 'net profit');
    eq(await text(page, '#outPph'), '$45.01/hr', 'profit per hour');
    eq(await text(page, '#outMargin'), '36.6%', 'margin');
    eq(await text(page, '#outBE'), '$1,408.72', 'break-even');
    eq(await text(page, '#c-load-0'), 'Loaded cost $25.44/hr', 'loaded cost next to the wage (22 × 1.1565)');
    const r = C.calculate(FENCE);
    eq(r.netProfitCents, 117015, 'engine agrees with UI');
  });

  await step('Employee cost: labor burden, per diem, 1099 toggle, loaded rate, math and job sheet', async () => {
    await page.click('#burdenBox summary');
    eq(await page.inputValue('#bPayroll'), '7.65', 'example FICA default from profile');
    check((await text(page, '#burdenBox')).includes('not tax advice'), 'labelled as editable example, not tax advice');
    // $1.50/hr benefits: burden = 48.20 + 21.00 = 69.20 → labor 377.20, loaded 377.20 / 14 = 26.94
    await page.fill('#bBenHr', '1.50');
    eq(await text(page, '#c-load-0'), 'Loaded cost $26.94/hr', 'loaded rate with $/hr benefits');
    await page.fill('#c-pd-0', '40');  // + $40 per diem → 417.20 → 29.80/hr
    eq(await text(page, '#c-load-0'), 'Loaded cost $29.80/hr', 'loaded rate with per diem');
    const withB = C.calculate({ ...FENCE, burden: { ...C.DEFAULT_BURDEN, benefitsHourly: '1.50' }, crew: [{ ...FENCE.crew[0], perDiem: '40' }] });
    eq(await text(page, '#outNet'), C.money(withB.netProfitCents), 'burden in net profit');
    eq(await text(page, '#outBE'), C.money(withB.breakEvenCents), 'burden in break-even');
    check((await text(page, '#mathTable')).includes('Labor burden'), 'burden line in show the math');
    await page.click('#moreBtn'); await page.click('[data-action="print-jobsheet"]');
    const js = await text(page, '#printRoot');
    check(js.includes('labor burden $109.20') && js.includes('loaded $29.80/hr'), 'job sheet shows burden and loaded rate');
    await page.evaluate(() => { document.body.removeAttribute('data-print'); window.__printed = null; });
    await page.selectOption('#c-type-0', 'sub');   // 1099: no burden, no per diem → original hand-checked numbers
    eq(await text(page, '#c-load-0'), '1099 — no burden', '1099 label');
    eq(await text(page, '#outNet'), '$1,206.30', '1099 sub carries no burden');
    check(await page.isDisabled('#c-pd-0'), 'per diem off for 1099');
    await page.selectOption('#c-type-0', 'employee');
    await page.fill('#bBenHr', '0');
    eq(await text(page, '#outNet'), '$1,170.15', 'back to example burden only');
    await page.click('#burdenBox summary');
  });

  await step('Bad input is flagged inline and treated as zero (no NaN)', async () => {
    await page.fill('#miles', 'abc');
    check(await page.isVisible('#miles-err'), 'error message shown');
    eq(await page.getAttribute('#miles', 'aria-invalid'), 'true', 'aria-invalid');
    eq(await text(page, '#outNet'), '$1,201.65', 'miles counted as 0 (net rises by 42 × 0.75)');
    const all = await page.evaluate(() => document.body.innerText);
    check(!/NaN|Infinity|undefined/.test(all), 'no NaN/Infinity/undefined anywhere on screen');
    await page.fill('#miles', '60');
    check(await page.isHidden('#miles-err'), 'error clears');
    eq(await text(page, '#outNet'), '$1,170.15', 'restored');
  });

  await step('Save the job, reload the page, everything is still there', async () => {
    await page.click('#saveJob');
    eq(await text(page, '#saveStatus'), 'Saved', 'save status');
    await page.reload();
    check(await page.isHidden('#tour'), 'tour does not reappear after onboarding');
    eq(await page.inputValue('#jobName'), 'Fence repair — Smith', 'job name restored');
    eq(await text(page, '#outNet'), '$1,170.15', 'results restored');
    eq(await text(page, '#saveStatus'), 'Saved', 'still saved');
    await page.click('[data-view-link="jobs"]');
    eq(await page.locator('#jobsTable tbody tr').count(), 1, 'one saved job');
    check((await text(page, '#jobsTable tbody tr')).includes('$45.01'), 'saved job shows profit/hr');
    await page.click('[data-view-link="calculator"]');
  });

  await step('Negative profit is shown in red with an explanation', async () => {
    await page.fill('#price', '900');
    check(await page.isVisible('#lossAlert'), 'loss alert visible');
    const msg = await text(page, '#lossAlert');
    check(/Losing money/.test(msg) && /break even, charge at least \$1,408\.72/.test(msg), 'explains loss and break-even: ' + msg);
    check(await page.$eval('#outNet', e => e.classList.contains('neg')), 'net profit in red');
    eq(await page.$eval('#outNet', e => getComputedStyle(e).color), 'rgb(255, 155, 143)', 'red on navy');
    check((await text(page, '#valueMsg')).includes('loses'), 'value message explains loss');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'desktop-04-loss.png');
    await page.fill('#price', '3200');
    check(await page.isHidden('#lossAlert'), 'alert clears');
  });

  let quoteCents;
  await step('Reverse mode (Find my price): target margin and target profit per hour', async () => {
    await page.click('#modeReverse');
    eq(await page.getAttribute('#modeReverse', 'aria-selected'), 'true', 'reverse tab selected');
    await page.selectOption('#roundTo', '0');
    await page.fill('#targetValue', '30');
    const exp = C.priceForTarget(FENCE, { type: 'margin', value: 30 });
    eq(await text(page, '#quotePrice'), C.money(exp.priceCents), 'quote for 30% margin');
    eq(await text(page, '#outMargin'), '30.0%', 'results show margin at quoted price');
    await page.click('label:has(input[name=targetType][value=hourly])');
    await page.fill('#targetValue', '60');
    await page.selectOption('#roundTo', '25');
    const exp2 = C.priceForTarget(FENCE, { type: 'hourly', value: 60, roundTo: 25 });
    eq(await text(page, '#quotePrice'), C.money(exp2.priceCents), 'quote for $60/hr rounded to $25');
    check(exp2.priceCents % 2500 === 0, 'rounded');
    const pph = C.num((await text(page, '#outPph')).replace('/hr', ''));
    check(pph >= 60, 'profit per hour at quote ≥ target: ' + pph);
    quoteCents = exp2.priceCents;
    await page.click('label:has(input[name=targetType][value=margin])');
    await page.fill('#targetValue', '90');
    check((await text(page, '#quoteNote')).includes('not reachable'), 'impossible target is explained');
    check(await page.isDisabled('#quoteEstimate'), 'cannot make estimate from impossible target');
    await page.click('label:has(input[name=targetType][value=hourly])');
    await page.fill('#targetValue', '60');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'desktop-03-find-my-price.png');
    // keyboard: arrow keys switch tabs
    await page.focus('#modeReverse'); await page.keyboard.press('ArrowRight');
    eq(await page.getAttribute('#modeProfit', 'aria-selected'), 'true', 'arrow key switches mode');
    await page.keyboard.press('ArrowLeft');
    eq(await page.getAttribute('#modeReverse', 'aria-selected'), 'true', 'arrow key switches back');
  });

  await step('Business profile: details, logo upload, pay-online link (validated)', async () => {
    await page.click('[data-view-link="profile"]');
    await page.fill('#pfName', 'Ridgeline Carpentry LLC');
    await page.fill('#pfPhone', '(555) 010-2000');
    await page.fill('#pfEmail', 'office@ridgeline.example');
    await page.fill('#pfLicense', 'NC-GC-12345');
    await page.fill('#pfAddress', '12 Shop Rd\nAsheville, NC 28801');
    await page.fill('#pfPayLink', 'javascript:alert(1)');
    check(await page.isVisible('#pfPayLink-err'), 'unsafe link rejected');
    await page.fill('#pfPayLink', 'https://buy.stripe.com/test_ridgeline');
    check(await page.isHidden('#pfPayLink-err'), 'valid link accepted');
    // make a logo PNG on the fly
    const logoPage = await ctx.newPage();
    await logoPage.setContent('<div id=l style="width:300px;height:100px;background:#0b1f3a;color:#e2b13c;font:800 34px sans-serif;display:grid;place-items:center">RIDGELINE</div>');
    const logo = path.join(TMP, 'logo.png');
    await logoPage.locator('#l').screenshot({ path: logo });
    await logoPage.close();
    await page.setInputFiles('#pfLogo', logo);
    await page.waitForSelector('#logoPreview img');
    await page.waitForTimeout(400);
    const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('jpc.profile.v1')));
    eq(prof.companyName, 'Ridgeline Carpentry LLC', 'profile stored locally');
    check(/^data:image\/png;base64,/.test(prof.logo), 'logo stored as data URL');
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(3600); await shot(page, 'desktop-08-profile.png', { fullPage: true });
  });

  await step('Quote flows straight into a branded estimate (auto-numbered)', async () => {
    await page.click('[data-view-link="calculator"]');
    await page.click('#quoteEstimate');
    await page.waitForSelector('[data-view="documents"]:not([hidden])');
    estimateNo = await page.inputValue('#docNumber');
    eq(estimateNo, 'EST-1001', 'first estimate number');
    const prev = await text(page, '#docPreview');
    check(prev.includes('Ridgeline Carpentry LLC') && prev.includes('License #NC-GC-12345'), 'branded with business profile');
    check(await page.isVisible('#docPreview img.doc-logo'), 'logo on estimate');
    check(prev.includes(C.money(quoteCents)), 'estimate total equals quoted price ' + C.money(quoteCents));
    check(prev.includes('Customer signature'), 'signature line');
    await page.fill('#docCustName', 'Dana Smith');
    await page.fill('#docCustAddr', '88 Laurel St\nAsheville, NC 28806');
    await page.fill('#docCustEmail', 'dana@example.com');
    await page.fill('#docJobAddr', '88 Laurel St, Asheville, NC 28806');
    await page.fill('#docTax', '6.75');
    await page.fill('#docPaid', '1000');
    await page.selectOption('#docStatus', 'sent');
    const sub = C.num((await text(page, '#docSum div:first-child dd')));
    check(Math.abs(sub * 100 - quoteCents) < 1, 'subtotal = quote');
    const prev2 = await text(page, '#docPreview');
    check(prev2.includes('Sales tax (6.75%)') && prev2.includes('Deposit due on acceptance') && prev2.includes('Balance after deposit'), 'tax and deposit rows');
    check((await text(page, '#docsList')).includes('Sent'), 'status chip in list');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(3600);
    await shot(page, 'desktop-06-estimate-editor.png');
  });

  const LEAK_WORDS = ['profit', 'margin', 'wage', 'overhead', 'internal', 'set-aside', 'break-even', 'markup', '/hr', 'per hour', 'card fee', 'carina', 'terms of use', 'burden', 'payroll', 'per diem', 'loaded', '1099', 'workers'];
  function leakCheck(docText, label) {
    const lower = docText.toLowerCase();
    for (const w of LEAK_WORDS) check(!lower.includes(w), `${label} leaks the word "${w}"`);
    const job = { ...FENCE, price: (quoteCents / 100).toFixed(2) };
    const r = C.calculate(job), m = C.money;
    const internal = [m(r.netProfitCents), m(r.totalCostsCents), m(r.feesCents), m(r.overheadCents), m(r.taxSetAsideCents), m(r.direct.labor), m(r.direct.laborBurden), m(r.direct.total), m(r.grossProfitCents), '$22.00', '$3.89', '$308.00', '$466.80', '$753.20', m(r.breakEvenCents)];
    for (const s of internal) check(!docText.includes(s), `${label} leaks internal amount ${s}`);
    check(!docText.includes('Helper'), `${label} leaks crew name`);
  }

  await step('Print estimate (Letter PDF + screenshot) and verify it leaks no internal numbers', async () => {
    await page.click('#printDoc');
    const root = await text(page, '#printRoot');
    leakCheck(root, 'printed estimate');
    leakCheck(await text(page, '#docPreview'), 'estimate preview');
    check(!(await page.$eval('#printRoot', e => e.innerHTML)).includes('terms.html'), 'no app Terms link on customer doc');
    const pages = await printTo(page, 'doc', 'print-estimate.png', 'estimate.pdf');
    eq(pages, 1, 'estimate PDF pages');
  });

  await step('Convert estimate → invoice; record payment; pay-online link + QR', async () => {
    await page.click('#convertDoc');
    invoiceNo = await page.inputValue('#docNumber');
    eq(invoiceNo, 'INV-1001', 'invoice number');
    check((await text(page, '#docsList')).includes('Accepted'), 'estimate marked accepted');
    const prev = await text(page, '#docPreview');
    check(prev.includes('Estimate ref.') && prev.includes(estimateNo), 'invoice references estimate');
    check(prev.includes('Dana Smith'), 'customer carried over');
    await page.fill('#docPaid', '1000');
    check((await text(page, '#docPreview')).includes('Payments received'), 'payment row');
    check(await page.isVisible('#docPreview .doc-pay svg'), 'QR code on invoice');
    eq(await page.getAttribute('#docPreview .doc-pay a', 'href'), 'https://buy.stripe.com/test_ridgeline', 'pay link');
    await page.selectOption('#docStatus', 'sent');
    await page.click('#printDoc');
    leakCheck(await text(page, '#printRoot'), 'printed invoice');
    eq(await printTo(page, 'doc', 'print-invoice.png', 'invoice.pdf'), 1, 'invoice PDF pages');
    await page.selectOption('#docStatus', 'paid');
    const paid = await text(page, '#docPreview');
    check(paid.includes('PAID') && !paid.includes('Pay online'), 'paid stamp replaces pay link');
    await page.selectOption('#docStatus', 'sent');
    // "Convert" button on the estimate now opens the invoice instead of making a duplicate
    await page.click(`#docsList button:has-text("${estimateNo}")`);
    eq((await text(page, '#convertDoc')), 'Open invoice ' + invoiceNo, 'no double conversion');
  });

  await step('Internal job sheet prints full costs, profit, profit per hour and the disclaimer', async () => {
    await page.click('[data-view-link="calculator"]');
    await page.click('#modeProfit');
    await page.click('#moreBtn');
    await page.click('[data-action="print-jobsheet"]');
    const root = await text(page, '#printRoot');
    check(root.includes('INTERNAL — do not send to customer'), 'marked internal');
    check(root.includes('Helper') && root.includes('$22.00/hr'), 'crew wage shown internally');
    check(/Net profit/.test(root) && /Profit \/ hour/.test(root), 'profit numbers shown');
    check(root.includes('Estimates only, based on the numbers you enter. Not financial or tax advice.'), 'disclaimer');
    eq(await printTo(page, 'jobsheet', 'print-jobsheet.png', 'job-sheet.pdf'), 1, 'job sheet PDF pages');
  });

  await step('Export CSV (this job, all jobs) and download the blank worksheet', async () => {
    await page.click('#moreBtn');
    const one = await download(page, () => page.click('[data-action="export-csv"]'));
    check(one.name.endsWith('.csv'), 'csv filename');
    check(/Net profit,\d+\.\d\d/.test(one.text) && one.text.includes('Cedar pickets'), 'job CSV content');
    await page.click('[data-view-link="jobs"]');
    const all = await download(page, () => page.click('#exportAllCsv'));
    check(all.text.split('\r\n')[0].startsWith('Job,Customer,Price'), 'all-jobs CSV header');
    await page.click('[data-view-link="blueprints"]');
    const ws = await download(page, () => page.click('#dlWorksheet'));
    check(ws.text.startsWith('LevelPenny - blank job worksheet'), 'worksheet CSV');
    fs.copyFileSync(ws.path, path.join(SHOTS, 'sample-worksheet.csv'));
    fs.copyFileSync(one.path, path.join(SHOTS, 'sample-job-export.csv'));
  });

  await step('Templates: load one, save a copy as my own; duplicate a job; delete with undo', async () => {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(3600); await shot(page, 'desktop-07-templates.png', { fullPage: true });
    eq(await page.locator('.tpl').count(), 5, 'templates');
    await page.click('[data-tpl="bathroom-remodel"][data-tpl-act="load"]');
    check((await page.inputValue('#jobName')).startsWith('Bathroom remodel'), 'template loaded into calculator');
    eq(await text(page, '#saveStatus'), 'Not saved', 'template is an unsaved copy');
    await page.click('[data-view-link="blueprints"]');
    await page.click('[data-tpl="lawn-care"][data-tpl-act="copy"]');
    check((await page.inputValue('#jobName')).includes('(my template)'), 'saved as own template');
    await page.click('#dupJob');
    check((await page.inputValue('#jobName')).endsWith('(copy)'), 'duplicate');
    await page.click('[data-view-link="jobs"]');
    eq(await page.locator('#jobsTable tbody tr').count(), 3, 'fence + lawn template + copy');
    check(await page.isVisible('.pill-gold'), 'best $/hr highlighted');
    await page.locator('#jobsTable tbody tr').first().locator('[data-act="del"]').click();
    eq(await page.locator('#jobsTable tbody tr').count(), 2, 'deleted');
    await page.click('#toastUndo');
    eq(await page.locator('#jobsTable tbody tr').count(), 3, 'undo restores');
    await shot(page, 'desktop-05-saved-jobs.png');
  });

  await step('Free plan: 4th new job is blocked with an upgrade prompt; updates, duplicate and template copy respect the limit', async () => {
    await page.click('[data-view-link="jobs"]');
    eq(await text(page, '#jobsUsage'), '3 of 3 free saved jobs used · Pro and Business: unlimited', 'usage line');
    await page.locator('#jobsTable tbody tr').first().locator('[data-act="dup"]').click();
    check(await page.isVisible('#limitJobs'), 'duplicate from Saved jobs shows the limit prompt');
    eq(await page.locator('#jobsTable tbody tr').count(), 3, 'duplicate not added');
    await page.click('#limitJobs [data-limit-act="close"]');
    await page.click('[data-view-link="calculator"]');
    await page.click('#saveJob'); // the open job is already saved: updating it always works
    check(await page.isHidden('#limitCalc'), 'updating a saved job is not blocked');
    await page.click('#newJob'); await page.fill('#jobName', 'Gutter clean — Ruiz'); await page.fill('#price', '450');
    await page.click('#saveJob');
    await page.waitForSelector('#limitCalc:not([hidden])');
    const msg = await text(page, '#limitCalc');
    for (const sub of ['Free plan saves up to 3 jobs', 'You have 3 saved', P.priceText(P.plan('pro'), 'monthly'), P.priceText(P.plan('pro'), 'yearly'), 'not billed yet']) check(msg.includes(sub), 'limit prompt says ' + sub + ': ' + msg);
    eq(await page.inputValue('#jobName'), 'Gutter clean — Ruiz', 'blocked job stays in the calculator');
    eq(await text(page, '#saveStatus'), 'Not saved', 'blocked job is not saved');
    await page.click('#dupJob'); check(await page.isVisible('#limitCalc'), 'Duplicate blocked too');
    await page.click('[data-view-link="blueprints"]'); await page.click('[data-tpl="house-cleaning"][data-tpl-act="copy"]');
    await page.waitForSelector('section[data-view="calculator"]:not([hidden])');
    check(await page.isVisible('#limitCalc'), 'template copy blocked with prompt');
    await page.click('#limitCalc [data-limit-act="plans"]');
    await page.waitForSelector('section[data-view="plans"]:not([hidden])');
    await page.click('[data-view-link="jobs"]');
    eq(await page.locator('#jobsTable tbody tr').count(), 3, 'still exactly 3 saved jobs');
    // delete one -> room for one more; undo puts it back (nothing is ever deleted by the limit)
    await page.locator('#jobsTable tbody tr').first().locator('[data-act="del"]').click();
    eq(await text(page, '#jobsUsage'), '2 of 3 free saved jobs used · Pro and Business: unlimited', 'usage after delete');
    await page.click('#toastUndo');
    eq(await page.locator('#jobsTable tbody tr').count(), 3, 'undo restores');
  });

  await step('Plans page: real Free / Pro / Business cards, monthly and yearly, founding offer, planned and not billed', async () => {
    await page.click('[data-view-link="plans"]');
    const main = await text(page, 'section[data-view="plans"]');
    for (const bad of ['Coming later', 'to be announced', 'Nothing to buy today', 'Contractor Pro']) check(!main.includes(bad), 'old placeholder: ' + bad);
    check(main.includes(P.FOUNDING.text), 'founding wording');
    check(main.includes('Planned pricing, not billed yet'), 'planned label');
    check(main.includes('Not built yet, so not part of any plan'), 'unbuilt features called out');
    eq(await page.locator('#planCards .plan').count(), 3, 'three plan cards');
    const prices = () => page.$$eval('#planCards .plan-price', a => a.map(e => e.textContent.trim()));
    eq(JSON.stringify(await prices()), JSON.stringify(['$0 forever', '$9/mo', '$19/mo']), 'monthly prices');
    eq(JSON.stringify(await page.$$eval('[data-plan-option]', a => a.map(e => e.textContent.trim()))), JSON.stringify(['Join founding list: Pro $9/mo', 'Join founding list: Business $19/mo']), 'monthly buttons');
    await page.click('.billing-seg label:has(input[value="yearly"])');
    eq(JSON.stringify(await prices()), JSON.stringify(['$0 forever', '$79/yr', '$169/yr']), 'yearly prices');
    check((await text(page, '[data-plan="pro"] .plan-sub')).includes('$9/mo'), 'yearly card mentions monthly');
    eq(JSON.stringify(await page.$$eval('[data-plan-option]', a => a.map(e => e.textContent.trim()))), JSON.stringify(['Join founding list: Pro $79/yr', 'Join founding list: Business $169/yr']), 'yearly buttons');
    const gaps = await page.$$eval('#planCards .plan', a => { const r = a.map(e => e.getBoundingClientRect()); return [r[1].left - r[0].right, r[2].left - r[1].right, Math.abs(r[0].top - r[2].top)]; });
    check(gaps[0] >= 12 && gaps[1] >= 12 && gaps[2] < 1, 'cards side by side, >= 12px apart: ' + gaps);
    eq(JSON.stringify(await page.$$eval('#suPlan option', a => a.map(o => o.textContent))), JSON.stringify(P.PLAN_OPTIONS.map(o => o.short)), 'signup plan choices');
    await axe(page, 'plans');
  });

  await step('Founding-list signup (live Google Apps Script URL, intercepted: never leaves the box): validates, POSTs, confirms', async () => {
    const SCRIPT = CFG.SIGNUP_SCRIPT_URL;
    check(/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(SCRIPT), 'config points at an Apps Script /exec URL');
    const n0 = submissions.length;
    const storeBefore = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()));
    await page.click('[data-plan-option="business-yearly"]');
    eq(await page.inputValue('#suPlan'), 'business-yearly', 'clicked option is preselected');
    eq(await page.evaluate(() => document.activeElement.id), 'suEmail', 'email focused');
    check((await text(page, '#signupIdle')).startsWith('Sent to levelpennyapp@gmail.com'), 'says where signups go (not FormSubmit)');
    await page.click('#signupSubmit');
    check(await page.isVisible('#suEmailErr'), 'empty email flagged');
    await page.fill('#suEmail', 'not-an-email'); await page.click('#signupSubmit');
    check((await text(page, '#suEmailErr')).includes('doesn’t look right'), 'bad email flagged');
    eq(submissions.length, n0, 'nothing sent while invalid');
    await page.fill('#suEmail', 'dana@ridgeline.example'); await page.fill('#suNote', '3-person deck crew');
    await page.click('#signupSubmit');
    await page.waitForFunction(() => document.querySelector('#signupMsg').classList.contains('ok'));
    check((await text(page, '#signupMsg')).includes('Business yearly ($169/yr)'), 'confirmation names the plan');
    check(await page.isHidden('#suEmailErr'), 'error cleared');
    eq(submissions.length, n0 + 1, 'exactly one (intercepted) submission');
    const sub = submissions[n0];
    eq(sub.url, SCRIPT, 'Apps Script /exec URL'); eq(sub.method, 'POST', 'POST');
    check(/application\/x-www-form-urlencoded/.test(sub.headers['content-type']), 'form-encoded body');
    const want = { form: 'signup', email: 'dana@ridgeline.example', Plan: 'Business yearly', Price: '$169/yr', Offer: '40% off for life (founding member)', App: 'LevelPenny', Note: '3-person deck crew', website: '' };
    eq(JSON.stringify(sub.body), JSON.stringify(want), 'Apps Script payload');
    eq(await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort())), storeBefore, 'no new storage keys');
    check(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('dana@ridgeline'), 'email not stored locally');
    await page.$eval('#signup', e => e.scrollIntoView({ block: 'center' }));
    await shot(page, 'desktop-chrome-signup.png');
    // network error (fetch rejects; simulated in-page so it doesn't count as a failed request): show an error, keep what was typed
    await page.evaluate(() => { window.__realFetch = window.fetch; window.fetch = () => Promise.reject(new TypeError('Failed to fetch')); });
    await page.fill('#suEmail', 'lee@example.com'); await page.click('#signupSubmit');
    await page.waitForFunction(() => document.querySelector('#signupMsg').classList.contains('bad'));
    eq(await page.inputValue('#suEmail'), 'lee@example.com', 'input kept after a failed send');
    await page.evaluate(() => { window.fetch = window.__realFetch; });
    // honeypot filled = bot: nothing sent
    const n1 = submissions.length;
    await page.$eval('#suWebsite', e => { e.value = 'spam'; }); await page.click('#signupSubmit'); await page.waitForTimeout(300);
    eq(submissions.length, n1, 'honeypot blocks the send');
    await page.$eval('#suWebsite', e => { e.value = ''; });
    await page.click('.billing-seg label:has(input[value="monthly"])');
  });

  await step('Fallback: SIGNUP_SCRIPT_URL emptied → FormSubmit AJAX endpoint (intercepted): POSTs JSON, handles {success:"false"}', async () => {
    const FS = 'https://formsubmit.co/ajax/levelpennyapp@gmail.com';
    const cf = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await cf.addInitScript(INIT);
    await cf.route('**/js/config.js', route => route.fulfill({ contentType: 'text/javascript',
      body: fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace(/SIGNUP_SCRIPT_URL: '[^']*'/, "SIGNUP_SCRIPT_URL: ''") }));
    const pf = await cf.newPage(); watch(pf, 'signup-formsubmit');
    await pf.goto(BASE); await pf.check('#agreeTerms'); await pf.click('#tourSkip'); await pf.click('[data-view-link="plans"]');
    check((await text(pf, '#signupIdle')).startsWith('Sent by FormSubmit to levelpennyapp@gmail.com'), 'fallback idle note names FormSubmit');
    const n0 = submissions.length;
    await pf.selectOption('#suPlan', 'business-yearly');
    await pf.fill('#suEmail', 'dana@ridgeline.example'); await pf.fill('#suNote', '3-person deck crew');
    await pf.click('#signupSubmit');
    await pf.waitForFunction(() => document.querySelector('#signupMsg').classList.contains('ok'));
    eq(submissions.length, n0 + 1, 'exactly one (intercepted) submission');
    const sub = submissions[n0];
    eq(sub.url, FS, 'FormSubmit AJAX endpoint'); eq(sub.method, 'POST', 'POST');
    check(/application\/json/.test(sub.headers['content-type']) && /application\/json/.test(sub.headers.accept), 'JSON in, JSON out (AJAX)');
    const want = { email: 'dana@ridgeline.example', _replyto: 'dana@ridgeline.example', _subject: 'LevelPenny founding-list signup', _honey: '', _captcha: 'false', _template: 'table',
      Plan: 'Business yearly', Price: '$169/yr', Offer: '40% off for life (founding member)', App: 'LevelPenny', Note: '3-person deck crew' };
    eq(JSON.stringify(sub.body), JSON.stringify(want), 'FormSubmit payload');
    // FormSubmit sometimes answers 200 {success:"false"}: show an error, keep what was typed
    await pf.route(FS, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"success":"false","message":"x"}' }));
    await pf.fill('#suEmail', 'lee@example.com'); await pf.click('#signupSubmit');
    await pf.waitForFunction(() => document.querySelector('#signupMsg').classList.contains('bad'));
    eq(await pf.inputValue('#suEmail'), 'lee@example.com', 'input kept after a failed send');
    await cf.close();
  });

  await step('Signup with SIGNUP_SCRIPT_URL and SIGNUP_ENDPOINT emptied: "Signups open soon", sends and stores nothing', async () => {
    const c5 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c5.addInitScript(INIT);
    await c5.route('**/js/config.js', route => route.fulfill({ contentType: 'text/javascript',
      body: fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace(/SIGNUP_ENDPOINT: '[^']*'/, "SIGNUP_ENDPOINT: ''").replace(/SIGNUP_SCRIPT_URL: '[^']*'/, "SIGNUP_SCRIPT_URL: ''") }));
    const p5 = await c5.newPage(); watch(p5, 'signup-closed');
    const reqs = []; p5.on('request', r => { if (!r.url().startsWith(BASE)) reqs.push(r.url()); });
    const n0 = submissions.length;
    await p5.goto(BASE); await p5.check('#agreeTerms'); await p5.click('#tourSkip'); await p5.click('[data-view-link="plans"]');
    check((await text(p5, '#signupIdle')).includes('Signups open soon'), 'idle state says signups open soon');
    await p5.click('[data-plan-option="pro-monthly"]');
    await p5.fill('#suEmail', 'lee@example.com'); await p5.click('#signupSubmit');
    await p5.waitForSelector('#signupMsg:not([hidden])');
    check((await text(p5, '#signupMsg')).includes('Signups open soon. Nothing was sent or saved'), 'friendly soon state');
    eq(reqs.length, 0, 'no request left the page: ' + reqs.join(', '));
    eq(submissions.length, n0, 'nothing submitted');
    check(!(await p5.evaluate(() => JSON.stringify(localStorage))).includes('lee@example'), 'email not stored locally');
    await c5.close();
  });

  await step('Dev unlock (local only): ?dev-unlock=pro lifts the cap in this browser; turning it off restores Free', async () => {
    const c6 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c6.addInitScript(INIT);
    const p6 = await c6.newPage(); watch(p6, 'dev-unlock');
    await p6.goto(BASE + '?dev-unlock=pro#calculator'); await p6.check('#agreeTerms'); await p6.click('#tourSkip');
    check(!(await p6.evaluate(() => location.search)), 'param removed from the URL');
    for (let i = 0; i < 4; i++) { await p6.click('#newJob'); await p6.fill('#jobName', 'Job ' + (i + 1)); await p6.click('#saveJob'); }
    check(await p6.isHidden('#limitCalc'), 'no prompt with dev unlock');
    await p6.click('[data-view-link="jobs"]');
    eq(await p6.locator('#jobsTable tbody tr').count(), 4, '4 jobs saved with Pro dev unlock');
    eq(await text(p6, '#jobsUsage'), '4 saved jobs', 'usage without cap');
    await p6.click('[data-view-link="plans"]');
    check((await text(p6, '#devUnlockText')).includes('Not a subscription'), 'dev unlock is labelled');
    await p6.click('#devUnlockOff');
    check(await p6.isHidden('#devUnlockNote'), 'dev unlock off');
    await p6.click('[data-view-link="jobs"]');
    eq(await text(p6, '#jobsUsage'), '4 of 3 free saved jobs used · Pro and Business: unlimited', 'over the limit, nothing deleted');
    await p6.click('[data-view-link="calculator"]'); await p6.click('#newJob'); await p6.click('#saveJob');
    check(await p6.isVisible('#limitCalc'), 'Free limit back after turning off');
    await c6.close();
  });

  await step('One-click backup downloads profile, jobs, estimates and invoices as JSON', async () => {
    check((await text(page, '.site-foot')).includes('stored on this device only'), 'footer states local storage');
    const b = await download(page, () => page.click('.site-foot [data-backup]'));
    const data = JSON.parse(b.text);
    eq(data.format, 'job-profit-backup', 'format');
    eq(data.jobs.length, 3, 'jobs in backup');
    eq(data.docs.length, 2, 'docs in backup');
    eq(data.profile.companyName, 'Ridgeline Carpentry LLC', 'profile in backup');
    backupFile = b.path;
  });

  await step('Accessibility: labels, keyboard menu, axe-core (no serious/critical issues)', async () => {
    await page.click('[data-view-link="calculator"]');
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')].filter(e => e.type !== 'hidden' && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).map(e => e.id || e.name));
    eq(unlabeled.length, 0, 'unlabeled controls: ' + unlabeled.join(','));
    await page.focus('#moreBtn'); await page.keyboard.press('Enter');
    check(await page.isVisible('#moreMenu'), 'menu opens with keyboard');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    check(await page.isHidden('#moreMenu'), 'Escape closes menu');
    for (const v of ['calculator', 'jobs', 'documents', 'blueprints', 'profile', 'plans']) { await page.click(`[data-view-link="${v}"]`); await axe(page, v); }
    await page.click('[data-view-link="calculator"]');
    await page.click('#modeReverse');
    await axe(page, 'find my price');
  });

  await step('Legal pages: Terms (CT law, liability cap, attorney note) and Privacy', async () => {
    const href = await page.getAttribute('.site-foot a[href="terms.html"]', 'href');
    eq(href, 'terms.html', 'footer terms link');
    const tp = await ctx.newPage(); watch(tp, 'terms');
    await tp.goto(BASE + 'terms.html');
    const t = await tp.textContent('main');
    for (const s of ['Last updated', 'Connecticut', '12 MONTHS', 'attorney', 'INDEMNIF', 'AS IS', 'No guarantee of profit', 'not financial, tax, accounting, legal', 'templates', 'backups', 'Carina Dataworks']) check(t.toUpperCase().includes(s.toUpperCase()), 'terms mention ' + s);
    await tp.goto(BASE + 'privacy.html');
    check(t.includes('LevelPenny, a Carina Dataworks product'), 'terms name the product');
    check((await tp.textContent('main')).includes('only on your device'), 'privacy local storage');
    check((await tp.textContent('main')).includes('LevelPenny, a Carina Dataworks product'), 'privacy names the product');
    check((await tp.title()).includes('LevelPenny'), 'privacy title');
    await axe(tp, 'terms/privacy');
    await tp.close();
  });

  await step('Printable field guide fits on one Letter page', async () => {
    const gp = await ctx.newPage(); watch(gp, 'guide');
    await gp.goto(BASE + 'guide.html');
    check((await gp.title()).includes('LevelPenny'), 'name from config');
    check((await gp.textContent('main')).includes('$30.86/hr'), 'worked example');
    await gp.pdf({ path: path.join(SHOTS, 'field-guide.pdf'), format: 'Letter', printBackground: true, preferCSSPageSize: true });
    eq(pdfPages(path.join(SHOTS, 'field-guide.pdf')), 1, 'guide pages');
    rasterize(path.join(SHOTS, 'field-guide.pdf'), 'print-field-guide.png');
    await axe(gp, 'guide');
    await gp.close();
  });
  await ctx.close();

  // =============== RESTORE ON A "NEW DEVICE" ===============
  await step('Restore backup on a fresh browser (confirm dialog, bad file rejected)', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await c2.addInitScript(INIT);
    const p2 = await c2.newPage(); watch(p2, 'restore');
    await p2.goto(BASE);
    await p2.check('#agreeTerms'); await p2.click('#tourSkip');
    await p2.click('[data-view-link="profile"]');
    const bad = path.join(TMP, 'bad.json'); fs.writeFileSync(bad, '{"hello":"world"}');
    await p2.setInputFiles('#restoreFile', bad);
    await p2.waitForSelector('#restore-err:not([hidden])');
    check((await text(p2, '#restore-err')).includes('not a backup'), 'bad file explained');
    let dialogMsg = '';
    p2.once('dialog', d => { dialogMsg = d.message(); d.accept(); });
    await p2.setInputFiles('#restoreFile', backupFile);
    await p2.waitForFunction(() => document.querySelector('#pfName').value === 'Ridgeline Carpentry LLC');
    check(/3 jobs, 1 estimates and 1 invoices/.test(dialogMsg), 'confirm summarises backup: ' + dialogMsg);
    await p2.click('[data-view-link="jobs"]');
    eq(await p2.locator('#jobsTable tbody tr').count(), 3, 'jobs restored');
    await p2.click('[data-view-link="documents"]');
    eq(await p2.locator('#docsList li').count(), 2, 'documents restored');
    await c2.close();
  });

  // =============== MOBILE ===============
  await step('Mobile 390×844: welcome, calculator, sticky results bar, no sideways scroll', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
    await m.addInitScript(INIT);
    const mp = await m.newPage(); watch(mp, 'mobile');
    await mp.goto(BASE);
    await mp.waitForSelector('#tour:not([hidden])');
    await shot(mp, 'mobile-01-welcome.png');
    await mp.tap('#agreeTerms'); await mp.tap('#tourSkip');
    await mp.evaluate(() => window.scrollTo(0, 0));
    await shot(mp, 'mobile-02-calculator.png');
    const overflow = async () => mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    eq(await overflow(), 0, 'calculator horizontal overflow');
    check(await mp.isVisible('#mobileBar'), 'sticky results bar');
    eq(await text(mp, '#mbNet'), '$1,296.12', 'mobile bar net');
    eq(await text(mp, '#mbPph'), '$30.86/hr', 'mobile bar per hour');
    const small = await mp.evaluate(() => [...document.querySelectorAll('section[data-view="calculator"] button, section[data-view="calculator"] input:not([type=radio]):not([type=checkbox]), section[data-view="calculator"] select, section[data-view="calculator"] .seg label, .tabs a, .topbar button')]
      .filter(e => e.offsetParent !== null).map(e => ({ id: e.id || e.textContent.trim().slice(0, 20), h: e.getBoundingClientRect().height })).filter(x => x.h < 34));
    eq(small.length, 0, 'tap targets under 34px: ' + JSON.stringify(small));
    await mp.$eval('#secMaterials', e => e.scrollIntoView());
    await shot(mp, 'mobile-03-inputs.png');
    await mp.tap('#mbSee');
    await mp.waitForTimeout(1800);
    await shot(mp, 'mobile-04-results.png');
    await mp.evaluate(() => window.scrollTo(0, 0));
    await mp.tap('#modeReverse');
    await mp.$eval('#secPrice', e => e.scrollIntoView());
    await mp.waitForTimeout(100);
    await shot(mp, 'mobile-05-find-my-price.png');
    check((await text(mp, '#quotePrice')).startsWith('$'), 'quote on mobile');
    await mp.tap('#quoteEstimate');
    await mp.waitForSelector('[data-view="documents"]:not([hidden])');
    eq(await overflow(), 0, 'documents horizontal overflow');
    await mp.evaluate(() => window.scrollTo(0, 0));
    await shot(mp, 'mobile-06-estimate.png');
    await mp.$eval('.preview-wrap', e => e.scrollIntoView());
    await mp.waitForTimeout(3600);
    await shot(mp, 'mobile-07-estimate-preview.png');
    for (const v of ['jobs', 'blueprints', 'profile', 'plans']) {
      await mp.evaluate(v2 => { location.hash = v2; }, v);
      await mp.waitForSelector(`[data-view="${v}"]:not([hidden])`);
      eq(await overflow(), 0, v + ' horizontal overflow');
    }
    await mp.evaluate(() => { location.hash = 'blueprints'; });
    await mp.waitForTimeout(3600);
    await shot(mp, 'mobile-08-templates.png');
    await m.close();
  });

  await step('Renaming the product in js/config.js updates every surface', async () => {
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await c3.addInitScript(INIT);
    await c3.route('**/js/config.js', async route => {
      const body = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace("name: 'LevelPenny'", "name: 'CrewMargin Test'");
      await route.fulfill({ body, contentType: 'text/javascript' });
    });
    const p3 = await c3.newPage(); watch(p3, 'rename');
    await p3.goto(BASE);
    eq(await p3.title(), 'CrewMargin Test — by Carina Dataworks', 'document title');
    eq(await text(p3, '.brand-name'), 'CrewMargin Test', 'header');
    check((await text(p3, '.site-foot')).startsWith('CrewMargin Test · by Carina Dataworks'), 'footer');
    await p3.check('#agreeTerms'); await p3.click('#tourSkip');
    await p3.click('#moreBtn'); await p3.click('[data-action="print-jobsheet"]');
    check((await text(p3, '#printRoot')).includes('CrewMargin Test · Internal job sheet'), 'job sheet footer');
    await p3.goto(BASE + 'guide.html');
    check((await p3.title()).includes('CrewMargin Test'), 'guide title');
    await c3.close();
  });

  await step('Works when index.html is opened straight from disk (file://)', async () => {
    const c4 = await browser.newContext();
    const p4 = await c4.newPage(); watch(p4, 'file');
    await p4.goto('file://' + path.join(ROOT, 'index.html'));
    eq(await text(p4, '#outNet'), '$1,296.12', 'calculates from file://');
    await c4.close();
  });

  await step('No console errors, warnings, failed requests, page errors or internet requests (all blocked)', async () => {
    eq(consoleProblems.length, 0, 'console problems:\n' + consoleProblems.join('\n'));
    eq(blockedNet.length, 0, 'requests to the internet were attempted (and blocked):\n' + blockedNet.join('\n'));
  });

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed. Screenshots in ${SHOTS}`);
  if (failed.length) { failed.forEach(f => console.log(' FAIL:', f.name, '-', f.err)); process.exit(1); }
})().catch(e => { console.error('E2E crashed during "' + current + '":', e); process.exit(1); });
